// 由 floorplan.json 建出房屋的 Three.js 物件：牆、窗台、楣樑、玻璃、地板
import * as THREE from 'three';
import { buildGlass, buildSolids } from '../core/floorplan.js';

export const DEFAULT_FLOOR_COLORS = {
  living: '#c8a97e',
  bedroom: '#b98b5e',
  bath: '#d9d9d6',
  balcony: '#a7a39a',
};
const FALLBACK_FLOOR = '#c8b49a';

const WALL_COLORS = { rc: '#f1ede6', partition: '#ece6dc', column: '#e3ddd3', sill: '#f1ede6', lintel: '#f1ede6' };

function shapeOf(polygon) {
  const shape = new THREE.Shape();
  polygon.forEach(([x, y], i) => (i === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y)));
  shape.closePath();
  return shape;
}

// 平面多邊形往上擠出；旋轉後 shape 的 y 對到世界 -z、擠出方向對到世界 +y
function extrude(polygon, bottom, top, material) {
  const geometry = new THREE.ExtrudeGeometry(shapeOf(polygon), { depth: top - bottom, bevelEnabled: false });
  geometry.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = bottom;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function floorColorOf(roomId, roomSettings) {
  return roomSettings?.[roomId]?.floorColor ?? DEFAULT_FLOOR_COLORS[roomId] ?? FALLBACK_FLOOR;
}

// 回傳 { group, floors: Map<roomId, Mesh[]>, wallMeshes }；樓高或地板色變了就整個重建，量很小
export function buildHouse(floorplan, { ceilingHeight, rooms, ceilingColor = '#f4f2ee' }) {
  const group = new THREE.Group();
  group.name = 'house';

  const wallMaterials = Object.fromEntries(
    Object.entries(WALL_COLORS).map(([k, c]) => [k, new THREE.MeshStandardMaterial({ color: c, roughness: 0.9 })]),
  );
  const wallMeshes = [];
  for (const solid of buildSolids(floorplan, ceilingHeight)) {
    const mesh = extrude(solid.polygon, solid.bottom, solid.top, wallMaterials[solid.kind] ?? wallMaterials.rc);
    mesh.name = solid.id;
    mesh.userData.kind = solid.kind;
    wallMeshes.push(mesh);
    group.add(mesh);
  }

  const glassMaterial = new THREE.MeshPhysicalMaterial({
    color: '#bcd7e6',
    transparent: true,
    opacity: 0.28,
    roughness: 0.05,
    depthWrite: false,
  });
  for (const glass of buildGlass(floorplan)) {
    // 剖面模式的牆比窗低，玻璃也跟著截掉
    const top = Math.min(glass.top, ceilingHeight);
    if (top <= glass.bottom) continue;
    const mesh = extrude(glass.polygon, glass.bottom, top, glassMaterial);
    mesh.castShadow = false;
    mesh.name = glass.id;
    group.add(mesh);
  }

  const floors = new Map();
  for (const room of floorplan.rooms) {
    const material = new THREE.MeshStandardMaterial({ color: floorColorOf(room.id, rooms), roughness: 0.75 });
    const meshes = room.rects.map(([x0, y0, x1, y1]) => {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, y1 - y0), material);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set((x0 + x1) / 2, 0.002, -(y0 + y1) / 2);
      mesh.receiveShadow = true;
      mesh.userData.roomId = room.id;
      group.add(mesh);
      return mesh;
    });
    floors.set(room.id, meshes);
  }

  // 天花板：面朝下，從上方看是透明的；不投影，免得室內一片黑
  const ceiling = new THREE.Group();
  ceiling.name = 'ceiling';
  const ceilingMaterial = new THREE.MeshStandardMaterial({ color: ceilingColor, roughness: 0.95 });
  for (const room of floorplan.rooms) {
    for (const [x0, y0, x1, y1] of room.rects) {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, y1 - y0), ceilingMaterial);
      mesh.rotation.x = Math.PI / 2;
      mesh.position.set((x0 + x1) / 2, ceilingHeight - 0.002, -(y0 + y1) / 2);
      ceiling.add(mesh);
    }
  }
  group.add(ceiling);

  // 室外地面，讓俯視時房子不是浮在虛空中
  const { width, depth } = floorplan.bounds;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(width + 20, depth + 20),
    new THREE.MeshStandardMaterial({ color: '#dfe3e6', roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(width / 2, -0.001, -depth / 2);
  ground.receiveShadow = true;
  ground.name = 'ground';
  group.add(ground);

  return { group, floors, wallMeshes, ceiling };
}

export function disposeObject(object) {
  object.traverse((child) => {
    child.geometry?.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((m) => m?.dispose());
  });
}
