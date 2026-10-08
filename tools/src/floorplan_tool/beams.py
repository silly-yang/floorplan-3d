"""從樑的圖層找出大樑：兩條平行線配成一支樑，深度讀旁邊的「(寬x深)」標註。"""

import math
import re
from dataclasses import dataclass

from floorplan_tool.config import Config
from floorplan_tool.dxf import DxfDocument

MIN_WIDTH = 15.0  # 圖面單位；平行線間距在這範圍內才算同一支樑
MAX_WIDTH = 80.0
MIN_OVERLAP = 0.5  # 兩條線重疊長度至少要佔較短那條的一半
LABEL_RADIUS = 150.0
WIDTH_TOLERANCE = 5.0
DEFAULT_DEPTH = 60.0
LABEL = re.compile(r"\((\d+)\s*[xX×]\s*(\d+)\)")


@dataclass(frozen=True)
class Beam:
    rect: tuple[float, float, float, float]  # 圖面單位 x0, y0, x1, y1
    depth: float  # 圖面單位


# (固定座標, 起點, 終點)：水平線固定 y、垂直線固定 x；斜線不處理
def _axis_lines(
    doc: DxfDocument, config: Config
) -> tuple[list[tuple[float, float, float]], list[tuple[float, float, float]]]:
    horizontal: list[tuple[float, float, float]] = []
    vertical: list[tuple[float, float, float]] = []
    for e in doc.entities:
        if e.type != "LINE" or e.layer not in config.layers.beam:
            continue
        x0, y0, x1, y1 = e.num(10), e.num(20), e.num(11), e.num(21)
        if not config.clip.contains(x0, y0):
            continue
        if abs(y0 - y1) < 0.5:
            horizontal.append((y0, min(x0, x1), max(x0, x1)))
        elif abs(x0 - x1) < 0.5:
            vertical.append((x0, min(y0, y1), max(y0, y1)))
    return horizontal, vertical


def _pair(lines: list[tuple[float, float, float]]) -> list[tuple[float, float, float, float]]:
    # 回傳 (固定座標小, 固定座標大, 重疊起點, 重疊終點)；每條線只用一次，挑最近的平行線
    used: set[int] = set()
    result: list[tuple[float, float, float, float]] = []
    order = sorted(range(len(lines)), key=lambda i: lines[i][0])
    for i in order:
        if i in used:
            continue
        best: tuple[float, int] | None = None
        for j in order:
            if j == i or j in used:
                continue
            gap = abs(lines[j][0] - lines[i][0])
            lo = max(lines[i][1], lines[j][1])
            hi = min(lines[i][2], lines[j][2])
            shorter = min(lines[i][2] - lines[i][1], lines[j][2] - lines[j][1])
            if (
                MIN_WIDTH <= gap <= MAX_WIDTH
                and hi - lo >= shorter * MIN_OVERLAP
                and (best is None or gap < best[0])
            ):
                best = (gap, j)
        if best is None:
            continue
        j = best[1]
        used.update({i, j})
        lo = max(lines[i][1], lines[j][1])
        hi = min(lines[i][2], lines[j][2])
        result.append((min(lines[i][0], lines[j][0]), max(lines[i][0], lines[j][0]), lo, hi))
    return result


def _labels(doc: DxfDocument, config: Config) -> list[tuple[float, float, float, float]]:
    result: list[tuple[float, float, float, float]] = []
    for e in doc.entities:
        if e.type not in ("TEXT", "MTEXT") or e.layer not in config.layers.beam:
            continue
        match = LABEL.search(" ".join(e.all(1)))
        if match:
            result.append((e.num(10), e.num(20), float(match.group(1)), float(match.group(2))))
    return result


def find_beams(doc: DxfDocument, config: Config) -> list[Beam]:
    horizontal, vertical = _axis_lines(doc, config)
    rects = [(lo, a, hi, b) for a, b, lo, hi in _pair(horizontal)]
    rects += [(a, lo, b, hi) for a, b, lo, hi in _pair(vertical)]
    labels = _labels(doc, config)
    beams: list[Beam] = []
    for x0, y0, x1, y1 in rects:
        width = min(x1 - x0, y1 - y0)
        # 標註寫在樑旁邊；用「離樑中心線最近」且寬度相符的那個
        candidates = [
            (_distance_to_rect((lx, ly), (x0, y0, x1, y1)), depth)
            for lx, ly, w, depth in labels
            if abs(w - width) <= WIDTH_TOLERANCE
        ]
        near = [c for c in candidates if c[0] <= LABEL_RADIUS]
        depth = min(near)[1] if near else DEFAULT_DEPTH
        beams.append(Beam((x0, y0, x1, y1), depth))
    return sorted(beams, key=lambda b: (b.rect[1], b.rect[0]))


def _distance_to_rect(p: tuple[float, float], rect: tuple[float, float, float, float]) -> float:
    x0, y0, x1, y1 = rect
    dx = max(x0 - p[0], 0.0, p[0] - x1)
    dy = max(y0 - p[1], 0.0, p[1] - y1)
    return math.hypot(dx, dy)
