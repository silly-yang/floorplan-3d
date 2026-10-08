// 寫實貼圖與外部模型的對照表；不依賴 Three.js
// 素材來源與授權見 assets/CREDITS.md

const TEXTURES = 'assets/textures';
const MODELS = 'assets/models';

// size：一張貼圖代表的實際寬、高（公尺），取自素材頁標示的實體尺寸
const polyHaven = (id, size) => ({
  id,
  size,
  map: `${TEXTURES}/${id}/${id}_diff_1k.jpg`,
  normalMap: `${TEXTURES}/${id}/${id}_nor_gl_1k.jpg`,
  roughnessMap: `${TEXTURES}/${id}/${id}_rough_1k.jpg`,
  thumb: `${TEXTURES}/${id}/thumb.jpg`,
});
const ambientCg = (id, size) => ({
  id,
  size,
  map: `${TEXTURES}/${id}/${id}_1K-JPG_Color.jpg`,
  normalMap: `${TEXTURES}/${id}/${id}_1K-JPG_NormalGL.jpg`,
  roughnessMap: `${TEXTURES}/${id}/${id}_1K-JPG_Roughness.jpg`,
  thumb: `${TEXTURES}/${id}/thumb.jpg`,
});

export const TEXTURE_SETS = Object.fromEntries(
  [
    polyHaven('laminate_floor_02', [1.7, 1.7]),
    polyHaven('laminate_floor_03', [2.08, 2.08]),
    polyHaven('marble_01', [1.5, 1.5]),
    polyHaven('rounded_square_tiled_wall', [2, 2]),
    polyHaven('beige_wall_001', [3, 3]),
    polyHaven('white_oak_veneer', [0.5, 0.5]),
    polyHaven('smoked_walnut_veneer', [1, 1]),
    polyHaven('poly_wool_herringbone', [0.27, 0.27]),
    ambientCg('WoodFloor046', [1.3, 1.3]),
    ambientCg('Concrete034', [1.1, 0.55]),
  ].map((set) => [set.id, set]),
);

// 沒列出的材質（SPC、拋光石英磚、木紋磚、止滑磚）維持程式紋理
export const FLOOR_TEXTURES = {
  laminate: 'laminate_floor_02',
  engineered: 'laminate_floor_03',
  microcement: 'Concrete034',
  walnut: 'WoodFloor046',
  marble: 'marble_01',
  mosaic: 'rounded_square_tiled_wall',
};

export function floorTextureOf(materialId) {
  return TEXTURE_SETS[FLOOR_TEXTURES[materialId]] ?? null;
}

// rect＝[x0, y0, x1, y1]（公尺）；位移用世界座標，相鄰兩塊地板的紋理才接得起來
export function textureRepeat([x0, y0, x1, y1], [sx, sy]) {
  return { repeat: [(x1 - x0) / sx, (y1 - y0) / sy], offset: [x0 / sx, y0 / sy] };
}

const MAX_TINT = 3;
const channels = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);

// 貼圖本身帶顏色；使用者自訂地板色時，用「自訂色／材質原色」當乘色，維持貼圖的明暗細節
export function tintRatio(custom, base) {
  if (!custom) return [1, 1, 1];
  const b = channels(base);
  return channels(custom).map((c, i) => Math.min(MAX_TINT, b[i] > 0 ? c / b[i] : c));
}

// 櫃體顏色亮度過半用淺色木皮，否則用深色
export function veneerFor(hex) {
  const [r, g, b] = channels(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b >= 0.5 ? 'white_oak_veneer' : 'smoked_walnut_veneer';
}

// rotationY：載入後先繞 y 轉多少，讓模型正面朝 +z、寬沿 x（與程式模型一致）
// finishes：低多邊形模型沒有貼圖，依材質名稱重新上材質；unit＝模型 1 單位約幾公尺，換算貼圖密度
// fabric 布料、tint 依家具顏色、linen 寢具白、legs 深色金屬腳、walnut 深色木皮
// 沒列出的（衣櫃、書桌、餐桌）用程式模型：素材包只有古典款或橢圓桌，風格或形狀不符
const polyHavenModel = (id) => ({ url: `${MODELS}/${id}/${id}_1k.gltf`, rotationY: 0 });
const quaternius = (file, unit, finishes) => ({ url: `${MODELS}/quaternius/${file}`, rotationY: 0, unit, finishes });
const BED_FINISHES = { Red: 'tint', DarkRed: 'tint', Wood: 'walnut', White: 'linen', Grey: 'linen' };

export const EXTERNAL_MODELS = {
  armchair: polyHavenModel('modern_arm_chair_01'),
  // 原檔長邊沿 z，轉 90° 讓長邊對到家具的寬
  'coffee-table': { ...polyHavenModel('modern_coffee_table_01'), rotationY: Math.PI / 2 },
  'dining-chair': polyHavenModel('dining_chair_02'),
  'tv-stand': polyHavenModel('modern_wooden_cabinet'),
  sofa: quaternius('couch_medium.glb', 0.45, { Couch_Blue: 'fabric', Black: 'legs' }),
  'double-bed': quaternius('bed_king.glb', 0.52, BED_FINISHES),
  'single-bed': quaternius('bed_single.glb', 0.51, BED_FINISHES),
  plant: quaternius('houseplant.glb', 1.3, {}),
  'floor-lamp': quaternius('light_floor.glb', 1, {}),
};

export function externalModelOf(type) {
  return EXTERNAL_MODELS[type] ?? null;
}

// 載入後的外框三軸都要有尺寸才能拉伸到家具大小；空場景或扁平模型改用程式模型
export function usableBounds({ x, y, z }) {
  return [x, y, z].every((v) => Number.isFinite(v) && v > 0);
}

// 沒有貼圖座標的模型用盒狀投影補上：依法向量最大的軸，取另外兩軸當 (u, v)
// 單位換算：座標 × unit（公尺）／ textureSize（一張貼圖幾公尺）
export function boxProjectUv(positions, normals, unit, textureSize) {
  const k = unit / textureSize;
  const count = positions.length / 3;
  const uv = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const [x, y, z] = [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];
    const [ax, ay, az] = [Math.abs(normals[i * 3]), Math.abs(normals[i * 3 + 1]), Math.abs(normals[i * 3 + 2])];
    const [u, v] = ay >= ax && ay >= az ? [x, z] : ax >= az ? [z, y] : [x, y];
    uv[i * 2] = u * k;
    uv[i * 2 + 1] = v * k;
  }
  return uv;
}
