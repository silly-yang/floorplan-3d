import json
from pathlib import Path
from typing import Any

import pytest

from floorplan_tool.cli import main
from tests.conftest import DxfFactory


def _write_inputs(tmp_path: Path, dxf: DxfFactory, raw_config: dict[str, Any]) -> list[str]:
    entities = dxf.rect_lines("L3", 0, 0, 300, 15) + dxf.rect_lines("L3", 0, 185, 300, 200)
    (tmp_path / "plan.dxf").write_text(dxf.document(entities), encoding="utf-8")
    (tmp_path / "overrides.json").write_text(json.dumps(raw_config), encoding="utf-8")
    return [
        str(tmp_path / "plan.dxf"),
        "--overrides",
        str(tmp_path / "overrides.json"),
        "--out",
        str(tmp_path / "floorplan.json"),
        "--preview",
        str(tmp_path / "check.svg"),
    ]


def test_main_with_valid_inputs_should_write_json_and_preview(
    tmp_path: Path, dxf: DxfFactory, raw_config: dict[str, Any]
) -> None:
    # Arrange
    argv = _write_inputs(tmp_path, dxf, raw_config)

    # Act
    code = main(argv)

    # Assert
    assert code == 0
    floorplan = json.loads((tmp_path / "floorplan.json").read_text(encoding="utf-8"))
    assert len(floorplan["walls"]) == 2
    assert (tmp_path / "check.svg").read_text(encoding="utf-8").startswith("<svg")


def test_main_with_invalid_overrides_should_return_1_and_name_field(
    tmp_path: Path, dxf: DxfFactory, raw_config: dict[str, Any], capsys: pytest.CaptureFixture[str]
) -> None:
    # Arrange
    raw_config["unitScale"] = -1
    argv = _write_inputs(tmp_path, dxf, raw_config)

    # Act
    code = main(argv)

    # Assert
    assert code == 1
    assert "unitScale" in capsys.readouterr().err
    assert not (tmp_path / "floorplan.json").exists()
