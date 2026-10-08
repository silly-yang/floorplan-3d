import json
import re
from typing import Any

import pytest

from floorplan_tool.builder import build_floorplan
from floorplan_tool.ceiling_services import (
    Detector,
    DeviceKind,
    Duct,
    DuctKind,
    classify_device,
    classify_duct,
    find_ceiling_services,
)
from floorplan_tool.config import Box, ServiceSheets, parse_config
from floorplan_tool.dxf import parse_dxf
from floorplan_tool.exceptions import ConfigError
from tests.conftest import DxfFactory

FIRE = 4000.0  # 消防圖畫在建築平面圖右邊這麼遠
PLUMBING = 6000.0  # 給排水通風圖再更右邊；兩者不同，扣錯位移才會被抓到
SPRINKLER = "撒水-密閉式撒水(向下型)-2.3m"
SMOKE = "F217偵煙式局限型探測器(2種)"
HEAT = "F209定溫式局限型探測器(1種)"
BOUNDS = Box(0, 0, 2000, 2000)


def _services_config(raw_config: dict[str, Any]) -> dict[str, Any]:
    raw_config["clip"] = {"xMin": 0, "yMin": 0, "xMax": 2000, "yMax": 2000}
    raw_config["layers"]["fireDevice"] = ["03-撒水", "F-偵煙", "F-定溫"]
    raw_config["layers"]["duct"] = ["機電-排油管", "機電-單排", "05通風管"]
    raw_config["serviceSheets"] = {"fire": [FIRE, 0], "plumbing": [PLUMBING, 10]}
    return raw_config


@pytest.mark.parametrize(
    ("block_name", "expected"),
    [
        (SPRINKLER, DeviceKind("sprinkler")),
        ("灑水頭", DeviceKind("sprinkler")),
        (SMOKE, DeviceKind("detector", "smoke")),
        (HEAT, DeviceKind("detector", "heat")),
        ("差動式探測器", DeviceKind("detector", "heat")),
    ],
    ids=["撒水頭", "灑水頭異體字", "偵煙探測器", "定溫探測器", "差動探測器"],
)
def test_classify_device_should_map_block_name_to_kind(
    block_name: str, expected: DeviceKind
) -> None:
    # Act
    kind = classify_device(block_name)

    # Assert
    assert kind == expected


@pytest.mark.parametrize(
    "block_name",
    ["F307揚聲器(壁掛式)", "F603緊急照明燈(壁掛式)", "A$C27727ED4"],
    ids=["壁掛揚聲器", "壁掛緊急照明", "匿名圖塊"],
)
def test_classify_device_with_non_ceiling_block_should_return_none(block_name: str) -> None:
    # Act
    kind = classify_device(block_name)

    # Assert
    assert kind is None


@pytest.mark.parametrize(
    ("layer", "expected"),
    [
        ("機電-排油管", DuctKind("range-hood", 0.15, vent=False)),
        ("機電-單排", DuctKind("exhaust", 0.10, vent=True)),
        ("浴室排風管", DuctKind("exhaust", 0.10, vent=True)),
    ],
    ids=["排油煙管", "浴室單排", "排風管"],
)
def test_classify_duct_should_map_layer_to_kind_with_default_size(
    layer: str, expected: DuctKind
) -> None:
    # Act
    kind = classify_duct(layer)

    # Assert
    assert kind == expected


def test_classify_duct_with_unrelated_layer_should_return_none() -> None:
    # Act
    kind = classify_duct("05通風管")

    # Assert
    assert kind is None


