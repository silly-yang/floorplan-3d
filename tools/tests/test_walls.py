from typing import Any

import pytest

from floorplan_tool.config import parse_config
from floorplan_tool.dxf import parse_dxf
from floorplan_tool.geometry import polygon_area
from floorplan_tool.walls import extract_walls
from tests.conftest import DxfFactory


def test_extract_walls_with_rc_lines_should_build_rc_polygon(
    dxf: DxfFactory, raw_config: dict[str, Any]
) -> None:
    # Arrange
    doc = parse_dxf(dxf.document(dxf.rect_lines("L3", 0, 0, 300, 15)))

    # Act
    result = extract_walls(doc, parse_config(raw_config))

    # Assert
    assert [w.kind for w in result.walls] == ["rc"]
    assert abs(polygon_area(result.walls[0].polygon)) == pytest.approx(4500.0)
    assert result.open_chains == 0


@pytest.mark.parametrize(
    ("layer", "expected_kind"),
    [("WALL2", "partition"), ("L12", "column")],
    ids=["輕隔間", "柱子"],
)
def test_extract_walls_with_closed_lwpolyline_should_map_layer_to_kind(
    dxf: DxfFactory, raw_config: dict[str, Any], layer: str, expected_kind: str
) -> None:
    # Arrange
    square = [(0.0, 0.0), (10.0, 0.0), (10.0, 120.0), (0.0, 120.0)]
    doc = parse_dxf(dxf.document([dxf.lwpolyline(layer, square, closed=True)]))

    # Act
    result = extract_walls(doc, parse_config(raw_config))

    # Assert
    assert [w.kind for w in result.walls] == [expected_kind]
    assert abs(polygon_area(result.walls[0].polygon)) == pytest.approx(1200.0)


def test_extract_walls_should_ignore_other_layers_and_outside_clip(
    dxf: DxfFactory, raw_config: dict[str, Any]
) -> None:
    # Arrange
    raw_config["clip"] = {"xMin": 0, "yMin": 0, "xMax": 1000, "yMax": 1000}
    entities = (
        dxf.rect_lines("L3", 0, 0, 300, 15)
        + dxf.rect_lines("L3", 2300, 0, 2600, 15)
        + dxf.rect_lines("S01-RC大梁", 0, 100, 300, 130)
    )
    doc = parse_dxf(dxf.document(entities))

    # Act
    result = extract_walls(doc, parse_config(raw_config))

    # Assert
    assert len(result.walls) == 1


def test_extract_walls_with_unclosed_lines_should_count_open_chains(
    dxf: DxfFactory, raw_config: dict[str, Any]
) -> None:
    # Arrange
    doc = parse_dxf(
        dxf.document([dxf.line("L3", (0, 0), (300, 0)), dxf.line("L3", (300, 0), (300, 300))])
    )

    # Act
    result = extract_walls(doc, parse_config(raw_config))

    # Assert
    assert result.walls == []
    assert result.open_chains == 1


def test_extract_walls_with_touching_closed_polylines_should_keep_them_separate(
    dxf: DxfFactory, raw_config: dict[str, Any]
) -> None:
    # Arrange：ㄈ 形三塊隔間牆，中間那塊的兩端都和上下兩塊共用頂點
    entities = [
        dxf.lwpolyline("WALL2", [(0, 0), (300, 0), (300, 10), (0, 10)], closed=True),
        dxf.lwpolyline("WALL2", [(0, 10), (10, 10), (10, 190), (0, 190)], closed=True),
        dxf.lwpolyline("WALL2", [(0, 190), (300, 190), (300, 200), (0, 200)], closed=True),
    ]
    doc = parse_dxf(dxf.document(entities))

    # Act
    result = extract_walls(doc, parse_config(raw_config))

    # Assert
    areas = sorted(abs(polygon_area(w.polygon)) for w in result.walls)
    assert areas == pytest.approx([1800.0, 3000.0, 3000.0])


def test_extract_walls_with_touching_line_rects_should_keep_them_separate(
    dxf: DxfFactory, raw_config: dict[str, Any]
) -> None:
    # Arrange：同上的 ㄈ 形，但每塊牆用四條 LINE 畫，共用頂點在線段圖上會變成四岔路口
    entities = (
        dxf.rect_lines("L3", 0, 0, 300, 15)
        + dxf.rect_lines("L3", 0, 15, 15, 185)
        + dxf.rect_lines("L3", 0, 185, 300, 200)
    )
    doc = parse_dxf(dxf.document(entities))

    # Act
    result = extract_walls(doc, parse_config(raw_config))

    # Assert
    areas = sorted(abs(polygon_area(w.polygon)) for w in result.walls)
    assert areas == pytest.approx([2550.0, 4500.0, 4500.0])
