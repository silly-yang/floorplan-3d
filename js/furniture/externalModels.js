// 外部模型（CC0）：註冊網址、載入後修正朝向，低多邊形模型補貼圖座標並重新上材質
// 按需載入：furnitureLayer 只在場景出現該類型時呼叫 loadExternalTemplate
import * as THREE from 'three';
import { EXTERNAL_MODELS, TEXTURE_SETS, boxProjectUv, usableBounds } from '../core/realisticAssets.js';
import { registerExternalModel } from './models.js';
import { fabricMaterial, walnutMaterial } from '../scene/assetTextures.js';

const LINEN = new THREE.MeshStandardMaterial({ color: '#f2efe9', roughness: 0.9 });
const LEGS = new THREE.MeshStandardMaterial({ color: '#2f2f2f', roughness: 0.5, metalness: 0.3 });
const TINT_FINISH = 'tint';
// 需要貼圖座標的材質，對應貼圖一張代表幾公尺
const UV_SIZE = { fabric: TEXTURE_SETS.poly_wool_herringbone.size[0], walnut: TEXTURE_SETS.smoked_walnut_veneer.size[0] };

export function registerRealisticModels() {
  for (const [type, spec] of Object.entries(EXTERNAL_MODELS)) registerExternalModel(type, spec.url);
}

const prepared = new WeakMap();

// 第一次用到時整理模型：重新上材質、轉正，外框不合理就回 null 改用程式模型
export function preparedTemplate(type, scene) {
  if (!scene) return null;
  if (!prepared.has(scene)) {
    const spec = EXTERNAL_MODELS[type];
    if (spec.finishes) refinish(scene, spec);
    const holder = new THREE.Group();
    holder.add(scene);
    scene.rotation.y += spec.rotationY;
    const size = new THREE.Box3().setFromObject(holder).getSize(new THREE.Vector3());
    if (!usableBounds(size)) console.warn(`外部模型 ${type} 沒有可用的外框，改用程式化模型`);
    prepared.set(scene, usableBounds(size) ? holder : null);
  }
  return prepared.get(scene);
}

function refinish(scene, spec) {
  scene.updateMatrixWorld(true);
  const scale = new THREE.Vector3();
  scene.traverse((node) => {
    if (!node.isMesh) return;
    const finish = spec.finishes[node.material?.name];
    if (!finish) return;
    if (UV_SIZE[finish] && !node.geometry.attributes.uv) {
      // 頂點座標要乘上節點本身的縮放，才是模型單位
      const { position, normal } = node.geometry.attributes;
      const unit = spec.unit * node.getWorldScale(scale).x;
      node.geometry.setAttribute('uv', new THREE.BufferAttribute(boxProjectUv(position.array, normal.array, unit, UV_SIZE[finish]), 2));
    }
    node.userData.finish = finish;
    if (finish === 'walnut') node.material = walnutMaterial();
    if (finish === 'linen') node.material = LINEN;
    if (finish === 'legs') node.material = LEGS;
  });
}

const tintCache = new Map();

// 依家具顏色上色的部分（沙發布料、床罩）；材質依顏色快取，不改共用模板
export function tintExternal(model, item) {
  model.traverse((node) => {
    const finish = node.userData.finish;
    if (finish === 'fabric') node.material = fabricMaterial(item.color);
    if (finish === TINT_FINISH) {
      const key = item.color;
      if (!tintCache.has(key)) tintCache.set(key, new THREE.MeshStandardMaterial({ color: item.color, roughness: 0.85 }));
      node.material = tintCache.get(key);
    }
  });
  return model;
}
