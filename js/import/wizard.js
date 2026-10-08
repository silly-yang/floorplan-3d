// 匯入精靈：步驟狀態與每一步的計算；不碰 DOM，介面在 js/ui/importWizard.js
import { pointInPolygon, pointSegmentDistance } from '../core/geometry2d.js';
import { DxfFormatError, FloorplanError } from './errors.js';
import { guessLayerRoles } from './layers.js';
import { labels } from './openings.js';
import { inClip } from './walls.js';

export const STEPS = [
  { id: 'file', title: '選檔' },
  { id: 'clip', title: '框選範圍' },
  { id: 'layers', title: '指定圖層' },
  { id: 'units', title: '確認單位' },
  { id: 'preview', title: '預覽與命名' },
  { id: 'finish', title: '完成' },
];

// id 與轉換設定的 layers 欄位同名；none 不進設定
export const ROLES = [
  { id: 'rcWall', label: 'RC 牆' },
  { id: 'partition', label: '輕隔間' },
  { id: 'column', label: '柱' },
  { id: 'window', label: '窗' },
  { id: 'door', label: '門' },
  { id: 'beam', label: '樑' },
  { id: 'barrier', label: '欄杆' },
  { id: 'none', label: '不用' },
];
const LAYER_KEYS = ['rcWall', 'partition', 'column', 'window', 'door', 'barrier', 'beam'];
const WALL_ROLES = ['rcWall', 'partition', 'column'];
// 圖層名稱猜到的用途 → 精靈的用途；先列的優先
const GUESS_TO_ROLE = { wall: 'rcWall', window: 'window', door: 'door', beam: 'beam' };

export const UNITS = [
  { scale: 0.001, label: '公釐' },
  { scale: 0.01, label: '公分' },
  { scale: 1, label: '公尺' },
];
export const unitLabel = (scale) => UNITS.find((u) => u.scale === scale)?.label ?? `${scale} m`;

export const QUICK_ROOM_NAMES = ['客廳', '餐廳', '臥室', '主臥', '書房', '廚房', '浴室', '陽台'];

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_CLIP_SIDE = 200; // 公尺；房間偵測的格點跟著框選範圍長，框整張圖會讓瀏覽器卡死
// 公尺；與現有平面圖的設定相同
const GAP_MIN = 0.3;
const GAP_MAX = 2.5;
const DOOR_HEAD = 2.1;
const DOORWAY_HEAD = 2.2;
// 窗編號 D 開頭（DW4）是落地窗
const WINDOW_TYPE = { sill: 0.9, head: 2.1 };
const FLOOR_WINDOW_TYPE = { sill: 0, head: 2.2 };
const ARC_STEP = Math.PI / 18; // 圓弧每 10° 一段

// ---------- 步驟 ----------

const CHECKS = {
  file: (s) => (s.doc ? null : '請先選擇 DXF 檔'),
  clip: (s) => (countInClip(s.doc, s.clip) ? null : '框選範圍內沒有任何線條，請重新框出要的那一戶'),
  layers: (s) => (Object.values(s.roles).some((r) => WALL_ROLES.includes(r)) ? null : '至少要把一個圖層設成 RC 牆、輕隔間或柱，才找得到牆'),
  units: (s) => {
    if (!s.unitScale) return '請選擇圖面單位';
    const size = [s.clip.xMax - s.clip.xMin, s.clip.yMax - s.clip.yMin];
    if (Math.max(...size) * s.unitScale <= MAX_CLIP_SIDE) return null;
    return `框選範圍約 ${formatSize(size, s.unitScale)}，太大了；請回「框選範圍」只框出要的那一戶`;
  },
  preview: (s) => {
    if (!s.result) return '還沒有轉換結果，請回上一步重新確認';
    return s.result.floorplan.rooms.some((r) => !s.removed.includes(r.id)) ? null : '至少要保留一個房間';
  },
  finish: (s) => (s.name?.trim() ? null : '請輸入平面圖名稱'),
};

// 離開這一步前的檢查；通過回 null，否則回給使用者看的原因
export const stepError = (stepId, state) => CHECKS[stepId](state);

export function goNext(state) {
  const error = stepError(STEPS[state.step].id, state);
  if (error) return { ...state, error };
  return { ...state, step: Math.min(state.step + 1, STEPS.length - 1), error: null };
}

export const goBack = (state) => ({ ...state, step: Math.max(state.step - 1, 0), error: null });

// ---------- 選檔 ----------

export function checkFile({ name, size }) {
  const lower = name.toLowerCase();
  if (lower.endsWith('.dwg')) return '這是 DWG 檔，請先轉成 DXF（ASCII）再選；做法見下方說明';
  if (!lower.endsWith('.dxf')) return '請選擇 .dxf 檔';
  if (size > MAX_FILE_BYTES) return '檔案超過 50 MB，瀏覽器可能處理不了；請在 CAD 裡刪掉不需要的圖面再存一次';
  return null;
}

// ---------- 框選範圍 ----------

