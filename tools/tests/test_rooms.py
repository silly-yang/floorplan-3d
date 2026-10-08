import pytest

from floorplan_tool.config import Box
from floorplan_tool.exceptions import FloorplanError, RoomLeakError
from floorplan_tool.geometry import Polygon
from floorplan_tool.rooms import Rect, trace_room

BOUNDS = Box(-50, -50, 200, 200)


def _rect(x0: float, y0: float, x1: float, y1: float) -> Polygon:
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


# 內部淨空 0~100 × 0~100、牆厚 10 的四面牆
def _closed_box() -> list[Polygon]:
    return [
        _rect(-10, -10, 110, 0),
        _rect(-10, 100, 110, 110),
        _rect(-10, 0, 0, 100),
        _rect(100, 0, 110, 100),
    ]


def _area(rects: list[Rect]) -> float:
    return sum((x1 - x0) * (y1 - y0) for x0, y0, x1, y1 in rects)


def test_trace_room_inside_closed_walls_should_cover_interior_exactly() -> None:
    # Act
    rects = trace_room((50, 50), _closed_box(), BOUNDS, cell=5)

    # Assert
    assert _area(rects) == pytest.approx(100 * 100)
    assert min(r[0] for r in rects) == pytest.approx(0)
    assert max(r[2] for r in rects) == pytest.approx(100)


def test_trace_room_with_gap_closed_by_barrier_should_stay_inside() -> None:
    # Arrange：右牆中間開 40 的口，再用一塊邊界把口封起來
    walls = [w for w in _closed_box() if w != _rect(100, 0, 110, 100)]
    walls += [_rect(100, 0, 110, 30), _rect(100, 70, 110, 100), _rect(100, 30, 110, 70)]

    # Act
    rects = trace_room((50, 50), walls, BOUNDS, cell=5)

    # Assert
    assert _area(rects) == pytest.approx(100 * 100)


def test_trace_room_with_open_wall_should_raise_leak() -> None:
    # Arrange
    walls = [w for w in _closed_box() if w != _rect(100, 0, 110, 100)]

    # Act & Assert
    with pytest.raises(RoomLeakError):
        trace_room((50, 50), walls, BOUNDS, cell=5)


def test_trace_room_with_seed_inside_wall_should_raise() -> None:
    # Act & Assert
    with pytest.raises(FloorplanError, match="種子點"):
        trace_room((-5, 50), _closed_box(), BOUNDS, cell=5)
