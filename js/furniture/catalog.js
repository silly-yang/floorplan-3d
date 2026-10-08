// 家具目錄：類型、預設尺寸（公分）、預設顏色；不依賴 Three.js

export const SIZE_LIMITS = { min: 1, max: 600 };

export const CATEGORIES = [
  { id: 'furniture', name: '家具' },
  { id: 'appliance', name: '家電' },
  { id: 'fixture', name: '廚衛' },
];

// placement：floor 只能放地上；surface 可以放地上，也可以放到有檯面（surface: true）的家具上
// allowOverlap：地毯本來就壓在其他家具底下，不算重疊
const item = (category, type, name, [w, d, h], color, { placement = 'floor', surface = false, allowOverlap = false } = {}) => ({
  category, type, name, size: { w, d, h }, color, placement, surface, allowOverlap,
});

export const CATALOG = [
  item('furniture', 'sofa', '沙發', [210, 90, 85], '#8c9aa6'),
  item('furniture', 'armchair', '單椅', [80, 80, 85], '#c08a5b'),
  item('furniture', 'coffee-table', '茶几', [110, 55, 42], '#a47a52', { surface: true }),
  item('furniture', 'dining-table', '餐桌', [150, 85, 75], '#b48a60', { surface: true }),
  item('furniture', 'dining-chair', '餐椅', [45, 50, 88], '#7d6047'),
  item('furniture', 'double-bed', '雙人床', [160, 205, 100], '#e8e2d6'),
  item('furniture', 'single-bed', '單人床', [105, 200, 95], '#dfe6ea'),
  item('furniture', 'wardrobe', '衣櫃', [120, 60, 210], '#d8cbb6'),
  item('furniture', 'desk', '書桌', [120, 60, 75], '#c7a37a', { surface: true }),
  item('furniture', 'tv-stand', '電視櫃', [180, 40, 50], '#6f5a48', { surface: true }),
  item('furniture', 'kitchen-island', '中島櫃', [180, 90, 90], '#e9e4dc', { surface: true }),
  item('furniture', 'fridge', '冰箱', [70, 70, 180], '#e6e8ea'),
  item('furniture', 'rug', '地毯', [200, 140, 1], '#b9a28c', { allowOverlap: true }),
  item('furniture', 'plant', '植栽', [45, 45, 120], '#5f8a54'),
  item('appliance', 'coffee-machine', '咖啡機', [25, 40, 35], '#2f3237', { placement: 'surface' }),
  item('appliance', 'microwave', '微波爐', [50, 40, 30], '#d9dbde', { placement: 'surface' }),
  item('appliance', 'rice-cooker', '電鍋', [30, 30, 28], '#e8e3d8', { placement: 'surface' }),
  item('appliance', 'laptop', '筆電', [33, 23, 22], '#9aa0a8', { placement: 'surface' }),
  item('appliance', 'desk-lamp', '檯燈', [18, 18, 45], '#3b3f45', { placement: 'surface' }),
  item('appliance', 'robot-vacuum', '掃地機器人', [35, 35, 9], '#25272b'),
  item('appliance', 'washing-machine', '洗衣機', [60, 65, 100], '#eef0f2'),
  item('appliance', 'air-purifier', '空氣清淨機', [30, 30, 65], '#f2f2f0'),
  item('appliance', 'fan', '電風扇', [40, 35, 110], '#e9ecef'),
  item('appliance', 'floor-lamp', '立燈', [35, 35, 160], '#3b3f45'),
  item('fixture', 'kitchen-counter', '廚具', [225, 60, 90], '#f0ece4', { surface: true }),
  item('fixture', 'toilet', '馬桶', [40, 70, 75], '#fafafa'),
  item('fixture', 'basin', '洗手台', [60, 45, 85], '#f5f5f3'),
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
