import pytest

from floorplan_tool.dxf import parse_dxf
from floorplan_tool.exceptions import DxfFormatError
from tests.conftest import DxfFactory


def test_parse_dxf_with_line_should_keep_layer_and_coordinates(dxf: DxfFactory) -> None:
    # Arrange
    text = dxf.document([dxf.line("L3", (1.5, 2.0), (10.0, 2.0))])

    # Act
    doc = parse_dxf(text)

    # Assert
    assert len(doc.entities) == 1
    entity = doc.entities[0]
    assert entity.type == "LINE"
    assert entity.layer == "L3"
    assert (entity.num(10), entity.num(20), entity.num(11), entity.num(21)) == (1.5, 2.0, 10.0, 2.0)


def test_parse_dxf_with_lwpolyline_should_keep_every_vertex(dxf: DxfFactory) -> None:
    # Arrange
    points = [(0.0, 0.0), (10.0, 0.0), (10.0, 5.0)]
    text = dxf.document([dxf.lwpolyline("WALL2", points, closed=True)])

    # Act
    entity = parse_dxf(text).entities[0]

    # Assert
    assert [float(v) for v in entity.all(10)] == [0.0, 10.0, 10.0]
    assert [float(v) for v in entity.all(20)] == [0.0, 0.0, 5.0]
    assert entity.first(70) == "1"


def test_parse_dxf_with_block_should_store_block_entities_separately(dxf: DxfFactory) -> None:
    # Arrange
    text = dxf.document(
        [dxf.insert("OPEN-Door", "DOOR1", (5.0, 5.0))],
        blocks={"DOOR1": [dxf.arc("OPEN-Door", (0.0, 0.0), 90.0, 0.0, 90.0)]},
    )

    # Act
    doc = parse_dxf(text)

    # Assert
    assert [e.type for e in doc.entities] == ["INSERT"]
    assert [e.type for e in doc.blocks["DOOR1"]] == ["ARC"]


def test_entity_num_with_missing_code_should_return_default(dxf: DxfFactory) -> None:
    # Arrange
    entity = parse_dxf(dxf.document([dxf.line("L3", (0, 0), (1, 1))])).entities[0]

    # Act
    value = entity.num(50, default=7.0)

    # Assert
    assert value == 7.0


@pytest.mark.parametrize(
    "text",
    ["", "0\nSECTION\n2\nHEADER\n0\nENDSEC\n0\nEOF\n", "這不是 DXF"],
    ids=["空字串", "沒有 ENTITIES 區段", "隨便的文字"],
)
def test_parse_dxf_without_entities_section_should_raise(text: str) -> None:
    # Act & Assert
    with pytest.raises(DxfFormatError, match="ENTITIES"):
        parse_dxf(text)
