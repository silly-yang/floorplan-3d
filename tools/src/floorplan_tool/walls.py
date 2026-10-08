"""從指定圖層取出牆體多邊形。"""

from dataclasses import dataclass
from itertools import pairwise

from floorplan_tool.config import Config
from floorplan_tool.dxf import DxfDocument, Entity
from floorplan_tool.geometry import Point, Polygon, Segment, build_loops


@dataclass(frozen=True)
class Wall:
    kind: str  # rc | partition | column
    polygon: Polygon


@dataclass(frozen=True)
class WallResult:
    walls: list[Wall]
    open_chains: int  # 串不起來的牆線數，> 0 代表圖面有缺口要人工確認


def _segments(entity: Entity) -> list[Segment]:
    if entity.type == "LINE":
        return [((entity.num(10), entity.num(20)), (entity.num(11), entity.num(21)))]
    if entity.type != "LWPOLYLINE":
        return []
    points: list[Point] = [
        (float(x), float(y)) for x, y in zip(entity.all(10), entity.all(20), strict=True)
    ]
    closed = int(entity.first(70) or "0") & 1
    if closed:
        points.append(points[0])
    return list(pairwise(points))


def extract_walls(doc: DxfDocument, config: Config) -> WallResult:
    kinds = {
        **dict.fromkeys(config.layers.rc_wall, "rc"),
        **dict.fromkeys(config.layers.partition, "partition"),
        **dict.fromkeys(config.layers.column, "column"),
    }
    by_kind: dict[str, list[Segment]] = {}
    for entity in doc.entities:
        kind = kinds.get(entity.layer)
        if kind is None:
            continue
        segments = _segments(entity)
        # 圖面上同一戶畫了好幾份，只取 clip 範圍內那份
        if segments and config.clip.contains(*segments[0][0]):
            by_kind.setdefault(kind, []).extend(segments)

    walls: list[Wall] = []
    open_chains = 0
    for kind, segments in by_kind.items():
        loops, chains = build_loops(segments)
        walls += [Wall(kind, loop) for loop in loops if len(loop) >= 3]
        open_chains += len(chains)
    return WallResult(walls=walls, open_chains=open_chains)
