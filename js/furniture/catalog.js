// 家具目錄：類型、預設尺寸（公分）、預設顏色；不依賴 Three.js

export const SIZE_LIMITS = { min: 1, max: 600 };

// allowOverlap：地毯本來就壓在其他家具底下，不算重疊
export const CATALOG = [
  { type: 'sofa', name: '沙發', size: { w: 210, d: 90, h: 85 }, color: '#8c9aa6', allowOverlap: false },
  { type: 'armchair', name: '單椅', size: { w: 80, d: 80, h: 85 }, color: '#c08a5b', allowOverlap: false },
  { type: 'coffee-table', name: '茶几', size: { w: 110, d: 55, h: 42 }, color: '#a47a52', allowOverlap: false },
  { type: 'dining-table', name: '餐桌', size: { w: 150, d: 85, h: 75 }, color: '#b48a60', allowOverlap: false },
  { type: 'dining-chair', name: '餐椅', size: { w: 45, d: 50, h: 88 }, color: '#7d6047', allowOverlap: false },
  { type: 'double-bed', name: '雙人床', size: { w: 160, d: 205, h: 100 }, color: '#e8e2d6', allowOverlap: false },
  { type: 'single-bed', name: '單人床', size: { w: 105, d: 200, h: 95 }, color: '#dfe6ea', allowOverlap: false },
  { type: 'wardrobe', name: '衣櫃', size: { w: 120, d: 60, h: 210 }, color: '#d8cbb6', allowOverlap: false },
  { type: 'desk', name: '書桌', size: { w: 120, d: 60, h: 75 }, color: '#c7a37a', allowOverlap: false },
  { type: 'tv-stand', name: '電視櫃', size: { w: 180, d: 40, h: 50 }, color: '#6f5a48', allowOverlap: false },
  { type: 'fridge', name: '冰箱', size: { w: 70, d: 70, h: 180 }, color: '#e6e8ea', allowOverlap: false },
  { type: 'rug', name: '地毯', size: { w: 200, d: 140, h: 1 }, color: '#b9a28c', allowOverlap: true },
  { type: 'plant', name: '植栽', size: { w: 45, d: 45, h: 120 }, color: '#5f8a54', allowOverlap: false },
];

const BY_TYPE = new Map(CATALOG.map((item) => [item.type, item]));

export function getCatalogItem(type) {
  return BY_TYPE.get(type);
}

export function createFurniture(type, { id, x, y }) {
  const item = getCatalogItem(type);
  if (!item) throw new Error(`未知的家具類型：${type}`);
  return { id, type, x, y, rotation: 0, size: { ...item.size }, color: item.color };
}

// 尺寸輸入的防呆：非數字回 null，超出範圍夾到上下限，取整到公分
export function normalizeSizeValue(value) {
  if (value === '' || value == null) return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.min(SIZE_LIMITS.max, Math.max(SIZE_LIMITS.min, Math.round(num)));
}
