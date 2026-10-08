import json
from typing import Any

import pytest

from floorplan_tool.builder import build_floorplan
from floorplan_tool.config import parse_config
from floorplan_tool.dxf import parse_dxf
from floorplan_tool.exceptions import ConfigError
from floorplan_tool.outlets import Outlet, OutletKind, classify, find_outlets
from tests.conftest import DxfFactory

OFFSET = 1000.0
SHEET = 3000.0  # 水電圖畫在建築平面圖右邊這麼遠的地方


def _electrical_config(raw_config: dict[str, Any]) -> dict[str, Any]:
    raw_config["layers"]["outlet"] = ["01插座設備"]
    raw_config["layers"]["wallDevice"] = ["01照明設備", "02電視設備", "02電話設備"]
    raw_config["electricalOffset"] = [SHEET, 0]
    return raw_config


@pytest.mark.parametrize(
    ("block_name", "expected"),
    [
        ("01正常插座", OutletKind("outlet-110", 0.3)),
        ("01冷氣插座", OutletKind("outlet-220", 2.3)),
        ("16電陶爐專插電源插座", OutletKind("outlet-220", 1.1)),
        ("15暖風機電源", OutletKind("outlet-220", 2.3)),
        ("03排油煙機電源", OutletKind("outlet-dedicated", 2.0)),
        ("11微波爐專插電源", OutletKind("outlet-dedicated", 1.2)),
        ("07烘碗機電源", OutletKind("outlet-dedicated", 1.2)),
        ("一般檯面插座", OutletKind("outlet-110", 1.1)),
        ("12浴室插座", OutletKind("outlet-110", 1.2)),
        ("13洗衣機插座", OutletKind("outlet-110", 1.2)),
        ("06冰箱電源", OutletKind("outlet-110", 1.2)),
        ("09水槽燈電源", OutletKind("outlet-110", 1.2)),
        ("02免治馬桶電源", OutletKind("outlet-110", 0.45)),
        ("11單切開關", OutletKind("switch", 1.2)),
        ("11雙切開關", OutletKind("switch", 1.2)),
        ("01電視資訊", OutletKind("tv-jack", 0.3)),
        ("01電話資訊出口", OutletKind("lan-jack", 0.3)),
    ],
    ids=[
        "一般插座",
        "冷氣 220V 高掛",
        "電陶爐 220V 專用",
        "暖風機 220V 專用",
        "排油煙機專用迴路",
        "微波爐專用迴路",
        "烘碗機專用迴路",
        "檯面插座",
        "浴室插座",
        "洗衣機插座",
        "冰箱插座",
        "水槽燈電源",
        "免治馬桶",
        "單切開關",
        "雙切開關",
        "電視出口",
        "網路出口",
    ],
)
def test_classify_should_map_block_name_to_type_and_height(
    block_name: str, expected: OutletKind
) -> None:
    # Act
    kind = classify(block_name)

    # Assert
    assert kind == expected


@pytest.mark.parametrize(
    "block_name",
    ["01出線口", "02陽台燈", "DD資訊箱"],
    ids=["燈具出線口", "陽台燈", "資訊箱"],
)
def test_classify_with_non_outlet_block_should_return_none(block_name: str) -> None:
    # Act
    kind = classify(block_name)

    # Assert
    assert kind is None


def test_find_outlets_should_shift_sheet_offset_and_clip(
    dxf: DxfFactory, raw_config: dict[str, Any]
) -> None:
    # Arrange：clip 範圍以建築平面圖為準，水電圖要先扣掉位移
    raw_config = _electrical_config(raw_config)
    raw_config["clip"] = {"xMin": 0, "yMin": 0, "xMax": 2000, "yMax": 2000}
    entities = [
        dxf.insert("01插座設備", "01冷氣插座", (SHEET + 500, 300)),
        dxf.insert("01照明設備", "11單切開關", (SHEET + 100, 200)),
        dxf.insert("01插座設備", "01正常插座", (SHEET + 2500, 300)),
    ]
    doc = parse_dxf(dxf.document(entities))

    # Act
    result = find_outlets(doc, parse_config(raw_config))

    # Assert
    assert result.outlets == [
        Outlet("switch", (100.0, 200.0), 1.2),
        Outlet("outlet-220", (500.0, 300.0), 2.3),
    ]
    assert result.warnings == []


def test_find_outlets_should_ignore_blocks_on_other_layers(
    dxf: DxfFactory, raw_config: dict[str, Any]
) -> None:
    # Arrange
    raw_config = _electrical_config(raw_config)
    doc = parse_dxf(dxf.document([dxf.insert("家具", "01正常插座", (SHEET + 100, 100))]))

    # Act
    result = find_outlets(doc, parse_config(raw_config))

    # Assert
    assert result.outlets == []


