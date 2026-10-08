"""消防圖與給排水通風圖上的天花板設備 → floorplan.json 的 ceilingServices。

灑水頭、探測器依圖塊名稱關鍵字判斷；風管依所在圖層名稱判斷。
只輸出類型代碼與座標，圖塊與圖層名稱不進 floorplan.json。
"""

import itertools
import math
from dataclasses import dataclass

from floorplan_tool.config import Box, Config
from floorplan_tool.dxf import DxfDocument
from floorplan_tool.geometry import Point


@dataclass(frozen=True)
class DeviceKind:
    category: str  # sprinkler | detector
    type: str | None = None  # 探測器：smoke | heat


@dataclass(frozen=True)
class DuctKind:
    type: str
    default_size: float  # 公尺，圓管直徑；圖上量不到套管時才用
    vent: bool  # 室內端是天花板排風口


@dataclass(frozen=True)
class Detector:
    type: str
    at: Point  # 圖面單位，已扣掉消防圖的位移


@dataclass(frozen=True)
class Duct:
    type: str
    path: tuple[Point, ...]  # 圖面單位，已扣掉給排水圖的位移
    size: float  # 公尺，圓管直徑


@dataclass(frozen=True)
class CeilingServices:
    sprinklers: list[Point]
    detectors: list[Detector]
    ducts: list[Duct]
    vents: list[Point]
    warnings: list[str]  # 給轉檔的人看，不寫進 floorplan.json


# 由上往下比對，第一個命中的關鍵字決定類型；圖面用「撒水」，也收「灑水」
# 壁掛的揚聲器、緊急照明、出口標示不在天花板上，所在圖層不列進 layers.fireDevice
DEVICE_RULES: tuple[tuple[tuple[str, ...], DeviceKind], ...] = (
    (("撒水", "灑水"), DeviceKind("sprinkler")),
    (("偵煙",), DeviceKind("detector", "smoke")),
    (("定溫", "差動"), DeviceKind("detector", "heat")),
)
# 風管沒有圖塊名稱，依所在圖層判斷；default_size 是預設值，只在路線上量不到套管時才用
DUCT_RULES: tuple[tuple[tuple[str, ...], DuctKind], ...] = (
    (("排油",), DuctKind("range-hood", 0.15, vent=False)),
    (("單排", "排風"), DuctKind("exhaust", 0.10, vent=True)),
)
AXIS_TOLERANCE = 0.5  # 圖面單位；座標差在這以內算同一條水平／垂直線
SLEEVE_CENTER_TOLERANCE = 1.0  # 路線要從套管矩形的中線穿過，才算量得到管徑


def classify_device(block_name: str) -> DeviceKind | None:
    return next((kind for words, kind in DEVICE_RULES if any(w in block_name for w in words)), None)


def classify_duct(layer: str) -> DuctKind | None:
    return next((kind for words, kind in DUCT_RULES if any(w in layer for w in words)), None)


def _points(xs: list[str], ys: list[str], offset: tuple[float, float]) -> list[Point]:
    return [(float(x) - offset[0], float(y) - offset[1]) for x, y in zip(xs, ys, strict=True)]


# 四個角（可重複首點）、邊與座標軸平行的封閉折線 → (x0, y0, x1, y1)；不是就回 None
def _axis_rect(points: list[Point], closed: bool) -> tuple[float, float, float, float] | None:
    if len(points) == 5 and math.dist(points[0], points[-1]) <= AXIS_TOLERANCE:
        points, closed = points[:4], True
    if not closed or len(points) != 4:
        return None
    xs, ys = sorted(x for x, _ in points), sorted(y for _, y in points)
    if xs[1] - xs[0] > AXIS_TOLERANCE or ys[1] - ys[0] > AXIS_TOLERANCE:
        return None
    return (xs[0], ys[0], xs[3], ys[3])


