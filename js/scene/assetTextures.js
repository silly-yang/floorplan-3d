// 寫實貼圖（CC0 素材）：地板、牆面、系統櫃木皮、布料
// 按需載入：畫面用到哪一組才下載；載入前與失敗時維持程式紋理
import * as THREE from 'three';
import { TEXTURE_SETS, floorTextureOf, textureRepeat, tintRatio, veneerFor } from '../core/realisticAssets.js';
import { textureThumbnail } from './textures.js';

const loader = new THREE.TextureLoader();
const files = new Map();
const MAP_KEYS = ['map', 'normalMap', 'roughnessMap'];

// 每張圖只下載一次
function loadTexture(url, srgb) {
  if (!files.has(url)) {
    const loading = new Promise((resolve, reject) => loader.load(url, resolve, undefined, reject)).then((texture) => {
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.anisotropy = 8;
      if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
      return texture;
    });
    files.set(url, loading);
  }
  return files.get(url);
}

// keys：只用到其中幾張就只下載那幾張（牆面只要法線）；失敗回 null，呼叫端維持原本的外觀
const sets = new Map();
export function loadTextureSet(id, keys = MAP_KEYS) {
  const cacheKey = `${id}|${keys}`;
  if (!sets.has(cacheKey)) {
    const set = TEXTURE_SETS[id];
    sets.set(
      cacheKey,
      Promise.all(keys.map((key) => loadTexture(set[key], key === 'map'))).then(
        (textures) => Object.fromEntries(keys.map((key, i) => [key, textures[i]])),
        (error) => {
          console.warn(`貼圖 ${id} 載入失敗，改用程式紋理`, error);
          return null;
        },
      ),
    );
  }
  return sets.get(cacheKey);
}

// 同一組貼圖給不同大小的面用：clone 共用影像，只各自設定重複與位移
function placed(textures, repeat, offset) {
  return Object.fromEntries(
    Object.entries(textures).map(([key, t]) => {
      const c = t.clone();
      c.repeat.set(...repeat);
      c.offset.set(...offset);
      return [key, c];
    }),
  );
}

// 地板：rect＝[x0, y0, x1, y1]（公尺）；自訂顏色換成乘色，保留貼圖的木紋與磚縫
export function applyFloorTexture(material, look, rect, customColor) {
  const set = floorTextureOf(look.id);
  if (!set) return;
  loadTextureSet(set.id).then((textures) => {
    if (!textures) return;
    const { repeat, offset } = textureRepeat(rect, set.size);
    const maps = placed(textures, repeat, offset);
    material.map?.dispose();
    Object.assign(material, maps);
    material.color.setRGB(...tintRatio(customColor, look.color));
    // 光澤交給粗糙度貼圖
    material.roughness = 1;
    material.needsUpdate = true;
  });
}

// 材質選單縮圖：有貼圖的用 128px 縮圖檔，其餘用程式紋理
export function floorThumbnail(look) {
  return floorTextureOf(look.id)?.thumb ?? textureThumbnail(look.pattern, look.color, look.options);
}

const WALL = TEXTURE_SETS.beige_wall_001;
const WALL_NORMAL_SCALE = 0.35;

// 牆面：只加乳膠漆的法線貼圖（低強度），顏色仍由牆色與程式紋理決定；牆的 UV 以公尺計
export function applyWallFinish(materials) {
  loadTextureSet(WALL.id, ['normalMap']).then((textures) => {
    if (!textures) return;
    const normalMap = textures.normalMap.clone();
    normalMap.repeat.set(1 / WALL.size[0], 1 / WALL.size[1]);
    for (const m of materials) {
      m.normalMap = normalMap;
      m.normalScale.set(WALL_NORMAL_SCALE, WALL_NORMAL_SCALE);
      m.needsUpdate = true;
    }
  });
}

const finishCache = new Map();
// 煙燻胡桃木皮的原色偏淺，深色用途（深色櫃體、床架）壓暗
const DARK_WOOD = [0.55, 0.45, 0.4];

// 依 key 快取的材質；貼圖載入前先用 fallback 顏色，載入後換上貼圖與乘色
function texturedMaterial(key, setId, fallback, tint) {
  if (!finishCache.has(key)) {
    const material = new THREE.MeshStandardMaterial({ color: fallback, roughness: 0.8 });
    loadTextureSet(setId).then((textures) => {
      if (!textures) return;
      Object.assign(material, textures);
      material.color.setRGB(...tint);
      material.roughness = 1;
      material.needsUpdate = true;
    });
    finishCache.set(key, material);
  }
  return finishCache.get(key);
}

// 系統櫃門片、抽屜面板的木皮：櫃體淺色用白橡、深色用煙燻胡桃
export function veneerMaterial(baseColor) {
  const id = veneerFor(baseColor);
  return texturedMaterial(`veneer|${id}`, id, baseColor, id === 'smoked_walnut_veneer' ? DARK_WOOD : [1, 1, 1]);
}

// 布料（沙發）：貼圖本身是灰色，用家具顏色換算乘色；基準取得比貼圖平均亮，避免色調映射後泛白
const FABRIC_GREY = '#a09f9a';
export function fabricMaterial(color) {
  return texturedMaterial(`fabric|${color}`, 'poly_wool_herringbone', color, tintRatio(color, FABRIC_GREY));
}

export function walnutMaterial() {
  return texturedMaterial('walnut', 'smoked_walnut_veneer', '#4a3a2c', DARK_WOOD);
}
