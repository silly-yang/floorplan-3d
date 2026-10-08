// 家具 3D 模型：程式化低多邊形造型，並預留外部 GLB/GLTF 模型取代
// 座標：原點在家具底面中心，寬沿 x、深沿 z、正面朝 +z
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { PLINTH, cellBox } from '../core/cabinet.js';
import { getCatalogItem } from './catalog.js';

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

  'kitchen-island': (g, w, d, h, c) => counterBody(g, w, d, h, c, { top: '#d9d4cb' }),

  'kitchen-counter': (g, w, d, h, c) => {
    counterBody(g, w, d, h, c, { top: '#cfcac2' });
    // 洗碗槽（含龍頭）、爐台：位置依檯面寬度比例放；面向 +z
    const sinkX = -w * 0.22;
    box(g, [Math.min(0.55, w * 0.25), 0.012, d * 0.6], [sinkX, h + 0.004, 0.02], '#9aa2aa', 0.25);
    box(g, [0.03, 0.24, 0.03], [sinkX, h + 0.12, -d / 2 + 0.08], METAL);
    box(g, [0.03, 0.03, 0.14], [sinkX, h + 0.24, -d / 2 + 0.14], METAL);
    box(g, [Math.min(0.6, w * 0.27), 0.012, d * 0.6], [w * 0.24, h + 0.004, 0.02], '#202225', 0.25);
    // 水槽旁的嵌入式洗碗機：不鏽鋼面板＋上緣把手
    const dw = Math.min(0.6, w * 0.27);
    const dwX = sinkX + Math.min(0.55, w * 0.25) / 2 + dw / 2 + 0.01;
    box(g, [dw - 0.006, h - 0.13, 0.02], [dwX, 0.08 + (h - 0.13) / 2, d / 2 + 0.012], '#b9bec4', 0.25);
    box(g, [dw * 0.7, 0.015, 0.025], [dwX, h - 0.09, d / 2 + 0.03], METAL);
    box(g, [dw * 0.5, 0.02, 0.003], [dwX, h - 0.13, d / 2 + 0.023], '#2a2d31');
    // 隱藏式排油煙機：薄型，藏在吊櫃下緣
    box(g, [Math.min(0.75, w * 0.32), 0.07, 0.42], [w * 0.24, 1.38, -d / 2 + 0.21], '#c9cdd1', 0.35);
  },

  'upper-cabinet': (g, w, d, h, c) => {
    box(g, [w, h, d], [0, h / 2, 0], c.main);
    const doors = Math.max(2, Math.round(w / 0.45));
    for (let i = 0; i < doors; i++) {
      const dw = w / doors;
      box(g, [dw - 0.006, h - 0.01, 0.018], [-w / 2 + dw * (i + 0.5), h / 2, d / 2 + 0.009], c.light);
      box(g, [0.012, 0.12, 0.02], [-w / 2 + dw * (i + 0.5) + (i % 2 ? -1 : 1) * (dw / 2 - 0.04), 0.1, d / 2 + 0.025], '#4a4d52');
    }
  },

  'shower-screen': (g, w, d, h) => {
    const glass = new THREE.Mesh(
      new THREE.BoxGeometry(w, h - 0.02, Math.max(d, 0.01)),
      new THREE.MeshPhysicalMaterial({ color: '#d6e9f2', transparent: true, opacity: 0.3, roughness: 0.05, depthWrite: false }),
    );
    glass.position.y = h / 2;
    g.add(glass);
    for (const y of [0.01, h - 0.01]) box(g, [w, 0.02, 0.04], [0, y, 0], METAL, 0.3);
    for (const x of [-w / 2, w / 2]) box(g, [0.02, h, 0.04], [x, h / 2, 0], METAL, 0.3);
    box(g, [0.02, 0.3, 0.03], [w * 0.2, 1.05, 0.025], METAL, 0.3);
  },

  toilet: (g, w, d, h, c) => {
    box(g, [w * 0.9, h * 0.45, d * 0.25], [0, h * 0.775, -d / 2 + d * 0.125], c.main, 0.3);
    cylinder(g, [w * 0.45, w * 0.32, h * 0.55, 16], [0, h * 0.275, d * 0.1], c.main);
    box(g, [w * 0.95, 0.03, d * 0.65], [0, h * 0.56, d * 0.12], c.light, 0.3);
  },

  basin: (g, w, d, h, c) => {
    box(g, [w, h * 0.7, d * 0.9], [0, h * 0.35, 0], '#b9a68f');
    box(g, [w, h * 0.3, d], [0, h * 0.85, 0], c.main, 0.3);
    box(g, [w * 0.6, 0.02, d * 0.55], [0, h + 0.001, 0.03], '#dfe3e6', 0.2);
    box(g, [0.03, 0.18, 0.03], [0, h + 0.09, -d / 2 + 0.06], METAL);
    box(g, [w * 0.9, 0.6, 0.02], [0, h + 0.55, -d / 2 + 0.01], '#cfe0ea', 0.1);
  },

  'coffee-machine': (g, w, d, h, c) => {
    box(g, [w, h * 0.12, d], [0, h * 0.06, 0], c.dark);
    box(g, [w, h * 0.88, d * 0.45], [0, h * 0.56, -d * 0.275], c.main, 0.4);
    box(g, [w, h * 0.22, d * 0.55], [0, h * 0.89, d * 0.225], c.main, 0.4);
    cylinder(g, [w * 0.18, w * 0.15, h * 0.22, 12], [0, h * 0.23, d * 0.2], '#f4f1ec');
  },

  microwave: (g, w, d, h, c) => {
    box(g, [w, h, d], [0, h / 2, 0], c.main, 0.4);
    box(g, [w * 0.68, h * 0.75, 0.005], [-w * 0.12, h / 2, d / 2], '#2a2d31', 0.2);
    box(g, [w * 0.2, h * 0.6, 0.006], [w * 0.36, h / 2, d / 2], c.dark);
  },

  'rice-cooker': (g, w, d, h, c) => {
    cylinder(g, [w * 0.48, w * 0.45, h * 0.75, 18], [0, h * 0.375, 0], c.main);
    cylinder(g, [w * 0.35, w * 0.48, h * 0.18, 18], [0, h * 0.84, 0], c.light);
    cylinder(g, [w * 0.06, w * 0.06, h * 0.07, 8], [0, h * 0.965, 0], '#3a3a3a');
    for (const s of [-1, 1]) box(g, [w * 0.12, h * 0.06, w * 0.08], [s * w * 0.52, h * 0.6, 0], '#3a3a3a');
  },

  laptop: (g, w, d, h, c) => {
    box(g, [w, 0.015, d], [0, 0.0075, 0], c.main, 0.4);
    const screen = box(g, [w, h, 0.008], [0, h / 2 * 0.95 + 0.01, -d / 2 + 0.03], c.dark, 0.4);
    screen.rotation.x = -0.25;
    box(g, [w * 0.9, h * 0.85, 0.001], [0, h / 2 * 0.95 + 0.01, -d / 2 + 0.036], '#1e2a38', 0.2).rotation.x = -0.25;
  },

  'desk-lamp': (g, w, d, h, c) => {
    cylinder(g, [w * 0.45, w * 0.5, 0.02, 16], [0, 0.01, 0], c.main);
    box(g, [0.015, h * 0.75, 0.015], [0, h * 0.375, 0], c.main);
    const shade = cylinder(g, [w * 0.15, w * 0.45, h * 0.25, 16], [0, h * 0.85, d * 0.15], c.main);
    shade.rotation.x = 0.4;
  },

  'robot-vacuum': (g, w, d, h, c) => {
    cylinder(g, [w / 2, w / 2, h * 0.85, 24], [0, h * 0.425 + h * 0.05, 0], c.main);
    cylinder(g, [w * 0.12, w * 0.12, h * 0.15, 16], [0, h * 0.95, -d * 0.18], '#5b6168');
    box(g, [w * 0.6, h * 0.3, 0.01], [0, h * 0.5, d / 2 - 0.01], '#45494e');
  },

  'washing-machine': (g, w, d, h, c) => {
    box(g, [w, h, d], [0, h / 2, 0], c.main, 0.35);
    box(g, [w * 0.9, h * 0.1, 0.006], [0, h * 0.92, d / 2], c.dark);
    const door = cylinder(g, [w * 0.3, w * 0.3, 0.02, 24], [0, h * 0.48, d / 2 + 0.01], '#9fb4c2');
    door.rotation.x = Math.PI / 2;
  },

  'air-purifier': (g, w, d, h, c) => {
    box(g, [w, h, d], [0, h / 2, 0], c.main, 0.5);
    for (let i = 0; i < 5; i++) box(g, [w * 0.7, 0.008, 0.004], [0, h * (0.3 + i * 0.08), d / 2], c.dark);
    box(g, [w * 0.8, 0.01, d * 0.8], [0, h + 0.005, 0], '#b7bcc2');
  },

  fan: (g, w, d, h, c) => {
    cylinder(g, [w * 0.35, w * 0.4, 0.04, 16], [0, 0.02, 0], c.main);
    cylinder(g, [0.015, 0.015, h * 0.6, 8], [0, h * 0.3, 0], c.main);
    const head = cylinder(g, [w * 0.48, w * 0.48, 0.06, 24], [0, h - w * 0.5, 0], c.light);
    head.rotation.x = Math.PI / 2;
    const hub = cylinder(g, [0.04, 0.04, 0.08, 12], [0, h - w * 0.5, 0.02], c.dark);
    hub.rotation.x = Math.PI / 2;
  },

  'floor-lamp': (g, w, d, h, c) => {
    cylinder(g, [w * 0.35, w * 0.4, 0.03, 16], [0, 0.015, 0], c.main);
    cylinder(g, [0.012, 0.012, h * 0.82, 8], [0, h * 0.41, 0], c.main);
    cylinder(g, [w * 0.3, w * 0.5, h * 0.18, 16], [0, h * 0.91, 0], '#f1e6cf');
  },

  // ---------- 網路設備 ----------
  'wifi-router': (g, w, d, h, c) => {
    const bodyH = Math.min(h * 0.25, 0.05);
    box(g, [w, bodyH, d], [0, bodyH / 2, 0], c.main, 0.5);
    for (let i = 0; i < 4; i++) box(g, [0.006, 0.006, 0.002], [-w * 0.3 + i * 0.02, bodyH * 0.5, d / 2 + 0.001], '#7ee08a');
    // 後方兩支天線
    for (const s of [-1, 1]) cylinder(g, [0.006, 0.008, h - bodyH, 8], [s * w * 0.38, bodyH + (h - bodyH) / 2, -d * 0.35], c.dark);
  },

  'mesh-node': (g, w, d, h, c) => {
    const r = Math.min(w, d) / 2;
    cylinder(g, [r * 0.85, r, h * 0.95, 24], [0, h * 0.475, 0], c.main);
    cylinder(g, [r * 0.6, r * 0.85, h * 0.05, 24], [0, h * 0.975, 0], c.light);
    box(g, [r * 0.3, 0.004, 0.002], [0, h * 0.2, r * 0.95], '#7ee08a');
  },

  // 底面貼著天花板：模型原點在底面，整體被 elevation 推到樓板下
  'ceiling-ap': (g, w, d, h, c) => {
    const r = Math.min(w, d) / 2;
    cylinder(g, [r * 0.8, r * 0.95, h * 0.7, 32], [0, h * 0.35, 0], c.main);
    cylinder(g, [r * 0.95, r * 0.95, h * 0.3, 32], [0, h * 0.85, 0], c.light);
    cylinder(g, [r * 0.08, r * 0.08, 0.003, 12], [0, -0.0015, 0], '#4f9be0');
  },

  'network-panel': (g, w, d, h, c) => {
    box(g, [w, h, d], [0, h / 2, 0], c.main, 0.45);
    box(g, [w - 0.02, h - 0.02, 0.006], [0, h / 2, d / 2 + 0.003], c.light, 0.45);
    for (let i = 0; i < 3; i++) box(g, [w * 0.5, 0.004, 0.002], [0, h * (0.62 + i * 0.06), d / 2 + 0.007], c.dark);
    box(g, [0.02, 0.06, 0.012], [w / 2 - 0.04, h / 2, d / 2 + 0.012], METAL);
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

// 櫃體＋踢腳內縮＋檯面＋門板分隔；中島櫃與廚具共用
function counterBody(g, w, d, h, c, { top }) {
  const kick = 0.08;
  box(g, [w - 0.04, kick, d - 0.06], [0, kick / 2, -0.03], '#4b4b4b');
  box(g, [w, h - kick - 0.03, d], [0, kick + (h - kick - 0.03) / 2, 0], c.main);
  box(g, [w + 0.02, 0.03, d + 0.03], [0, h - 0.015, 0.01], top, 0.35);
  const doors = Math.max(2, Math.round(w / 0.6));
  for (let i = 1; i < doors; i++) box(g, [0.005, h - kick - 0.08, 0.004], [-w / 2 + (w / doors) * i, kick + (h - kick) / 2, d / 2], c.dark);
}

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

const PANEL = 0.018; // 系統櫃板材厚 1.8 cm
const OUTLET_COLORS = { '110v': '#f4f4f2', '220v': '#d9534f' };

// 自己設計的系統櫃：櫃體、隔板、每格的門片／抽屜／開放、背板插座、格內家電
export function buildCabinetModel(cab) {
  const group = new THREE.Group();
  const w = cab.size.w / 100;
  const d = cab.size.d / 100;
  const h = cab.size.h / 100;
  const c = shades('#e9e4dc');
  const plinth = PLINTH / 100;
  box(group, [w - 0.02, plinth, d - 0.05], [0, plinth / 2, -0.025], '#4b4b4b');
  for (const sx of [-1, 1]) box(group, [PANEL, h - plinth, d], [sx * (w / 2 - PANEL / 2), plinth + (h - plinth) / 2, 0], c.main);
  box(group, [w, PANEL, d], [0, h - PANEL / 2, 0], c.main);
  box(group, [w, PANEL, d], [0, plinth + PANEL / 2, 0], c.main);
  box(group, [w, h - plinth, 0.008], [0, plinth + (h - plinth) / 2, -d / 2 + 0.004], c.dark);
  cab.columns.forEach((column, col) => {
    column.cells.forEach((cell, index) => {
      const b = cellBox(cab, col, index);
      const x0 = -w / 2 + b.x / 100;
      const cw = b.w / 100;
      const y0 = b.y / 100;
      const ch = b.h / 100;
      const cx = x0 + cw / 2;
      if (col > 0 && index === 0) box(group, [PANEL, h - plinth, d - 0.01], [x0, plinth + (h - plinth) / 2, 0.005], c.main);
      if (index > 0) box(group, [cw - PANEL, PANEL, d - 0.01], [cx, y0, 0.005], c.main);
      if (cell.kind === 'door') {
        box(group, [cw - 0.006, ch - 0.006, PANEL], [cx, y0 + ch / 2, d / 2 + PANEL / 2], c.light);
        box(group, [0.012, Math.min(0.16, ch * 0.5), 0.02], [x0 + cw - 0.05, y0 + ch / 2, d / 2 + PANEL + 0.01], '#4a4d52');
      }
      if (cell.kind === 'drawer') {
        const count = Math.max(1, Math.round(ch / 0.22));
        for (let k = 0; k < count; k++) {
          const dh = ch / count;
          box(group, [cw - 0.006, dh - 0.006, PANEL], [cx, y0 + dh * (k + 0.5), d / 2 + PANEL / 2], c.light);
          box(group, [Math.min(0.16, cw * 0.4), 0.012, 0.02], [cx, y0 + dh * (k + 0.5), d / 2 + PANEL + 0.01], '#4a4d52');
        }
      }
      if (cell.outlet !== 'none') {
        box(group, [0.07, 0.07, 0.01], [cx, y0 + ch - 0.08, -d / 2 + 0.013], OUTLET_COLORS[cell.outlet] ?? '#ffffff', 0.4);
      }
      // 抽拉盤：托盤＋前擋板＋上面的家電包成一組，主畫面點一下整組滑出
      let holder = group;
      let floorY = y0 + (index > 0 ? PANEL / 2 : PANEL);
      if (cell.kind === 'pullout') {
        holder = new THREE.Group();
        holder.name = 'pullout';
        holder.userData.pullout = { travel: d * 0.7, open: false, progress: 0 };
        box(holder, [cw - 0.04, 0.018, d - 0.06], [cx, floorY + 0.009, 0.01], '#cfc9bf');
        box(holder, [cw - 0.04, 0.05, 0.015], [cx, floorY + 0.025, d / 2 - 0.03], c.light);
        box(holder, [Math.min(0.14, cw * 0.4), 0.012, 0.02], [cx, floorY + 0.03, d / 2 - 0.012], '#4a4d52');
        floorY += 0.018;
        group.add(holder);
      }
      // 格內家電由左往右排，貼著格子底板（或托盤）、靠前緣
      let cursor = x0 + 0.02;
      for (const it of cell.items) {
        const spec = getCatalogItem(it.type);
        if (!spec) continue;
        const model = buildFurnitureModel({ type: it.type, size: spec.size, color: spec.color });
        model.position.set(cursor + spec.size.w / 200, floorY, d / 2 - spec.size.d / 200 - 0.04);
        holder.add(model);
        cursor += spec.size.w / 100 + 0.02;
      }
    });
  });
  return group;
}

// 回傳家具的 Three.js 群組；外部模型若已載入就用外部模型
// cabinet：custom-cabinet 對應的櫃子設計
export function buildFurnitureModel(item, externalTemplate = null, cabinet = null) {
  const group = new THREE.Group();
  const w = item.size.w / 100;
  const d = item.size.d / 100;
  const h = item.size.h / 100;
  if (item.type === 'custom-cabinet' && cabinet) {
    group.add(buildCabinetModel(cabinet));
  } else if (externalTemplate) {
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
