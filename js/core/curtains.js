// 窗簾：軌道與收在兩側的簾片位置；不依賴 Three.js
import { openingAxis } from './floorplan.js';

const PROBE_DISTANCE = 0.4; // 判斷窗戶兩側是哪個房間時，往外探多遠
const WALL_GAP = 0.1; // 軌道離牆面
const OVERHANG = 0.15; // 軌道比窗戶每邊多出來的長度
const ABOVE_HEAD = 0.12; // 軌道比窗頂高多少
const BELOW_CEILING = 0.02;
const STACK_RATIO = 0.15; // 拉開時每側簾片佔軌道長度的比例
const STACK_MIN = 0.2;
const STACK_MAX = 0.45;
const FOLD_WIDTH = 0.05; // 收起來時每一摺約 5 cm
const MIN_FOLDS = 3;
export const CURTAIN_BOTTOM = 0.015; // 落地簾離地

const add = (p, v, s) => [p[0] + v[0] * s, p[1] + v[1] * s];
const areaOf = (room) => room.rects.reduce((sum, [x0, y0, x1, y1]) => sum + (x1 - x0) * (y1 - y0), 0);
const roomAt = ([x, y], rooms) => rooms.find((r) => r.rects.some(([x0, y0, x1, y1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1));

// 窗簾掛在室內側：只有一側是房間就掛那側；兩側都是房間（例如通陽台）掛在大的那間；都不是回 null
// ceiling：窗戶所在位置的天花板高度；回傳平面座標，side 為 across 的正負
export function curtainPlan(opening, rooms, { ceiling }) {
  const { start, dir, across, width, thickness } = openingAxis(opening.polygon);
  const mid = add(start, dir, width / 2);
  const ahead = roomAt(add(mid, across, PROBE_DISTANCE), rooms);
  const behind = roomAt(add(mid, across, -PROBE_DISTANCE), rooms);
  if (!ahead && !behind) return null;
  const side = ahead && behind ? (areaOf(ahead) >= areaOf(behind) ? 1 : -1) : ahead ? 1 : -1;
  const line = add(start, across, side * (thickness / 2 + WALL_GAP));
  const a = add(line, dir, -OVERHANG);
  const b = add(line, dir, width + OVERHANG);
  const length = width + OVERHANG * 2;
  const stack = Math.min(STACK_MAX, Math.max(STACK_MIN, length * STACK_RATIO));
  const folds = Math.max(MIN_FOLDS, Math.round(stack / FOLD_WIDTH));
  return {
    side,
    track: { a, b, height: Math.min(opening.head + ABOVE_HEAD, ceiling - BELOW_CEILING) },
    bottom: CURTAIN_BOTTOM,
    panels: [
      { a, b: add(a, dir, stack), folds },
      { a: add(b, dir, -stack), b, folds },
    ],
  };
}
