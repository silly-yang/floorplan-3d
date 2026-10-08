// 洞洞板：板子材質、孔距、掛牆高度、板上配件與檢查；單位公分，不依賴 Three.js
// 配件座標 (x, y) 是配件左下角在板子正面的位置，y 從板子下緣往上算

export const PEGBOARD_MATERIALS = [
  { id: 'wood', name: '木質', color: '#c8a27a' },
  { id: 'metal', name: '金屬烤漆', color: '#e6e7e8' },
  { id: 'plastic', name: '塑膠', color: '#f2f2ef' },
];

// jump：貓會跳上去站的台子，算進垂直間距檢查；貓抓板、一般配件不算
const accessory = (category, id, name, [w, h, d], color, { jump = false } = {}) => ({ id, name, category, size: { w, h, d }, color, jump });

export const PEGBOARD_ACCESSORIES = [
  accessory('general', 'shelf', '層板', [40, 3, 20], '#d9c3a0'),
  accessory('general', 'hook', '掛勾', [5, 10, 10], '#5b5f66'),
  accessory('general', 'storage-box', '收納盒', [20, 12, 12], '#9fb8c8'),
  accessory('general', 'basket', '置物籃', [30, 15, 15], '#7d8590'),
  accessory('general', 'pen-holder', '筆筒', [10, 12, 8], '#c9a27e'),
  accessory('general', 'tool-rack', '工具掛架', [30, 10, 8], '#4a4d52'),
  accessory('cat', 'cat-step', '貓跳板', [40, 3, 25], '#b8946a', { jump: true }),
  accessory('cat', 'cat-bed', '貓窩', [40, 30, 35], '#a98463', { jump: true }),
  accessory('cat', 'cat-scratcher', '貓抓板', [25, 50, 3], '#c9b38a'),
  accessory('cat', 'cat-bridge', '吊橋', [60, 8, 25], '#b08a62', { jump: true }),
  accessory('cat', 'cat-lookout', '觀景台', [45, 5, 35], '#bf9d74', { jump: true }),
];

export const BOARD_THICKNESS = 2;
export const MIN_BOARD = 20;
export const MAX_MOUNT = 300;
export const CAT_MAX_GAP = 50; // 上下兩個跳台頂面差超過這個值，一般家貓就跳得很勉強
export const PEGBOARD_TYPE = 'custom-pegboard';

const BY_ID = new Map(PEGBOARD_ACCESSORIES.map((a) => [a.id, a]));

export function getAccessory(type) {
  return BY_ID.get(type);
}

const clone = (board) => structuredClone(board);
// 孔距 2.5 這類小數一乘一除會冒出 12.499999，四捨五入到 0.01 cm
const round = (v) => Math.round(v * 100) / 100;
const snap = (v, pitch) => round(Math.round(v / pitch) * pitch);

// 對齊孔距後夾在板內；配件比板子大時貼齊左下
function place(board, spec, x, y) {
  const maxX = Math.max(0, Math.floor((board.size.w - spec.size.w) / board.pitch + 1e-9) * board.pitch);
  const maxY = Math.max(0, Math.floor((board.size.h - spec.size.h) / board.pitch + 1e-9) * board.pitch);
  return { x: round(Math.min(maxX, Math.max(0, snap(x, board.pitch)))), y: round(Math.min(maxY, Math.max(0, snap(y, board.pitch)))) };
}

const rectOf = (a) => {
  const { w, h } = getAccessory(a.type).size;
  return { x0: a.x, y0: a.y, x1: a.x + w, y1: a.y + h };
};
const overlapOf = (a, b) => ({ w: round(Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)), h: round(Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0)) });

// 由上往下、由左往右找第一個不壓到其他配件的孔位；都滿了就放左下
function freeSpot(board, spec) {
  const rects = board.accessories.filter((a) => getAccessory(a.type)).map(rectOf);
  const { x: maxX, y: maxY } = place(board, spec, Infinity, Infinity);
  for (let y = maxY; y >= 0; y = round(y - board.pitch)) {
    for (let x = 0; x <= maxX; x = round(x + board.pitch)) {
      const r = { x0: x, y0: y, x1: x + spec.size.w, y1: y + spec.size.h };
      if (rects.every((o) => { const ov = overlapOf(r, o); return ov.w <= 0 || ov.h <= 0; })) return { x, y };
    }
  }
  return { x: 0, y: 0 };
}

export function createPegboard({ id, name = '洞洞板', w = 120, h = 80 }) {
  return { id, name, size: { w, h }, material: 'wood', color: PEGBOARD_MATERIALS[0].color, pitch: 2.5, mountHeight: 90, accessories: [] };
}

// 沒給 x、y 時自動找空位（點選加入）；有給就對齊孔距（拖進板子）
export function addAccessory(board, type, { id, x, y } = {}) {
  const spec = getAccessory(type);
  if (!spec) throw new Error(`未知的洞洞板配件：${type}`);
  const next = clone(board);
  const pos = x === undefined || y === undefined ? freeSpot(board, spec) : place(board, spec, x, y);
  next.accessories.push({ id, type, ...pos });
  return next;
}

export function moveAccessory(board, accessoryId, { x, y }) {
  const next = clone(board);
  const target = next.accessories.find((a) => a.id === accessoryId);
  if (target) Object.assign(target, place(board, getAccessory(target.type), x, y));
  return next;
}

export function removeAccessory(board, accessoryId) {
  const next = clone(board);
  next.accessories = next.accessories.filter((a) => a.id !== accessoryId);
  return next;
}

