// 找出牆與牆之間的開口，並分類成門、窗、門洞
import { toNumber } from './dxf.js';
import { ConfigError } from './errors.js';
import { centroid, comparePoints, dist, pointInPolygon, polygonArea, rayHit } from './geometry.js';
import { inClip } from './walls.js';

// 距離皆為公尺；使用時除以 unitScale 換成圖面單位
const MAX_JAMB_LENGTH = 0.3; // 牆端面最長多少；比這長的邊是牆面不是端面
const DEDUPE_DISTANCE = 0.05; // 兩側牆端射到對方會產生同一個開口，中心距離在此以內視為同一個
const PROBE_OFFSET = 0.005;
const WINDOW_MARGIN = 0.05;
const DOOR_MARGIN = 0.3; // 門圖塊插入點在門框上，可能稍微落在開口外
const LABEL_RADIUS = 1.5;
// 編號只接受 W5、DW4、FD2 這類代號；其他圖面文字一律不輸出，避免地址等資訊外流
const LABEL_PATTERN = /^[A-Z]{1,3}\d{1,3}$/;

function insideBox([x, y], poly, margin) {
  const xs = poly.map((p) => p[0]);
  const ys = poly.map((p) => p[1]);
  return Math.min(...xs) - margin <= x && x <= Math.max(...xs) + margin && Math.min(...ys) - margin <= y && y <= Math.max(...ys) + margin;
}

// 從每道牆的短邊（牆端面）往外射線，碰到另一道牆就是一個開口
export function findGaps(walls, gapMin, gapMax, unitScale) {
  const maxJamb = MAX_JAMB_LENGTH / unitScale;
  const probeOffset = PROBE_OFFSET / unitScale;
  const dedupe = DEDUPE_DISTANCE / unitScale;
  const polygons = walls.map((w) => w.polygon);
  const gaps = [];
  for (const poly of polygons) {
    const ccw = polygonArea(poly) > 0;
    poly.forEach((a, i) => {
      const b = poly[(i + 1) % poly.length];
      const length = dist(a, b);
      if (length === 0 || length > maxJamb) return;
      const ex = (b[0] - a[0]) / length;
      const ey = (b[1] - a[1]) / length;
      const normal = ccw ? [ey, -ex] : [-ey, ex];
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      // 端面外側緊貼著另一道牆＝牆是連續的，不是開口
      const probe = [mid[0] + normal[0] * probeOffset, mid[1] + normal[1] * probeOffset];
      if (polygons.some((other) => pointInPolygon(probe, other))) return;
      const d = rayHit(mid, normal, polygons, gapMax);
      if (d === null || d < gapMin) return;
      const farA = [a[0] + normal[0] * d, a[1] + normal[1] * d];
      const farB = [b[0] + normal[0] * d, b[1] + normal[1] * d];
      const rect = [a, b, farB, farA];
      if (gaps.every((g) => dist(centroid(rect), centroid(g)) > dedupe)) gaps.push(rect);
    });
  }
  return gaps;
}

function midpoint(entity) {
  const xs = [...entity.all(10), ...entity.all(11)];
  const ys = [...entity.all(20), ...entity.all(21)];
  const n = Math.min(xs.length, ys.length);
  if (!n) return null;
  return centroid(xs.slice(0, n).map((x, i) => [toNumber(x), toNumber(ys[i])]));
}

function labelOf(entity) {
  if (entity.type === 'ATTDEF') return entity.first(2);
  if (entity.type === 'ATTRIB' && entity.first(2) === 'NO.') return entity.first(1);
  if (entity.type === 'TEXT') return entity.first(1);
  return null;
}

// 回傳 [[座標, 編號]]；只收符合代號格式的文字
export function labels(doc, layers, clip) {
  const result = [];
  for (const entity of doc.entities) {
    if (!layers.includes(entity.layer)) continue;
    const label = labelOf(entity);
    const at = [entity.num(10), entity.num(20)];
    if (label && LABEL_PATTERN.test(label) && inClip(clip, at)) result.push([at, label]);
  }
  return result;
}

// 距離相同時取代號字典序較小的，與 Python 的 tuple 比較一致
function nearestLabel(center, candidates, radius) {
  let best = null;
  for (const [at, label] of candidates) {
    const d = dist(center, at);
    if (d > radius) continue;
    if (best === null || d < best[0] || (d === best[0] && label < best[1])) best = [d, label];
  }
  return best ? best[1] : '';
}

// 回傳 [{ id, kind, label, polygon, sill, head }]；kind 為 door | window | doorway，高度單位公尺
export function findOpenings(doc, walls, config) {
  const { layers, clip, unitScale } = config;
  const [windowMargin, doorMargin, labelRadius] = [WINDOW_MARGIN, DOOR_MARGIN, LABEL_RADIUS].map((m) => m / unitScale);
  const inClipEntities = [];
  for (const e of doc.entities) {
    const m = midpoint(e);
    if (m && inClip(clip, m)) inClipEntities.push([e, m]);
  }
  const windowMarks = inClipEntities
    .filter(([e]) => layers.window.includes(e.layer) && (e.type === 'LINE' || e.type === 'LWPOLYLINE'))
    .map(([, m]) => m);
  const doorMarks = inClipEntities
    .filter(([e]) => layers.door.includes(e.layer) && e.type === 'INSERT')
    .map(([e]) => [e.num(10), e.num(20)]);
  const windowLabels = labels(doc, layers.window, clip);
  const doorLabels = labels(doc, layers.door, clip);

  const gaps = findGaps(walls, config.gapMin, config.gapMax, unitScale).sort((g, h) => comparePoints(centroid(g), centroid(h)));
  // 一扇門只屬於離它最近的開口，避免旁邊的門洞也被認成門
  const doorGaps = new Set();
  for (const mark of doorMarks) {
    let best = null;
    gaps.forEach((g, i) => {
      if (!insideBox(mark, g, doorMargin)) return;
      const d = dist(mark, centroid(g));
      if (best === null || d < best[0]) best = [d, i];
    });
    if (best) doorGaps.add(best[1]);
  }

  const counters = new Map();
  const openings = [];
  gaps.forEach((gap, index) => {
    const center = centroid(gap);
    let kind;
    let label;
    let sill;
    let head;
    if (windowMarks.some((m) => insideBox(m, gap, windowMargin))) {
      kind = 'window';
      label = nearestLabel(center, windowLabels, labelRadius);
      if (!label) throw new ConfigError([`位於 (${center.join(', ')}) 的窗沒有編號，無法決定窗台與窗頂高度`]);
      const spec = config.windowTypes[label];
      if (!spec) throw new ConfigError([`windowTypes 缺少 ${label} 的 sill／head 設定`]);
      ({ sill, head } = spec);
    } else if (doorGaps.has(index)) {
      kind = 'door';
      label = nearestLabel(center, doorLabels, labelRadius);
      [sill, head] = [0, config.doorHead];
    } else {
      kind = 'doorway';
      label = '';
      [sill, head] = [0, config.doorwayHead];
    }
    const prefix = label || kind;
    counters.set(prefix, (counters.get(prefix) ?? 0) + 1);
    const id = `${prefix}-${counters.get(prefix)}`;
    if (config.ignoreOpenings.includes(id)) return;
    openings.push({ id, kind, label, polygon: gap, sill, head });
  });
  return openings;
}
