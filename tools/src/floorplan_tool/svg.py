"""把 floorplan dict 畫成 SVG 檢查圖，讓人對照原始 CAD 確認轉換結果。"""

import html
from typing import Any

PX_PER_METER = 100
PADDING = 40
STYLE = """
.wall.rc{fill:#555}.wall.partition{fill:#c44}.wall.column{fill:#222}
.room{fill:#e8dcc4;stroke:none}.opening{fill-opacity:.7}
.opening.window{fill:#39f}.opening.door{fill:#f90}.opening.doorway{fill:#3b3}
text{font:12px sans-serif;fill:#000}.room-name{font-size:16px;fill:#865}
"""


# floorplan 為 build_floorplan 的輸出結構
def render_check_svg(floorplan: dict[str, Any]) -> str:
    depth = floorplan["bounds"]["depth"]
    width = floorplan["bounds"]["width"]

    # SVG 的 y 朝下、平面圖的 y 朝上，所以要翻轉
    def xy(p: list[float]) -> str:
        return f"{p[0] * PX_PER_METER:.1f},{(depth - p[1]) * PX_PER_METER:.1f}"

    def points(poly: list[list[float]]) -> str:
        return " ".join(xy(p) for p in poly)

    parts: list[str] = []
    for room in floorplan["rooms"]:
        for x0, y0, x1, y1 in room["rects"]:
            corners = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
            parts.append(f'<polygon class="room" points="{points(corners)}"/>')
    for wall in floorplan["walls"]:
        parts.append(f'<polygon class="wall {wall["kind"]}" points="{points(wall["polygon"])}"/>')
    for opening in floorplan["openings"]:
        poly = opening["polygon"]
        parts.append(f'<polygon class="opening {opening["kind"]}" points="{points(poly)}"/>')
        cx = sum(p[0] for p in poly) / len(poly)
        cy = sum(p[1] for p in poly) / len(poly)
        x, y = xy([cx, cy]).split(",")
        parts.append(f'<text x="{x}" y="{y}" dy="-12">{html.escape(opening["id"])}</text>')
    for room in floorplan["rooms"]:
        x0, y0, x1, y1 = max(room["rects"], key=lambda r: (r[2] - r[0]) * (r[3] - r[1]))
        x, y = xy([(x0 + x1) / 2, (y0 + y1) / 2]).split(",")
        name = html.escape(room["name"])
        parts.append(f'<text class="room-name" x="{x}" y="{y}" text-anchor="middle">{name}</text>')

    w, h = width * PX_PER_METER, depth * PX_PER_METER
    view = f"{-PADDING} {-PADDING} {w + 2 * PADDING:.0f} {h + 2 * PADDING:.0f}"
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{view}" '
        f'width="{w + 2 * PADDING:.0f}" height="{h + 2 * PADDING:.0f}" style="background:#fff">'
        f"<style>{STYLE}</style>{''.join(parts)}</svg>"
    )
