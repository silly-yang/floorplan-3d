from floorplan_tool.svg import render_check_svg

FLOORPLAN = {
    "version": 1,
    "units": "m",
    "bounds": {"width": 3.0, "depth": 2.0},
    "walls": [{"id": "wall-1", "kind": "rc", "polygon": [[0, 0], [3, 0], [3, 0.15], [0, 0.15]]}],
    "openings": [
        {
            "id": "W5-1",
            "kind": "window",
            "label": "W5",
            "polygon": [[1, 0], [2, 0], [2, 0.15], [1, 0.15]],
            "sill": 0.9,
            "head": 2.1,
        }
    ],
    "rooms": [{"id": "living", "name": "客廳", "rects": [[0, 0.15, 3, 2]]}],
}


def test_render_check_svg_should_draw_every_wall_opening_and_room() -> None:
    # Act
    svg = render_check_svg(FLOORPLAN)

    # Assert
    assert svg.startswith("<svg")
    assert svg.count('class="wall rc"') == 1
    assert "W5-1" in svg
    assert "客廳" in svg


def test_render_check_svg_should_flip_y_so_plan_north_is_up() -> None:
    # Arrange：y=0 的牆在平面圖下方，SVG 的 y 軸朝下，所以要畫在靠近底部
    floorplan = {**FLOORPLAN, "openings": [], "rooms": []}

    # Act
    svg = render_check_svg(floorplan)

    # Assert：深度 2 m、每公尺 100 px，y=0 的點應落在 SVG y=200
    assert "0.0,200.0" in svg
