// 家具目錄：類型、預設尺寸（公分）、預設顏色；不依賴 Three.js
import { ELECTRICAL_ITEMS } from './electricalCatalog.js';

export const SIZE_LIMITS = { min: 1, max: 600 };

export const CATEGORIES = [
  { id: 'furniture', name: '家具' },
  { id: 'appliance', name: '家電' },
  { id: 'fixture', name: '廚衛' },
  { id: 'light', name: '照明' },
  { id: 'electrical', name: '水電' },
];

// placement：floor 只能放地上；surface 可以放地上，也可以放到有檯面（surface: true）的家具上
// allowOverlap：地毯本來就壓在其他家具底下，不算重疊
// power：電壓（110／220）與瓦數；vent：上方建議保留的散熱空間（公分），放進櫃子時檢查
// mountHeight：掛牆家具（吊櫃）的固定離地高度（公分）
// cabinetItem：檯面家電能不能放進系統櫃的格子（電視不行）
// blocksWalk：隔間這類漫遊時會被擋住的東西；sizeLimits：與預設不同的尺寸範圍 { d: [min, max] }，h 上限另受室內淨高限制
// light：燈具的光源參數（kind：spot 朝下聚光／point 四散／linear 長條；lumens 光通量；beam 光束角°）
const item = (category, type, name, [w, d, h], color, { placement = 'floor', surface = false, allowOverlap = false, blocksWalk = false, cabinetItem = true, sizeLimits, power, vent, mountHeight, light } = {}) => ({
  category, type, name, size: { w, d, h }, color, placement, surface, allowOverlap, blocksWalk, cabinetItem,
  ...(sizeLimits ? { sizeLimits } : {}),
  ...(mountHeight ? { mountHeight } : {}),
  ...(light ? { light } : {}),
  ...(power ? { power: { voltage: power[0], watts: power[1] }, vent: vent ?? 0 } : {}),
});

