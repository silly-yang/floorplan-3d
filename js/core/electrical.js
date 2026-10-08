// 水電：插座貼牆、建商預設插座、用電檢查；單位公尺，不依賴 Three.js
import { getCatalogItem } from '../furniture/catalog.js';
import { pointInPolygon, pointSegmentDistance } from './geometry2d.js';
import { elevationOf, footprint, normalizeRotation } from './layout.js';

export const OUTLET_DEPTH = 0.04; // 面板深，中心離牆面半個深度
export const SNAP_DISTANCE = 0.6; // 落點離牆超過這個距離就不貼
export const REACH = 1.5; // 家電電線一般夠得到的距離
export const DEDICATED_WATTS = 1200; // 這個瓦數以上建議專用迴路
export const BLOCK_TOLERANCE = 0.05; // 插座正前方這個距離內有家具就算擋住
const PANEL_HALF = 0.06; // 面板半寬：貼牆時不超出牆的端點
const OUTLET_TOLERANCE = 0.3; // 建商插座原位附近這個距離內有同類型就算已放好
const EPS = 1e-9;

// 屬性面板的常用高度（公分）
export const HEIGHT_PRESETS = [
  { name: '一般', cm: 30 },
  { name: '床頭', cm: 60 },
  { name: '檯面', cm: 110 },
  { name: '開關', cm: 120 },
  { name: '冷氣', cm: 230 },
];

const round = (v) => Math.round(v * 1e6) / 1e6;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export function isElectrical(type) {
  return getCatalogItem(type)?.category === 'electrical';
}

export function outletSpec(item) {
  const options = { ...getCatalogItem(item.type)?.options, ...item.options };
  return { voltage: options.voltage ?? null, dedicated: Boolean(options.dedicated) };
}

const signedArea = (poly) =>
  poly.reduce((s, p, i) => {
    const q = poly[(i + 1) % poly.length];
    return s + p[0] * q[1] - q[0] * p[1];
  }, 0) / 2;

// 每道牆的每一條邊與它的外法線（不管頂點是順時針還是逆時針）
function wallEdges(walls) {
  const edges = [];
  for (const wall of walls ?? []) {
    const poly = wall.polygon;
    const sign = signedArea(poly) > 0 ? 1 : -1;
    poly.forEach((a, i) => {
      const b = poly[(i + 1) % poly.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < PANEL_HALF * 2) return;
      const dir = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
      edges.push({ a, dir, len, normal: [dir[1] * sign, -dir[0] * sign] });
    });
  }
  return edges;
}

// 找最近的牆面，回傳 { x, y, rotation }：貼在牆面外、正面朝外法線（房間內）；太遠回 null
// rotation 與家具相同（逆時針度數）；正面方向為 (sin θ, −cos θ)
export function snapToWall([x, y], walls, { depth = OUTLET_DEPTH, maxDistance = SNAP_DISTANCE } = {}) {
  const polygons = (walls ?? []).map((w) => w.polygon);
  const candidates = wallEdges(walls).map(({ a, dir, len, normal }) => {
    const t = Math.min(len - PANEL_HALF, Math.max(PANEL_HALF, (x - a[0]) * dir[0] + (y - a[1]) * dir[1]));
    const foot = [a[0] + dir[0] * t, a[1] + dir[1] * t];
    const spot = [foot[0] + (normal[0] * depth) / 2, foot[1] + (normal[1] * depth) / 2];
    const distance = Math.hypot(x - foot[0], y - foot[1]);
    // 同距離時（轉角）優先選落點所在那一側的牆面
    const side = (x - foot[0]) * normal[0] + (y - foot[1]) * normal[1];
    return { spot, normal, distance, side };
  });
  // 兩道牆相接的那一面，往外推會卡進另一道牆
  const valid = candidates.filter((c) => !polygons.some((p) => pointInPolygon(c.spot, p)));
  valid.sort((p, q) => (Math.abs(p.distance - q.distance) > EPS ? p.distance - q.distance : q.side - p.side));
  const best = valid[0];
  if (!best || best.distance > maxDistance + EPS) return null;
  const rotation = normalizeRotation(round((Math.atan2(best.normal[0], -best.normal[1]) * 180) / Math.PI));
  return { x: round(best.spot[0]), y: round(best.spot[1]), rotation };
}

