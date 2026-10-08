"""DXF（ASCII）最小解析器：只取用得到的圖元與圖塊，不依賴第三方套件。"""

from dataclasses import dataclass, field

from floorplan_tool.exceptions import DxfFormatError


@dataclass(frozen=True)
class Entity:
    type: str
    layer: str
    codes: tuple[tuple[int, str], ...]

    # 取第一個指定群組碼的值；不存在回 None
    def first(self, code: int) -> str | None:
        return next((value for c, value in self.codes if c == code), None)

    # 取所有指定群組碼的值（LWPOLYLINE 的頂點會重複出現）
    def all(self, code: int) -> list[str]:
        return [value for c, value in self.codes if c == code]

    # 取第一個指定群組碼並轉成浮點數；不存在回 default
    def num(self, code: int, default: float = 0.0) -> float:
        value = self.first(code)
        if value is None:
            return default
        return float(value)


@dataclass(frozen=True)
class DxfDocument:
    entities: list[Entity]
    blocks: dict[str, list[Entity]]


@dataclass
class _Reader:
    entities: list[Entity] = field(default_factory=list)
    blocks: dict[str, list[Entity]] = field(default_factory=dict)
    section: str | None = None
    block_name: str | None = None  # "" 代表剛進 BLOCK、還沒讀到名稱
    current_type: str | None = None
    current_codes: list[tuple[int, str]] = field(default_factory=list)
    seen_entities: bool = False

    def flush(self) -> None:
        if self.current_type is None:
            return
        layer = next((v for c, v in self.current_codes if c == 8), "")
        entity = Entity(self.current_type, layer, tuple(self.current_codes))
        if self.section == "ENTITIES":
            self.entities.append(entity)
        elif self.section == "BLOCKS" and self.block_name:
            self.blocks[self.block_name].append(entity)
        self.current_type, self.current_codes = None, []

    def start(self, value: str) -> None:
        self.flush()
        if self.section == "BLOCKS" and value == "BLOCK":
            self.block_name = ""
            return
        if self.section == "BLOCKS" and value == "ENDBLK":
            self.block_name = None
            return
        self.current_type = value

    def feed(self, code: int, value: str) -> None:
        # BLOCK 標頭的群組碼 2 是圖塊名稱，不是圖元內容
        if self.block_name == "" and self.current_type is None:
            if code == 2:
                self.block_name = value
                self.blocks.setdefault(value, [])
            return
        if self.current_type is not None:
            self.current_codes.append((code, value))


def _pairs(text: str) -> list[tuple[int, str]]:
    lines = text.splitlines()
    pairs: list[tuple[int, str]] = []
    for i in range(0, len(lines) - 1, 2):
        code = lines[i].strip()
        if not code.lstrip("-").isdigit():
            raise DxfFormatError(
                f"第 {i + 1} 行應為群組碼數字，收到 {code!r}；找不到可解析的 ENTITIES"
            )
        pairs.append((int(code), lines[i + 1].strip()))
    return pairs


def parse_dxf(text: str) -> DxfDocument:
    reader = _Reader()
    expecting_section_name = False
    for code, value in _pairs(text):
        if expecting_section_name:
            expecting_section_name = False
            reader.section = value
            reader.seen_entities = reader.seen_entities or value == "ENTITIES"
            continue
        if code == 0 and value == "SECTION":
            expecting_section_name = True
            continue
        if code == 0 and value == "ENDSEC":
            reader.flush()
            reader.section, reader.block_name = None, None
            continue
        if reader.section not in ("ENTITIES", "BLOCKS"):
            continue
        if code == 0:
            reader.start(value)
            continue
        reader.feed(code, value)

    if not reader.seen_entities:
        raise DxfFormatError("找不到 ENTITIES 區段，這不是有效的 DXF 文字檔")
    return DxfDocument(entities=reader.entities, blocks=reader.blocks)
