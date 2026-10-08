"""平面幾何工具；單位跟著輸入走，不做換算。"""

import math

Point = tuple[float, float]
Segment = tuple[Point, Point]
Polygon = list[Point]

RAY_EPSILON = 1e-6  # 射線起點落在邊上時，避免把自己那條邊算成命中


def _snap(points: list[Point], p: Point, tol: float) -> int:
    for i, q in enumerate(points):
        if math.dist(p, q) <= tol:
            return i
    points.append(p)
    return len(points) - 1


# 從 start 節點沿未走過的線段一路走，回傳走過的節點序列
def _walk(start: int, adjacency: dict[int, list[tuple[int, int]]], used: set[int]) -> list[int]:
    path = [start]
    node = start
    while True:
        step = next(((n, s) for n, s in adjacency[node] if s not in used), None)
        if step is None:
            return path
        node, seg = step
        used.add(seg)
        path.append(node)
        if node == start:
            return path


# 兩塊牆共用頂點時，一次走訪會繞成 8 字形；從重複出現的節點把子輪廓切出來
def _split_at_repeats(cycle: list[int]) -> list[list[int]]:
    loops: list[list[int]] = []
    stack: list[int] = []
    for node in [*cycle, cycle[0]]:
        if node in stack:
            cut = stack.index(node)
            loop = stack[cut:]
            if len(loop) >= 3:
                loops.append(loop)
            del stack[cut + 1 :]
            continue
        stack.append(node)
    return loops


# 把散落的線段依端點串成封閉輪廓；回傳 (封閉輪廓, 無法封閉的開放鏈)
# 開放鏈兩端距離在 close_gap 以內時直接補一條線封閉（牆接柱子時常見）
def build_loops(
    segments: list[Segment], tol: float = 0.5, close_gap: float = 25.0
) -> tuple[list[Polygon], list[list[Point]]]:
    nodes: list[Point] = []
    adjacency: dict[int, list[tuple[int, int]]] = {}
    for idx, (a, b) in enumerate(segments):
        ia, ib = _snap(nodes, a, tol), _snap(nodes, b, tol)
        adjacency.setdefault(ia, []).append((ib, idx))
        adjacency.setdefault(ib, []).append((ia, idx))

    used: set[int] = set()
    loops: list[Polygon] = []
    open_chains: list[list[Point]] = []
    # 先從度數 1 的端點出發，開放鏈才會從頭走到尾
    starts = sorted(adjacency, key=lambda n: len(adjacency[n]) != 1)
    for start in starts:
        while any(s not in used for _, s in adjacency[start]):
            path = _walk(start, adjacency, used)
            points = [nodes[i] for i in path]
            if path[0] == path[-1]:
                loops += [[nodes[i] for i in sub] for sub in _split_at_repeats(path[:-1])]
            elif math.dist(points[0], points[-1]) <= close_gap:
                loops.append(points)
            else:
                open_chains.append(points)
    paired, open_chains = _pair_open_chains(open_chains, close_gap)
    return loops + paired, open_chains


# 牆的內外兩條線各是一條開放鏈、兩端都接在別的牆上時，兩兩配對接成一個輪廓
def _pair_open_chains(
    chains: list[list[Point]], close_gap: float
) -> tuple[list[Polygon], list[list[Point]]]:
    loops: list[Polygon] = []
    remaining = list(chains)
    i = 0
    while i < len(remaining):
        a = remaining[i]
        match = None
        for j in range(i + 1, len(remaining)):
            b = remaining[j]
            if math.dist(a[-1], b[-1]) <= close_gap and math.dist(a[0], b[0]) <= close_gap:
                match = (j, a + b[::-1])
                break
            if math.dist(a[-1], b[0]) <= close_gap and math.dist(a[0], b[-1]) <= close_gap:
                match = (j, a + b)
                break
        if match is None:
            i += 1
            continue
        loops.append(match[1])
        del remaining[match[0]]
        del remaining[i]
    return loops, remaining


def point_in_polygon(pt: Point, poly: Polygon) -> bool:
    x, y = pt
    inside = False
    for (x1, y1), (x2, y2) in zip(poly, poly[1:] + poly[:1], strict=True):
        if (y1 > y) != (y2 > y):
            cross_x = x1 + (y - y1) * (x2 - x1) / (y2 - y1)
            if x < cross_x:
                inside = not inside
    return inside


# 從 origin 沿 direction（單位向量）射出，回傳第一個碰到多邊形邊的距離；超過 max_dist 或沒碰到回 None
def ray_hit(
    origin: Point, direction: Point, polygons: list[Polygon], max_dist: float
) -> float | None:
    ox, oy = origin
    dx, dy = direction
    best: float | None = None
    for poly in polygons:
        for (ax, ay), (bx, by) in zip(poly, poly[1:] + poly[:1], strict=True):
            ex, ey = bx - ax, by - ay
            denom = dx * ey - dy * ex
            if abs(denom) < 1e-12:
                continue
            t = ((ax - ox) * ey - (ay - oy) * ex) / denom
            u = ((ax - ox) * dy - (ay - oy) * dx) / denom
            if t > RAY_EPSILON and -1e-9 <= u <= 1 + 1e-9 and (best is None or t < best):
                best = t
    if best is None or best > max_dist:
        return None
    return best


# 有號面積：逆時針為正
def polygon_area(poly: Polygon) -> float:
    total = 0.0
    for (x1, y1), (x2, y2) in zip(poly, poly[1:] + poly[:1], strict=True):
        total += x1 * y2 - x2 * y1
    return total / 2


# 頂點平均；矩形與一般牆體輪廓用來排序、去重已足夠
def centroid(poly: Polygon) -> Point:
    return (sum(x for x, _ in poly) / len(poly), sum(y for _, y in poly) / len(poly))
