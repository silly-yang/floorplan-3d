// 家具擺放規則：網格、旋轉、撞牆、重疊、牆距、找空位；單位公尺（家具尺寸為公分）
import { getCatalogItem } from '../furniture/catalog.js';
import { pointInPolygon, polygonDistance, polygonsIntersect, rectCorners } from './geometry2d.js';

export const GRID_STEP = 0.05;
export const ROTATION_STEP = 15;

const clean = (v) => Math.round(v * 1e9) / 1e9;

export function snapToGrid(value, step = GRID_STEP) {
  if (!step) return value;
  return clean(Math.round(value / step) * step);
}

export function normalizeRotation(deg) {
  return clean(((deg % 360) + 360) % 360);
}

export function footprint(item) {
  return rectCorners(item.x, item.y, item.size.w / 100, item.size.d / 100, item.rotation);
}

// 只有高度範圍跟家具重疊的量體會擋到（楣樑在頭頂上、窗台在桌上家電的腳下）
const blockingSolids = (item, solids, elevation = 0) =>
  solids.filter((s) => s.bottom < elevation + item.size.h / 100 && s.top > elevation);

// solids 為 buildSolids 的輸出；elevation 是家具離地高度（公尺）
export function hitsWalls(item, solids, elevation = 0) {
  const area = footprint(item);
  return blockingSolids(item, solids, elevation).some((s) => polygonsIntersect(area, s.polygon));
}

export function findConflicts(furniture) {
  const solid = furniture.filter((f) => !getCatalogItem(f.type)?.allowOverlap);
  const areas = solid.map(footprint);
  const ranges = solid.map((f) => {
    const bottom = elevationOf(f, furniture);
    return [bottom, bottom + f.size.h / 100];
  });
  // 上下疊放（咖啡機在桌上）只碰到一個面，不算重疊
  const verticalOverlap = (a, b) => a[0] < b[1] - 1e-9 && b[0] < a[1] - 1e-9;
  const conflicts = new Set();
  for (let i = 0; i < solid.length; i++) {
    for (let j = i + 1; j < solid.length; j++) {
      if (verticalOverlap(ranges[i], ranges[j]) && polygonsIntersect(areas[i], areas[j])) {
        conflicts.add(solid[i].id);
        conflicts.add(solid[j].id);
      }
    }
  }
  return conflicts;
}

export function nearestWallDistance(item, solids) {
  const area = footprint(item);
  return blockingSolids(item, solids).reduce((best, s) => Math.min(best, polygonDistance(area, s.polygon)), Infinity);
}

// 離牆面 threshold（公尺）內時平移到剛好貼齊；兩個方向各自吸附
export function snapToWalls(item, solids, threshold = 0.1) {
  const corners = footprint(item);
  const cx = item.x;
  const cy = item.y;
  const best = [null, null]; // 依家具的兩個軸各留最近的一面牆：{ gap, n }
  corners.forEach((p, i) => {
    const q = corners[(i + 1) % 4];
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const dir = [(q[0] - p[0]) / len, (q[1] - p[1]) / len];
    // 朝外的法向量：背離家具中心
    let n = [-dir[1], dir[0]];
    if ((p[0] - cx) * n[0] + (p[1] - cy) * n[1] < 0) n = [-n[0], -n[1]];
    const along = (pt) => pt[0] * dir[0] + pt[1] * dir[1];
    for (const s of blockingSolids(item, solids)) {
      s.polygon.forEach((a, j) => {
        const b = s.polygon[(j + 1) % s.polygon.length];
        const wl = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (wl < 1e-9 || Math.abs(((b[0] - a[0]) * dir[1] - (b[1] - a[1]) * dir[0]) / wl) > 1e-6) return;
        const gap = (a[0] - p[0]) * n[0] + (a[1] - p[1]) * n[1];
        if (gap < -1e-9 || gap > threshold + 1e-9) return;
        // 兩條邊在沿邊方向要有重疊；取最近的牆邊，一定是面向家具的那一面
        const lo = Math.max(Math.min(along(p), along(q)), Math.min(along(a), along(b)));
        const hi = Math.min(Math.max(along(p), along(q)), Math.max(along(a), along(b)));
        if (hi - lo < 1e-6) return;
        const axis = i % 2;
        if (!best[axis] || gap < best[axis].gap) best[axis] = { gap, n };
      });
    }
  });
  const shift = best.reduce(([dx, dy], b) => (b ? [dx + b.n[0] * b.gap, dy + b.n[1] * b.gap] : [dx, dy]), [0, 0]);
  const spot = { x: clean(item.x + shift[0]), y: clean(item.y + shift[1]) };
  return hitsWalls({ ...item, ...spot }, solids) ? { x: item.x, y: item.y } : spot;
}