# 路線某一段沿著套管長邊、從中線穿過時，套管短邊就是管徑（圖面單位）
def _sleeve_size(
    path: list[Point], sleeves: list[tuple[float, float, float, float]]
) -> float | None:
    for a, b in itertools.pairwise(path):
        for x0, y0, x1, y1 in sleeves:
            vertical = abs(a[0] - b[0]) <= AXIS_TOLERANCE and y1 - y0 > x1 - x0
            horizontal = abs(a[1] - b[1]) <= AXIS_TOLERANCE and x1 - x0 > y1 - y0
            if vertical:
                on_center = abs(a[0] - (x0 + x1) / 2) <= SLEEVE_CENTER_TOLERANCE
                overlap = min(max(a[1], b[1]), y1) - max(min(a[1], b[1]), y0)
                if on_center and overlap > 0:
                    return x1 - x0
            if horizontal:
                on_center = abs(a[1] - (y0 + y1) / 2) <= SLEEVE_CENTER_TOLERANCE
                overlap = min(max(a[0], b[0]), x1) - max(min(a[0], b[0]), x0)
                if on_center and overlap > 0:
                    return y1 - y0
    return None


# 風管一端接外牆（貼著牆體外框），另一端在室內；離外框較遠的那端是室內端
def _indoor_end(path: list[Point], bounds: Box) -> Point:
    def edge_distance(p: Point) -> float:
        return min(
            p[0] - bounds.x_min, bounds.x_max - p[0], p[1] - bounds.y_min, bounds.y_max - p[1]
        )

    return max((path[0], path[-1]), key=edge_distance)


def _fire_devices(
    doc: DxfDocument, config: Config, unknown: set[str]
) -> tuple[list[Point], list[Detector]]:
    dx, dy = config.service_sheets.fire
    sprinklers: list[Point] = []
    detectors: list[Detector] = []
    for e in doc.entities:
        if e.type != "INSERT" or e.layer not in config.layers.fire_device:
            continue
        at = (e.num(10) - dx, e.num(20) - dy)
        if not config.clip.contains(*at):
            continue
        name = e.first(2) or ""
        kind = classify_device(name)
        if kind is None:
            unknown.add(name)
        elif kind.category == "sprinkler":
            sprinklers.append(at)
        else:
            detectors.append(Detector(kind.type or "", at))
    return sprinklers, detectors


def _ducts(
    doc: DxfDocument, config: Config, bounds: Box, unknown: set[str]
) -> tuple[list[Duct], list[Point]]:
    offset = config.service_sheets.plumbing
    sleeves: list[tuple[float, float, float, float]] = []
    paths: list[tuple[str, list[Point]]] = []
    for e in doc.entities:
        if e.type != "LWPOLYLINE" or e.layer not in config.layers.duct:
            continue
        points = _points(e.all(10), e.all(20), offset)
        if len(points) < 2 or not all(config.clip.contains(*p) for p in points):
            continue
        rect = _axis_rect(points, closed=int(e.num(70)) & 1 == 1)
        if rect is not None:
            sleeves.append(rect)
            continue
        paths.append((e.layer, points))
    ducts: list[Duct] = []
    vents: list[Point] = []
    for layer, points in paths:
        kind = classify_duct(layer)
        if kind is None:
            unknown.add(layer)
            continue
        measured = _sleeve_size(points, sleeves)
        size = measured * config.unit_scale if measured is not None else kind.default_size
        ducts.append(Duct(kind.type, tuple(points), size))
        if kind.vent:
            vents.append(_indoor_end(points, bounds))
    return ducts, vents


# 由下往上、由左往右，輸出順序才穩定
def _by_position(p: Point) -> tuple[float, float]:
    return (p[1], p[0])


# bounds：牆體外框（圖面單位），用來判斷風管哪一端在室內
def find_ceiling_services(doc: DxfDocument, config: Config, bounds: Box) -> CeilingServices:
    unknown_blocks: set[str] = set()
    unknown_layers: set[str] = set()
    sprinklers, detectors = _fire_devices(doc, config, unknown_blocks)
    ducts, vents = _ducts(doc, config, bounds, unknown_layers)
    warnings: list[str] = []
    if unknown_blocks:
        warnings.append(f"天花板設備圖塊認不出類型，已略過：{'、'.join(sorted(unknown_blocks))}")
    if unknown_layers:
        warnings.append(f"風管圖層認不出類型，已略過：{'、'.join(sorted(unknown_layers))}")
    return CeilingServices(
        sorted(sprinklers, key=_by_position),
        sorted(detectors, key=lambda d: _by_position(d.at)),
        sorted(ducts, key=lambda d: _by_position(d.path[0])),
        sorted(vents, key=_by_position),
        warnings,
    )