// 圖元上所有的 [x, y]；LINE 的終點、LWPOLYLINE 的每個頂點都算
function pointsOf(entity) {
  const xs = [...entity.all(10), ...entity.all(11)].map(Number);
  const ys = [...entity.all(20), ...entity.all(21)].map(Number);
  const points = [];
  for (let i = 0; i < Math.min(xs.length, ys.length); i += 1) {
    if (Number.isFinite(xs[i]) && Number.isFinite(ys[i])) points.push([xs[i], ys[i]]);
  }
  return points;
}

export function defaultClip(summary) {
  const boxes = summary.map((layer) => layer.bbox).filter(Boolean);
  if (!boxes.length) return null;
  return {
    xMin: Math.min(...boxes.map((b) => b[0])),
    yMin: Math.min(...boxes.map((b) => b[1])),
    xMax: Math.max(...boxes.map((b) => b[2])),
    yMax: Math.max(...boxes.map((b) => b[3])),
  };
}

export const clipFromCorners = (a, b) => ({
  xMin: Math.min(a[0], b[0]),
  yMin: Math.min(a[1], b[1]),
  xMax: Math.max(a[0], b[0]),
  yMax: Math.max(a[1], b[1]),
});

export const countInClip = (doc, clip) => doc.entities.filter((e) => pointsOf(e).some((p) => inClip(clip, p))).length;

// 畫布座標：螢幕 x = 圖面 x·k + tx，螢幕 y = −圖面 y·k + ty（圖面 y 朝上、畫布 y 朝下）
export function fitView([x0, y0, x1, y1], width, height, margin) {
  const k = Math.min((width - 2 * margin) / Math.max(x1 - x0, 1e-9), (height - 2 * margin) / Math.max(y1 - y0, 1e-9));
  return { k, tx: width / 2 - ((x0 + x1) / 2) * k, ty: height / 2 + ((y0 + y1) / 2) * k };
}

export const toScreen = ({ k, tx, ty }, [x, y]) => [x * k + tx, -y * k + ty];

export const toDrawing = ({ k, tx, ty }, [sx, sy]) => [(sx - tx) / k, (ty - sy) / k];

export function zoomAt(view, factor, cursor) {
  const [x, y] = toDrawing(view, cursor);
  const k = view.k * factor;
  return { k, tx: cursor[0] - x * k, ty: cursor[1] + y * k };
}

export const panBy = (view, dx, dy) => ({ ...view, tx: view.tx + dx, ty: view.ty + dy });

function arcPoints(entity, start, end) {
  const [cx, cy, r] = [entity.num(10), entity.num(20), entity.num(40)];
  const sweep = end > start ? end - start : end + 2 * Math.PI - start;
  const steps = Math.max(2, Math.ceil(sweep / ARC_STEP));
  return Array.from({ length: steps + 1 }, (_, i) => {
    const a = start + (sweep * i) / steps;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  });
}

const FOCUS_TRIM = 0.02;

// 線稿預覽一開始要看的範圍：x、y 各去掉頭尾 2% 的點；圖框外常有零星圖元，用全部外框會把圖縮成一點
export function focusBox(shapes) {
  const points = shapes.flatMap((s) => s.points);
  if (!points.length) return null;
  const xs = points.map((p) => p[0]).sort((a, b) => a - b);
  const ys = points.map((p) => p[1]).sort((a, b) => a - b);
  const cut = Math.floor(points.length * FOCUS_TRIM);
  const last = points.length - 1 - cut;
  return [xs[cut], ys[cut], xs[last], ys[last]];
}

const toRadians = (deg) => (deg * Math.PI) / 180;

// 線稿預覽用的折線 [{ layer, points }]；圖塊只標插入點，文字一律不畫
export function previewShapes(doc) {
  const shapes = [];
  for (const e of doc.entities) {
    let points = null;
    if (e.type === 'LINE') points = [[e.num(10), e.num(20)], [e.num(11), e.num(21)]];
    else if (e.type === 'LWPOLYLINE') {
      points = pointsOf(e);
      if (points.length && Number(e.first(70) ?? '0') & 1) points.push(points[0]);
    } else if (e.type === 'ARC') points = arcPoints(e, toRadians(e.num(50)), toRadians(e.num(51)));
    else if (e.type === 'CIRCLE') points = arcPoints(e, 0, 2 * Math.PI);
    else if (e.type === 'INSERT') points = [[e.num(10), e.num(20)]];
    if (points?.length) shapes.push({ layer: e.layer, points });
  }
  return shapes;
}

// ---------- 指定圖層 ----------

// 回傳 { 圖層名稱: 用途 id }，依摘要順序
export function initialRoles(summary) {
  const guessed = guessLayerRoles(summary);
  const roles = {};
  for (const layer of summary) {
    const hit = Object.keys(GUESS_TO_ROLE).find((key) => guessed[key].includes(layer.name));
    roles[layer.name] = hit ? GUESS_TO_ROLE[hit] : 'none';
  }
  return roles;
}

