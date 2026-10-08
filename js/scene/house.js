// 由 floorplan.json 建出房屋的 Three.js 物件：牆、窗台、楣樑、玻璃、地板
import * as THREE from 'three';
import { buildGlass, buildSolids, openingAxis } from '../core/floorplan.js';
import { floorMaterialOf } from '../core/materials.js';
import { sizedTexture, proceduralTexture } from './textures.js';


const BASEBOARD_HEIGHT = 0.08;
const BASEBOARD_THICKNESS = 0.012;
const FRAME_WIDTH = 0.045;

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

// 自訂顏色優先，否則用材質本身的顏色
export function floorColorOf(roomId, roomSettings) {
  return roomSettings?.[roomId]?.floorColor ?? floorMaterialOf(roomId, roomSettings).color;
}

// 回傳 { group, floors: Map<roomId, Mesh[]>, wallMeshes }；樓高或地板色變了就整個重建，量很小
export function buildHouse(floorplan, { ceilingHeight, rooms, ceilingColor = '#f4f2ee' }) {
  const group = new THREE.Group();
  group.name = 'house';

  // 牆面用淡淡的乳膠漆紋理；ExtrudeGeometry 的 UV 以公尺計，紋理每 1.6 m 重複一次
  const paint = proceduralTexture('paint', '#ffffff').clone();
  paint.needsUpdate = true;
  paint.repeat.set(1 / 1.6, 1 / 1.6);
  const wallMaterials = Object.fromEntries(
    Object.entries(WALL_COLORS).map(([k, c]) => [k, new THREE.MeshStandardMaterial({ color: c, roughness: 0.92, map: paint })]),
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
    const color = floorColorOf(room.id, rooms);
    const look = floorMaterialOf(room.id, rooms);
    const meshes = room.rects.map(([x0, y0, x1, y1]) => {
      // 每塊地板依實際大小貼圖，木紋與磁磚的尺寸才不會被拉長；世界座標對齊，相鄰兩塊會接得起來
      // 紋理直接用材質顏色畫，比白底再乘色更飽和
      const map = sizedTexture(look.pattern, color, x1 - x0, y1 - y0, look.tile, look.options);
      map.offset.set(x0 / look.tile, y0 / look.tile);
      const material = new THREE.MeshStandardMaterial({ color: '#ffffff', map, roughness: look.roughness, metalness: 0 });
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

  group.add(buildBaseboards(floorplan, ceilingHeight));
  group.add(buildFrames(floorplan));

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

const edgesOf = (poly) => poly.map((p, i) => [p, poly[(i + 1) % poly.length]]);
const signedArea = (poly) => edgesOf(poly).reduce((sum, [a, b]) => sum + a[0] * b[1] - b[0] * a[1], 0) / 2;

// 踢腳板：沿每道牆的每條邊，往牆外側貼一條 8 cm 高的薄板
function buildBaseboards(floorplan) {
  const group = new THREE.Group();
  group.name = 'baseboards';
  const material = new THREE.MeshStandardMaterial({ color: '#f7f5f0', roughness: 0.5 });
  for (const wall of floorplan.walls) {
    if (wall.kind === 'column') continue;
    const ccw = signedArea(wall.polygon) > 0;
    for (const [a, b] of edgesOf(wall.polygon)) {
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (length < 0.2) continue; // 牆端面（開口兩側）不貼
      const dir = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
      const out = ccw ? [dir[1], -dir[0]] : [-dir[1], dir[0]];
      const mid = [(a[0] + b[0]) / 2 + (out[0] * BASEBOARD_THICKNESS) / 2, (a[1] + b[1]) / 2 + (out[1] * BASEBOARD_THICKNESS) / 2];
      const board = new THREE.Mesh(new THREE.BoxGeometry(length, BASEBOARD_HEIGHT, BASEBOARD_THICKNESS), material);
      board.position.set(mid[0], BASEBOARD_HEIGHT / 2, -mid[1]);
      board.rotation.y = Math.atan2(dir[1], dir[0]);
      board.receiveShadow = true;
      group.add(board);
    }
  }
  return group;
}

// 窗框（鋁色）與門框（白色）：開口兩側與上緣各一條，窗戶下緣也有
function buildFrames(floorplan) {
  const group = new THREE.Group();
  group.name = 'frames';
  const aluminium = new THREE.MeshStandardMaterial({ color: '#6b6e72', roughness: 0.35, metalness: 0.6 });
  const casing = new THREE.MeshStandardMaterial({ color: '#f4f1ea', roughness: 0.55 });
  for (const opening of floorplan.openings) {
    const { start, dir, width, thickness } = openingAxis(opening.polygon);
    const isWindow = opening.kind === 'window';
    const material = isWindow ? aluminium : casing;
    const depth = thickness + (isWindow ? -0.04 : 0.02);
    const angle = Math.atan2(dir[1], dir[0]);
    const place = (along, bottom, height, w) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, height, depth), material);
      const p = [start[0] + dir[0] * along, start[1] + dir[1] * along];
      mesh.position.set(p[0], bottom + height / 2, -p[1]);
      mesh.rotation.y = angle;
      mesh.castShadow = true;
      group.add(mesh);
    };
    const span = opening.head - opening.sill;
    place(FRAME_WIDTH / 2, opening.sill, span, FRAME_WIDTH);
    place(width - FRAME_WIDTH / 2, opening.sill, span, FRAME_WIDTH);
    place(width / 2, opening.head - FRAME_WIDTH, FRAME_WIDTH, width);
    if (isWindow && opening.sill > 0) place(width / 2, opening.sill, FRAME_WIDTH, width);
    if (isWindow) place(width / 2, opening.sill, span, 0.03); // 中間的分隔框
  }
  return group;
}

export function disposeObject(object) {
  object.traverse((child) => {
    child.geometry?.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    // 貼圖都是從快取 clone 出來的，可以安全釋放；快取的原件不會掛在物件上
    materials.forEach((m) => {
      m?.map?.dispose();
      m?.dispose();
    });
  });
}