def test_find_ceiling_services_should_shift_fire_sheet_offset_and_clip(
    dxf: DxfFactory, raw_config: dict[str, Any]
) -> None:
    # Arrange：clip 以建築平面圖為準；最後一個扣掉位移後落在 clip 外
    entities = [
        dxf.insert("03-撒水", SPRINKLER, (FIRE + 500, 300)),
        dxf.insert("F-偵煙", SMOKE, (FIRE + 100, 200)),
        dxf.insert("F-定溫", HEAT, (FIRE + 700, 900)),
        dxf.insert("03-撒水", SPRINKLER, (FIRE + 2500, 300)),
    ]
    doc = parse_dxf(dxf.document(entities))

    # Act
    result = find_ceiling_services(doc, parse_config(_services_config(raw_config)), BOUNDS)

    # Assert
    assert result.sprinklers == [(500.0, 300.0)]
    assert result.detectors == [Detector("smoke", (100.0, 200.0)), Detector("heat", (700.0, 900.0))]
    assert result.warnings == []


def test_find_ceiling_services_should_not_read_devices_without_fire_offset(
    dxf: DxfFactory, raw_config: dict[str, Any]
) -> None:
    # Arrange：建築平面圖上（未位移）的同名圖塊不是消防圖的，不收
    doc = parse_dxf(dxf.document([dxf.insert("03-撒水", SPRINKLER, (500, 300))]))

    # Act
    result = find_ceiling_services(doc, parse_config(_services_config(raw_config)), BOUNDS)

    # Assert
    assert result.sprinklers == []


def test_find_ceiling_services_with_unknown_block_should_warn_and_skip(
    dxf: DxfFactory, raw_config: dict[str, Any]
) -> None:
    # Arrange：設備圖層上認不出的圖塊；其他圖層的圖塊（壁掛設備）不讀也不警告
    entities = [
        dxf.insert("F-偵煙", "XX特殊探測器", (FIRE + 100, 100)),
        dxf.insert("F-揚聲器", "F307揚聲器(壁掛式)", (FIRE + 200, 100)),
    ]
    doc = parse_dxf(dxf.document(entities))

    # Act
    result = find_ceiling_services(doc, parse_config(_services_config(raw_config)), BOUNDS)

    # Assert
    assert result.sprinklers == []
    assert result.detectors == []
    assert len(result.warnings) == 1
    assert "XX特殊探測器" in result.warnings[0]


def test_find_ceiling_services_should_shift_duct_path_and_measure_sleeve(
    dxf: DxfFactory, raw_config: dict[str, Any]
) -> None:
    # Arrange：排油煙管垂直走，穿過寬 16 的套管矩形 → 直徑 0.16 m；位移含 dy
    p = (PLUMBING, 10)
    path = [(p[0] + 300, p[1] + 200), (p[0] + 300, p[1] + 1900)]
    sleeve = [(292, 1800), (308, 1800), (308, 1900), (292, 1900), (292, 1800)]
    entities = [
        dxf.lwpolyline("機電-排油管", path, closed=False),
        dxf.lwpolyline("05通風管", [(p[0] + x, p[1] + y) for x, y in sleeve], closed=False),
    ]
    doc = parse_dxf(dxf.document(entities))

    # Act
    result = find_ceiling_services(doc, parse_config(_services_config(raw_config)), BOUNDS)

    # Assert
    assert result.ducts == [Duct("range-hood", ((300.0, 200.0), (300.0, 1900.0)), 0.16)]
    assert result.warnings == []


def test_find_ceiling_services_without_sleeve_should_use_default_size(
    dxf: DxfFactory, raw_config: dict[str, Any]
) -> None:
    # Arrange：套管不在路線上（中心線偏掉），量不到
    p = (PLUMBING, 10)
    path = [(p[0] + 1900, p[1] + 1000), (p[0] + 1000, p[1] + 1000), (p[0] + 1000, p[1] + 600)]
    sleeve = [(1500, 900), (1600, 900), (1600, 911), (1500, 911)]
    entities = [
        dxf.lwpolyline("機電-單排", path, closed=False),
        dxf.lwpolyline("05通風管", [(p[0] + x, p[1] + y) for x, y in sleeve], closed=True),
    ]
    doc = parse_dxf(dxf.document(entities))

    # Act
    result = find_ceiling_services(doc, parse_config(_services_config(raw_config)), BOUNDS)

    # Assert
    assert [(d.type, d.size) for d in result.ducts] == [("exhaust", 0.10)]


