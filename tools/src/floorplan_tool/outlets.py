"""水電圖上的插座、開關、弱電出口 → floorplan.json 的 outlets。

依圖塊名稱的關鍵字判斷類型與離地高度；類型代碼對應網頁目錄的水電類。
只輸出類型代碼、座標與高度，圖塊名稱不進 floorplan.json。
"""

from dataclasses import dataclass

from floorplan_tool.config import Config
from floorplan_tool.dxf import DxfDocument
from floorplan_tool.geometry import Point


@dataclass(frozen=True)
class OutletKind:
    type: str
    height: float  # 公尺，離地


@dataclass(frozen=True)
class Outlet:
    type: str
    at: Point  # 圖面單位，已扣掉水電圖的位移
    height: float


@dataclass(frozen=True)
class OutletResult:
    outlets: list[Outlet]
    warnings: list[str]  # 給轉檔的人看，不寫進 floorplan.json


# 由上往下比對，第一個命中的關鍵字決定類型；順序有意義（「電視資訊」要先於「資訊出口」）
# 220V：冷氣、暖風機、電陶爐；專用迴路 110V：排油煙機、微波爐、烘碗機
# 高度：一般 0.3、檯面 1.1、廚房／浴室／洗衣機 1.2、開關 1.2、冷氣與暖風機 2.3
RULES: tuple[tuple[tuple[str, ...], OutletKind], ...] = (
    (("冷氣",), OutletKind("outlet-220", 2.3)),
    (("暖風機",), OutletKind("outlet-220", 2.3)),
    (("電陶爐", "IH爐"), OutletKind("outlet-220", 1.1)),
    (("排油煙機",), OutletKind("outlet-dedicated", 2.0)),
    (("微波爐", "烤箱", "烘碗"), OutletKind("outlet-dedicated", 1.2)),
    (("檯面",), OutletKind("outlet-110", 1.1)),
    (("浴室", "洗衣機", "冰箱", "水槽燈"), OutletKind("outlet-110", 1.2)),
    (("免治馬桶",), OutletKind("outlet-110", 0.45)),
    (("正常插座", "一般插座"), OutletKind("outlet-110", 0.3)),
    (("開關",), OutletKind("switch", 1.2)),
    (("電視",), OutletKind("tv-jack", 0.3)),
    (("資訊出口", "網路"), OutletKind("lan-jack", 0.3)),
)
FALLBACK = OutletKind("outlet-110", 0.3)


def classify(block_name: str) -> OutletKind | None:
    return next((kind for words, kind in RULES if any(w in block_name for w in words)), None)


def find_outlets(doc: DxfDocument, config: Config) -> OutletResult:
    dx, dy = config.electrical_offset
    outlets: list[Outlet] = []
    unknown: set[str] = set()
    for e in doc.entities:
        on_outlet_layer = e.layer in config.layers.outlet
        if e.type != "INSERT" or not (on_outlet_layer or e.layer in config.layers.wall_device):
            continue
        at = (e.num(10) - dx, e.num(20) - dy)
        if not config.clip.contains(*at):
            continue
        name = e.first(2) or ""
        kind = classify(name)
        if kind is None and on_outlet_layer:
            unknown.add(name)
            kind = FALLBACK
        if kind is not None:
            outlets.append(Outlet(kind.type, at, kind.height))
    warnings = (
        [f"插座圖塊認不出類型，已當成一般插座：{'、'.join(sorted(unknown))}"] if unknown else []
    )
    return OutletResult(sorted(outlets, key=lambda o: (o.at[1], o.at[0])), warnings)
