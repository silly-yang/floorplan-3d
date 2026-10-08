// 平面幾何：碰撞、距離；單位公尺，點為 [x, y]

const EPS = 1e-9;

export function pointInPolygon([x, y], poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// 點到線段的最短距離
export function pointSegmentDistance(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

const edges = (poly) => poly.map((p, i) => [p, poly[(i + 1) % poly.length]]);

const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

// 只算「真正穿越」：端點剛好碰到不算，家具貼牆擺放才不會被誤判
function segmentsCross(a, b, c, d) {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return d1 * d2 < -EPS && d3 * d4 < -EPS;
}

const centroid = (poly) => [
  poly.reduce((s, p) => s + p[0], 0) / poly.length,
  poly.reduce((s, p) => s + p[1], 0) / poly.length,
];

// 嚴格內部才算：沿邊貼齊不算重疊
function strictlyInside(pt, poly) {
  if (!pointInPolygon(pt, poly)) return false;
  return edges(poly).every(([a, b]) => pointSegmentDistance(pt, a, b) > EPS);
}

export function polygonsIntersect(a, b) {
  for (const [p, q] of edges(a)) {
    for (const [r, s] of edges(b)) {
      if (segmentsCross(p, q, r, s)) return true;
    }
  }
  // 沒有邊穿越時，只剩一個整個包住另一個的情況
  return strictlyInside(centroid(a), b) || strictlyInside(centroid(b), a) || a.some((p) => strictlyInside(p, b)) || b.some((p) => strictlyInside(p, a));
}

// 兩多邊形的最短距離；相交時為 0
export function polygonDistance(a, b) {
  if (polygonsIntersect(a, b)) return 0;
  let best = Infinity;
  for (const p of a) for (const [r, s] of edges(b)) best = Math.min(best, pointSegmentDistance(p, r, s));
  for (const p of b) for (const [r, s] of edges(a)) best = Math.min(best, pointSegmentDistance(p, r, s));
  return best;
}

// 以中心、寬、深、旋轉角（度，逆時針）求家具底面的四個角
export function rectCorners(cx, cy, w, d, rotationDeg) {
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const round = (v) => Math.round(v * 1e9) / 1e9;
  return [
    [-w / 2, -d / 2],
    [w / 2, -d / 2],
    [w / 2, d / 2],
    [-w / 2, d / 2],
  ].map(([x, y]) => [round(cx + x * cos - y * sin), round(cy + x * sin + y * cos)]);
}
