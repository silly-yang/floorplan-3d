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
  const support = supportOf(item, furniture);
  return support ? support.size.h / 100 : 0;
}
