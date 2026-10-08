// 從樑的圖層找出大樑：兩條平行線配成一支樑，深度讀旁邊的「(寬x深)」標註
import { inClip } from './walls.js';

// 距離皆為公尺；使用時除以 unitScale 換成圖面單位
const AXIS_TOLERANCE = 0.005; // 兩端點差在此以內視為水平／垂直線
const MIN_WIDTH = 0.15; // 平行線間距在這範圍內才算同一支樑
const MAX_WIDTH = 0.8;
const MIN_OVERLAP = 0.5; // 比例：兩條線重疊長度至少要佔較短那條的一半
const LABEL_RADIUS = 1.5;
const WIDTH_TOLERANCE = 0.05;
const DEFAULT_DEPTH = 0.6;
// 標註的寬、深是圖面單位；公尺圖會寫小數
const LABEL = /\((\d+(?:\.\d+)?)\s*[xX×]\s*(\d+(?:\.\d+)?)\)/;

// [固定座標, 起點, 終點]：水平線固定 y、垂直線固定 x；斜線不處理
function axisLines(doc, config) {
  const tolerance = AXIS_TOLERANCE / config.unitScale;
  const horizontal = [];
  const vertical = [];
  for (const e of doc.entities) {
    if (e.type !== 'LINE' || !config.layers.beam.includes(e.layer)) continue;
    const [x0, y0, x1, y1] = [e.num(10), e.num(20), e.num(11), e.num(21)];
    if (!inClip(config.clip, [x0, y0])) continue;
    if (Math.abs(y0 - y1) < tolerance) horizontal.push([y0, Math.min(x0, x1), Math.max(x0, x1)]);
    else if (Math.abs(x0 - x1) < tolerance) vertical.push([x0, Math.min(y0, y1), Math.max(y0, y1)]);
  }
  return [horizontal, vertical];
}

// 回傳 [固定座標小, 固定座標大, 重疊起點, 重疊終點]；每條線只用一次，挑最近的平行線
function pair(lines, minWidth, maxWidth) {
  const used = new Set();
  const result = [];
  const order = lines.map((_, i) => i).sort((i, j) => lines[i][0] - lines[j][0]);
  for (const i of order) {
    if (used.has(i)) continue;
    let best = null;
    for (const j of order) {
      if (j === i || used.has(j)) continue;
      const gap = Math.abs(lines[j][0] - lines[i][0]);
      const lo = Math.max(lines[i][1], lines[j][1]);
      const hi = Math.min(lines[i][2], lines[j][2]);
      const shorter = Math.min(lines[i][2] - lines[i][1], lines[j][2] - lines[j][1]);
      if (gap >= minWidth && gap <= maxWidth && hi - lo >= shorter * MIN_OVERLAP && (best === null || gap < best[0])) {
        best = [gap, j];
      }
    }
    if (best === null) continue;
    const j = best[1];
    used.add(i).add(j);
    const lo = Math.max(lines[i][1], lines[j][1]);
    const hi = Math.min(lines[i][2], lines[j][2]);
    result.push([Math.min(lines[i][0], lines[j][0]), Math.max(lines[i][0], lines[j][0]), lo, hi]);
  }
  return result;
}

function labels(doc, config) {
  const result = [];
  for (const e of doc.entities) {
    if ((e.type !== 'TEXT' && e.type !== 'MTEXT') || !config.layers.beam.includes(e.layer)) continue;
    const match = LABEL.exec(e.all(1).join(' '));
    if (match) result.push([e.num(10), e.num(20), Number(match[1]), Number(match[2])]);
  }
  return result;
}

function distanceToRect([px, py], [x0, y0, x1, y1]) {
  const dx = Math.max(x0 - px, 0, px - x1);
  const dy = Math.max(y0 - py, 0, py - y1);
  return Math.hypot(dx, dy);
}

// 回傳 [{ rect: [x0, y0, x1, y1], depth }]，皆為圖面單位；樑的代號不輸出
export function findBeams(doc, config) {
  const [minWidth, maxWidth, labelRadius, widthTolerance, defaultDepth] = [MIN_WIDTH, MAX_WIDTH, LABEL_RADIUS, WIDTH_TOLERANCE, DEFAULT_DEPTH].map(
    (m) => m / config.unitScale,
  );
  const [horizontal, vertical] = axisLines(doc, config);
  const rects = [
    ...pair(horizontal, minWidth, maxWidth).map(([a, b, lo, hi]) => [lo, a, hi, b]),
    ...pair(vertical, minWidth, maxWidth).map(([a, b, lo, hi]) => [a, lo, b, hi]),
  ];
  const found = labels(doc, config);
  const beams = rects.map((rect) => {
    const [x0, y0, x1, y1] = rect;
    const width = Math.min(x1 - x0, y1 - y0);
    // 標註寫在樑旁邊；用離樑最近且寬度相符的那個，距離相同取較淺的（同 Python tuple 比較）
    let best = null;
    for (const [lx, ly, w, depth] of found) {
      if (Math.abs(w - width) > widthTolerance) continue;
      const d = distanceToRect([lx, ly], rect);
      if (d > labelRadius) continue;
      if (best === null || d < best[0] || (d === best[0] && depth < best[1])) best = [d, depth];
    }
    return { rect, depth: best ? best[1] : defaultDepth };
  });
  return beams.sort((a, b) => a.rect[1] - b.rect[1] || a.rect[0] - b.rect[0]);
}
