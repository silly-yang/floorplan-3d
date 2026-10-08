from typing import Any

import pytest

from floorplan_tool.config import parse_config
from floorplan_tool.exceptions import ConfigError


def test_parse_config_with_valid_raw_should_return_typed_config(raw_config: dict[str, Any]) -> None:
    # Arrange
    raw_config["rooms"] = [{"id": "living", "name": "客餐廳", "seed": [100, 200]}]

    # Act
    config = parse_config(raw_config)

    # Assert
    assert config.unit_scale == 0.01
    assert config.clip.x_max == 5000
    assert config.layers.rc_wall == ["L3"]
    assert config.window_types["W5"].sill == 0.9
    assert config.rooms[0].seed == (100.0, 200.0)


@pytest.mark.parametrize(
    ("field", "bad_value", "expected_fragment"),
    [
        ("unitScale", 0, "unitScale"),
        ("unitScale", "0.01", "unitScale"),
        ("gapMax", 10, "gapMax"),
        ("windowTypes", {"W5": {"sill": 2.5, "head": 2.1}}, "W5"),
        ("rooms", [{"id": "a", "name": "A"}], "rooms[0].seed"),
    ],
    ids=["比例為零", "比例是字串", "gapMax 小於 gapMin", "窗台高於窗頂", "房間缺種子點"],
)
def test_parse_config_with_invalid_field_should_name_the_field(
    raw_config: dict[str, Any], field: str, bad_value: Any, expected_fragment: str
) -> None:
    # Arrange
    raw_config[field] = bad_value

    # Act & Assert
    with pytest.raises(ConfigError) as excinfo:
        parse_config(raw_config)

    assert any(expected_fragment in p for p in excinfo.value.problems)


def test_parse_config_with_several_missing_fields_should_list_all(
    raw_config: dict[str, Any],
) -> None:
    # Arrange
    del raw_config["unitScale"]
    del raw_config["clip"]

    # Act & Assert
    with pytest.raises(ConfigError) as excinfo:
        parse_config(raw_config)

    problems = excinfo.value.problems
    assert len(problems) == 2
    assert any("unitScale" in p for p in problems)
    assert any("clip" in p for p in problems)


def test_parse_config_with_fixtures_should_keep_position_size_and_rotation(
    raw_config: dict[str, Any],
) -> None:
    # Arrange
    raw_config["fixtures"] = [
        {"type": "toilet", "center": [3943.5, 1464], "size": [40, 70, 75], "rotation": 180}
    ]

    # Act
    config = parse_config(raw_config)

    # Assert
    fixture = config.fixtures[0]
    assert (fixture.type, fixture.center, fixture.size, fixture.rotation) == (
        "toilet",
        (3943.5, 1464.0),
        (40.0, 70.0, 75.0),
        180.0,
    )


@pytest.mark.parametrize(
    ("fixture", "fragment"),
    [
        ({"type": "", "center": [0, 0], "size": [1, 1, 1], "rotation": 0}, "fixtures[0].type"),
        ({"type": "toilet", "center": [0], "size": [1, 1, 1], "rotation": 0}, "fixtures[0].center"),
        (
            {"type": "toilet", "center": [0, 0], "size": [1, 0, 1], "rotation": 0},
            "fixtures[0].size",
        ),
    ],
    ids=["類型空白", "座標少一個", "尺寸有 0"],
)
def test_parse_config_with_invalid_fixture_should_name_the_field(
    raw_config: dict[str, Any], fixture: dict[str, Any], fragment: str
) -> None:
    # Arrange
    raw_config["fixtures"] = [fixture]

    # Act & Assert
    with pytest.raises(ConfigError) as excinfo:
        parse_config(raw_config)

    assert any(fragment in p for p in excinfo.value.problems)
