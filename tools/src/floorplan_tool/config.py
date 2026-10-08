"""overrides.json：圖面上讀不出來、要人工指定的設定。

距離類欄位（clip、gap、seed）用圖面單位；高度類欄位（sill、head）用公尺。
"""

from dataclasses import dataclass, field
from typing import Any

from floorplan_tool.exceptions import ConfigError

LAYER_KEYS = {
    "rcWall": "rc_wall",
    "partition": "partition",
    "column": "column",
    "window": "window",
    "door": "door",
    "barrier": "barrier",
}


@dataclass(frozen=True)
class Box:
    x_min: float
    y_min: float
    x_max: float
    y_max: float

    def contains(self, x: float, y: float) -> bool:
        return self.x_min <= x <= self.x_max and self.y_min <= y <= self.y_max


@dataclass(frozen=True)
class LayerMap:
    rc_wall: list[str]
    partition: list[str]
    column: list[str]
    window: list[str]
    door: list[str]
    barrier: list[str]


@dataclass(frozen=True)
class OpeningSpec:
    sill: float
    head: float


@dataclass(frozen=True)
class RoomSeed:
    id: str
    name: str
    seed: tuple[float, float]


@dataclass(frozen=True)
class FixtureSeed:
    type: str
    center: tuple[float, float]
    size: tuple[float, float, float]  # 公分：寬、深、高
    rotation: float


@dataclass(frozen=True)
class Config:
    unit_scale: float
    clip: Box
    layers: LayerMap
    window_types: dict[str, OpeningSpec]
    door_head: float
    doorway_head: float
    gap_min: float
    gap_max: float
    rooms: list[RoomSeed]
    ignore_openings: list[str]
    fixtures: list[FixtureSeed] = field(default_factory=list)


def _is_number(value: object) -> bool:
    return isinstance(value, int | float) and not isinstance(value, bool)


# 驗證失敗時把訊息加進 problems 並回傳 None，讓呼叫端一次收集所有錯誤
def _positive(raw: dict[str, Any], key: str, problems: list[str]) -> float | None:
    if key not in raw:
        problems.append(f"{key}：缺少此欄位")
        return None
    value = raw[key]
    if not _is_number(value) or value <= 0:
        problems.append(f"{key}：必須是正數，收到 {value!r}")
        return None
    return float(value)


def _clip(raw: dict[str, Any], problems: list[str]) -> Box | None:
    clip = raw.get("clip")
    keys = ("xMin", "yMin", "xMax", "yMax")
    if not isinstance(clip, dict) or not all(_is_number(clip.get(k)) for k in keys):
        problems.append(f"clip：必須是含 {', '.join(keys)} 四個數字的物件，收到 {clip!r}")
        return None
    box = Box(*(float(clip[k]) for k in keys))
    if box.x_min >= box.x_max or box.y_min >= box.y_max:
        problems.append(f"clip：最小值必須小於最大值，收到 {clip!r}")
        return None
    return box


def _layers(raw: dict[str, Any], problems: list[str]) -> LayerMap | None:
    layers = raw.get("layers")
    if not isinstance(layers, dict):
        problems.append(f"layers：必須是物件，收到 {layers!r}")
        return None
    values: dict[str, list[str]] = {}
    for key, attr in LAYER_KEYS.items():
        names = layers.get(key, [])
        if not isinstance(names, list) or not all(isinstance(n, str) for n in names):
            problems.append(f"layers.{key}：必須是圖層名稱字串陣列，收到 {names!r}")
            continue
        values[attr] = names
    if len(values) != len(LAYER_KEYS):
        return None
    return LayerMap(**values)


def _window_types(raw: dict[str, Any], problems: list[str]) -> dict[str, OpeningSpec]:
    types = raw.get("windowTypes", {})
    if not isinstance(types, dict):
        problems.append(f"windowTypes：必須是物件，收到 {types!r}")
        return {}
    result: dict[str, OpeningSpec] = {}
    for label, spec in types.items():
        sill = spec.get("sill") if isinstance(spec, dict) else None
        head = spec.get("head") if isinstance(spec, dict) else None
        if not (isinstance(sill, int | float) and isinstance(head, int | float)) or not (
            0 <= sill < head
        ):
            problems.append(f"windowTypes.{label}：需要 0 ≤ sill < head（公尺），收到 {spec!r}")
            continue
        result[label] = OpeningSpec(float(sill), float(head))
    return result


