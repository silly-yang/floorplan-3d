// 地板網格：細線每 10 cm、粗線每 1 m，略高於地板避免閃爍；只在 3D／俯視顯示
import * as THREE from 'three';
import { gridLines } from '../core/gridLines.js';

const LIFT = 0.006;

function segments(lines, color, opacity) {
  const positions = lines.flatMap(({ from, to }) => [from[0], LIFT, -from[1], to[0], LIFT, -to[1]]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
  const mesh = new THREE.LineSegments(geometry, material);
  mesh.renderOrder = 1;
  return mesh;
}

export function buildGrid(bounds) {
  const lines = gridLines(bounds);
  const group = new THREE.Group();
  group.name = 'grid';
  group.add(segments(lines.filter((l) => !l.major), '#3b3f45', 0.12));
  group.add(segments(lines.filter((l) => l.major), '#3b3f45', 0.4));
  return group;
}
