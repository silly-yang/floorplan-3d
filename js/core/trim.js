// 牆面線條：踢腳板、天花板線板沿牆的路徑與轉角接法；不依賴 Three.js
// 轉角接法（線條在牆外側、往 out 方向有厚度）：
//   convex：牆的外角，兩段各往外斜切 45° 接成一個角；不切會在角上缺一塊
//   reflex：牆的內角，兩段各往內斜切 45°；不切會互相重疊、表面閃爍
//   butt：頂到另一道牆的牆面，那道牆的線條會通過這裡，這一段要整個退一個厚度
//   square：不接任何東西，或與另一道牆頭尾相接，直接平切
import { pointSegmentDistance } from './geometry2d.js';

const EPS = 1e-4;
const clean = (v) => v + 0; // 把 -0 變成 0

const signedArea = (poly) => poly.reduce((sum, [x0, y0], i) => {
  const [x1, y1] = poly[(i + 1) % poly.length];
  return sum + x0 * y1 - x1 * y0;
}, 0) / 2;

const edgeAt = (poly, i) => {
  const n = poly.length;
  const a = poly[((i % n) + n) % n];
  const b = poly[(((i + 1) % n) + n) % n];
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return { a, b, length, dir: [clean((b[0] - a[0]) / length), clean((b[1] - a[1]) / length)] };
};

// 柱子不貼線條（多半在室外角落），也不算會擋住線條的牆
export function wallFaceRuns(walls, { minEdge = 0.2 } = {}) {
  const trimmed = walls.filter((w) => w.kind !== 'column');
  // 落在別道牆的邊上（不是那道牆的角）：那道牆的線條會從這裡通過
  const touchesOther = (point, self) =>
    trimmed.some(
      (w) =>
        w !== self &&
        !w.polygon.some((p) => Math.hypot(p[0] - point[0], p[1] - point[1]) < EPS) &&
        w.polygon.some((p, i) => pointSegmentDistance(point, p, w.polygon[(i + 1) % w.polygon.length]) < EPS),
    );
  const runs = [];
  for (const wall of trimmed) {
    const poly = wall.polygon;
    const ccw = signedArea(poly) > 0;
    // 兩段在 vertex 相接：先邊 first、後邊 second
    const joint = (first, second, vertex) => {
      if (touchesOther(vertex, wall)) return 'butt';
      if (first.length < minEdge || second.length < minEdge) return 'square';
      const turn = first.dir[0] * second.dir[1] - first.dir[1] * second.dir[0];
      if (Math.abs(turn) < 1e-9) return 'square';
      return turn > 0 === ccw ? 'convex' : 'reflex';
    };
    poly.forEach((_, i) => {
      const edge = edgeAt(poly, i);
      if (edge.length < minEdge) return;
      const { dir } = edge;
      runs.push({
        wallId: wall.id,
        a: edge.a,
        b: edge.b,
        dir,
        out: ccw ? [clean(dir[1]), clean(-dir[0])] : [clean(-dir[1]), clean(dir[0])],
        start: joint(edgeAt(poly, i - 1), edge, edge.a),
        end: joint(edge, edgeAt(poly, i + 1), edge.b),
      });
    });
  }
  return runs;
}

// 線段 p + d·t（t∈[0,1]）落在矩形內的範圍；不相交回 null
function clipToRect(p, d, [x0, y0, x1, y1]) {
  let t0 = 0;
  let t1 = 1;
  for (const [delta, from, lo, hi] of [[d[0], p[0], x0, x1], [d[1], p[1], y0, y1]]) {
    if (Math.abs(delta) < 1e-12) {
      if (from < lo || from > hi) return null;
      continue;
    }
    const ta = (lo - from) / delta;
    const tb = (hi - from) / delta;
    t0 = Math.max(t0, Math.min(ta, tb));
    t1 = Math.min(t1, Math.max(ta, tb));
  }
  return t1 - t0 > 1e-9 ? [t0, t1] : null;
}

// 每段牆面線條只留在 zones（{ rect, height }）裡的部分；判斷用牆面往外一點點的位置，房間矩形貼齊牆面也算在內
export function clipRuns(runs, zones) {
  const pieces = [];
  for (const run of runs) {
    const d = [run.b[0] - run.a[0], run.b[1] - run.a[1]];
    const face = [run.a[0] + run.out[0] * EPS, run.a[1] + run.out[1] * EPS];
    for (const zone of zones) {
      const range = clipToRect(face, d, zone.rect);
      if (!range) continue;
      const [t0, t1] = range;
      const at = (t) => [run.a[0] + d[0] * t, run.a[1] + d[1] * t];
      const cutStart = t0 > 1e-9;
      const cutEnd = t1 < 1 - 1e-9;
      pieces.push({
        ...run,
        a: cutStart ? at(t0) : run.a,
        b: cutEnd ? at(t1) : run.b,
        start: cutStart ? 'square' : run.start,
        end: cutEnd ? 'square' : run.end,
        height: zone.height,
      });
    }
  }
  return pieces;
}
