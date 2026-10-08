// 天花板設備（灑水頭、探測器、風管、排風口、推估的灑水支管）：屬於哪一區、要不要顯示、顯示高度
// 單位公尺，不依賴 Three.js
import { COVE_MARGIN, COVE_RECESS, ceilingStateOf, ceilingZones } from './ceilings.js';

export const SPRINKLER_HEAD_HEIGHT = 2.3; // 圖面標註的灑水頭離地高度；不包時從樓板垂下來
export const BRANCH_BELOW_SLAB = 0.05; // 灑水支管中心離樓板底的距離

const EPS = 1e-9;
const mm = (v) => Math.round(v * 1000) / 1000;
const inRect = ([x, y], [x0, y0, x1, y1]) => x >= x0 - EPS && x <= x1 + EPS && y >= y0 - EPS && y <= y1 + EPS;
const samePoint = (a, b) => Math.abs(a[0] - b[0]) < EPS && Math.abs(a[1] - b[1]) < EPS;

function zoneAt(point, zones) {
  return zones.find((z) => z.rects.some((r) => inRect(point, r))) ?? null;
}

// 線段依各區矩形的邊切開；相鄰同區的合併，不在任何區（牆裡、門洞）的那段 zoneId 為 null
export function splitByZones(from, to, zones) {
  const ts = new Set([0, 1]);
  for (const zone of zones) {
    for (const [x0, y0, x1, y1] of zone.rects) {
      for (const [axis, value] of [[0, x0], [0, x1], [1, y0], [1, y1]]) {
        const d = to[axis] - from[axis];
        if (Math.abs(d) < EPS) continue;
        const t = (value - from[axis]) / d;
        if (t > EPS && t < 1 - EPS) ts.add(t);
      }
    }
  }
  const at = (t) => [mm(from[0] + (to[0] - from[0]) * t), mm(from[1] + (to[1] - from[1]) * t)];
  const sorted = [...ts].sort((a, b) => a - b);
  const pieces = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const zoneId = zoneAt(at((sorted[i] + sorted[i + 1]) / 2), zones)?.id ?? null;
    const last = pieces.at(-1);
    if (last && last.zoneId === zoneId) {
      last.to = at(sorted[i + 1]);
      continue;
    }
    pieces.push({ from: at(sorted[i]), to: at(sorted[i + 1]), zoneId });
  }
  return pieces.filter((p) => !samePoint(p.from, p.to));
}

// 只有不包區的那幾段顯示；牆裡、門洞那段跟著前後的區：兩側（端點只有一側）都顯示才顯示
function withVisibility(pieces, exposedIds) {
  const shown = pieces.map((p) => (p.zoneId === null ? null : exposedIds.has(p.zoneId)));
  return pieces.map((p, i) => {
    if (shown[i] !== null) return { ...p, visible: shown[i] };
    const before = shown.slice(0, i).reverse().find((v) => v !== null);
    const after = shown.slice(i + 1).find((v) => v !== null);
    const sides = [before, after].filter((v) => v !== undefined);
    return { ...p, visible: sides.length > 0 && sides.every(Boolean) };
  });
}

function pathPieces(path, zones, exposedIds) {
  const pieces = [];
  for (let i = 0; i < path.length - 1; i++) pieces.push(...splitByZones(path[i], path[i + 1], zones));
  return withVisibility(pieces, exposedIds);
}

// 點所在位置的天花板面高度；造型天花板中間內凹、四周是下降帶
function surfaceAt(point, zone, state, slabHeight) {
  if (state.type === 'exposed' || state.type === 'beam-wrap') return slabHeight;
  const lowered = Math.min(state.height, slabHeight);
  if (state.type !== 'cove') return lowered;
  const [x0, y0, x1, y1] = zone.rects.find((r) => inRect(point, r));
  const inner = [x0 + COVE_MARGIN, y0 + COVE_MARGIN, x1 - COVE_MARGIN, y1 - COVE_MARGIN];
  const recessed = inner[2] > inner[0] && inner[3] > inner[1] && inRect(point, inner);
  return recessed ? mm(Math.min(slabHeight, lowered + COVE_RECESS)) : lowered;
}

const manhattan = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);

// 直角走線：兩個轉角候選中，挑兩段都落在同一區裡的那個
function elbowPath(a, b, zone, zones) {
  const candidates = [[b[0], a[1]], [a[0], b[1]]];
  const inside = (p, q) => splitByZones(p, q, zones).every((piece) => piece.zoneId === zone.id);
  const elbow = candidates.find((c) => inside(a, c) && inside(c, b)) ?? candidates[0];
  return [a, elbow, b];
}