// 可以裝插座的面：牆，加上有窗台的窗（窗台下方是實牆）；門、門洞、落地窗不行
export function mountSurfaces(floorplan) {
  const sills = (floorplan.openings ?? []).filter((o) => o.kind === 'window' && o.sill > 0);
  return [...(floorplan.walls ?? []), ...sills];
}

const electricalItem = (spec, { id, x, y, rotation }, elevation) => ({
  id,
  type: spec.type,
  x,
  y,
  rotation,
  size: { ...spec.size },
  color: spec.color,
  elevation,
  options: { ...spec.options },
});

// 新增插座：一律貼牆；附近沒有牆回 null
export function createElectrical(type, { id, x, y }, walls, { maxDistance = SNAP_DISTANCE } = {}) {
  const spec = getCatalogItem(type);
  if (spec?.category !== 'electrical') return null;
  const spot = snapToWall([x, y], walls, { maxDistance });
  if (!spot) return null;
  return electricalItem(spec, { id, ...spot }, spec.mountHeight / 100);
}

// 圖面符號常畫在離牆一段距離處（例如暖風機電源在天花板中央），一律貼到最近的牆；完全沒有牆才留在原位
const importSpot = (o, walls) => snapToWall([o.x, o.y], walls, { maxDistance: Infinity }) ?? { x: o.x, y: o.y, rotation: 0 };

// 建商圖面上的插座 → 新方案的預設家具
export function outletsToFurniture(outlets, walls, newId) {
  return (Array.isArray(outlets) ? outlets : [])
    .filter((o) => getCatalogItem(o?.type)?.category === 'electrical' && isNum(o.x) && isNum(o.y) && isNum(o.height))
    .map((o) => electricalItem(getCatalogItem(o.type), { id: newId(), ...importSpot(o, walls) }, o.height));
}

// 建商插座裡，貼牆後的原位附近沒有同類型的那些；一個插座只能抵一個原位
export function missingOutlets(furniture, outlets, walls) {
  const used = new Set();
  return (Array.isArray(outlets) ? outlets : []).filter((o) => {
    const spot = importSpot(o, walls);
    const gap = (f) => Math.hypot(f.x - spot.x, f.y - spot.y);
    const match = furniture
      .filter((f) => !used.has(f.id) && f.type === o.type && gap(f) <= OUTLET_TOLERANCE)
      .sort((p, q) => gap(p) - gap(q))[0];
    if (!match) return true;
    used.add(match.id);
    return false;
  });
}

// ---------- 用電檢查 ----------

function distanceToArea(point, area) {
  if (pointInPolygon(point, area)) return 0;
  return area.reduce((best, a, i) => Math.min(best, pointSegmentDistance(point, a, area[(i + 1) % area.length])), Infinity);
}

// 電線要走的距離：平面距離，加上插座比家電底部更低或比頂部更高的那段
function reachTo(appliance, bottom, outlet, outletElevation) {
  const top = bottom + appliance.size.h / 100;
  const vertical = Math.max(0, bottom - outletElevation, outletElevation - top);
  return distanceToArea([outlet.x, outlet.y], footprint(appliance)) + vertical;
}

const nameOf = (item) => getCatalogItem(item.type)?.name ?? item.type;

// 220V 或大功率家電跟別的電器共用迴路容易跳電
export function needsDedicatedCircuit(power) {
  return power.voltage === 220 || power.watts >= DEDICATED_WATTS;
}

