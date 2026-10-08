// 日光：太陽方向、陰影相機範圍；不依賴 Three.js
import { openingAxis } from './floorplan.js';

const PROBE_DISTANCE = 0.4; // 判斷窗戶哪一側是室外時，往外探多遠
const DEFAULT_HORIZONTAL = [-Math.SQRT1_2, -Math.SQRT1_2]; // 沒有對外窗時：西南
const DEG = Math.PI / 180;

const inRooms = ([x, y], rooms) => rooms.some((r) => r.rects.some(([x0, y0, x1, y1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1));

// 窗戶外側是開口 across 的正向（+1）或反向（-1）；兩側都是房間或都不是時回 0
export function exteriorSide(opening, rooms) {
  const { start, dir, across, width } = openingAxis(opening.polygon);
  const probe = (s) => [start[0] + dir[0] * (width / 2) + across[0] * s * PROBE_DISTANCE, start[1] + dir[1] * (width / 2) + across[1] * s * PROBE_DISTANCE];
  const ahead = inRooms(probe(1), rooms);
  const behind = inRooms(probe(-1), rooms);
  if (ahead === behind) return 0;
  return ahead ? -1 : 1;
}

const rotate = ([x, y], angle) => [x * Math.cos(angle) - y * Math.sin(angle), x * Math.sin(angle) + y * Math.cos(angle)];

// 指向太陽的單位向量 [x, y, 高度]（平面座標）
// 平面圖的上方不一定是真北，所以從對外窗的主要朝向推：太陽在窗外、往西偏 skew 度（下午），光才照得進窗
export function sunDirection(floorplan, { elevation = 35, skew = 30 } = {}) {
  let sum = [0, 0];
  for (const o of floorplan.openings) {
    if (o.kind !== 'window') continue;
    const side = exteriorSide(o, floorplan.rooms);
    if (!side) continue;
    const { across, width } = openingAxis(o.polygon);
    const weight = width * (o.head - o.sill);
    sum = [sum[0] + across[0] * side * weight, sum[1] + across[1] * side * weight];
  }
  const length = Math.hypot(sum[0], sum[1]);
  let horizontal = DEFAULT_HORIZONTAL;
  if (length > 1e-9) {
    const facing = [sum[0] / length, sum[1] / length];
    // 兩個偏轉方向取比較西的；一樣西（窗朝正西）取偏南
    const [a, b] = [rotate(facing, skew * DEG), rotate(facing, -skew * DEG)];
    const tie = Math.abs(a[0] - b[0]) < 1e-9;
    horizontal = tie ? (a[1] <= b[1] ? a : b) : a[0] < b[0] ? a : b;
  }
  const flat = Math.cos(elevation * DEG);
  return [horizontal[0] * flat, horizontal[1] * flat, Math.sin(elevation * DEG)];
}

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const normalize = (v) => {
  const l = Math.hypot(v.x, v.y, v.z);
  return { x: v.x / l, y: v.y / l, z: v.z / l };
};

// 平行光陰影相機剛好包住 box（世界座標）：範圍越貼，每個陰影像素越小、邊緣越不鋸齒
// toSun 為世界座標、指向太陽的單位向量，不可垂直朝上；座標軸與 Three.js 的 lookAt（up = +y）一致
export function shadowFrustum(box, toSun, margin = 0) {
  const center = { x: (box.min.x + box.max.x) / 2, y: (box.min.y + box.max.y) / 2, z: (box.min.z + box.max.z) / 2 };
  const distance = Math.hypot(box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z) / 2 + 1;
  const zAxis = normalize(toSun);
  const xAxis = normalize(cross({ x: 0, y: 1, z: 0 }, zAxis));
  const yAxis = cross(zAxis, xAxis);
  const range = { x: [Infinity, -Infinity], y: [Infinity, -Infinity], z: [Infinity, -Infinity] };
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) {
        const rel = sub({ x, y, z }, center);
        for (const [key, axis] of [['x', xAxis], ['y', yAxis], ['z', zAxis]]) {
          const v = dot(rel, axis);
          range[key] = [Math.min(range[key][0], v), Math.max(range[key][1], v)];
        }
      }
    }
  }
  return {
    center,
    distance,
    left: range.x[0] - margin,
    right: range.x[1] + margin,
    bottom: range.y[0] - margin,
    top: range.y[1] + margin,
    // 相機朝 -z 看：越靠近太陽的角，深度越小
    near: distance - range.z[1] - margin,
    far: distance - range.z[0] + margin,
  };
}
