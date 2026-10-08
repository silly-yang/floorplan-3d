from typing import Any

import pytest

from floorplan_tool.config import parse_config
from floorplan_tool.dxf import parse_dxf
from floorplan_tool.exceptions import ConfigError
from floorplan_tool.geometry import polygon_area
from floorplan_tool.openings import find_gaps, find_openings
from floorplan_tool.walls import Wall, extract_walls
from tests.conftest import DxfFactory


# 兩段 RC 牆沿 x 軸排列，中間留 gap 寬的開口（x 從 100 到 100+gap，牆厚 15）
def _two_walls(dxf: DxfFactory, gap: float) -> list[str]:
    return dxf.rect_lines("L3", 0, 0, 100, 15) + dxf.rect_lines("L3", 100 + gap, 0, 300 + gap, 15)


def _walls(dxf: DxfFactory, entities: list[str], raw_config: dict[str, Any]) -> list[Wall]:
    return extract_walls(parse_dxf(dxf.document(entities)), parse_config(raw_config)).walls


def test_find_gaps_with_90cm_gap_should_return_one_rect_across_wall(
    dxf: DxfFactory, raw_config: dict[str, Any]
) -> None:
    # Arrange
    walls = _walls(dxf, _two_walls(dxf, 90), raw_config)

    # Act
    gaps = find_gaps(walls, gap_min=30, gap_max=250)

    # Assert：兩側牆端都會射到對方，要去重成一個
    assert len(gaps) == 1
    xs = sorted({round(x, 3) for x, _ in gaps[0]})
    ys = sorted({round(y, 3) for _, y in gaps[0]})
    assert (xs, ys) == ([100.0, 190.0], [0.0, 15.0])


def test_find_gaps_with_partition_end_facing_long_wall_face_should_find_gap(
    dxf: DxfFactory, raw_config: dict[str, Any]
) -> None:
    # Arrange：隔間牆端面朝下，對面是一道橫牆的長邊（不是另一個牆端）
    entities = [
        dxf.lwpolyline("WALL2", [(0, 0), (300, 0), (300, 10), (0, 10)], closed=True),
        dxf.lwpolyline("WALL2", [(100, 100), (110, 100), (110, 400), (100, 400)], closed=True),
    ]
    walls = _walls(dxf, entities, raw_config)

    # Act
    gaps = find_gaps(walls, gap_min=30, gap_max=250)

    # Assert
    assert len(gaps) == 1
    assert abs(polygon_area(gaps[0])) == pytest.approx(10 * 90)


@pytest.mark.parametrize(
    "gap",
    [0, 20, 400],
    ids=["牆相接", "小於下限", "大於上限"],
)
def test_find_gaps_with_gap_out_of_range_should_ignore(
    dxf: DxfFactory, raw_config: dict[str, Any], gap: float
) -> None:
    # Arrange
    walls = _walls(dxf, _two_walls(dxf, gap), raw_config)

    # Act
    gaps = find_gaps(walls, gap_min=30, gap_max=250)

    # Assert
    assert gaps == []


def test_find_openings_with_window_lines_in_gap_should_classify_window(
    dxf: DxfFactory, raw_config: dict[str, Any]
) -> None:
    # Arrange
    entities = [
        *_two_walls(dxf, 160),
        dxf.line("OPEN-Window", (100, 7.5), (260, 7.5)),
        dxf.attrib("OPEN-Window", (170, 60), "NO.", "W5"),
    ]
    doc = parse_dxf(dxf.document(entities))
    config = parse_config(raw_config)
    walls = extract_walls(doc, config).walls

    # Act
    openings = find_openings(doc, walls, config)

    # Assert
    assert len(openings) == 1
    opening = openings[0]
    assert (opening.id, opening.kind, opening.label) == ("W5-1", "window", "W5")
    assert (opening.sill, opening.head) == (0.9, 2.1)


