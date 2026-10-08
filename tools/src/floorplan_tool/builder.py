"""把解析結果組成 floorplan.json 的內容。"""

import math
from dataclasses import dataclass
from typing import Any

from floorplan_tool.beams import find_beams
from floorplan_tool.ceiling_services import find_ceiling_services
from floorplan_tool.config import Box, Config
from floorplan_tool.dxf import DxfDocument
from floorplan_tool.geometry import Point, Polygon, centroid
from floorplan_tool.openings import find_openings
from floorplan_tool.outlets import find_outlets
from floorplan_tool.rooms import DEFAULT_CELL, trace_room
from floorplan_tool.walls import extract_walls

FLOORPLAN_VERSION = 1
ROOM_MARGIN = 50.0  # 填色範圍比牆體外框再大一圈，漏出牆外才碰得到邊界
# 欄杆等邊界線要加粗到至少一格，否則填色會從格子中心之間漏過去
BARRIER_HALF_WIDTH = DEFAULT_CELL
DECIMALS = 3  # 公尺到小數第三位＝毫米


@dataclass(frozen=True)
class BuildResult:
    floorplan: dict[str, Any]  # 直接交給 json.dump 的巢狀結構
    warnings: list[str]  # 給轉檔的人看，不寫進 floorplan.json


def _thicken(a: Point, b: Point) -> Polygon:
    length = math.dist(a, b)
    nx, ny = (-(b[1] - a[1]) / length, (b[0] - a[0]) / length)
    w = BARRIER_HALF_WIDTH
    return [
        (a[0] + nx * w, a[1] + ny * w),
        (b[0] + nx * w, b[1] + ny * w),
        (b[0] - nx * w, b[1] - ny * w),
        (a[0] - nx * w, a[1] - ny * w),
    ]


def _barrier_lines(doc: DxfDocument, config: Config) -> list[Polygon]:
    result: list[Polygon] = []
    for entity in doc.entities:
        if entity.layer not in config.layers.barrier or entity.type != "LINE":
            continue
        a, b = (entity.num(10), entity.num(20)), (entity.num(11), entity.num(21))
        if config.clip.contains(*a) and math.dist(a, b) > 0:
            result.append(_thicken(a, b))
    return result


# 座標單位公尺、原點平移到牆體外框左下角、y 軸朝上；不輸出圖面上的任何文字
def build_floorplan(doc: DxfDocument, config: Config) -> BuildResult:
    warnings: list[str] = []
    wall_result = extract_walls(doc, config)
    walls = sorted(wall_result.walls, key=lambda w: (w.kind, centroid(w.polygon)))
    if wall_result.open_chains:
        warnings.append(f"有 {wall_result.open_chains} 段牆線沒有封閉，請對照檢查圖確認是否缺牆")
    openings = find_openings(doc, walls, config)
    outlet_result = find_outlets(doc, config)
    warnings += outlet_result.warnings

    points = [p for w in walls for p in w.polygon]
    x0, y0 = min(x for x, _ in points), min(y for _, y in points)
    x1, y1 = max(x for x, _ in points), max(y for _, y in points)
    scale = config.unit_scale
    services = find_ceiling_services(doc, config, Box(x0, y0, x1, y1))
    warnings += services.warnings

    def pt(p: Point) -> list[float]:
        return [round((p[0] - x0) * scale, DECIMALS), round((p[1] - y0) * scale, DECIMALS)]

    barriers = [w.polygon for w in walls] + [o.polygon for o in openings]
    barriers += _barrier_lines(doc, config)
    area = Box(x0 - ROOM_MARGIN, y0 - ROOM_MARGIN, x1 + ROOM_MARGIN, y1 + ROOM_MARGIN)
    rooms = []
    for room in config.rooms:
        rects = trace_room(room.seed, barriers, area)
        rooms.append(
            {
                "id": room.id,
                "name": room.name,
                "rects": [[*pt((rx0, ry0)), *pt((rx1, ry1))] for rx0, ry0, rx1, ry1 in rects],
            }
        )

    floorplan: dict[str, Any] = {
        "version": FLOORPLAN_VERSION,
        "units": "m",
        "bounds": {
            "width": round((x1 - x0) * scale, DECIMALS),
            "depth": round((y1 - y0) * scale, DECIMALS),
        },
        "walls": [
            {"id": f"wall-{i}", "kind": w.kind, "polygon": [pt(p) for p in w.polygon]}
            for i, w in enumerate(walls, start=1)
        ],
        "openings": [
            {
                "id": o.id,
                "kind": o.kind,
                "label": o.label,
                "polygon": [pt(p) for p in o.polygon],
                "sill": o.sill,
                "head": o.head,
            }
            for o in openings
        ],
        "rooms": rooms,
        # 大樑：平面範圍與樑深（公尺）；樑的代號不輸出
        "beams": [
            {
                "rect": [*pt((b.rect[0], b.rect[1])), *pt((b.rect[2], b.rect[3]))],
                "depth": round(b.depth * scale, DECIMALS),
            }
            for b in find_beams(doc, config)
        ],
        # 建商已經做好天花板的區域（例如廚房）
        "ceilingZones": [
            {
                "id": z.id,
                "name": z.name,
                "rect": [*pt((z.rect[0], z.rect[1])), *pt((z.rect[2], z.rect[3]))],
            }
            for z in config.ceiling_zones
        ],
        # 建商附的廚具、衛浴；新方案會以此為預設家具
        "fixtures": [
            {
                "type": f.type,
                "x": pt(f.center)[0],
                "y": pt(f.center)[1],
                "rotation": f.rotation,
                "size": {"w": f.size[0], "d": f.size[1], "h": f.size[2]},
            }
            for f in config.fixtures
        ],
        # 插座、開關、弱電出口：只有類型代碼、座標與離地高度（公尺）
        "outlets": [
            {"type": o.type, "x": pt(o.at)[0], "y": pt(o.at)[1], "height": o.height}
            for o in outlet_result.outlets
        ],
        # 不包天花板時看得到的灑水頭、探測器、風管、排風口；只有類型代碼與座標，風管尺寸為公尺
        "ceilingServices": {
            "sprinklers": [{"x": pt(s)[0], "y": pt(s)[1]} for s in services.sprinklers],
            "detectors": [
                {"type": d.type, "x": pt(d.at)[0], "y": pt(d.at)[1]} for d in services.detectors
            ],
            "ducts": [
                {
                    "type": d.type,
                    "path": [pt(p) for p in d.path],
                    "size": {"w": round(d.size, DECIMALS), "h": round(d.size, DECIMALS)},
                }
                for d in services.ducts
            ],
            "vents": [{"x": pt(v)[0], "y": pt(v)[1]} for v in services.vents],
        },
    }
    return BuildResult(floorplan=floorplan, warnings=warnings)