def _rooms(raw: dict[str, Any], problems: list[str]) -> list[RoomSeed]:
    rooms = raw.get("rooms", [])
    if not isinstance(rooms, list):
        problems.append(f"rooms：必須是陣列，收到 {rooms!r}")
        return []
    result: list[RoomSeed] = []
    for i, room in enumerate(rooms):
        if not isinstance(room, dict):
            problems.append(f"rooms[{i}]：必須是物件，收到 {room!r}")
            continue
        seed = room.get("seed")
        if not (isinstance(seed, list) and len(seed) == 2 and all(_is_number(v) for v in seed)):
            problems.append(f"rooms[{i}].seed：必須是 [x, y] 兩個數字，收到 {seed!r}")
            continue
        if not isinstance(room.get("id"), str) or not isinstance(room.get("name"), str):
            problems.append(f"rooms[{i}]：id 與 name 必須是字串")
            continue
        result.append(RoomSeed(room["id"], room["name"], (float(seed[0]), float(seed[1]))))
    return result


def _fixtures(raw: dict[str, Any], problems: list[str]) -> list[FixtureSeed]:
    fixtures = raw.get("fixtures", [])
    if not isinstance(fixtures, list):
        problems.append(f"fixtures：必須是陣列，收到 {fixtures!r}")
        return []
    result: list[FixtureSeed] = []
    for i, f in enumerate(fixtures):
        at = f"fixtures[{i}]"
        if not isinstance(f, dict):
            problems.append(f"{at}：必須是物件")
            continue
        center, size, rotation = f.get("center"), f.get("size"), f.get("rotation", 0)
        ok = True
        if not isinstance(f.get("type"), str) or not f["type"]:
            problems.append(f"{at}.type：必須是家具類型字串")
            ok = False
        if not (
            isinstance(center, list) and len(center) == 2 and all(_is_number(v) for v in center)
        ):
            problems.append(f"{at}.center：必須是 [x, y] 兩個數字（圖面單位）")
            ok = False
        if not (
            isinstance(size, list) and len(size) == 3 and all(_is_number(v) and v > 0 for v in size)
        ):
            problems.append(f"{at}.size：必須是 [寬, 深, 高] 三個正數（公分）")
            ok = False
        if not _is_number(rotation):
            problems.append(f"{at}.rotation：必須是數字（度）")
            ok = False
        if ok:
            # 上面已逐項驗過；這行只是讓型別檢查知道它們是 list
            assert isinstance(center, list) and isinstance(size, list)
            result.append(
                FixtureSeed(
                    f["type"],
                    (float(center[0]), float(center[1])),
                    (float(size[0]), float(size[1]), float(size[2])),
                    float(rotation),
                )
            )
    return result


# raw 來自 json.load，結構未知，驗證完才轉成具型別的 Config
def parse_config(raw: Any) -> Config:
    if not isinstance(raw, dict):
        raise ConfigError([f"overrides 最外層必須是物件，收到 {type(raw).__name__}"])
    problems: list[str] = []
    unit_scale = _positive(raw, "unitScale", problems)
    clip = _clip(raw, problems)
    layers = _layers(raw, problems)
    window_types = _window_types(raw, problems)
    door_head = _positive(raw, "doorHead", problems)
    doorway_head = _positive(raw, "doorwayHead", problems)
    gap_min = _positive(raw, "gapMin", problems)
    gap_max = _positive(raw, "gapMax", problems)
    if gap_min is not None and gap_max is not None and gap_max <= gap_min:
        problems.append(f"gapMax：必須大於 gapMin（{gap_min}），收到 {gap_max}")
    rooms = _rooms(raw, problems)
    fixtures = _fixtures(raw, problems)
    ignore = raw.get("ignoreOpenings", [])
    if not isinstance(ignore, list) or not all(isinstance(i, str) for i in ignore):
        problems.append(f"ignoreOpenings：必須是字串陣列，收到 {ignore!r}")

    if problems:
        raise ConfigError(problems)
    # 走到這裡代表上面每個欄位都驗過，None 不會出現
    assert unit_scale and clip and layers and door_head and doorway_head and gap_min and gap_max
    return Config(
        unit_scale=unit_scale,
        clip=clip,
        layers=layers,
        window_types=window_types,
        door_head=door_head,
        doorway_head=doorway_head,
        gap_min=gap_min,
        gap_max=gap_max,
        rooms=rooms,
        ignore_openings=list(ignore),
        fixtures=fixtures,
    )
