// 由 floorplan.json 建出房屋的 Three.js 物件：牆、窗台、楣樑、玻璃、地板
import * as THREE from 'three';
import { buildGlass, buildSolids, openingAxis } from '../core/floorplan.js';
import { ceilingStateOf, ceilingZones, clipRect } from '../core/ceilings.js';
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
export function buildHouse(floorplan, { ceilingHeight, rooms, ceilingColor = '#f4f2ee', ceilings = {}, slabHeight = ceilingHeight }) {
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

  // 天花板（含大樑、管線）：剖面模式時牆變矮，天花板一律依真正的樓板高度建，整組由 visible 控制
  const ceiling = buildCeilings(floorplan, { slabHeight, ceilingColor, ceilings });
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

const SLAB_THICKNESS = 0.15; // 樑標示的深度含樓板，樑在天花板下突出的是深度扣掉這個值
const COVE_MARGIN = 0.4; // 造型天花板四周下降帶的寬度
const COVE_RECESS = 0.12; // 中間內凹的高度

function plane(rect, y, material, faceDown = true) {
  const [x0, y0, x1, y1] = rect;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, y1 - y0), material);
  mesh.rotation.x = faceDown ? Math.PI / 2 : -Math.PI / 2;
  mesh.position.set((x0 + x1) / 2, y, -(y0 + y1) / 2);
  return mesh;
}

// 平面矩形 rect、從 bottom 到 top 的實心方塊（大樑、管線槽）
function slab(rect, bottom, top, material) {
  const [x0, y0, x1, y1] = rect;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, top - bottom, y1 - y0), material);
  mesh.position.set((x0 + x1) / 2, (bottom + top) / 2, -(y0 + y1) / 2);
  return mesh;
}

// 平釘、造型與其他區域交界處的封板側面：矩形四邊各一片，從 bottom 往上到 top
function bulkhead(rect, bottom, top, material) {
  const group = new THREE.Group();
  const [x0, y0, x1, y1] = rect;
  const h = top - bottom;
  if (h <= 0.001) return group;
  for (const [ax, ay, bx, by] of [[x0, y0, x1, y0], [x1, y0, x1, y1], [x1, y1, x0, y1], [x0, y1, x0, y0]]) {
    const len = Math.hypot(bx - ax, by - ay);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(len, h), material);
    face.position.set((ax + bx) / 2, bottom + h / 2, -(ay + by) / 2);
    face.rotation.y = Math.atan2(by - ay, bx - ax);
    group.add(face);
  }
  return group;
}

function buildCeilings(floorplan, { slabHeight, ceilingColor, ceilings }) {
  const group = new THREE.Group();
  group.name = 'ceiling';
  const paint = new THREE.MeshStandardMaterial({ color: ceilingColor, roughness: 0.95, side: THREE.DoubleSide });
  const concrete = new THREE.MeshStandardMaterial({ color: '#ffffff', map: proceduralTexture('concrete', '#c4c0b9'), roughness: 0.9, side: THREE.DoubleSide });
  const pipeMaterial = new THREE.MeshStandardMaterial({ color: '#8d9096', roughness: 0.5, metalness: 0.3 });
  const led = new THREE.MeshBasicMaterial({ color: '#ffe2b0' });
  for (const zone of ceilingZones(floorplan)) {
    const state = ceilingStateOf(ceilings, zone.id, floorplan);
    const exposed = state.type === 'exposed';
    const surface = exposed ? concrete : paint;
    const lowered = Math.min(state.height, slabHeight);
    for (const rect of zone.rects) {
      // 樓板底
      if (state.type !== 'flat') group.add(plane(rect, slabHeight - 0.002, surface));
      // 大樑：與這一區重疊的部分；平釘只露出比天花板還低的那段
      for (const beam of floorplan.beams ?? []) {
        const part = clipRect(rect, beam.rect);
        if (!part) continue;
        const bottom = Math.max(1.9, slabHeight - (beam.depth - SLAB_THICKNESS));
        const top = state.type === 'flat' ? lowered : slabHeight;
        if (bottom < top - 0.005) group.add(slab(part, bottom, top, surface));
      }
      if (state.type === 'flat') {
        group.add(plane(rect, lowered, paint));
        group.add(bulkhead(rect, lowered, slabHeight, paint));
      }
      if (state.type === 'cove') {
        // 四周一圈下降帶在 lowered，中間內凹往上 COVE_RECESS，交界處嵌一條暖色燈帶
        const [x0, y0, x1, y1] = rect;
        const inner = [x0 + COVE_MARGIN, y0 + COVE_MARGIN, x1 - COVE_MARGIN, y1 - COVE_MARGIN];
        const recessTop = Math.min(slabHeight, lowered + COVE_RECESS);
        if (inner[2] > inner[0] && inner[3] > inner[1]) {
          for (const band of [[x0, y0, x1, inner[1]], [x0, inner[3], x1, y1], [x0, inner[1], inner[0], inner[3]], [inner[2], inner[1], x1, inner[3]]]) {
            group.add(plane(band, lowered, paint));
          }
          group.add(plane(inner, recessTop, paint));
          group.add(bulkhead(inner, lowered, recessTop, paint));
          const glow = bulkhead([inner[0] + 0.02, inner[1] + 0.02, inner[2] - 0.02, inner[3] - 0.02], lowered + 0.01, lowered + 0.04, led);
          group.add(glow);
        } else {
          group.add(plane(rect, lowered, paint));
        }
        group.add(bulkhead(rect, lowered, slabHeight, paint));
      }
      // 不包：沿著這一區的長邊拉兩條外露管線
      if (exposed) {
        const [x0, y0, x1, y1] = rect;
        const alongX = x1 - x0 >= y1 - y0;
        const length = alongX ? x1 - x0 : y1 - y0;
        if (length > 1) {
          for (const offset of [0.25, 0.4]) {
            const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, length - 0.1, 10), pipeMaterial);
            pipe.rotation.z = alongX ? Math.PI / 2 : 0;
            pipe.rotation.x = alongX ? 0 : Math.PI / 2;
            const cx = alongX ? (x0 + x1) / 2 : x0 + offset;
            const cy = alongX ? y0 + offset : (y0 + y1) / 2;
            pipe.position.set(cx, slabHeight - 0.08, -cy);
            group.add(pipe);
          }
        }
      }
    }
  }
  return group;
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
