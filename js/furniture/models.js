// 家具 3D 模型：程式化低多邊形造型，並預留外部 GLB/GLTF 模型取代
// 座標：原點在家具底面中心，寬沿 x、深沿 z、正面朝 +z
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const materialCache = new Map();

function mat(color, roughness = 0.8) {
  const key = `${color}|${roughness}`;
  if (!materialCache.has(key)) materialCache.set(key, new THREE.MeshStandardMaterial({ color, roughness }));
  return materialCache.get(key);
}

// 由主色推出深一階、淺一階的配色
function shades(hex) {
  const base = new THREE.Color(hex);
  return {
    main: `#${base.getHexString()}`,
    dark: `#${base.clone().offsetHSL(0, 0, -0.14).getHexString()}`,
    light: `#${base.clone().offsetHSL(0, -0.05, 0.1).getHexString()}`,
  };
}

const WOOD_DARK = '#4a3a2c';
const METAL = '#3c3f44';

function box(group, [sx, sy, sz], [x, y, z], color, roughness) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat(color, roughness));
  mesh.position.set(x, y, z);
  group.add(mesh);
  return mesh;
}

function cylinder(group, [rTop, rBottom, height, segments], [x, y, z], color) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, height, segments), mat(color));
  mesh.position.set(x, y, z);
  group.add(mesh);
  return mesh;
}

// 四支腳，放在矩形內縮 inset 的四個角
function legs(group, w, d, height, thickness, inset, color) {
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      box(group, [thickness, height, thickness], [sx * (w / 2 - inset), height / 2, sz * (d / 2 - inset)], color);
    }
  }
}

function seating(g, w, d, h, c, { arm }) {
  const seatH = Math.min(0.45, h * 0.5);
  const back = Math.min(0.22, d * 0.25);
  const armW = arm ? Math.min(0.18, w * 0.15) : 0;
  box(g, [w, seatH * 0.55, d], [0, seatH * 0.275 + 0.06, 0], c.dark);
  legs(g, w, d, 0.06, 0.05, 0.06, WOOD_DARK);
  box(g, [w - armW * 2, seatH * 0.35, d - back], [0, seatH * 0.55 + 0.06 + seatH * 0.175, back / 2], c.light);
  box(g, [w, h - 0.06, back], [0, (h - 0.06) / 2 + 0.06, -d / 2 + back / 2], c.main);
  if (arm) {
    for (const s of [-1, 1]) box(g, [armW, h * 0.68, d], [s * (w / 2 - armW / 2), h * 0.34 + 0.03, 0], c.main);
  }
}

const BUILDERS = {
  sofa: (g, w, d, h, c) => seating(g, w, d, h, c, { arm: true }),
  armchair: (g, w, d, h, c) => seating(g, w, d, h, c, { arm: true }),

  'coffee-table': (g, w, d, h, c) => {
    box(g, [w, 0.04, d], [0, h - 0.02, 0], c.main, 0.5);
    box(g, [w * 0.9, 0.02, d * 0.85], [0, h * 0.3, 0], c.dark);
    legs(g, w, d, h - 0.04, 0.04, 0.05, c.dark);
  },

  'dining-table': (g, w, d, h, c) => {
    box(g, [w, 0.04, d], [0, h - 0.02, 0], c.main, 0.5);
    legs(g, w, d, h - 0.04, 0.06, 0.08, c.dark);
  },

  'dining-chair': (g, w, d, h, c) => {
    const seatH = Math.min(0.46, h * 0.52);
    box(g, [w, 0.04, d], [0, seatH, 0], c.main);
    legs(g, w, d, seatH - 0.02, 0.035, 0.03, c.dark);
    box(g, [w, h - seatH, 0.03], [0, seatH + (h - seatH) / 2, -d / 2 + 0.015], c.main);
  },

  'double-bed': (g, w, d, h, c) => bed(g, w, d, h, c, 2),
  'single-bed': (g, w, d, h, c) => bed(g, w, d, h, c, 1),

  wardrobe: (g, w, d, h, c) => {
    box(g, [w, h, d], [0, h / 2, 0], c.main);
    const doors = Math.max(2, Math.round(w / 0.5));
    for (let i = 1; i < doors; i++) box(g, [0.006, h * 0.96, 0.004], [-w / 2 + (w / doors) * i, h / 2, d / 2], c.dark);
    for (let i = 0; i < doors; i++) {
      const x = -w / 2 + (w / doors) * (i + 0.5) + (i % 2 === 0 ? 1 : -1) * (w / doors) * 0.35;
      box(g, [0.015, 0.18, 0.02], [x, h * 0.5, d / 2 + 0.01], METAL);
    }
  },

  desk: (g, w, d, h, c) => {
    box(g, [w, 0.03, d], [0, h - 0.015, 0], c.main, 0.5);
    for (const s of [-1, 1]) box(g, [0.03, h - 0.03, d * 0.9], [s * (w / 2 - 0.03), (h - 0.03) / 2, 0], c.dark);
    box(g, [w * 0.35, 0.12, d * 0.9], [w * 0.28, h - 0.09, 0], c.dark);
  },

  'tv-stand': (g, w, d, h, c) => {
    box(g, [w, h - 0.05, d], [0, (h - 0.05) / 2 + 0.05, 0], c.main);
    legs(g, w, d, 0.05, 0.04, 0.05, METAL);
    for (let i = 1; i < 3; i++) box(g, [0.005, (h - 0.05) * 0.9, 0.004], [-w / 2 + (w / 3) * i, (h - 0.05) / 2 + 0.05, d / 2], c.dark);
    // 電視本體放在櫃子上，尺寸跟著櫃寬
    const tvW = Math.min(w * 0.75, 1.45);
    box(g, [tvW, tvW * 0.56, 0.04], [0, h + 0.06 + (tvW * 0.56) / 2, -d * 0.1], '#1d1f22', 0.3);
    box(g, [0.3, 0.06, 0.18], [0, h + 0.03, -d * 0.1], METAL);
  },

  fridge: (g, w, d, h, c) => {
    box(g, [w, h, d], [0, h / 2, 0], c.main, 0.35);
    box(g, [w * 0.98, 0.008, 0.004], [0, h * 0.62, d / 2], c.dark);
    for (const y of [h * 0.8, h * 0.45]) box(g, [0.025, h * 0.14, 0.03], [w / 2 - 0.06, y, d / 2 + 0.015], METAL);
  },

  rug: (g, w, d, h, c) => {
    box(g, [w, Math.max(h, 0.005), d], [0, Math.max(h, 0.005) / 2, 0], c.main, 1);
    box(g, [w * 0.82, Math.max(h, 0.005) + 0.001, d * 0.78], [0, Math.max(h, 0.005) / 2, 0], c.light, 1);
  },

  plant: (g, w, d, h, c) => {
    const r = Math.min(w, d) / 2;
    cylinder(g, [r * 0.7, r * 0.55, h * 0.3, 12], [0, h * 0.15, 0], '#b6866a');
    const leaves = [
      [0, h * 0.62, 0, r * 0.95],
      [r * 0.35, h * 0.78, r * 0.1, r * 0.7],
      [-r * 0.3, h * 0.82, -r * 0.15, r * 0.65],
      [0, h * 0.93, 0, r * 0.5],
    ];
    for (const [x, y, z, size] of leaves) {
      const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(size, 0), mat(c.main));
      mesh.position.set(x, y, z);
      g.add(mesh);
    }
  },
};

