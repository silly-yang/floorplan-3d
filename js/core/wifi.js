// WiFi 訊號估算（純邏輯）：多牆模型，2.4 GHz
// RSSI = 發射功率 − 自由空間路徑損失（1 公尺 40 dB，距離每 10 倍多 20 dB）− 穿過的牆損失總和
// 只算平面、不算樓層高度差與反射，用來比較擺放位置的相對好壞，不是實測值
import { getCatalogItem } from '../furniture/catalog.js';
import { segmentPolygonCrossings } from './geometry2d.js';

export const WALL_LOSS = { rc: 12, partition: 4, column: 15, window: 3 };
const WALL_KINDS = new Set(['rc', 'partition', 'column']);
const MIN_DISTANCE = 0.5; // 公尺；太靠近設備時 log 會趨近無限大

export const GRADES = [
  { id: 'excellent', label: '優', min: -60 },
  { id: 'good', label: '良', min: -70 },
  { id: 'fair', label: '普通', min: -80 },
  { id: 'poor', label: '差', min: -Infinity },
];

const SUGGEST_WALLS = 2;
const SUGGEST_MIN_RSSI = -75;

export function wallLoss(kind) {
  return WALL_LOSS[kind] ?? 0;
}

export function pathLoss(distance) {
  return 40 + 20 * Math.log10(Math.max(MIN_DISTANCE, distance));
}

// 只數牆與柱（窗戶不算「一道牆」）
export function wallsBetween(a, b, walls) {
  return walls.filter((w) => WALL_KINDS.has(w.kind)).reduce((n, w) => n + segmentPolygonCrossings(a, b, w.polygon), 0);
}

export function signalAt([x, y], device, walls) {
  const from = [device.x, device.y];
  const loss = walls.reduce((sum, w) => sum + wallLoss(w.kind) * segmentPolygonCrossings(from, [x, y], w.polygon), 0);
  return device.txPower - pathLoss(Math.hypot(x - device.x, y - device.y)) - loss;
}

const strongest = (point, devices, walls) => Math.max(...devices.map((d) => signalAt(point, d, walls)));

const clean = (v) => Math.round(v * 1e9) / 1e9;

// 每個房間的矩形以格子中心取樣，避免取到牆邊上
function samplePoints(room, step) {
  const points = [];
  for (const [x0, y0, x1, y1] of room.rects) {
    for (let y = y0 + step / 2; y < y1; y += step) {
      for (let x = x0 + step / 2; x < x1; x += step) points.push([clean(x), clean(y)]);
    }
  }
  return points;
}

export function coverageGrid(rooms, devices, walls, step = 0.25) {
  if (devices.length === 0) return [];
  return rooms.flatMap((room) =>
    samplePoints(room, step).map(([x, y]) => ({ x, y, rssi: strongest([x, y], devices, walls), roomId: room.id })),
  );
}

export function gradeOf(rssi) {
  const { id, label } = GRADES.find((g) => rssi >= g.min);
  return { id, label };
}

// 房間中心取最大那塊矩形的中心，L 形房間也一定落在房內
function roomCenter(room) {
  const area = ([x0, y0, x1, y1]) => (x1 - x0) * (y1 - y0);
  const [x0, y0, x1, y1] = room.rects.reduce((best, r) => (area(r) > area(best) ? r : best));
  return [(x0 + x1) / 2, (y0 + y1) / 2];
}

function suggestionOf(walls, min) {
  const reasons = [];
  if (walls >= SUGGEST_WALLS) reasons.push(`離最近的設備隔了 ${walls} 道牆`);
  if (min < SUGGEST_MIN_RSSI) reasons.push(`最弱處只有 ${Math.round(min)} dBm`);
  return reasons.length ? `${reasons.join('、')}，建議在附近加一個 Mesh 節點` : null;
}

// 等級看平均；最低值與穿牆數決定要不要建議補 Mesh
export function roomRatings(rooms, devices, walls, { step = 0.25 } = {}) {
  if (devices.length === 0) return [];
  return rooms.map((room) => {
    const values = samplePoints(room, step).map((p) => strongest(p, devices, walls));
    const min = Math.min(...values);
    const avg = values.reduce((s, v) => s + v, 0) / values.length;
    const center = roomCenter(room);
    const nearest = devices.reduce((best, d) =>
      Math.hypot(d.x - center[0], d.y - center[1]) < Math.hypot(best.x - center[0], best.y - center[1]) ? d : best);
    const count = wallsBetween([nearest.x, nearest.y], center, walls);
    return { id: room.id, name: room.name, min, avg, grade: gradeOf(avg), walls: count, suggestion: suggestionOf(count, min) };
  });
}

// 有無線參數的家具才算訊號源；弱電箱只是線路起點
export function wirelessDevices(furniture) {
  return furniture.flatMap((f) => {
    const wireless = getCatalogItem(f.type)?.wireless;
    return wireless ? [{ id: f.id, x: f.x, y: f.y, txPower: wireless.txPower }] : [];
  });
}

// 擋訊號的東西：牆、柱、窗戶玻璃；門的開關狀態不固定，一律當作不擋
export function obstaclesOf(floorplan) {
  return [
    ...floorplan.walls.map((w) => ({ kind: w.kind, polygon: w.polygon })),
    ...floorplan.openings.filter((o) => o.kind === 'window').map((o) => ({ kind: 'window', polygon: o.polygon })),
  ];
}