def test_find_openings_with_window_label_missing_in_config_should_raise(
    dxf: DxfFactory, raw_config: dict[str, Any]
) -> None:
    # Arrange
    entities = [
        *_two_walls(dxf, 160),
        dxf.line("OPEN-Window", (100, 7.5), (260, 7.5)),
        dxf.attrib("OPEN-Window", (170, 60), "NO.", "W9"),
    ]
    doc = parse_dxf(dxf.document(entities))
    config = parse_config(raw_config)
    walls = extract_walls(doc, config).walls

    # Act & Assert
    with pytest.raises(ConfigError, match="W9"):
        find_openings(doc, walls, config)


def test_find_openings_with_door_insert_at_gap_should_classify_door(
    dxf: DxfFactory, raw_config: dict[str, Any]
) -> None:
    # Arrange：門的標籤在真實圖面是 ATTDEF，標籤字放在 tag
    entities = [
        *_two_walls(dxf, 110),
        dxf.insert("OPEN-Door", "DOOR1", (100, 15)),
        dxf.attdef("OPEN-Door", (150, -60), "FD2", "D7"),
    ]
    blocks = {"DOOR1": [dxf.arc("OPEN-Door", (0, 0), 100, 270, 0)]}
    doc = parse_dxf(dxf.document(entities, blocks))
    config = parse_config(raw_config)
    walls = extract_walls(doc, config).walls

    # Act
    openings = find_openings(doc, walls, config)

    # Assert
    assert [(o.id, o.kind, o.label, o.sill, o.head) for o in openings] == [
        ("FD2-1", "door", "FD2", 0.0, 2.1)
    ]


def test_find_openings_with_nothing_in_gap_should_classify_doorway(
    dxf: DxfFactory, raw_config: dict[str, Any]
) -> None:
    # Arrange
    doc = parse_dxf(dxf.document(_two_walls(dxf, 90)))
    config = parse_config(raw_config)
    walls = extract_walls(doc, config).walls

    # Act
    openings = find_openings(doc, walls, config)

    # Assert
    assert [(o.id, o.kind, o.label, o.sill, o.head) for o in openings] == [
        ("doorway-1", "doorway", "", 0.0, 2.2)
    ]


def test_find_openings_with_ignored_id_should_drop_it(
    dxf: DxfFactory, raw_config: dict[str, Any]
) -> None:
    # Arrange
    raw_config["ignoreOpenings"] = ["doorway-1"]
    doc = parse_dxf(dxf.document(_two_walls(dxf, 90)))
    config = parse_config(raw_config)
    walls = extract_walls(doc, config).walls

    # Act
    openings = find_openings(doc, walls, config)

    # Assert
    assert openings == []


def test_find_openings_with_free_text_label_should_not_use_it_as_label(
    dxf: DxfFactory, raw_config: dict[str, Any]
) -> None:
    # Arrange：編號只接受 W5、FD2 這類代號，圖面上的地址之類的文字不能變成輸出的 label
    entities = [
        *_two_walls(dxf, 160),
        dxf.line("OPEN-Window", (100, 7.5), (260, 7.5)),
        dxf.attrib("OPEN-Window", (170, 60), "NO.", "某某路1號"),
    ]
    doc = parse_dxf(dxf.document(entities))
    config = parse_config(raw_config)
    walls = extract_walls(doc, config).walls

    # Act & Assert
    with pytest.raises(ConfigError, match="沒有編號"):
        find_openings(doc, walls, config)


def test_find_openings_with_door_near_two_gaps_should_mark_only_nearest_as_door(
    dxf: DxfFactory, raw_config: dict[str, Any]
) -> None:
    # Arrange：三段牆留兩個開口，門的插入點貼著第一個、離第二個 20 單位
    entities = [
        *dxf.rect_lines("L3", 0, 0, 100, 15),
        *dxf.rect_lines("L3", 175, 0, 195, 15),
        *dxf.rect_lines("L3", 285, 0, 400, 15),
        dxf.insert("OPEN-Door", "DOOR1", (165, 15)),
    ]
    blocks = {"DOOR1": [dxf.arc("OPEN-Door", (0, 0), 70, 180, 270)]}
    doc = parse_dxf(dxf.document(entities, blocks))
    config = parse_config(raw_config)
    walls = extract_walls(doc, config).walls

    # Act
    openings = find_openings(doc, walls, config)

    # Assert
    assert [o.kind for o in openings] == ["door", "doorway"]