function bed(g, w, d, h, c, pillows) {
  const baseH = Math.min(0.3, h * 0.3);
  const mattressH = Math.min(0.22, h * 0.22);
  box(g, [w, baseH, d], [0, baseH / 2, 0], '#8a6e55');
  box(g, [w - 0.04, mattressH, d - 0.06], [0, baseH + mattressH / 2, 0.02], '#f5f3ee');
  box(g, [w - 0.02, mattressH * 0.35, d * 0.62], [0, baseH + mattressH + 0.01, d * 0.18], c.main);
  box(g, [w, h, 0.07], [0, h / 2, -d / 2 + 0.035], '#8a6e55');
  const pw = (w - 0.2) / pillows;
  for (let i = 0; i < pillows; i++) {
    box(g, [pw - 0.06, 0.1, 0.38], [-w / 2 + 0.1 + pw * (i + 0.5), baseH + mattressH + 0.05, -d / 2 + 0.3], '#ffffff', 1);
  }
}

// ---------- 外部模型 ----------
// 日後要換成真實模型：registerExternalModel('sofa', 'models/sofa.glb')
// 載入後會等比例以外「拉伸」到家具的寬深高，原點放到底面中心
const externalUrls = new Map();
const externalTemplates = new Map();
let loader;

export function registerExternalModel(type, url) {
  externalUrls.set(type, url);
  externalTemplates.delete(type);
}

export function loadExternalTemplate(type) {
  if (!externalUrls.has(type)) return Promise.resolve(null);
  if (!externalTemplates.has(type)) {
    loader ??= new GLTFLoader();
    externalTemplates.set(
      type,
      loader.loadAsync(externalUrls.get(type)).then(
        (gltf) => gltf.scene,
        (error) => {
          console.warn(`外部模型 ${type} 載入失敗，改用程式化模型`, error);
          return null;
        },
      ),
    );
  }
  return externalTemplates.get(type);
}

function fitExternal(template, w, d, h) {
  const clone = template.clone(true);
  const bounds = new THREE.Box3().setFromObject(clone);
  const size = bounds.getSize(new THREE.Vector3());
  clone.scale.set(w / (size.x || 1), h / (size.y || 1), d / (size.z || 1));
  const scaled = new THREE.Box3().setFromObject(clone);
  const center = scaled.getCenter(new THREE.Vector3());
  clone.position.sub(new THREE.Vector3(center.x, scaled.min.y, center.z));
  return clone;
}

// 回傳家具的 Three.js 群組；外部模型若已載入就用外部模型
export function buildFurnitureModel(item, externalTemplate = null) {
  const group = new THREE.Group();
  const w = item.size.w / 100;
  const d = item.size.d / 100;
  const h = item.size.h / 100;
  if (externalTemplate) {
    group.add(fitExternal(externalTemplate, w, d, h));
  } else {
    (BUILDERS[item.type] ?? BUILDERS['coffee-table'])(group, w, d, h, shades(item.color));
  }
  group.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = item.type !== 'rug';
      child.receiveShadow = true;
    }
  });
  return group;
}
