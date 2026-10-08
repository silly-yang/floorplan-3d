"""命令列進入點：DXF ＋ overrides.json → floorplan.json（＋檢查圖）。"""

import argparse
import json
import sys
from pathlib import Path

from floorplan_tool.builder import build_floorplan
from floorplan_tool.config import parse_config
from floorplan_tool.dxf import parse_dxf
from floorplan_tool.exceptions import FloorplanError
from floorplan_tool.svg import render_check_svg


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="把 DXF 平面圖轉成 floorplan.json")
    parser.add_argument("dxf", type=Path, help="DXF 檔（ASCII）")
    parser.add_argument("--overrides", type=Path, required=True, help="overrides.json")
    parser.add_argument("--out", type=Path, required=True, help="輸出的 floorplan.json")
    parser.add_argument("--preview", type=Path, help="輸出 SVG 檢查圖（建議放 source/，不進版控）")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        raw_config = json.loads(args.overrides.read_text(encoding="utf-8"))
        config = parse_config(raw_config)
        # CAD 匯出的 DXF 偶有非 UTF-8 的中文，替換掉不影響幾何
        doc = parse_dxf(args.dxf.read_text(encoding="utf-8", errors="replace"))
        result = build_floorplan(doc, config)
    except (FloorplanError, OSError, json.JSONDecodeError) as exc:
        print(f"轉換失敗：{exc}", file=sys.stderr)
        return 1

    args.out.write_text(
        json.dumps(result.floorplan, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    if args.preview:
        args.preview.write_text(render_check_svg(result.floorplan), encoding="utf-8")
    for warning in result.warnings:
        print(f"警告：{warning}", file=sys.stderr)
    fp = result.floorplan
    print(
        f"完成：牆 {len(fp['walls'])}、開口 {len(fp['openings'])}、房間 {len(fp['rooms'])}，"
        f"外框 {fp['bounds']['width']} × {fp['bounds']['depth']} m"
    )
    return 0
