"""找出牆與牆之間的開口，並分類成門、窗、門洞。"""

import math
import re
from dataclasses import dataclass

from floorplan_tool.config import Config
from floorplan_tool.dxf import DxfDocument, Entity
from floorplan_tool.exceptions import ConfigError
from floorplan_tool.geometry import (
    Point,
    Polygon,
    centroid,
    point_in_polygon,
    polygon_area,
    ray_hit,
)
from floorplan_tool.walls import Wall

MAX_JAMB_LENGTH = 30.0  # 牆端面最長幾單位；比這長的邊是牆面不是端面
DEDUPE_DISTANCE = 5.0  # 兩側牆端射到對方會產生同一個開口，中心距離在此以內視為同一個
PROBE_OFFSET = 0.5
WINDOW_MARGIN = 5.0
DOOR_MARGIN = 30.0  # 門圖塊插入點在門框上，可能稍微落在開口外
LABEL_RADIUS = 150.0
# 編號只接受 W5、DW4、FD2 這類代號；其他圖面文字一律不輸出，避免地址等資訊外流
LABEL_PATTERN = re.compile(r"^[A-Z]{1,3}\d{1,3}$")


@dataclass(frozen=True)
class Opening:
    id: str
    kind: str  # door | window | doorway
    label: str
    polygon: Polygon  # 開口在平面上的矩形，四個角
    sill: float  # 公尺，開口下緣離地
    head: float  # 公尺，開口上緣離地


def _inside_box(pt: Point, poly: Polygon, margin: float) -> bool:
    xs, ys = [x for x, _ in poly], [y for _, y in poly]
    return (
        min(xs) - margin <= pt[0] <= max(xs) + margin
        and min(ys) - margin <= pt[1] <= max(ys) + margin
    )


# 從每道牆的短邊（牆端面）往外射線，碰到另一道牆就是一個開口
def find_gaps(walls: list[Wall], gap_min: float, gap_max: float) -> list[Polygon]:
    polygons = [w.polygon for w in walls]
    gaps: list[Polygon] = []
    for poly in polygons:
        ccw = polygon_area(poly) > 0
        for a, b in zip(poly, poly[1:] + poly[:1], strict=True):
            length = math.dist(a, b)
            if length == 0 or length > MAX_JAMB_LENGTH:
                continue
            ex, ey = (b[0] - a[0]) / length, (b[1] - a[1]) / length
            normal = (ey, -ex) if ccw else (-ey, ex)
            mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
            # 端面外側緊貼著另一道牆＝牆是連續的，不是開口
            probe = (mid[0] + normal[0] * PROBE_OFFSET, mid[1] + normal[1] * PROBE_OFFSET)
            if any(point_in_polygon(probe, other) for other in polygons):
                continue
            dist = ray_hit(mid, normal, polygons, gap_max)
            if dist is None or dist < gap_min:
                continue
            far_a = (a[0] + normal[0] * dist, a[1] + normal[1] * dist)
            far_b = (b[0] + normal[0] * dist, b[1] + normal[1] * dist)
            rect = [a, b, far_b, far_a]
            if all(math.dist(centroid(rect), centroid(g)) > DEDUPE_DISTANCE for g in gaps):
                gaps.append(rect)
    return gaps


def _points(entity: Entity) -> list[Point]:
    xs, ys = entity.all(10) + entity.all(11), entity.all(20) + entity.all(21)
    return [(float(x), float(y)) for x, y in zip(xs, ys, strict=False)]


def _midpoint(entity: Entity) -> Point | None:
    points = _points(entity)
    if not points:
        return None
    return centroid(points)


def _label_of(entity: Entity) -> str | None:
    if entity.type == "ATTDEF":
        return entity.first(2)
    if entity.type == "ATTRIB" and entity.first(2) == "NO.":
        return entity.first(1)
    if entity.type == "TEXT":
        return entity.first(1)
    return None


def _labels(doc: DxfDocument, layers: list[str], config: Config) -> list[tuple[Point, str]]:
    result: list[tuple[Point, str]] = []
    for entity in doc.entities:
        if entity.layer not in layers:
            continue
        label = _label_of(entity)
        at = (entity.num(10), entity.num(20))
        if label and LABEL_PATTERN.match(label) and config.clip.contains(*at):
            result.append((at, label))
    return result


def _nearest_label(center: Point, labels: list[tuple[Point, str]]) -> str:
    near = [(math.dist(center, at), label) for at, label in labels]
    near = [item for item in near if item[0] <= LABEL_RADIUS]
    return min(near)[1] if near else ""


def find_openings(doc: DxfDocument, walls: list[Wall], config: Config) -> list[Opening]:
    in_clip = [e for e in doc.entities if (m := _midpoint(e)) and config.clip.contains(*m)]
    window_marks = [
        m
        for e in in_clip
        if e.layer in config.layers.window and e.type in ("LINE", "LWPOLYLINE")
        if (m := _midpoint(e))
    ]
    door_marks = [
        (e.num(10), e.num(20))
        for e in in_clip
        if e.layer in config.layers.door and e.type == "INSERT"
    ]
    window_labels = _labels(doc, config.layers.window, config)
    door_labels = _labels(doc, config.layers.door, config)

    gaps = sorted(find_gaps(walls, config.gap_min, config.gap_max), key=centroid)
    # 一扇門只屬於離它最近的開口，避免旁邊的門洞也被認成門
    door_gaps: set[int] = set()
    for mark in door_marks:
        near = [(math.dist(mark, centroid(g)), i) for i, g in enumerate(gaps)]
        near = [item for item in near if _inside_box(mark, gaps[item[1]], DOOR_MARGIN)]
        if near:
            door_gaps.add(min(near)[1])
    counters: dict[str, int] = {}
    openings: list[Opening] = []
    for index, gap in enumerate(gaps):
        center = centroid(gap)
        if any(_inside_box(m, gap, WINDOW_MARGIN) for m in window_marks):
            kind, label = "window", _nearest_label(center, window_labels)
            if not label:
                raise ConfigError([f"位於 {center} 的窗沒有編號，無法決定窗台與窗頂高度"])
            spec = config.window_types.get(label)
            if spec is None:
                raise ConfigError([f"windowTypes 缺少 {label} 的 sill／head 設定"])
            sill, head = spec.sill, spec.head
        elif index in door_gaps:
            kind, label = "door", _nearest_label(center, door_labels)
            sill, head = 0.0, config.door_head
        else:
            kind, label = "doorway", ""
            sill, head = 0.0, config.doorway_head
        prefix = label or kind
        counters[prefix] = counters.get(prefix, 0) + 1
        opening_id = f"{prefix}-{counters[prefix]}"
        if opening_id in config.ignore_openings:
            continue
        openings.append(Opening(opening_id, kind, label, gap, sill, head))
    return openings