const partition = (depth) => ({ blocksWalk: true, sizeLimits: { w: [20, 600], d: depth, h: [30, 600] } });

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
  item('furniture', 'fridge', '冰箱', [70, 70, 180], '#e6e8ea', { power: [110, 200], vent: 5 }),
  item('furniture', 'rug', '地毯', [200, 140, 1], '#b9a28c', { allowOverlap: true }),
  item('furniture', 'plant', '植栽', [45, 45, 120], '#5f8a54'),
  item('furniture', 'cat-tree', '貓爬架', [60, 50, 160], '#c9b49a'),
  // 隔間：會擋住漫遊；尺寸範圍另訂（厚度、高度上限＝室內淨高）
  item('furniture', 'half-wall', '半牆', [120, 10, 110], '#ece8e1', { surface: true, ...partition([8, 30]) }),
  item('furniture', 'glass-partition', '玻璃隔間', [120, 6, 220], '#2f3237', partition([4, 15])),
  item('furniture', 'slat-screen', '格柵屏風', [120, 6, 220], '#b48a60', partition([4, 20])),
  item('appliance', 'coffee-machine', '咖啡機', [25, 40, 35], '#2f3237', { placement: 'surface', power: [110, 1200], vent: 5 }),
  item('appliance', 'microwave', '微波爐', [50, 40, 30], '#d9dbde', { placement: 'surface', power: [110, 1200], vent: 10 }),
  item('appliance', 'rice-cooker', '電鍋', [30, 30, 28], '#e8e3d8', { placement: 'surface', power: [110, 800], vent: 20 }),
  item('appliance', 'air-fryer', '氣炸鍋', [30, 36, 33], '#2b2d31', { placement: 'surface', power: [110, 1500], vent: 10 }),
  item('appliance', 'oven', '烤箱', [50, 42, 32], '#3a3d42', { placement: 'surface', power: [110, 1500], vent: 10 }),
  item('appliance', 'steam-oven', '蒸烤爐', [60, 55, 45], '#1f2226', { placement: 'surface', power: [220, 3000], vent: 5 }),
  item('appliance', 'kettle', '電熱水瓶', [23, 30, 32], '#f1efe9', { placement: 'surface', power: [110, 700], vent: 10 }),
  item('appliance', 'laptop', '筆電', [33, 23, 22], '#9aa0a8', { placement: 'surface', power: [110, 65] }),
  item('appliance', 'desk-lamp', '檯燈', [18, 18, 45], '#3b3f45', { placement: 'surface', power: [110, 10] }),
  item('appliance', 'robot-vacuum', '掃地機器人', [35, 35, 9], '#25272b', { power: [110, 30] }),
  item('appliance', 'washing-machine', '洗衣機', [60, 65, 100], '#eef0f2', { power: [110, 500] }),
  item('appliance', 'dishwasher', '洗碗機', [60, 57, 82], '#d6d9dd', { power: [220, 1800] }),
  item('appliance', 'air-purifier', '空氣清淨機', [30, 30, 65], '#f2f2f0', { power: [110, 50] }),
  item('appliance', 'fan', '電風扇', [40, 35, 110], '#e9ecef', { power: [110, 45] }),
  item('appliance', 'floor-lamp', '立燈', [35, 35, 160], '#3b3f45', { power: [110, 20] }),
  // 電視：尺寸、瓦數依吋數與放置方式另算（core/tv.js），這裡是預設 55 吋放櫃上
  item('appliance', 'tv', '電視', [123, 25, 75], '#1d1f22', { placement: 'surface', cabinetItem: false, power: [110, 120] }),
  // 自己設計的系統櫃：不出現在家具清單，從「櫃子」分頁擺放；尺寸與格子來自 design.cabinets
  item('custom', 'custom-cabinet', '系統櫃', [120, 60, 210], '#e9e4dc', { surface: true }),
  // 自己設計的洞洞板：從「洞洞板」分頁擺放；離地高度存在家具的 elevation（取設計的掛牆高度）
  item('custom', 'custom-pegboard', '洞洞板', [120, 2, 80], '#c8a27a', { placement: 'wall' }),
  item('fixture', 'kitchen-counter', '廚具', [225, 60, 90], '#f0ece4', { surface: true }),
  item('fixture', 'toilet', '馬桶', [40, 70, 75], '#fafafa'),
  item('fixture', 'upper-cabinet', '吊櫃', [225, 35, 70], '#f0ece4', { placement: 'wall', mountHeight: 145 }),
  item('fixture', 'shower-screen', '淋浴拉門', [105, 2, 200], '#cfe3ee'),
  // 淋浴龍頭組：龍頭離地 100 cm，滑桿與頂噴到 215 cm；頂噴往前伸出約 35 cm
  // 淋浴龍頭組（頂噴＋手持）：龍頭離地 100 cm，滑桿與頂噴到 215 cm，頂噴往前伸出約 35 cm
  item('fixture', 'shower-set', '淋浴龍頭組', [25, 35, 115], '#c9ccd1', { placement: 'wall', mountHeight: 100 }),
  // 陽台：屋外型瓦斯熱水器底部約離地 130 cm；長水栓（拖把、澆花用）約 70 cm
  item('fixture', 'water-heater', '熱水器', [35, 18, 60], '#f1f1ee', { placement: 'wall', mountHeight: 130 }),
  item('fixture', 'balcony-tap', '長水栓', [6, 18, 12], '#c9ccd1', { placement: 'wall', mountHeight: 70 }),
  item('fixture', 'basin', '洗手台', [60, 45, 85], '#f5f5f3'),
  item('light', 'downlight', '嵌燈', [10, 10, 2], '#f2f2f0', { placement: 'ceiling', power: [110, 9], light: { kind: 'spot', lumens: 800, beam: 36 } }),
  item('light', 'ceiling-light', '吸頂燈', [50, 50, 10], '#f6f5f2', { placement: 'ceiling', power: [110, 36], light: { kind: 'point', lumens: 3600 } }),
  item('light', 'pendant-light', '吊燈', [35, 35, 30], '#3b3f45', { placement: 'ceiling', power: [110, 15], light: { kind: 'point', lumens: 1200 } }),
  item('light', 'track-light', '軌道燈', [120, 8, 15], '#2b2d31', { placement: 'ceiling', power: [110, 28], light: { kind: 'spot', lumens: 2400, beam: 24 } }),
  item('light', 'linear-light', '線燈', [120, 4, 4], '#e9e9e6', { placement: 'ceiling', power: [110, 18], light: { kind: 'linear', lumens: 1800 } }),
  ...ELECTRICAL_ITEMS,
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
// 尺寸輸入範圍 [下限, 上限]（公分）；隔間的高度不超過室內淨高
export function sizeLimitsOf(type, key, ceilingHeight) {
  const limits = getCatalogItem(type)?.sizeLimits?.[key];
  if (!limits) return [SIZE_LIMITS.min, SIZE_LIMITS.max];
  if (key === 'h') return [limits[0], Math.min(limits[1], Math.round(ceilingHeight * 100))];
  return [...limits];
}

export function normalizeSizeValue(value, [min, max] = [SIZE_LIMITS.min, SIZE_LIMITS.max]) {
  if (value === '' || value == null) return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.min(max, Math.max(min, Math.round(num)));
}