def test_find_ceiling_services_should_measure_sleeve_on_horizontal_leg(
    dxf: DxfFactory, raw_config: dict[str, Any]
) -> None:
    # Arrange：套管在第二段（水平段）上，高 11
    p = (PLUMBING, 10)
    path = [(p[0] + 1000, p[1] + 600), (p[0] + 1000, p[1] + 1000), (p[0] + 1900, p[1] + 1000)]
    sleeve = [(1800, 994.5), (1900, 994.5), (1900, 1005.5), (1800, 1005.5)]
    entities = [
        dxf.lwpolyline("機電-單排", path, closed=False),
        dxf.lwpolyline("05通風管", [(p[0] + x, p[1] + y) for x, y in sleeve], closed=True),
    ]
    doc = parse_dxf(dxf.document(entities))

    # Act
    result = find_ceiling_services(doc, parse_config(_services_config(raw_config)), BOUNDS)

    # Assert
    assert [d.size for d in result.ducts] == [0.11]


def test_find_ceiling_services_should_put_vent_at_indoor_end_of_exhaust_duct(
    dxf: DxfFactory, raw_config: dict[str, Any]
) -> None:
    # Arrange：浴室排風從外牆（外框上緣 y=2000）拉進室內；排油煙管室內端接的是排油煙機，不算風口
    p = (PLUMBING, 10)
    exhaust = [(p[0] + 800, p[1] + 2000), (p[0] + 800, p[1] + 500), (p[0] + 1200, p[1] + 500)]
    hood = [(p[0] + 300, p[1] + 200), (p[0] + 300, p[1] + 2000)]
    entities = [
        dxf.lwpolyline("機電-單排", exhaust, closed=False),
        dxf.lwpolyline("機電-排油管", hood, closed=False),
    ]
    doc = parse_dxf(dxf.document(entities))

    # Act
    result = find_ceiling_services(doc, parse_config(_services_config(raw_config)), BOUNDS)

    # Assert
    assert result.vents == [(1200.0, 500.0)]


def test_find_ceiling_services_should_skip_duct_leaving_clip(
    dxf: DxfFactory, raw_config: dict[str, Any]
) -> None:
    # Arrange：只要有一點扣掉位移後在 clip 外，就是別戶的管線
    p = (PLUMBING, 10)
    path = [(p[0] + 300, p[1] + 200), (p[0] + 300, p[1] + 2500)]
    doc = parse_dxf(dxf.document([dxf.lwpolyline("機電-排油管", path, closed=False)]))

    # Act
    result = find_ceiling_services(doc, parse_config(_services_config(raw_config)), BOUNDS)

    # Assert
    assert result.ducts == []


def test_find_ceiling_services_with_unknown_duct_layer_should_warn_and_skip(
    dxf: DxfFactory, raw_config: dict[str, Any]
) -> None:
    # Arrange：通風圖層上不是封閉套管的折線，認不出是哪種風管
    p = (PLUMBING, 10)
    path = [(p[0] + 300, p[1] + 200), (p[0] + 300, p[1] + 900)]
    doc = parse_dxf(dxf.document([dxf.lwpolyline("05通風管", path, closed=False)]))

    # Act
    result = find_ceiling_services(doc, parse_config(_services_config(raw_config)), BOUNDS)

    # Assert
    assert result.ducts == []
    assert len(result.warnings) == 1
    assert "05通風管" in result.warnings[0]


def test_parse_config_should_read_service_layers_and_sheet_offsets(
    raw_config: dict[str, Any],
) -> None:
    # Act
    config = parse_config(_services_config(raw_config))

    # Assert
    assert config.layers.fire_device == ["03-撒水", "F-偵煙", "F-定溫"]
    assert config.layers.duct == ["機電-排油管", "機電-單排", "05通風管"]
    assert config.service_sheets == ServiceSheets(fire=(FIRE, 0.0), plumbing=(PLUMBING, 10.0))