// 最小生成樹（Prim，直角距離）：回傳要相連的點對
function spanningPairs(points) {
  const inTree = [0];
  const pairs = [];
  while (inTree.length < points.length) {
    let best = null;
    for (const i of inTree) {
      points.forEach((p, j) => {
        if (inTree.includes(j)) return;
        const d = manhattan(points[i], p);
        if (!best || d < best.d - EPS) best = { i, j, d };
      });
    }
    inTree.push(best.j);
    pairs.push([points[best.i], points[best.j]]);
  }
  return pairs;
}

function closestOnSegment(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 < EPS ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return [a[0] + dx * t, a[1] + dy * t];
}

// 這群灑水頭裡離牆最近的一顆，與牆面上最近的點（代表主管從那道牆過來）
function wallFeed(points, walls) {
  let best = null;
  for (const p of points) {
    for (const wall of walls) {
      wall.polygon.forEach((a, k) => {
        const q = closestOnSegment(p, a, wall.polygon[(k + 1) % wall.polygon.length]);
        const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (!best || d < best.d - EPS) best = { from: p, to: [mm(q[0]), mm(q[1])], d };
      });
    }
  }
  return best;
}

// 灑水支管是推估的：同一區不包的灑水頭以直角最小生成樹串起，再接到最近的牆
function sprinklerBranches(sprinklers, zones, floorplan, exposedIds, slabHeight) {
  const branches = [];
  for (const zone of zones) {
    if (!exposedIds.has(zone.id)) continue;
    const points = sprinklers.filter((s) => s.zoneId === zone.id).map((s) => [s.x, s.y]);
    if (points.length === 0) continue;
    const pieces = [];
    for (const [a, b] of spanningPairs(points)) {
      const path = elbowPath(a, b, zone, zones);
      for (let i = 0; i < path.length - 1; i++) pieces.push(...splitByZones(path[i], path[i + 1], zones));
    }
    const feed = wallFeed(points, floorplan.walls ?? []);
    if (feed) {
      const path = elbowPath(feed.from, feed.to, zone, zones);
      for (let i = 0; i < path.length - 1; i++) pieces.push(...splitByZones(path[i], path[i + 1], zones));
    }
    branches.push({ zoneId: zone.id, estimated: true, height: mm(slabHeight - BRANCH_BELOW_SLAB), segments: withVisibility(pieces, exposedIds) });
  }
  return branches;
}

// 給定平面圖與天花板設定，算出每個設備屬於哪一區、要不要顯示、顯示高度
// 灑水頭：top 是管子上端（樓板或板面），height 是灑水頭；兩者相同代表貼在板面上
export function ceilingServiceLayout(floorplan, ceilings, slabHeight) {
  const services = floorplan.ceilingServices;
  if (!services) return { sprinklers: [], detectors: [], vents: [], ducts: [], branches: [] };
  const zones = ceilingZones(floorplan);
  const stateOf = (zone) => (zone ? ceilingStateOf(ceilings, zone.id, floorplan) : { type: 'exposed' });
  const exposedIds = new Set(zones.filter((z) => stateOf(z).type === 'exposed').map((z) => z.id));
  // 不在任何區的設備當作原始樓板
  const place = (x, y) => {
    const zone = zoneAt([x, y], zones);
    const state = stateOf(zone);
    const surface = zone ? surfaceAt([x, y], zone, state, slabHeight) : slabHeight;
    return { zoneId: zone?.id ?? null, exposed: state.type === 'exposed', surface };
  };

  const sprinklers = services.sprinklers.map(({ x, y }) => {
    const { zoneId, exposed, surface } = place(x, y);
    return { x, y, zoneId, top: surface, height: exposed ? Math.min(SPRINKLER_HEAD_HEIGHT, slabHeight) : surface };
  });
  const detectors = services.detectors.map(({ type, x, y }) => {
    const { zoneId, surface } = place(x, y);
    return { type, x, y, zoneId, height: surface };
  });
  const vents = services.vents.map(({ x, y }) => {
    const { zoneId, surface } = place(x, y);
    return { x, y, zoneId, height: surface };
  });
  const ducts = services.ducts.map((d) => ({
    type: d.type,
    size: { ...d.size },
    height: mm(slabHeight - d.size.h / 2),
    segments: pathPieces(d.path, zones, exposedIds),
  }));
  const branches = sprinklerBranches(sprinklers, zones, floorplan, exposedIds, slabHeight);
  return { sprinklers, detectors, vents, ducts, branches };
}
