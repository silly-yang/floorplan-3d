"""測試共用：用程式組出最小的 DXF 文字，避免依賴真實圖檔。"""

from typing import Any

import pytest

from floorplan_tool.config import Config, parse_config


class DxfFactory:
    # 組一份只有 ENTITIES 與 BLOCKS 的 DXF；blocks 為 {名稱: [圖元片段]}
    def document(self, entities: list[str], blocks: dict[str, list[str]] | None = None) -> str:
        parts = ["0", "SECTION", "2", "HEADER", "9", "$INSUNITS", "70", "4", "0", "ENDSEC"]
        parts += ["0", "SECTION", "2", "BLOCKS"]
        for name, body in (blocks or {}).items():
            parts += ["0", "BLOCK", "8", "0", "2", name, "10", "0", "20", "0"]
            parts += body
            parts += ["0", "ENDBLK", "8", "0"]
        parts += ["0", "ENDSEC", "0", "SECTION", "2", "ENTITIES"]
        for entity in entities:
            parts += entity.split("\n")
        parts += ["0", "ENDSEC", "0", "EOF"]
        return "\n".join(parts) + "\n"

    def line(self, layer: str, a: tuple[float, float], b: tuple[float, float]) -> str:
        return f"0\nLINE\n8\n{layer}\n10\n{a[0]}\n20\n{a[1]}\n11\n{b[0]}\n21\n{b[1]}"

    def lwpolyline(self, layer: str, points: list[tuple[float, float]], closed: bool) -> str:
        head = f"0\nLWPOLYLINE\n8\n{layer}\n90\n{len(points)}\n70\n{1 if closed else 0}"
        return head + "".join(f"\n10\n{x}\n20\n{y}" for x, y in points)

    # 以 LINE 畫出矩形四邊（真實圖面的牆多半是這種畫法）
    def rect_lines(self, layer: str, x0: float, y0: float, x1: float, y1: float) -> list[str]:
        return [
            self.line(layer, (x0, y0), (x1, y0)),
            self.line(layer, (x1, y0), (x1, y1)),
            self.line(layer, (x1, y1), (x0, y1)),
            self.line(layer, (x0, y1), (x0, y0)),
        ]

    def text(self, layer: str, at: tuple[float, float], value: str) -> str:
        return f"0\nTEXT\n8\n{layer}\n10\n{at[0]}\n20\n{at[1]}\n40\n10\n1\n{value}"

    def attrib(self, layer: str, at: tuple[float, float], tag: str, value: str) -> str:
        return f"0\nATTRIB\n8\n{layer}\n10\n{at[0]}\n20\n{at[1]}\n2\n{tag}\n1\n{value}"

    def attdef(self, layer: str, at: tuple[float, float], tag: str, default: str) -> str:
        return f"0\nATTDEF\n8\n{layer}\n10\n{at[0]}\n20\n{at[1]}\n1\n{default}\n2\n{tag}"

    def insert(self, layer: str, name: str, at: tuple[float, float], rotation: float = 0.0) -> str:
        return f"0\nINSERT\n8\n{layer}\n2\n{name}\n10\n{at[0]}\n20\n{at[1]}\n50\n{rotation}"

    def arc(
        self, layer: str, center: tuple[float, float], radius: float, start: float, end: float
    ) -> str:
        return (
            f"0\nARC\n8\n{layer}\n10\n{center[0]}\n20\n{center[1]}\n40\n{radius}"
            f"\n50\n{start}\n51\n{end}"
        )


@pytest.fixture
def dxf() -> DxfFactory:
    return DxfFactory()


# 合法 overrides 的最小內容；各測試只覆寫要驗的欄位
def _base_raw_config() -> dict[str, Any]:
    return {
        "unitScale": 0.01,
        "clip": {"xMin": -1000, "yMin": -1000, "xMax": 5000, "yMax": 5000},
        "layers": {
            "rcWall": ["L3"],
            "partition": ["WALL2"],
            "column": ["L12"],
            "window": ["OPEN-Window"],
            "door": ["OPEN-Door"],
            "barrier": ["L23"],
            "beam": [],
        },
        "windowTypes": {"W5": {"sill": 0.9, "head": 2.1}},
        "doorHead": 2.1,
        "doorwayHead": 2.2,
        "gapMin": 30,
        "gapMax": 250,
        "rooms": [],
        "ignoreOpenings": [],
    }


@pytest.fixture
def raw_config() -> dict[str, Any]:
    return _base_raw_config()


@pytest.fixture
def config() -> Config:
    return parse_config(_base_raw_config())