def test_parse_config_without_service_sheets_should_default_to_zero(
    raw_config: dict[str, Any],
) -> None:
    # Act
    config = parse_config(raw_config)

    # Assert
    assert config.service_sheets == ServiceSheets()


@pytest.mark.parametrize(
    ("bad_value", "expected_fragment"),
    [
        ([1, 2], "serviceSheets"),
        ({"fire": [1]}, "serviceSheets.fire"),
        ({"plumbing": "6000,0"}, "serviceSheets.plumbing"),
        ({"fier": [1, 2]}, "serviceSheets.fier"),
    ],
    ids=["不是物件", "少一個數字", "字串", "打錯圖名"],
)
def test_parse_config_with_invalid_service_sheets_should_name_the_field(
    raw_config: dict[str, Any], bad_value: Any, expected_fragment: str
) -> None:
    # Arrange
    raw_config["serviceSheets"] = bad_value

    # Act & Assert
    with pytest.raises(ConfigError) as excinfo:
        parse_config(raw_config)

    assert any(expected_fragment in p for p in excinfo.value.problems)


OFFSET = 1000.0


def _room_entities(dxf: DxfFactory) -> list[str]:
    o = OFFSET
    return (
        dxf.rect_lines("L3", o + 0, o + 0, o + 300, o + 15)
        + dxf.rect_lines("L3", o + 0, o + 185, o + 300, o + 200)
        + dxf.rect_lines("L3", o + 0, o + 15, o + 15, o + 185)
        + dxf.rect_lines("L3", o + 285, o + 15, o + 300, o + 185)
    )


def test_build_floorplan_should_output_ceiling_services_in_plan_meters_without_text(
    dxf: DxfFactory, raw_config: dict[str, Any]
) -> None:
    # Arrange：房間外框 (1000,1000)–(1300,1200)；排風管從上方外牆拉進來
    raw_config = _services_config(raw_config)
    o, p = OFFSET, (PLUMBING, 10)
    exhaust = [(p[0] + o + 150, p[1] + o + 200), (p[0] + o + 150, p[1] + o + 100)]
    entities = [
        *_room_entities(dxf),
        dxf.insert("03-撒水", SPRINKLER, (FIRE + o + 100, o + 50)),
        dxf.insert("F-偵煙", SMOKE, (FIRE + o + 200, o + 150)),
        dxf.lwpolyline("機電-單排", exhaust, closed=False),
    ]
    doc = parse_dxf(dxf.document(entities))

    # Act
    result = build_floorplan(doc, parse_config(raw_config))

    # Assert
    assert result.floorplan["ceilingServices"] == {
        "sprinklers": [{"x": 1.0, "y": 0.5}],
        "detectors": [{"type": "smoke", "x": 2.0, "y": 1.5}],
        "ducts": [
            {"type": "exhaust", "path": [[1.5, 2.0], [1.5, 1.0]], "size": {"w": 0.1, "h": 0.1}}
        ],
        "vents": [{"x": 1.5, "y": 1.0}],
    }
    text = json.dumps(result.floorplan["ceilingServices"], ensure_ascii=False)
    assert not re.search(r"[一-鿿]", text)


def test_build_floorplan_should_pass_ceiling_service_warnings(
    dxf: DxfFactory, raw_config: dict[str, Any]
) -> None:
    # Arrange
    raw_config = _services_config(raw_config)
    entities = [
        *_room_entities(dxf),
        dxf.insert("F-偵煙", "XX特殊探測器", (FIRE + OFFSET + 100, OFFSET + 100)),
    ]
    doc = parse_dxf(dxf.document(entities))

    # Act
    result = build_floorplan(doc, parse_config(raw_config))

    # Assert
    assert any("XX特殊探測器" in w for w in result.warnings)
    assert "XX特殊探測器" not in json.dumps(result.floorplan, ensure_ascii=False)
