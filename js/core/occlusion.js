// 遮擋判斷：哪些牆擋在鏡頭與目標之間；只看平面，不依賴 Three.js
import { pointInPolygon, pointSegmentDistance } from './geometry2d.js';

const EPS = 1e-9;

const edgesOf = (poly) => poly.map((p, i) => [p, poly[(i + 1) % poly.length]]);
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];

const onBoundary = (pt, poly) => edgesOf(poly).some(([a, b]) => pointSegmentDistance(pt, a, b) <= EPS);

// 線段 a→b 與多邊形邊界的交會參數 t（0~1），含兩端點
function boundaryParams(a, b, poly) {
  const r = sub(b, a);
  const ts = [0, 1];
  for (const [p, q] of edgesOf(poly)) {
    const s = sub(q, p);
    const denom = cross(r, s);
    if (Math.abs(denom) > EPS) {
      const t = cross(sub(p, a), s) / denom;
      const u = cross(sub(p, a), r) / denom;
      if (t >= -EPS && t <= 1 + EPS && u >= -EPS && u <= 1 + EPS) ts.push(t);
    }
  }
  return ts.map((t) => Math.min(1, Math.max(0, t))).sort((x, y) => x - y);
}

// 線段有一段真的走進牆裡才算；只擦過邊或角不算
function passesThrough(a, b, poly) {
  const ts = boundaryParams(a, b, poly);
  for (let i = 1; i < ts.length; i++) {
    if (ts[i] - ts[i - 1] <= EPS) continue;
    const t = (ts[i] + ts[i - 1]) / 2;
    const mid = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    if (pointInPolygon(mid, poly) && !onBoundary(mid, poly)) return true;
  }
  return false;
}

// solids 為 buildSolids 的輸出；回傳擋住視線的量體 id
// 目標本身落在牆裡（含牆面上）時那道牆不算，貼牆的家具才不會把自己靠的牆變透明
export function occludingWalls(solids, cameraPlan, targetPlan) {
  const ids = new Set();
  if (Math.hypot(cameraPlan[0] - targetPlan[0], cameraPlan[1] - targetPlan[1]) <= EPS) return ids;
  for (const { id, polygon } of solids) {
    if (pointInPolygon(targetPlan, polygon) || onBoundary(targetPlan, polygon)) continue;
    if (passesThrough(cameraPlan, targetPlan, polygon)) ids.add(id);
  }
  return ids;
}
