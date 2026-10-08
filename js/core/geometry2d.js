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

const signedArea = (poly) => edges(poly).reduce((s, [p, q]) => s + p[0] * q[1] - q[0] * p[1], 0) / 2;

function isConvex(poly) {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const c = cross(poly[i], poly[(i + 1) % poly.length], poly[(i + 2) % poly.length]);
    if (Math.abs(c) < EPS) continue;
    if (sign === 0) sign = Math.sign(c);
    else if (Math.sign(c) !== sign) return false;
  }
  return true;
}

// Sutherland–Hodgman：以凸多邊形 clip 裁切任意簡單多邊形 subject，回傳交集
function clipPolygon(subject, clip) {
  const ccw = signedArea(clip) > 0 ? clip : [...clip].reverse();
  let output = subject;
  for (const [a, b] of edges(ccw)) {
    if (output.length === 0) break;
    const input = output;
    output = [];
    const inside = (p) => cross(a, b, p) >= -EPS;
    const intersect = (p, q) => {
      const t = cross(a, b, p) / (cross(a, b, p) - cross(a, b, q));
      return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
    };
    input.forEach((p, i) => {
      const q = input[(i + 1) % input.length];
      if (inside(q)) {
        if (!inside(p)) output.push(intersect(p, q));
        output.push(q);
      } else if (inside(p)) {
        output.push(intersect(p, q));
      }
    });
  }
  return output;
}

const OVERLAP_AREA = 1e-8; // 平方公尺；只碰到邊的交集面積為 0

export function polygonsIntersect(a, b) {
  // 有一邊是凸多邊形（家具底面一定是）就直接算交集面積，邊對齊的情況也判得準
  if (isConvex(a) || isConvex(b)) {
    const [subject, clip] = isConvex(a) ? [b, a] : [a, b];
    const overlap = clipPolygon(subject, clip);
    return overlap.length >= 3 && Math.abs(signedArea(overlap)) > OVERLAP_AREA;
  }
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

// 線段 a→b 穿過多邊形幾次（進出算一次）；非凸的 L 形牆可能被穿過兩次
export function segmentPolygonCrossings(a, b, poly) {
  const rx = b[0] - a[0];
  const ry = b[1] - a[1];
  let hits = 0;
  for (const [p, q] of edges(poly)) {
    const sx = q[0] - p[0];
    const sy = q[1] - p[1];
    const denom = rx * sy - ry * sx;
    if (Math.abs(denom) < EPS) continue; // 平行或沿邊擦過不算
    const t = ((p[0] - a[0]) * sy - (p[1] - a[1]) * sx) / denom;
    const u = ((p[0] - a[0]) * ry - (p[1] - a[1]) * rx) / denom;
    // 邊取半開區間，剛好穿過頂點時不會被相鄰兩條邊各算一次
    if (t >= 0 && t <= 1 && u >= 0 && u < 1) hits++;
  }
  return Math.ceil(hits / 2);
}
