"""從種子點往外填，算出房間的地板範圍。"""

import math
from collections import deque

from floorplan_tool.config import Box
from floorplan_tool.exceptions import FloorplanError, RoomLeakError
from floorplan_tool.geometry import Point, Polygon, point_in_polygon

Rect = tuple[float, float, float, float]  # x0, y0, x1, y1
Cell = tuple[int, int]  # (col, row)
DEFAULT_CELL = 5.0


def _blocked_grid(
    barriers: list[Polygon], bounds: Box, cols: int, rows: int, cell: float
) -> set[Cell]:
    blocked: set[Cell] = set()
    for poly in barriers:
        xs, ys = [x for x, _ in poly], [y for _, y in poly]
        c0 = max(0, int((min(xs) - bounds.x_min) // cell))
        c1 = min(cols - 1, int((max(xs) - bounds.x_min) // cell))
        r0 = max(0, int((min(ys) - bounds.y_min) // cell))
        r1 = min(rows - 1, int((max(ys) - bounds.y_min) // cell))
        for c in range(c0, c1 + 1):
            for r in range(r0, r1 + 1):
                center = (bounds.x_min + (c + 0.5) * cell, bounds.y_min + (r + 0.5) * cell)
                if point_in_polygon(center, poly):
                    blocked.add((c, r))
    return blocked


# 同一列連續的格子併成一段，再把上下列完全相同的段落併成一個矩形
def _merge(filled: set[Cell], bounds: Box, cell: float) -> list[Rect]:
    runs: dict[tuple[int, int], list[int]] = {}
    for row in sorted({r for _, r in filled}):
        cols = sorted(c for c, r in filled if r == row)
        start = prev = cols[0]
        for c in [*cols[1:], None]:
            if c is not None and c == prev + 1:
                prev = c
                continue
            runs.setdefault((start, prev), []).append(row)
            if c is not None:
                start = prev = c
    rects: list[Rect] = []
    for (c0, c1), rows in sorted(runs.items()):
        start = prev = rows[0]
        for r in [*rows[1:], None]:
            if r is not None and r == prev + 1:
                prev = r
                continue
            rects.append(
                (
                    bounds.x_min + c0 * cell,
                    bounds.y_min + start * cell,
                    bounds.x_min + (c1 + 1) * cell,
                    bounds.y_min + (prev + 1) * cell,
                )
            )
            if r is not None:
                start = prev = r
    return rects


# 以 cell 為格子大小做填色；碰到 barriers 停止，碰到 bounds 邊界視為漏水
def trace_room(
    seed: Point, barriers: list[Polygon], bounds: Box, cell: float = DEFAULT_CELL
) -> list[Rect]:
    cols = math.ceil((bounds.x_max - bounds.x_min) / cell)
    rows = math.ceil((bounds.y_max - bounds.y_min) / cell)
    blocked = _blocked_grid(barriers, bounds, cols, rows, cell)
    start = (int((seed[0] - bounds.x_min) // cell), int((seed[1] - bounds.y_min) // cell))
    if start in blocked or not (0 <= start[0] < cols and 0 <= start[1] < rows):
        raise FloorplanError(f"種子點 {seed} 落在牆內或圖面範圍外，請改到房間內部")

    filled = {start}
    queue = deque([start])
    while queue:
        c, r = queue.popleft()
        if c in (0, cols - 1) or r in (0, rows - 1):
            raise RoomLeakError(f"從種子點 {seed} 填色時碰到圖面邊界，牆或開口沒有封閉")
        for nxt in ((c + 1, r), (c - 1, r), (c, r + 1), (c, r - 1)):
            if nxt not in blocked and nxt not in filled:
                filled.add(nxt)
                queue.append(nxt)
    return _merge(filled, bounds, cell)
