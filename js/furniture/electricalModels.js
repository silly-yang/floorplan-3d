// 插座、開關、弱電面板的 3D 模型：底面中心為原點、正面朝 +z（與 models.js 相同）
import * as THREE from 'three';

const DARK = '#3c3f44';
const materials = new Map();
const mat = (color) => {
  if (!materials.has(color)) materials.set(color, new THREE.MeshStandardMaterial({ color, roughness: 0.4 }));
  return materials.get(color);
};

function box(group, [sx, sy, sz], [x, y, z], color) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat(color));
  mesh.position.set(x, y, z);
  group.add(mesh);
  return mesh;
}

// 面板本體＋正面的小零件；marks 為 [寬, 高, x, y]，以面板中心為原點（公尺）
function plate(marks, markColor = DARK) {
  return (g, w, d, h, c) => {
    box(g, [w, h, d], [0, h / 2, 0], c.main);
    for (const [mw, mh, mx, my] of marks) box(g, [mw, mh, 0.004], [mx, h / 2 + my, d / 2 + 0.002], markColor);
  };
}

export const ELECTRICAL_BUILDERS = {
  'outlet-110': plate([[0.006, 0.018, -0.012, 0.01], [0.006, 0.018, 0.012, 0.01], [0.012, 0.006, 0, -0.02]]),
  'outlet-220': plate([[0.016, 0.005, -0.012, 0.01], [0.016, 0.005, 0.012, 0.01], [0.006, 0.012, 0, -0.02]], '#a33b33'),
  'outlet-dedicated': plate([[0.006, 0.018, -0.012, 0.01], [0.006, 0.018, 0.012, 0.01], [0.04, 0.008, 0, -0.035]], '#b8860b'),
  switch: plate([[0.04, 0.07, 0, 0]], '#d8d8d4'),
  'tv-jack': plate([[0.022, 0.022, 0, 0]]),
  'lan-jack': plate([[0.024, 0.02, 0, 0]], '#6b7480'),
};
