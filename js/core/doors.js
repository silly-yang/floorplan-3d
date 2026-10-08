// 門：每個開口可裝的門型、預設值、開關時門片的位置；不依賴 Three.js
import { openingAxis } from './floorplan.js';

export const DOOR_TYPES = [
  { id: 'none', name: '無門', icon: 'door-none' },
  { id: 'hinged', name: '一般門', icon: 'door-hinged' },
  { id: 'sliding', name: '拉門', icon: 'door-sliding' },
  { id: 'glass-sliding', name: '陽台玻璃門', icon: 'door-glass' },
];

const LEAF_GAP = 0.01; // 門片與門框的縫
const LEAF_THICKNESS = 0.04;
const SLIDER_THICKNESS = 0.03;
const TRACK_OFFSET = 0.02; // 玻璃門兩條軌道各離中線多遠
const PROBE_DISTANCE = 0.4; // 判斷開口兩側是哪個房間時，往外探多遠

// 落地窗（窗台高 0）可以當門用；有窗台的窗戶不能裝門
const isFloorLevel = (opening) => opening.sill <= 0.001;

export function doorOptions(opening) {
  if (opening.kind === 'window') return isFloorLevel(opening) ? ['none', 'sliding', 'glass-sliding'] : [];
  return ['none', 'hinged', 'sliding'];
}

export function defaultDoor(opening) {
  const type = { door: 'hinged', doorway: 'none' }[opening.kind] ?? (isFloorLevel(opening) ? 'glass-sliding' : 'none');
  return { type, open: false, flip: false, out: false };
}

// doors 為設計裡的 { [openingId]: { type, open, flip } }；沒設定的開口用預設值
export function doorStateOf(doors, opening) {
  return { ...defaultDoor(opening), ...(doors?.[opening.id] ?? {}) };
}

export function blocksPassage(state) {
  return state.type !== 'none' && !state.open;
}

const add = (p, v, s) => [p[0] + v[0] * s, p[1] + v[1] * s];
const angleOf = (v) => (Math.atan2(v[1], v[0]) * 180) / Math.PI;

function hinged(axis, opening, state, progress) {
  const { start, dir, across, width } = axis;
  const dirFromHinge = state.flip ? [-dir[0], -dir[1]] : dir;
  const hinge = add(state.flip ? add(start, dir, width) : start, dirFromHinge, LEAF_GAP);
  const theta = (Math.PI / 2) * progress;
  // 門片從沿牆方向往 across 那一側轉開
  const leafDir = [
    Math.cos(theta) * dirFromHinge[0] + Math.sin(theta) * across[0],
    Math.cos(theta) * dirFromHinge[1] + Math.sin(theta) * across[1],
  ];
  const leafWidth = width - LEAF_GAP * 2;
  return [{ center: add(hinge, leafDir, leafWidth / 2), width: leafWidth, thickness: LEAF_THICKNESS, rotation: angleOf(leafDir), glass: false }];
}

function sliding(axis, opening, state, progress) {
  const { start, dir, across, width, thickness } = axis;
  const slideDir = state.flip ? [-dir[0], -dir[1]] : dir;
  // 拉門掛在牆面外側，比開口稍寬，打開時滑到牆前面
  const panelWidth = width + 0.06;
  const closedCenter = add(add(start, dir, width / 2), across, thickness / 2 + SLIDER_THICKNESS);
  return [{ center: add(closedCenter, slideDir, panelWidth * 0.95 * progress), width: panelWidth, thickness: SLIDER_THICKNESS, rotation: angleOf(dir), glass: false }];
}

function glassSliding(axis, opening, state, progress) {
  const { start, dir, across, width } = axis;
  const panelWidth = width / 2 + 0.03;
  const near = add(add(start, dir, width / 4), across, -TRACK_OFFSET);
  const far = add(add(start, dir, (width * 3) / 4), across, TRACK_OFFSET);
  // 一片固定、另一片滑到它後面；反向時換另一片滑動
  const [fixed, moving, toward] = state.flip ? [far, near, dir] : [near, far, [-dir[0], -dir[1]]];
  const panel = (center) => ({ center, width: panelWidth, thickness: SLIDER_THICKNESS, rotation: angleOf(dir), glass: true });
  return [panel(fixed), panel(add(moving, toward, (width / 2) * progress))];
}

const BUILDERS = { hinged, sliding, 'glass-sliding': glassSliding };

// progress：0＝全關、1＝全開；side 為 swingSide 的結果，out 時改往另一側
// 回傳每片門板的平面位置與尺寸（公尺、角度為逆時針度數）
export function doorPanels(opening, state, progress, side = 1) {
  const build = BUILDERS[state.type];
  if (!build) return [];
  const axis = openingAxis(opening.polygon);
  const sign = side * (state.out ? -1 : 1);
  const facing = { ...axis, across: [axis.across[0] * sign, axis.across[1] * sign] };
  const height = opening.head - opening.sill - LEAF_GAP;
  return build(facing, opening, state, progress).map((p) => ({ ...p, bottom: opening.sill, height }));
}

// 門往哪一側開：+1＝開口 across 方向、-1＝反方向；朝房間開，兩側都是房間時朝小的那間
export function swingSide(opening, rooms) {
  const { start, dir, across, width } = openingAxis(opening.polygon);
  const mid = add(start, dir, width / 2);
  const roomAt = (side) => {
    const probe = add(mid, across, side * PROBE_DISTANCE);
    return rooms.find((r) => r.rects.some(([x0, y0, x1, y1]) => probe[0] >= x0 && probe[0] <= x1 && probe[1] >= y0 && probe[1] <= y1));
  };
  const area = (room) => room.rects.reduce((sum, [x0, y0, x1, y1]) => sum + (x1 - x0) * (y1 - y0), 0);
  const ahead = roomAt(1);
  const behind = roomAt(-1);
  if (ahead && behind) return area(behind) < area(ahead) ? -1 : 1;
  if (behind) return -1;
  return 1;
}