export function rolesToLayers(roles) {
  const layers = Object.fromEntries(LAYER_KEYS.map((key) => [key, []]));
  for (const [name, role] of Object.entries(roles)) layers[role]?.push(name);
  return layers;
}

// ---------- 確認單位 ----------

export function unitHint({ scale, source, headerScale }) {
  if (scale === null) return '判斷不出圖面單位，請手動選擇';
  if (source !== 'extent') return null;
  // 檔頭合理時 source 就是 header；走到這裡代表外框推出的單位與檔頭不同
  if (headerScale === null) return `檔頭沒有寫單位，看起來是${unitLabel(scale)}`;
  return `檔頭寫${unitLabel(headerScale)}，但看起來是${unitLabel(scale)}`;
}

// 牆圖層落在框選範圍內的外框寬、深（圖面單位）；沒有牆回 null
export function wallExtent(doc, layers, clip) {
  const names = WALL_ROLES.flatMap((key) => layers[key]);
  const points = doc.entities.filter((e) => names.includes(e.layer)).flatMap(pointsOf).filter((p) => inClip(clip, p));
  if (!points.length) return null;
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
}

export const formatSize = ([w, d], scale) => `${(w * scale).toFixed(1)} × ${(d * scale).toFixed(1)} m`;

// ---------- 組設定 ----------

// 公尺換圖面單位；toPrecision 去掉 0.3 / 0.001 這類除法的浮點尾數
const toDrawingUnits = (meters, unitScale) => Number((meters / unitScale).toPrecision(12));

export function windowLabels(doc, windowLayers, clip) {
  return [...new Set(labels(doc, windowLayers, clip).map(([, label]) => label))].sort();
}

// 房間不給種子，交給自動偵測；窗高依編號猜
export function buildConfig({ clip, roles, unitScale, beamLabelScale, windowLabels: windowNames }) {
  return {
    unitScale,
    beamLabelScale,
    clip,
    layers: rolesToLayers(roles),
    windowTypes: Object.fromEntries(windowNames.map((label) => [label, { ...(label.startsWith('D') ? FLOOR_WINDOW_TYPE : WINDOW_TYPE) }])),
    unlabeledWindow: { ...WINDOW_TYPE },
    doorHead: DOOR_HEAD,
    doorwayHead: DOORWAY_HEAD,
    gapMin: toDrawingUnits(GAP_MIN, unitScale),
    gapMax: toDrawingUnits(GAP_MAX, unitScale),
    rooms: [],
    ignoreOpenings: [],
  };
}

// ---------- 預覽與命名 ----------

// 名稱只用使用者輸入的；留空就保留自動編號
export function applyRoomEdits(floorplan, { names = {}, removed = [] }) {
  const rooms = floorplan.rooms
    .filter((room) => !removed.includes(room.id))
    .map((room) => ({ ...room, name: names[room.id]?.trim() || room.name }));
  return { ...floorplan, rooms };
}

export function roomAt(rooms, [x, y]) {
  const hit = rooms.find((room) => room.rects.some(([x0, y0, x1, y1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1));
  return hit ? hit.id : null;
}

// 點擊位置的窗 id；窗只有牆厚那麼窄，離邊 tolerance（公尺）以內也算點到
export function windowAt(openings, point, tolerance) {
  const near = (polygon) =>
    pointInPolygon(point, polygon) || polygon.some((a, i) => pointSegmentDistance(point, a, polygon[(i + 1) % polygon.length]) <= tolerance);
  return openings.find((o) => o.kind === 'window' && near(o.polygon))?.id ?? null;
}

export const WINDOW_HEIGHT_MAX = 3;

export function windowHeightError(sill, head) {
  const inRange = (v) => Number.isFinite(v) && v >= 0 && v <= WINDOW_HEIGHT_MAX;
  if (!inRange(sill)) return `窗台要在 0～${WINDOW_HEIGHT_MAX} m 之間`;
  if (!inRange(head)) return `窗頂要在 0～${WINDOW_HEIGHT_MAX} m 之間`;
  if (sill >= head) return '窗台要低於窗頂';
  return null;
}

// edits：{ 開口 id: { sill, head } }；只改窗
export function applyWindowEdits(floorplan, edits) {
  const openings = floorplan.openings.map((o) => (o.kind === 'window' && edits[o.id] ? { ...o, sill: edits[o.id].sill, head: edits[o.id].head } : o));
  return { ...floorplan, openings };
}

export function summarizeFloorplan(floorplan) {
  const count = (kind) => floorplan.openings.filter((o) => o.kind === kind).length;
  return {
    walls: floorplan.walls.length,
    doors: count('door'),
    windows: count('window'),
    doorways: count('doorway'),
    rooms: floorplan.rooms.length,
    beams: floorplan.beams.length,
  };
}

// ---------- 錯誤說明 ----------

export function explainError(error) {
  if (error instanceof DxfFormatError) return `${error.message}\n請確認存成 DXF（ASCII）格式，不是 DWG 或二進位 DXF`;
  if (error instanceof FloorplanError) return error.message;
  return `發生非預期的錯誤：${error.message}`;
}
