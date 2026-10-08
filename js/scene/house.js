// 由 floorplan.json 建出房屋的 Three.js 物件：牆、窗台、楣樑、玻璃、地板
import * as THREE from 'three';
import { buildGlass, buildSolids, openingAxis } from '../core/floorplan.js';
import { COVE_MARGIN, COVE_RECESS, ceilingStateOf, ceilingZones, clipRect } from '../core/ceilings.js';
import { floorMaterialOf } from '../core/materials.js';
import { clipRuns, wallFaceRuns } from '../core/trim.js';
import { buildCeilingServices } from './ceilingServices.js';
import { sizedTexture, proceduralTexture } from './textures.js';
import { applyFloorTexture, applyWallFinish } from './assetTextures.js';
import { trimMesh } from './trimGeometry.js';


const BASEBOARD_HEIGHT = 0.08;
const BASEBOARD_THICKNESS = 0.012;
const FRAME_WIDTH = 0.045;
// 踢腳板斷面：上緣外側倒一個小斜角，打光時看得出板子的厚度
const BASEBOARD_PROFILE = [[0, 0], [BASEBOARD_THICKNESS, 0], [BASEBOARD_THICKNESS, BASEBOARD_HEIGHT - 0.006], [BASEBOARD_THICKNESS - 0.004, BASEBOARD_HEIGHT], [0, BASEBOARD_HEIGHT]];
// 天花板線板：牆與平釘天花板交接處的內凹弧形，高、深各 6 cm；h 從天花板往下量
const CROWN_SIZE = 0.06;
const CROWN_PROFILE = [
  [0, -CROWN_SIZE],
  ...Array.from({ length: 7 }, (_, i) => {
    const t = Math.PI - (Math.PI / 2) * (i / 6);
    return [CROWN_SIZE + CROWN_SIZE * Math.cos(t), -CROWN_SIZE + CROWN_SIZE * Math.sin(t)];
  }).slice(1),
  [0, 0],
];

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
  applyWallFinish(Object.values(wallMaterials));
  const wallMeshes = [];
  for (const solid of buildSolids(floorplan, ceilingHeight)) {
    const mesh = extrude(solid.polygon, solid.bottom, solid.top, wallMaterials[solid.kind] ?? wallMaterials.rc);
    mesh.name = solid.id;
    mesh.userData.kind = solid.kind;
    wallMeshes.push(mesh);
    group.add(mesh);
  }
  const wallFade = wallFader(wallMeshes, paint);

  // 玻璃：本身偏淡、反射加強，看得到窗外也看得到室內的倒影
  const glassMaterial = new THREE.MeshPhysicalMaterial({
    color: '#b4cddb',
    transparent: true,
    opacity: 0.24,
    roughness: 0.03,
    envMapIntensity: 2.5,
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
      // 有寫實貼圖的材質載入後換上，期間與失敗時維持程式紋理
      applyFloorTexture(material, look, [x0, y0, x1, y1], rooms?.[room.id]?.floorColor);
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

  group.add(buildBaseboards(floorplan));
  group.add(buildFrames(floorplan));

  // 天花板（含大樑、天花板設備）：剖面模式時牆變矮，天花板一律依真正的樓板高度建，整組由 visible 控制
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

  return { group, floors, wallMeshes, ceiling, wallFade };
}

const FADED_OPACITY = 0.2;

// 牆材質依牆種共用，淡化改成換上一份共用的半透明材質，才不會連帶沒被擋的牆
// 不寫深度：後面的家具照樣畫得出來；mesh.userData.faded 讓射線檢測略過
// 拆掉房子前先 dispose：換回原材質，disposeObject 才釋放得到
function wallFader(wallMeshes, paint) {
  const faded = new THREE.MeshStandardMaterial({
    color: WALL_COLORS.rc,
    roughness: 0.92,
    map: paint,
    transparent: true,
    opacity: FADED_OPACITY,
    depthWrite: false,
  });
  applyWallFinish([faded]);
  const apply = (ids) => {
    for (const mesh of wallMeshes) {
      const fade = ids.has(mesh.name);
      if (fade === Boolean(mesh.userData.faded)) continue;
      if (fade) mesh.userData.baseMaterial = mesh.material;
      mesh.material = fade ? faded : mesh.userData.baseMaterial;
      mesh.userData.faded = fade;
    }
  };
  return {
    apply,
    dispose: () => {
      apply(new Set());
      faded.dispose();
    },
  };
}

const SLAB_THICKNESS = 0.15; // 樑標示的深度含樓板，樑在天花板下突出的是深度扣掉這個值

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
  const led = new THREE.MeshBasicMaterial({ color: '#ffe2b0' });
  const flatZones = [];
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
        flatZones.push({ rect, height: lowered });
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
          glow.name = 'cove-led'; // 夜晚模式靠這個名字找燈帶調亮
          group.add(glow);
        } else {
          group.add(plane(rect, lowered, paint));
        }
        group.add(bulkhead(rect, lowered, slabHeight, paint));
      }
    }
  }
  group.add(buildCrownMolding(floorplan, flatZones, paint));
  group.add(buildCeilingServices(floorplan, { slabHeight, ceilings }));
  // 漫遊時天花板才顯示，這時要擋住從上面來的陽光，光只從窗戶進來
  group.traverse((o) => {
    if (o.isMesh && !o.material.isMeshBasicMaterial) o.castShadow = true;
  });
  return group;
}

// 窗戶上方的楣樑也是牆面，線板要接著通過；楣樑比線板還低才算
function buildCrownMolding(floorplan, zones, material) {
  const lintels = floorplan.openings.map((o) => ({ id: o.id, kind: 'lintel', polygon: o.polygon, head: o.head }));
  const pieces = clipRuns(wallFaceRuns([...floorplan.walls, ...lintels]), zones).filter((piece) => {
    const lintel = lintels.find((l) => l.id === piece.wallId);
    return !lintel || lintel.head <= piece.height - CROWN_SIZE;
  });
  const mesh = trimMesh(pieces, CROWN_PROFILE, (piece) => piece.height, material);
  mesh.name = 'crown-molding';
  return mesh;
}

// 踢腳板：沿每道牆的牆面（牆端面太短不貼），轉角斜切接合；窗台下的矮牆也要貼
function buildBaseboards(floorplan) {
  const group = new THREE.Group();
  group.name = 'baseboards';
  const material = new THREE.MeshStandardMaterial({ color: '#f7f5f0', roughness: 0.5 });
  const sills = floorplan.openings.filter((o) => o.sill >= BASEBOARD_HEIGHT).map((o) => ({ id: o.id, kind: 'sill', polygon: o.polygon }));
  const board = trimMesh(wallFaceRuns([...floorplan.walls, ...sills]), BASEBOARD_PROFILE, () => 0, material);
  board.receiveShadow = true;
  group.add(board);
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
