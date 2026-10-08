// 家具擺放規則：網格、旋轉、撞牆、重疊、牆距、找空位；單位公尺（家具尺寸為公分）
import { getCatalogItem } from '../furniture/catalog.js';
import { polygonDistance, polygonsIntersect, rectCorners } from './geometry2d.js';

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

// 只有底部低於家具高度的量體會擋到（楣樑在頭頂上）
const blockingSolids = (item, solids) => solids.filter((s) => s.bottom < item.size.h / 100);

// solids 為 buildSolids 的輸出
export function hitsWalls(item, solids) {
  const area = footprint(item);
  return blockingSolids(item, solids).some((s) => polygonsIntersect(area, s.polygon));
}

export function findConflicts(furniture) {
  const solid = furniture.filter((f) => !getCatalogItem(f.type)?.allowOverlap);
  const areas = solid.map(footprint);
  const conflicts = new Set();
  for (let i = 0; i < solid.length; i++) {
    for (let j = i + 1; j < solid.length; j++) {
      if (polygonsIntersect(areas[i], areas[j])) {
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