def test_find_outlets_with_unknown_block_on_outlet_layer_should_fallback_and_warn(
    dxf: DxfFactory, raw_config: dict[str, Any]
) -> None:
    # Arrange：插座圖層上的圖塊一定是插座，認不出名稱就當一般插座並提醒
    raw_config = _electrical_config(raw_config)
    doc = parse_dxf(dxf.document([dxf.insert("01插座設備", "XX特殊電源", (SHEET + 100, 100))]))

    # Act
    result = find_outlets(doc, parse_config(raw_config))

    # Assert
    assert result.outlets == [Outlet("outlet-110", (100.0, 100.0), 0.3)]
    assert len(result.warnings) == 1
    assert "XX特殊電源" in result.warnings[0]


def test_find_outlets_with_unknown_block_on_device_layer_should_skip_silently(
    dxf: DxfFactory, raw_config: dict[str, Any]
) -> None:
    # Arrange：開關所在的照明圖層也有燈具，那些不是插座
    raw_config = _electrical_config(raw_config)
    entities = [
        dxf.insert("01照明設備", "01出線口", (SHEET + 100, 100)),
        dxf.insert("02電話設備", "DD資訊箱", (SHEET + 200, 100)),
    ]
    doc = parse_dxf(dxf.document(entities))

    # Act
    result = find_outlets(doc, parse_config(raw_config))

    # Assert
    assert result.outlets == []
    assert result.warnings == []


def _room_entities(dxf: DxfFactory) -> list[str]:
    o = OFFSET
    return (
        dxf.rect_lines("L3", o + 0, o + 0, o + 300, o + 15)
        + dxf.rect_lines("L3", o + 0, o + 185, o + 300, o + 200)
        + dxf.rect_lines("L3", o + 0, o + 15, o + 15, o + 185)
        + dxf.rect_lines("L3", o + 285, o + 15, o + 300, o + 185)
    )


def test_build_floorplan_should_output_outlets_in_plan_meters_without_text(
    dxf: DxfFactory, raw_config: dict[str, Any]
) -> None:
    # Arrange
    raw_config = _electrical_config(raw_config)
    entities = [
        *_room_entities(dxf),
        dxf.insert("01插座設備", "01冷氣插座", (SHEET + OFFSET + 150, OFFSET + 20)),
        dxf.insert("02電話設備", "01電話資訊出口", (SHEET + OFFSET + 20, OFFSET + 100)),
    ]
    doc = parse_dxf(dxf.document(entities))

    # Act
    result = build_floorplan(doc, parse_config(raw_config))

    # Assert
    outlets = result.floorplan["outlets"]
    assert outlets == [
        {"type": "outlet-220", "x": 1.5, "y": 0.2, "height": 2.3},
        {"type": "lan-jack", "x": 0.2, "y": 1.0, "height": 0.3},
    ]
    text = json.dumps(result.floorplan, ensure_ascii=False)
    assert "冷氣" not in text
    assert "資訊" not in text


def test_build_floorplan_should_pass_outlet_warnings(
    dxf: DxfFactory, raw_config: dict[str, Any]
) -> None:
    # Arrange
    raw_config = _electrical_config(raw_config)
    entities = [
        *_room_entities(dxf),
        dxf.insert("01插座設備", "XX特殊電源", (SHEET + OFFSET + 150, OFFSET + 20)),
    ]
    doc = parse_dxf(dxf.document(entities))

    # Act
    result = build_floorplan(doc, parse_config(raw_config))

    # Assert
    assert any("XX特殊電源" in w for w in result.warnings)
    assert "XX特殊電源" not in json.dumps(result.floorplan, ensure_ascii=False)


def test_parse_config_should_read_electrical_layers_and_offset(
    raw_config: dict[str, Any],
) -> None:
    # Act
    config = parse_config(_electrical_config(raw_config))

    # Assert
    assert config.layers.outlet == ["01插座設備"]
    assert config.layers.wall_device == ["01照明設備", "02電視設備", "02電話設備"]
    assert config.electrical_offset == (SHEET, 0.0)


def test_parse_config_without_electrical_offset_should_default_to_zero(
    raw_config: dict[str, Any],
) -> None:
    # Act
    config = parse_config(raw_config)

    # Assert
    assert config.electrical_offset == (0.0, 0.0)


@pytest.mark.parametrize(
    "bad_value",
    [[1], "3000,0", [1, "a"]],
    ids=["少一個數字", "字串", "含非數字"],
)
def test_parse_config_with_invalid_electrical_offset_should_name_the_field(
    raw_config: dict[str, Any], bad_value: Any
) -> None:
    # Arrange
    raw_config["electricalOffset"] = bad_value

    # Act & Assert
    with pytest.raises(ConfigError, match="electricalOffset"):
        parse_config(raw_config)
