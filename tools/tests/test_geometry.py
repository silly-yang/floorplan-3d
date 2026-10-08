import pytest

from floorplan_tool.geometry import (
    Point,
    Segment,
    build_loops,
    point_in_polygon,
    polygon_area,
    ray_hit,
)

SQUARE: list[Point] = [(0, 0), (10, 0), (10, 10), (0, 10)]


def test_build_loops_with_shuffled_reversed_square_should_return_one_loop() -> None:
    # Arrange
    segments: list[Segment] = [
        ((10, 10), (10, 0)),
        ((0, 0), (10, 0)),
        ((0, 10), (0, 0)),
        ((0, 10), (10, 10)),
    ]

    # Act
    loops, open_chains = build_loops(segments)

    # Assert
    assert len(loops) == 1
    assert len(loops[0]) == 4
    assert abs(polygon_area(loops[0])) == pytest.approx(100.0)
    assert open_chains == []


def test_build_loops_with_endpoints_within_tolerance_should_join() -> None:
    # Arrange
    segments: list[Segment] = [
        ((0, 0), (10, 0)),
        ((10.3, 0), (10, 10)),
        ((10, 10), (0, 10)),
        ((0, 10.2), (0, 0)),
    ]

    # Act
    loops, _ = build_loops(segments, tol=0.5)

    # Assert
    assert len(loops) == 1


def test_build_loops_with_open_chain_ends_close_together_should_close_it() -> None:
    # Arrange：U 形牆，開口 15，像牆接到柱子時沒畫封口
    segments: list[Segment] = [((0, 0), (0, 100)), ((0, 0), (15, 0)), ((15, 0), (15, 100))]

    # Act
    loops, open_chains = build_loops(segments, close_gap=25.0)

    # Assert
    assert len(loops) == 1
    assert abs(polygon_area(loops[0])) == pytest.approx(1500.0)
    assert open_chains == []


def test_build_loops_with_open_chain_ends_far_apart_should_report_open_chain() -> None:
    # Arrange
    segments: list[Segment] = [((0, 0), (100, 0)), ((100, 0), (100, 100))]

    # Act
    loops, open_chains = build_loops(segments, close_gap=25.0)

    # Assert
    assert loops == []
    assert len(open_chains) == 1


@pytest.mark.parametrize(
    ("pt", "expected"),
    [((5, 5), True), ((15, 5), False), ((-1, -1), False)],
    ids=["中心點在內", "右側在外", "左下在外"],
)
def test_point_in_polygon_should_tell_inside_from_outside(pt: Point, expected: bool) -> None:
    # Act
    result = point_in_polygon(pt, SQUARE)

    # Assert
    assert result is expected


@pytest.mark.parametrize(
    ("origin", "direction", "max_dist", "expected"),
    [
        ((-5, 5), (1, 0), 100.0, 5.0),
        ((5, 20), (0, -1), 100.0, 10.0),
        ((-5, 5), (-1, 0), 100.0, None),
        ((-50, 5), (1, 0), 30.0, None),
    ],
    ids=["向右碰到左邊", "向下碰到上邊", "背向不會碰到", "超過最大距離"],
)
def test_ray_hit_should_return_distance_to_first_edge(
    origin: Point, direction: Point, max_dist: float, expected: float | None
) -> None:
    # Act
    result = ray_hit(origin, direction, [SQUARE], max_dist)

    # Assert
    assert result == (pytest.approx(expected) if expected is not None else None)


def test_build_loops_with_two_squares_sharing_a_vertex_should_split_into_two_loops() -> None:
    # Arrange：8 字形，線段順序讓走訪在共用頂點 (10, 10) 先轉進另一個方塊
    segments: list[Segment] = [
        ((0, 0), (10, 0)),
        ((10, 0), (10, 10)),
        ((10, 10), (20, 10)),
        ((20, 10), (20, 20)),
        ((20, 20), (10, 20)),
        ((10, 20), (10, 10)),
        ((10, 10), (0, 10)),
        ((0, 10), (0, 0)),
    ]

    # Act
    loops, _ = build_loops(segments)

    # Assert
    assert sorted(abs(polygon_area(loop)) for loop in loops) == [100.0, 100.0]


def test_build_loops_with_two_parallel_open_chains_should_join_into_one_loop() -> None:
    # Arrange：L 形牆用內外兩條 L 線畫，四個端點都接在別的牆上、沒有封口
    segments: list[Segment] = [
        ((0, 0), (0, 100)),
        ((0, 100), (100, 100)),
        ((10, 0), (10, 90)),
        ((10, 90), (100, 90)),
    ]

    # Act
    loops, open_chains = build_loops(segments, close_gap=25.0)

    # Assert
    assert open_chains == []
    assert len(loops) == 1
    assert abs(polygon_area(loops[0])) == pytest.approx(100 * 10 + 90 * 10)