// 從 (x, y) 往外螺旋找第一個不撞牆的位置；找不到回 null
export function findFreeSpot(item, solids, { radius = 2, step = 0.1 } = {}) {
  if (!hitsWalls(item, solids)) return { x: item.x, y: item.y };
  for (let r = step; r <= radius + 1e-9; r += step) {
    const samples = Math.max(8, Math.round((2 * Math.PI * r) / step));
    for (let k = 0; k < samples; k++) {
      const angle = (2 * Math.PI * k) / samples;
      const spot = { x: snapToGrid(item.x + r * Math.cos(angle)), y: snapToGrid(item.y + r * Math.sin(angle)) };
      if (!hitsWalls({ ...item, ...spot }, solids)) return spot;
    }
  }
  return null;
}

// 漫遊時會擋路的家具（隔間）：回傳 [{ polygon, bottom }]
export function walkBlockers(furniture) {
  return furniture.filter((f) => getCatalogItem(f.type)?.blocksWalk).map((f) => ({ polygon: footprint(f), bottom: 0 }));
}

export function addFurniture(design, item) {
  return { ...design, furniture: [...design.furniture, item] };
}

export function updateFurniture(design, id, patch) {
  return { ...design, furniture: design.furniture.map((f) => (f.id === id ? { ...f, ...patch } : f)) };
}

export function removeFurniture(design, id) {
  return { ...design, furniture: design.furniture.filter((f) => f.id !== id) };
}

// 從目前位置往 target 一小步一小步前進，碰到牆就停在最後一個合法位置；避免快速拖曳一次跳過薄牆
export function moveToward(item, target, solids, step = GRID_STEP) {
  const dist = Math.hypot(target.x - item.x, target.y - item.y);
  const steps = Math.max(1, Math.ceil(dist / step));
  let last = { x: item.x, y: item.y };
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const next = i === steps ? { x: target.x, y: target.y } : { x: item.x + (target.x - item.x) * t, y: item.y + (target.y - item.y) * t };
    if (hitsWalls({ ...item, ...next }, solids)) return last;
    last = next;
  }
  return last;
}

// 桌上型家電底下的檯面家具；沒有就回 null
export function supportOf(item, furniture) {
  if (getCatalogItem(item.type)?.placement !== 'surface') return null;
  const center = [item.x, item.y];
  const supports = furniture.filter(
    (f) => f.id !== item.id && getCatalogItem(f.type)?.surface && pointInPolygon(center, footprint(f)),
  );
  if (supports.length === 0) return null;
  return supports.reduce((best, f) => (f.size.h > best.size.h ? f : best));
}

// 家具離地高度（公尺）：放在檯面上就是檯面高度，否則為 0；檯面家具本身一定落地，不會再往下遞迴
export function elevationOf(item, furniture) {
  // 插座、燈具這類掛牆／吸頂的東西，放置時就算好高度存在 item.elevation
  if (typeof item.elevation === 'number') return item.elevation;
  const mount = getCatalogItem(item.type)?.mountHeight;
  if (mount) return mount / 100;
  const support = supportOf(item, furniture);
  return support ? support.size.h / 100 : 0;
}