// 配件不跟著搬：縮小後超出的由 pegboardIssues 提醒，讓使用者自己決定怎麼挪
export function resizePegboard(board, { w, h }) {
  const next = clone(board);
  next.size = { w: Math.max(MIN_BOARD, Math.round(w)), h: Math.max(MIN_BOARD, Math.round(h)) };
  return next;
}

export function updatePegboard(board, patch) {
  const next = { ...clone(board), ...patch };
  if (patch.material && patch.color === undefined) {
    next.color = PEGBOARD_MATERIALS.find((m) => m.id === patch.material)?.color ?? board.color;
  }
  if (patch.mountHeight !== undefined) next.mountHeight = Math.min(MAX_MOUNT, Math.max(0, Math.round(patch.mountHeight)));
  if (patch.pitch !== undefined) {
    next.pitch = patch.pitch > 0 ? patch.pitch : board.pitch;
    next.accessories = next.accessories.map((a) => ({ ...a, x: snap(a.x, next.pitch), y: snap(a.y, next.pitch) }));
  }
  return next;
}

const SIDES = [
  ['左側', (r) => -r.x0],
  ['右側', (r, b) => r.x1 - b.size.w],
  ['下方', (r) => -r.y0],
  ['上方', (r, b) => r.y1 - b.size.h],
];

// 回傳 [{ kind, accessoryIds, message }]
export function pegboardIssues(board) {
  const issues = [];
  const items = board.accessories.filter((a) => getAccessory(a.type)).map((a) => ({ a, spec: getAccessory(a.type), r: rectOf(a) }));

  for (const { a, spec, r } of items) {
    const over = SIDES.map(([side, fn]) => [side, round(fn(r, board))]).filter(([, v]) => v > 0);
    if (over.length) issues.push({ kind: 'out-of-bounds', accessoryIds: [a.id], message: `${spec.name}超出板子：${over.map(([s, v]) => `${s} ${v} cm`).join('、')}` });
  }

  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const ov = overlapOf(items[i].r, items[j].r);
      if (ov.w > 0 && ov.h > 0) {
        issues.push({ kind: 'overlap', accessoryIds: [items[i].a.id, items[j].a.id], message: `${items[i].spec.name}與${items[j].spec.name}重疊 ${ov.w}×${ov.h} cm` });
      }
    }
  }

  const cats = items.filter((it) => it.spec.category === 'cat');
  if (board.material === 'plastic' && cats.length) {
    const names = [...new Set(cats.map((c) => c.spec.name))].join('、');
    issues.push({
      kind: 'weak-board',
      accessoryIds: cats.map((c) => c.a.id),
      message: `塑膠洞洞板承重不足，撐不住貓跳上跳下（${names}）；建議改用木質或金屬，並用膨脹螺絲鎖在牆上`,
    });
  }

  // 依頂面高度排序，逐一檢查相鄰兩個跳台的高度差
  const steps = items.filter((it) => it.spec.jump).sort((p, q) => p.r.y1 - q.r.y1);
  for (let i = 1; i < steps.length; i++) {
    const gap = round(steps[i].r.y1 - steps[i - 1].r.y1);
    if (gap > CAT_MAX_GAP) {
      issues.push({
        kind: 'cat-gap',
        accessoryIds: [steps[i - 1].a.id, steps[i].a.id],
        message: `${steps[i - 1].spec.name}到${steps[i].spec.name}高度差 ${gap} cm，超過 ${CAT_MAX_GAP} cm（多 ${round(gap - CAT_MAX_GAP)} cm），貓不好跳，建議中間加一塊貓跳板`,
      });
    }
  }
  return issues;
}

// ---------- 存進方案、擺到場景 ----------

// 場景裡的外框：寬高同板子，深度＝板厚＋最深的配件
export function pegboardFootprint(board) {
  const depth = Math.max(0, ...board.accessories.map((a) => getAccessory(a.type)?.size.d ?? 0));
  return { w: board.size.w, d: Math.ceil(BOARD_THICKNESS + depth), h: board.size.h };
}

const sceneFields = (board) => ({ size: pegboardFootprint(board), color: board.color, elevation: board.mountHeight / 100 });

// 舊方案沒有 pegboards 欄位，當成空陣列；場景裡用到它的洞洞板一起更新外框與高度
export function savePegboardDesign(design, board) {
  const list = design.pegboards ?? [];
  const exists = list.some((p) => p.id === board.id);
  return {
    ...design,
    pegboards: exists ? list.map((p) => (p.id === board.id ? board : p)) : [...list, board],
    furniture: design.furniture.map((f) => (f.type === PEGBOARD_TYPE && f.pegboardId === board.id ? { ...f, ...sceneFields(board) } : f)),
  };
}

export function placePegboard(design, pegboardId, { id, x, y }) {
  const board = (design.pegboards ?? []).find((p) => p.id === pegboardId);
  if (!board) throw new Error(`找不到洞洞板設計（${pegboardId}）`);
  const item = { id, type: PEGBOARD_TYPE, pegboardId, x, y, rotation: 0, ...sceneFields(board) };
  return { ...design, furniture: [...design.furniture, item] };
}

// 設計刪掉後，場景裡的洞洞板就畫不出來了，所以一起移除
export function deletePegboardDesign(design, pegboardId) {
  return {
    ...design,
    pegboards: (design.pegboards ?? []).filter((p) => p.id !== pegboardId),
    furniture: design.furniture.filter((f) => !(f.type === PEGBOARD_TYPE && f.pegboardId === pegboardId)),
  };
}
