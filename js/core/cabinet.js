// 系統櫃：欄（左右）× 格（上下）的格狀結構、每格的類型與插座、格內家電、檢查；單位公分，不依賴 Three.js
import { CATALOG, getCatalogItem } from '../furniture/catalog.js';

export const PLINTH = 8; // 底部踢腳高度
export const MIN_SPAN = 20; // 每欄最窄、每格最矮
const BACK_PANEL = 2; // 背板與留縫，家電可用深度＝櫃深－這個值
const SIDE_GAP = 2; // 同一格並排家電之間、與側板之間的留縫

// 系統櫃設計器可以放進格子的家電：檯面家電，排除目錄標了 cabinetItem: false 的（電視）
export function cabinetAppliances() {
  return CATALOG.filter((c) => c.category === 'appliance' && c.placement === 'surface' && c.cabinetItem);
}

export const CELL_KINDS = [
  { id: 'door', name: '門片' },
  { id: 'drawer', name: '抽屜' },
  { id: 'open', name: '開放層板' },
  { id: 'appliance', name: '家電格' },
  { id: 'pullout', name: '抽拉盤' },
];
export const OUTLETS = [
  { id: 'none', name: '無插座' },
  { id: '110v', name: '110V' },
  { id: '220v', name: '220V' },
];

const clone = (cab) => structuredClone(cab);

// 把 total 依原本比例分給各段，四捨五入後最後一段補差，總和一定等於 total
function scaleSpans(spans, total) {
  const old = spans.reduce((s, v) => s + v, 0) || 1;
  const scaled = spans.map((v) => Math.round((v * total) / old));
  scaled[scaled.length - 1] = total - scaled.slice(0, -1).reduce((s, v) => s + v, 0);
  return scaled;
}

const emptyCell = (height, kind = 'door') => ({ height, kind, outlet: 'none', items: [] });

export function createCabinet({ id, name = '系統櫃', w = 120, d = 60, h = 210 }) {
  return { id, name, size: { w, d, h }, columns: [{ width: w, cells: [emptyCell(h - PLINTH)] }] };
}

export function splitColumn(cab, col) {
  const next = clone(cab);
  const column = next.columns[col];
  const left = Math.floor(column.width / 2);
  const right = column.width - left;
  column.width = left;
  next.columns.splice(col + 1, 0, { width: right, cells: [emptyCell(cab.size.h - PLINTH, column.cells[0].kind)] });
  return next;
}

export function splitCell(cab, col, cell) {
  const next = clone(cab);
  const cells = next.columns[col].cells;
  const lower = Math.floor(cells[cell].height / 2);
  const upper = cells[cell].height - lower;
  cells[cell].height = lower;
  cells.splice(cell + 1, 0, emptyCell(upper, cells[cell].kind));
  return next;
}

// 刪掉的那段長度併給隔壁（優先左／下方）；只剩一段時不刪
function removeSpan(list, index, key) {
  if (list.length <= 1) return;
  const neighbor = index > 0 ? index - 1 : 1;
  list[neighbor][key] += list[index][key];
  list.splice(index, 1);
}

export function removeColumn(cab, col) {
  const next = clone(cab);
  removeSpan(next.columns, col, 'width');
  return next;
}

export function removeCell(cab, col, cell) {
  const next = clone(cab);
  removeSpan(next.columns[col].cells, cell, 'height');
  return next;
}

// 調整一段的長度，由隔壁（優先右／上方）吸收差額；兩段都不小於 MIN_SPAN
function setSpan(list, index, value, key) {
  if (list.length <= 1) return;
  const neighbor = index < list.length - 1 ? index + 1 : index - 1;
  const total = list[index][key] + list[neighbor][key];
  const clamped = Math.min(total - MIN_SPAN, Math.max(MIN_SPAN, Math.round(value)));
  list[index][key] = clamped;
  list[neighbor][key] = total - clamped;
}

export function setColumnWidth(cab, col, width) {
  const next = clone(cab);
  setSpan(next.columns, col, width, 'width');
  return next;
}

export function setCellHeight(cab, col, cell, height) {
  const next = clone(cab);
  setSpan(next.columns[col].cells, cell, height, 'height');
  return next;
}

export function resizeCabinet(cab, size) {
  const next = clone(cab);
  next.size = { ...size };
  scaleSpans(next.columns.map((c) => c.width), size.w).forEach((w, i) => (next.columns[i].width = w));
  for (const column of next.columns) {
    scaleSpans(column.cells.map((c) => c.height), size.h - PLINTH).forEach((h, i) => (column.cells[i].height = h));
  }
  return next;
}

export function updateCell(cab, col, cell, patch) {
  const next = clone(cab);
  Object.assign(next.columns[col].cells[cell], patch);
  return next;
}

