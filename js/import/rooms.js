// 格點填色算房間的地板範圍；範圍 bounds 為 { xMin, yMin, xMax, yMax }，矩形為 [x0, y0, x1, y1]
import { FloorplanError, RoomLeakError } from './errors.js';
import { floorDiv, pointInPolygon } from './geometry.js';

function gridOf(bounds, cell) {
  const cols = Math.ceil((bounds.xMax - bounds.xMin) / cell);
  const rows = Math.ceil((bounds.yMax - bounds.yMin) / cell);
  return { cols, rows, bounds, cell };
}

// 格子中心落在任一障礙多邊形內就擋住；回傳 Uint8Array，索引為 r * cols + c
function blockedGrid(barriers, { cols, rows, bounds, cell }) {
  const blocked = new Uint8Array(cols * rows);
  for (const poly of barriers) {
    const xs = poly.map((p) => p[0]);
    const ys = poly.map((p) => p[1]);
    const c0 = Math.max(0, floorDiv(Math.min(...xs) - bounds.xMin, cell));
    const c1 = Math.min(cols - 1, floorDiv(Math.max(...xs) - bounds.xMin, cell));
    const r0 = Math.max(0, floorDiv(Math.min(...ys) - bounds.yMin, cell));
    const r1 = Math.min(rows - 1, floorDiv(Math.max(...ys) - bounds.yMin, cell));
    for (let c = c0; c <= c1; c += 1) {
      for (let r = r0; r <= r1; r += 1) {
        const center = [bounds.xMin + (c + 0.5) * cell, bounds.yMin + (r + 0.5) * cell];
        if (pointInPolygon(center, poly)) blocked[r * cols + c] = 1;
      }
    }
  }
  return blocked;
}

// 從 start 往四方向填色；回傳填到的格子（[c, r]）與是否碰到邊界
function flood(start, blocked, filled, { cols, rows }) {
  const cells = [start];
  filled[start[1] * cols + start[0]] = 1;
  let touchesEdge = false;
  for (let i = 0; i < cells.length; i += 1) {
    const [c, r] = cells[i];
    if (c === 0 || c === cols - 1 || r === 0 || r === rows - 1) touchesEdge = true;
    for (const [nc, nr] of [[c + 1, r], [c - 1, r], [c, r + 1], [c, r - 1]]) {
      if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
      const k = nr * cols + nc;
      if (blocked[k] || filled[k]) continue;
      filled[k] = 1;
      cells.push([nc, nr]);
    }
  }
  return { cells, touchesEdge };
}

// 同一列連續的格子併成一段，再把上下列完全相同的段落併成一個矩形
function merge(cells, { bounds, cell }) {
  const byRow = new Map();
  for (const [c, r] of cells) {
    if (!byRow.has(r)) byRow.set(r, []);
    byRow.get(r).push(c);
  }
  const runs = new Map(); // `${c0},${c1}` → { c0, c1, rows }
  for (const row of [...byRow.keys()].sort((a, b) => a - b)) {
    const cols = byRow.get(row).sort((a, b) => a - b);
    let start = cols[0];
    let prev = cols[0];
    for (const c of [...cols.slice(1), null]) {
      if (c !== null && c === prev + 1) {
        prev = c;
        continue;
      }
      const key = `${start},${prev}`;
      if (!runs.has(key)) runs.set(key, { c0: start, c1: prev, rows: [] });
      runs.get(key).rows.push(row);
      if (c !== null) [start, prev] = [c, c];
    }
  }
  const rects = [];
  const ordered = [...runs.values()].sort((a, b) => a.c0 - b.c0 || a.c1 - b.c1);
  for (const { c0, c1, rows } of ordered) {
    let start = rows[0];
    let prev = rows[0];
    for (const r of [...rows.slice(1), null]) {
      if (r !== null && r === prev + 1) {
        prev = r;
        continue;
      }
      rects.push([bounds.xMin + c0 * cell, bounds.yMin + start * cell, bounds.xMin + (c1 + 1) * cell, bounds.yMin + (prev + 1) * cell]);
      if (r !== null) [start, prev] = [r, r];
    }
  }
  return rects;
}

// 以 cell 為格子大小從種子點填色；碰到 barriers 停止，碰到 bounds 邊界視為漏水
export function traceRoom(seed, barriers, bounds, cell) {
  const grid = gridOf(bounds, cell);
  const blocked = blockedGrid(barriers, grid);
  const start = [floorDiv(seed[0] - bounds.xMin, cell), floorDiv(seed[1] - bounds.yMin, cell)];
  const outside = !(start[0] >= 0 && start[0] < grid.cols && start[1] >= 0 && start[1] < grid.rows);
  if (outside || blocked[start[1] * grid.cols + start[0]]) {
    throw new FloorplanError(`種子點 (${seed.join(', ')}) 落在牆內或圖面範圍外，請改到房間內部`);
  }
  const { cells, touchesEdge } = flood(start, blocked, new Uint8Array(grid.cols * grid.rows), grid);
  if (touchesEdge) throw new RoomLeakError(`從種子點 (${seed.join(', ')}) 填色時碰到圖面邊界，牆或開口沒有封閉`);
  return merge(cells, grid);
}

// 不靠種子點：把 bounds 內所有沒碰到邊界的連通區域都找出來，依由下而上、由左而右的發現順序回傳矩形組
export function enclosedRegions(barriers, bounds, cell) {
  const grid = gridOf(bounds, cell);
  const blocked = blockedGrid(barriers, grid);
  const filled = new Uint8Array(grid.cols * grid.rows);
  const regions = [];
  for (let r = 0; r < grid.rows; r += 1) {
    for (let c = 0; c < grid.cols; c += 1) {
      const k = r * grid.cols + c;
      if (blocked[k] || filled[k]) continue;
      const { cells, touchesEdge } = flood([c, r], blocked, filled, grid);
      if (!touchesEdge) regions.push(merge(cells, grid));
    }
  }
  return regions;
}