function applianceIssues(item, outlets, furniture) {
  const power = getCatalogItem(item.type).power;
  const bottom = elevationOf(item, furniture);
  const matching = outlets
    .filter((o) => outletSpec(o).voltage === power.voltage)
    .map((o) => ({ outlet: o, reach: reachTo(item, bottom, o, elevationOf(o, furniture)) }));
  const nearby = matching.filter((m) => m.reach <= REACH + EPS);
  const needsDedicated = needsDedicatedCircuit(power);
  // 訊息不重複家電名稱：清單與屬性面板都已標示是哪一件
  const label = `${power.voltage}V ${power.watts}W`;
  if (nearby.length === 0) {
    const closest = Math.min(...matching.map((m) => m.reach));
    // 無條件進位：1.53 m 寫成 1.5 m 會看起來像沒超過
    const where = Number.isFinite(closest) ? `（最近的在 ${(Math.ceil(closest * 10 - EPS) / 10).toFixed(1)} m，建議 ${REACH} m 內）` : '';
    const hint = needsDedicated ? `；${label} 建議拉專用迴路` : '';
    return [{ furnitureId: item.id, kind: 'no-outlet', message: `附近沒有 ${power.voltage}V 插座${where}${hint}` }];
  }
  if (needsDedicated && !nearby.some((m) => outletSpec(m.outlet).dedicated)) {
    return [{ furnitureId: item.id, kind: 'needs-dedicated', message: `${label}，附近的插座都不是專用迴路，建議拉專用迴路` }];
  }
  return [];
}

// 會擋住插座的：落地、不允許重疊、本身不用電的家具（用電的家電本來就插在後面那個插座）
function blockers(furniture) {
  return furniture.filter((f) => {
    const spec = getCatalogItem(f.type);
    if (!spec || spec.allowOverlap || spec.power) return false;
    return elevationOf(f, furniture) === 0;
  });
}

// 「110V 插座」「專用迴路插座」在訊息裡都叫插座
const shortName = (item) => nameOf(item).replace(/^(110V |220V |專用迴路)/, '');

// 只看插座中心到正前方 BLOCK_TOLERANCE 這一小段；旁邊緊貼的家具（例如馬桶旁的免治插座）不算
function blockedIssues(outlet, candidates, furniture) {
  const elevation = elevationOf(outlet, furniture);
  const rad = (outlet.rotation * Math.PI) / 180;
  const ahead = [outlet.x + Math.sin(rad) * BLOCK_TOLERANCE, outlet.y - Math.cos(rad) * BLOCK_TOLERANCE];
  const blocker = candidates.find((f) => {
    if (elevation >= f.size.h / 100) return false;
    const area = footprint(f);
    return pointInPolygon([outlet.x, outlet.y], area) || pointInPolygon(ahead, area);
  });
  if (!blocker) return [];
  const name = nameOf(blocker);
  return [{
    furnitureId: outlet.id,
    kind: 'blocked',
    message: `${shortName(outlet)}被「${name}」擋住（離地 ${Math.round(elevation * 100)} cm，${name}高 ${blocker.size.h} cm）`,
  }];
}

// 回傳 [{ furnitureId, kind, message }]；系統櫃格子裡的家電不是場景家具，由櫃子自己的檢查負責
export function powerIssues(design) {
  const furniture = design.furniture ?? [];
  const electrical = furniture.filter((f) => isElectrical(f.type));
  const outlets = electrical.filter((o) => outletSpec(o).voltage);
  // 吸頂燈具接天花板的燈具迴路，不插插座
  const appliances = furniture.filter((f) => getCatalogItem(f.type)?.power && getCatalogItem(f.type).placement !== 'ceiling');
  const candidates = blockers(furniture);
  return [
    ...appliances.flatMap((item) => applianceIssues(item, outlets, furniture)),
    ...electrical.flatMap((o) => blockedIssues(o, candidates, furniture)),
  ];
}
