// 插座、開關、弱電面板的 3D 模型：底面中心為原點、正面朝 +z（與 models.js 相同）
// 目錄尺寸的深度含安裝空間；實際面板是貼在牆上（-z 那面）的薄板，孔位做在面板正面
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const HOLE = '#26282b';
const PLATE_DEPTH = 0.01;
const materials = new Map();
const mat = (color, roughness = 0.4) => {
  const key = `${color}|${roughness}`;
  if (!materials.has(key)) materials.set(key, new THREE.MeshStandardMaterial({ color, roughness }));
  return materials.get(key);
};

function box(group, [sx, sy, sz], [x, y, z], color, roughness) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat(color, roughness));
  mesh.position.set(x, y, z);
  group.add(mesh);
  return mesh;
}

// 圓孔（接地孔、電視孔）：薄圓片，朝 +z
function disc(group, radius, [x, y, z], color) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 0.002, 8), mat(color, 0.6));
  mesh.rotation.x = Math.PI / 2;
  mesh.position.set(x, y, z);
  group.add(mesh);
  return mesh;
}

// 面板：貼牆的外框，正面再一片略小的蓋板做出倒角的層次；回傳蓋板正面的 z 與面板中心高度
function plate(g, w, d, h, c) {
  const back = -d / 2;
  box(g, [w, h, PLATE_DEPTH * 0.6], [0, h / 2, back + PLATE_DEPTH * 0.3], c.main);
  box(g, [w - 0.008, h - 0.008, PLATE_DEPTH * 0.4], [0, h / 2, back + PLATE_DEPTH * 0.8], c.light, 0.3);
  return { z: back + PLATE_DEPTH + 0.001, cy: h / 2 };
}

// 一組插座孔：兩個插腳孔＋下方接地圓孔；horizontal 為 220V 的橫向扁孔
function socket(g, [x, y, z], { horizontal = false, color = HOLE } = {}) {
  box(g, [0.04, 0.034, 0.002], [x, y, z], '#ecebe7', 0.35);
  const slot = horizontal ? [0.009, 0.0026, 0.002] : [0.0026, 0.009, 0.002];
  for (const s of [-1, 1]) box(g, slot, [x + s * 0.0065, y + 0.004, z + 0.0012], color, 0.8);
  disc(g, 0.0028, [x, y - 0.009, z + 0.0012], color);
}

// 同材質的零件併成一個 mesh：一面插座十幾個小零件，全屋幾十個面板會讓 draw call 暴增
function mergedByMaterial(build) {
  return (g, ...args) => {
    const parts = new THREE.Group();
    build(parts, ...args);
    const buckets = new Map();
    for (const child of parts.children) {
      child.updateMatrix();
      const geometry = child.geometry.clone().applyMatrix4(child.matrix);
      child.geometry.dispose();
      if (!buckets.has(child.material)) buckets.set(child.material, []);
      buckets.get(child.material).push(geometry);
    }
    for (const [material, geometries] of buckets) {
      g.add(new THREE.Mesh(mergeGeometries(geometries), material));
      geometries.forEach((geometry) => geometry.dispose());
    }
  };
}

const BUILDERS = {
  // 雙插座：上下兩組
  'outlet-110': (g, w, d, h, c) => {
    const { z, cy } = plate(g, w, d, h, c);
    for (const dy of [0.025, -0.025]) socket(g, [0, cy + dy, z]);
  },
  'outlet-220': (g, w, d, h, c) => {
    const { z, cy } = plate(g, w, d, h, c);
    socket(g, [0, cy, z], { horizontal: true, color: '#7a2a24' });
  },
  // 專用迴路：一組插座＋下方的標示條
  'outlet-dedicated': (g, w, d, h, c) => {
    const { z, cy } = plate(g, w, d, h, c);
    socket(g, [0, cy + 0.012, z]);
    box(g, [0.04, 0.008, 0.002], [0, cy - 0.035, z], '#b8860b');
  },
  // 開關：兩片翹板，上緣微微翹起，右下一個指示燈
  switch: (g, w, d, h, c) => {
    const { z, cy } = plate(g, w, d, h, c);
    for (const s of [-1, 1]) {
      const rocker = box(g, [0.034, 0.07, 0.006], [s * 0.0185, cy, z + 0.003], '#f7f7f4', 0.3);
      rocker.rotation.x = -0.05;
      box(g, [0.004, 0.002, 0.002], [s * 0.0185, cy - 0.028, z + 0.0065], '#e07a2e', 0.5);
    }
  },
  // 電視孔：圓形同軸座＋中心針
  'tv-jack': (g, w, d, h, c) => {
    const { z, cy } = plate(g, w, d, h, c);
    disc(g, 0.009, [0, cy, z + 0.001], '#b8bcc0');
    disc(g, 0.006, [0, cy, z + 0.002], HOLE);
    disc(g, 0.0012, [0, cy, z + 0.003], '#c9a64a');
  },
  // 網路孔：方形 RJ45 孔，上緣有卡榫缺口
  'lan-jack': (g, w, d, h, c) => {
    const { z, cy } = plate(g, w, d, h, c);
    box(g, [0.022, 0.022, 0.002], [0, cy, z], '#e8e9ea', 0.35);
    box(g, [0.015, 0.012, 0.002], [0, cy - 0.001, z + 0.0012], HOLE, 0.8);
    box(g, [0.006, 0.003, 0.002], [0, cy + 0.0065, z + 0.0012], HOLE, 0.8);
  },
};

export const ELECTRICAL_BUILDERS = Object.fromEntries(Object.entries(BUILDERS).map(([type, build]) => [type, mergedByMaterial(build)]));
