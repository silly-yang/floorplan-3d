import json
from typing import Any

import pytest

from floorplan_tool.builder import FLOORPLAN_VERSION, build_floorplan
from floorplan_tool.config import parse_config
from floorplan_tool.dxf import parse_dxf
from tests.conftest import DxfFactory

OFFSET = 1000.0


# 一個 300×200（cm）、牆厚 15 的房間，下牆中間留 90 的門洞；整體平移 OFFSET 模擬圖面座標
def _room_entities(dxf: DxfFactory) -> list[str]:
    o = OFFSET
    return (
        dxf.rect_lines("L3", o + 0, o + 0, o + 100, o + 15)
        + dxf.rect_lines("L3", o + 190, o + 0, o + 300, o + 15)
        + dxf.rect_lines("L3", o + 0, o + 185, o + 300, o + 200)
        + dxf.rect_lines("L3", o + 0, o + 15, o + 15, o + 185)
        + dxf.rect_lines("L3", o + 285, o + 15, o + 300, o + 185)
    )


def _build(dxf: DxfFactory, raw_config: dict[str, Any], extra: list[str] | None = None) -> Any:
    raw_config["rooms"] = [{"id": "living", "name": "客廳", "seed": [OFFSET + 150, OFFSET + 100]}]
    doc = parse_dxf(dxf.document(_room_entities(dxf) + (extra or [])))
    return build_floorplan(doc, parse_config(raw_config))


def test_build_floorplan_should_output_versioned_metric_document(
    dxf: DxfFactory, raw_config: dict[str, Any]
) -> None:
    # Act
    floorplan = _build(dxf, raw_config).floorplan

    # Assert
    assert floorplan["version"] == FLOORPLAN_VERSION
    assert floorplan["units"] == "m"
    assert floorplan["bounds"] == {"width": 3.0, "depth": 2.0}
    assert len(floorplan["walls"]) == 5
    assert {w["kind"] for w in floorplan["walls"]} == {"rc"}


def test_build_floorplan_should_shift_origin_and_scale_to_meters(
    dxf: DxfFactory, raw_config: dict[str, Any]
) -> None:
    # Act
    floorplan = _build(dxf, raw_config).floorplan

    # Assert
    points = [p for w in floorplan["walls"] for p in w["polygon"]]
    assert min(x for x, _ in points) == 0.0
    assert min(y for _, y in points) == 0.0
    assert max(x for x, _ in points) == 3.0
    assert max(y for _, y in points) == 2.0


def test_build_floorplan_should_round_coordinates_to_millimeter(
    dxf: DxfFactory, raw_config: dict[str, Any]
) -> None:
    # Arrange
    extra = dxf.rect_lines("WALL2", OFFSET + 50.12345, OFFSET + 50, OFFSET + 60.12345, OFFSET + 90)
    raw_config["clip"] = {"xMin": 0, "yMin": 0, "xMax": 5000, "yMax": 5000}

    # Act
    floorplan = _build(dxf, raw_config, extra).floorplan

    # Assert
    partition = next(w for w in floorplan["walls"] if w["kind"] == "partition")
    assert {x for x, _ in partition["polygon"]} == {0.501, 0.601}


def test_build_floorplan_should_include_doorway_and_room(
    dxf: DxfFactory, raw_config: dict[str, Any]
) -> None:
    # Act
    floorplan = _build(dxf, raw_config).floorplan

    # Assert
    assert [(o["id"], o["kind"]) for o in floorplan["openings"]] == [("doorway-1", "doorway")]
    room = floorplan["rooms"][0]
    assert (room["id"], room["name"]) == ("living", "客廳")
    area = sum((x1 - x0) * (y1 - y0) for x0, y0, x1, y1 in room["rects"])
    assert area == pytest.approx(2.7 * 1.7)


def test_build_floorplan_should_never_output_drawing_text(
    dxf: DxfFactory, raw_config: dict[str, Any]
) -> None:
    # Arrange：圖面文字可能含地址、社區名、樓層，絕對不能流進公開的 JSON
    secret = "某某市某某路1號3F"
    extra = [
        dxf.text("表格", (OFFSET + 50, OFFSET + 50), secret),
        dxf.attrib("OPEN-Window", (OFFSET + 50, OFFSET + 60), "NO.", secret),
    ]

    # Act
    floorplan = _build(dxf, raw_config, extra).floorplan

    # Assert
    assert secret not in json.dumps(floorplan, ensure_ascii=False)


def test_build_floorplan_with_unclosed_wall_should_warn(
    dxf: DxfFactory, raw_config: dict[str, Any]
) -> None:
    # Arrange
    extra = [dxf.line("L3", (OFFSET + 50, OFFSET + 50), (OFFSET + 120, OFFSET + 50))]

    # Act
    warnings = _build(dxf, raw_config, extra).warnings

    # Assert
    assert any("沒有封閉" in w for w in warnings)


def test_build_floorplan_with_railing_line_should_close_room(
    dxf: DxfFactory, raw_config: dict[str, Any]
) -> None:
    # Arrange：上方沒有牆，只有一條欄杆線（陽台）；欄杆刻意不落在填色格子中心上
    o = OFFSET
    entities = [
        *dxf.rect_lines("L3", o + 0, o + 0, o + 100, o + 15),
        *dxf.rect_lines("L3", o + 190, o + 0, o + 300, o + 15),
        *dxf.rect_lines("L3", o + 0, o + 15, o + 15, o + 200),
        *dxf.rect_lines("L3", o + 285, o + 15, o + 300, o + 200),
        dxf.line("L23", (o + 15, o + 190), (o + 285, o + 190)),
    ]
    raw_config["rooms"] = [{"id": "balcony", "name": "陽台", "seed": [o + 150, o + 100]}]
    doc = parse_dxf(dxf.document(entities))

    # Act
    floorplan = build_floorplan(doc, parse_config(raw_config)).floorplan

    # Assert
    rects = floorplan["rooms"][0]["rects"]
    assert max(r[3] for r in rects) <= 1.9
