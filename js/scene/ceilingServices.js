// 天花板設備的簡單模型：灑水頭（含垂管）、探測器、風管、排風口、推估的灑水支管
import * as THREE from 'three';
import { ceilingServiceLayout } from '../core/ceilingServices.js';

const PIPE_RADIUS = 0.013; // 灑水垂管、支管
const HEAD_RADIUS = 0.025;
const DETECTOR_RADIUS = 0.05;
const DETECTOR_HEIGHT = 0.035;
const VENT_SIZE = 0.25;
const UP = new THREE.Vector3(0, 1, 0);

// 平面座標 a→b、離地 y 的水平圓管；長度為 0 時不畫
function tube(a, b, y, radius, material) {
  const start = new THREE.Vector3(a[0], y, -a[1]);
  const end = new THREE.Vector3(b[0], y, -b[1]);
  const length = start.distanceTo(end);
  if (length < 1e-4) return null;
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 14), material);
  mesh.position.copy(start).add(end).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(UP, end.sub(start).normalize());
  return mesh;
}

// 垂直圓管，從 bottom 到 top
function riser(x, y, bottom, top, material) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(PIPE_RADIUS, PIPE_RADIUS, top - bottom, 10), material);
  mesh.position.set(x, (bottom + top) / 2, -y);
  return mesh;
}

// 可見的線段各畫一根管，轉折處補一顆球讓接縫看起來連續
function addRun(group, segments, y, radius, material) {
  for (const s of segments.filter((p) => p.visible)) {
    const mesh = tube(s.from, s.to, y, radius, material);
    if (!mesh) continue;
    group.add(mesh);
    for (const p of [s.from, s.to]) {
      const joint = new THREE.Mesh(new THREE.SphereGeometry(radius, 12, 8), material);
      joint.position.set(p[0], y, -p[1]);
      group.add(joint);
    }
  }
}

export function buildCeilingServices(floorplan, { slabHeight, ceilings }) {
  const group = new THREE.Group();
  group.name = 'ceiling-services';
  const layout = ceilingServiceLayout(floorplan, ceilings, slabHeight);
  const firePipe = new THREE.MeshStandardMaterial({ color: '#b5413b', roughness: 0.5, metalness: 0.2 });
  // 推估的支管用較淡、半透明的顏色，與圖面上的設備區分
  const estimatedPipe = new THREE.MeshStandardMaterial({ color: '#e6aaa5', roughness: 0.6, transparent: true, opacity: 0.6 });
  const brass = new THREE.MeshStandardMaterial({ color: '#c9a646', roughness: 0.35, metalness: 0.7 });
  const white = new THREE.MeshStandardMaterial({ color: '#f5f5f2', roughness: 0.6 });
  const duct = new THREE.MeshStandardMaterial({ color: '#b3b7bc', roughness: 0.4, metalness: 0.6 });
  const grille = new THREE.MeshStandardMaterial({ color: '#e4e5e3', roughness: 0.7 });

  for (const s of layout.sprinklers) {
    const head = new THREE.Group();
    head.name = 'sprinkler';
    if (s.top - s.height > 0.01) head.add(riser(s.x, s.y, s.height + 0.02, s.top, firePipe));
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.016, 0.03, 10), brass);
    body.position.set(s.x, s.height + 0.005, -s.y);
    const deflector = new THREE.Mesh(new THREE.CylinderGeometry(HEAD_RADIUS, HEAD_RADIUS, 0.004, 16), brass);
    deflector.position.set(s.x, s.height - 0.012, -s.y);
    head.add(body, deflector);
    group.add(head);
  }
  for (const d of layout.detectors) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(DETECTOR_RADIUS * 0.8, DETECTOR_RADIUS, DETECTOR_HEIGHT, 20), white);
    mesh.position.set(d.x, d.height - DETECTOR_HEIGHT / 2, -d.y);
    mesh.name = `detector-${d.type}`;
    group.add(mesh);
  }
  for (const v of layout.vents) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(VENT_SIZE, 0.01, VENT_SIZE), grille);
    mesh.position.set(v.x, v.height - 0.005, -v.y);
    mesh.name = 'vent';
    group.add(mesh);
  }
  for (const d of layout.ducts) addRun(group, d.segments, d.height, d.size.w / 2, duct);
  for (const b of layout.branches) addRun(group, b.segments, b.height, PIPE_RADIUS, b.estimated ? estimatedPipe : firePipe);
  return group;
}