export function addItem(cab, col, cell, type) {
  const next = clone(cab);
  next.columns[col].cells[cell].items.push({ type });
  return next;
}

export function removeItem(cab, col, cell, index) {
  const next = clone(cab);
  next.columns[col].cells[cell].items.splice(index, 1);
  return next;
}

// 格子在櫃體正面的位置：x 從左、y 從地面算起
export function cellBox(cab, col, cell) {
  const x = cab.columns.slice(0, col).reduce((s, c) => s + c.width, 0);
  const cells = cab.columns[col].cells;
  const y = PLINTH + cells.slice(0, cell).reduce((s, c) => s + c.height, 0);
  return { x, y, w: cab.columns[col].width, h: cells[cell].height };
}

const VOLTAGE_OF = { '110v': 110, '220v': 220 };

// 每格逐項檢查；回傳 [{ col, cell, item?, kind, message }]
export function cabinetIssues(cab) {
  const issues = [];
  cab.columns.forEach((column, col) => {
    column.cells.forEach((c, cell) => {
      const appliances = c.items.map((it, index) => ({ index, spec: getCatalogItem(it.type) })).filter((a) => a.spec);
      if (appliances.length === 0) return;
      const add = (kind, message, item) => issues.push({ col, cell, ...(item === undefined ? {} : { item }), kind, message });
      if (c.kind === 'door' || c.kind === 'drawer') add('closed-cell', '家電放在有門片／抽屜的格子，使用時要開門、散熱也差，建議改成家電格或開放層板');
      const needed = appliances.reduce((s, a) => s + a.spec.size.w, 0) + SIDE_GAP * (appliances.length + 1);
      if (needed > column.width) add('too-wide', `並排需要 ${needed} cm，格子只有 ${column.width} cm（差 ${needed - column.width} cm）`);
      for (const { index, spec } of appliances) {
        if (spec.size.h > c.height) add('too-tall', `${spec.name}高 ${spec.size.h} cm，格子只有 ${c.height} cm（差 ${spec.size.h - c.height} cm）`, index);
        else if (c.height - spec.size.h < (spec.vent ?? 0)) {
          const hint = c.kind === 'pullout' ? '；使用時抽出來可以改善' : '';
          add('vent', `${spec.name}上方建議留 ${spec.vent} cm 散熱，目前只剩 ${c.height - spec.size.h} cm${hint}`, index);
        }
        const usable = cab.size.d - BACK_PANEL;
        if (spec.size.d > usable) add('too-deep', `${spec.name}深 ${spec.size.d} cm，櫃內可用深度只有 ${usable} cm（差 ${spec.size.d - usable} cm）`, index);
      }
      const voltages = [...new Set(appliances.map((a) => a.spec.power?.voltage).filter(Boolean))];
      if (voltages.length === 0) return;
      if (c.outlet === 'none') add('no-outlet', `這一格沒有插座，${appliances.map((a) => a.spec.name).join('、')}需要 ${voltages.join('／')}V`);
      else if (!voltages.includes(VOLTAGE_OF[c.outlet])) add('wrong-voltage', `這一格是 ${VOLTAGE_OF[c.outlet]}V 插座，但家電需要 ${voltages.join('／')}V`);
    });
  });
  return issues;
}

// ---------- 存進方案、擺到場景 ----------

export const CABINET_TYPE = 'custom-cabinet';
const CABINET_COLOR = '#e9e4dc';

// 新的就加入、同 id 就覆蓋；場景裡用到它的櫃子尺寸一起更新
export function saveCabinetDesign(design, cab) {
  const exists = design.cabinets.some((c) => c.id === cab.id);
  return {
    ...design,
    cabinets: exists ? design.cabinets.map((c) => (c.id === cab.id ? cab : c)) : [...design.cabinets, cab],
    furniture: design.furniture.map((f) => (f.type === CABINET_TYPE && f.cabinetId === cab.id ? { ...f, size: { ...cab.size } } : f)),
  };
}

export function placeCabinet(design, cabinetId, { id, x, y }) {
  const cab = design.cabinets.find((c) => c.id === cabinetId);
  if (!cab) throw new Error(`找不到櫃子設計（${cabinetId}）`);
  const item = { id, type: CABINET_TYPE, cabinetId, x, y, rotation: 0, size: { ...cab.size }, color: CABINET_COLOR };
  return { ...design, furniture: [...design.furniture, item] };
}

// 設計刪掉後，場景裡的櫃子就畫不出來了，所以一起移除
export function deleteCabinetDesign(design, cabinetId) {
  return {
    ...design,
    cabinets: design.cabinets.filter((c) => c.id !== cabinetId),
    furniture: design.furniture.filter((f) => !(f.type === CABINET_TYPE && f.cabinetId === cabinetId)),
  };
}
