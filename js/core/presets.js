// 櫃子與洞洞板的預設樣式：用既有的建立／分割／配件函式組出設計，分割與檢查規則才會跟著走；單位公分
import { addItem, createCabinet, setCellHeight, setColumnWidth, splitCell, splitColumn, updateCell } from './cabinet.js';
import { addAccessory, createPegboard, updatePegboard } from './pegboard.js';

// 依序切出各欄寬度，最後一欄拿剩下的
function withColumns(cab, widths) {
  let next = cab;
  widths.slice(0, -1).forEach((width, col) => {
    next = setColumnWidth(splitColumn(next, col), col, width);
  });
  return next;
}

// cells 由下往上：{ h, kind, outlet, items }；最上面一格拿剩下的高度
function withCells(cab, col, cells) {
  let next = cab;
  cells.slice(0, -1).forEach(({ h }, cell) => {
    next = setCellHeight(splitCell(next, col, cell), col, cell, h);
  });
  cells.forEach(({ kind, outlet = 'none', items = [] }, cell) => {
    next = updateCell(next, col, cell, { kind, outlet });
    for (const type of items) next = addItem(next, col, cell, type);
  });
  return next;
}

const cabinetPreset = (id, name, description, size, columns) => ({
  id,
  name,
  description,
  build: ({ id: cabId, name: cabName }) => {
    const base = withColumns(createCabinet({ id: cabId, name: cabName, ...size }), columns.map((c) => c.width));
    return columns.reduce((cab, c, col) => withCells(cab, col, c.cells), base);
  },
});

const door = (h) => ({ h, kind: 'door' });
const drawer = (h) => ({ h, kind: 'drawer' });
const open = (h) => ({ h, kind: 'open' });
const SHELVES = [open(38), open(38), open(38), open(38), open()];

export const CABINET_PRESETS = [
  cabinetPreset('appliance-cabinet', '電器櫃', '下方抽屜、中段電鍋抽拉盤與微波爐家電格（110V）、上方門片', { w: 60, d: 60, h: 210 }, [
    { width: 60, cells: [drawer(70), { h: 48, kind: 'pullout', outlet: '110v', items: ['rice-cooker'] }, { h: 45, kind: 'appliance', outlet: '110v', items: ['microwave'] }, door()] },
  ]),
  cabinetPreset('tall-appliance-cabinet', '高身電器櫃', '嵌入蒸烤爐（220V）、氣炸鍋與咖啡機並排（110V），旁邊一欄窄高櫃', { w: 90, d: 60, h: 210 }, [
    { width: 64, cells: [drawer(40), { h: 50, kind: 'appliance', outlet: '220v', items: ['steam-oven'] }, { h: 45, kind: 'appliance', outlet: '110v', items: ['air-fryer', 'coffee-machine'] }, door()] },
    { width: 26, cells: [door(120), door()] },
  ]),
  cabinetPreset('wardrobe', '衣櫃', '左邊長版掛衣區，右邊抽屜加短版掛衣，上方門片放換季棉被', { w: 120, d: 60, h: 240 }, [
    { width: 60, cells: [open(192), door()] },
    { width: 60, cells: [drawer(60), open(132), door()] },
  ]),
  cabinetPreset('shoe-cabinet', '鞋櫃', '淺櫃門片，內部三層層板', { w: 90, d: 35, h: 110 }, [
    { width: 45, cells: [door(34), door(34), door()] },
    { width: 45, cells: [door(34), door(34), door()] },
  ]),
  cabinetPreset('bookcase', '書櫃', '兩欄開放層板，每欄五層', { w: 120, d: 35, h: 200 }, [
    { width: 60, cells: SHELVES },
    { width: 60, cells: SHELVES },
  ]),
  cabinetPreset('tv-cabinet', '電視下櫃', '兩側抽屜，中間開放格放機上盒、遊戲機（110V）', { w: 180, d: 45, h: 50 }, [
    { width: 60, cells: [drawer()] },
    { width: 60, cells: [{ kind: 'open', outlet: '110v' }] },
    { width: 60, cells: [drawer()] },
  ]),
];

// accessories：[type, x, y]，x、y 是配件左下角離板子左緣、下緣的距離
const pegboardPreset = (id, name, description, { w, h, material, mountHeight = 90 }, accessories) => ({
  id,
  name,
  description,
  build: ({ id: boardId, name: boardName, newId = () => crypto.randomUUID() }) => {
    const base = updatePegboard(createPegboard({ id: boardId, name: boardName, w, h }), { material, mountHeight });
    return accessories.reduce((board, [type, x, y]) => addAccessory(board, type, { id: newId(), x, y }), base);
  },
});

export const PEGBOARD_PRESETS = [
  pegboardPreset('entryway', '玄關收納', '掛鑰匙、包包與帽子，置物籃放口罩零錢', { w: 60, h: 90, material: 'wood' }, [
    ['shelf', 10, 80], ['basket', 15, 55],
    ['hook', 5, 30], ['hook', 20, 30], ['hook', 35, 30], ['hook', 50, 30],
  ]),
  pegboardPreset('kitchen', '廚房收納', '層板放調味料，掛勾吊鍋鏟湯杓', { w: 80, h: 60, material: 'metal' }, [
    ['shelf', 0, 50], ['shelf', 40, 50], ['storage-box', 5, 30],
    ['hook', 35, 10], ['hook', 47.5, 10], ['hook', 60, 10], ['hook', 72.5, 10],
  ]),
  pegboardPreset('desk-wall', '書桌工作牆', '書桌上方收文具、耳機與小物', { w: 120, h: 60, material: 'wood' }, [
    ['shelf', 40, 45], ['pen-holder', 10, 25], ['storage-box', 30, 25], ['storage-box', 55, 25], ['hook', 90, 25],
  ]),
  pegboardPreset('tool-wall', '工具牆', '工具掛架放螺絲起子，掛勾吊扳手、鉗子', { w: 120, h: 80, material: 'metal' }, [
    ['shelf', 40, 65], ['tool-rack', 5, 45], ['tool-rack', 85, 45],
    ['hook', 10, 20], ['hook', 30, 20], ['hook', 50, 20], ['hook', 65, 20], ['hook', 85, 20], ['hook', 105, 20],
  ]),
  // 跳台頂面由下往上 55.5 → 100 → 143 → 180，相鄰差都在貓跳得上去的範圍內
  pegboardPreset('cat-wall', '貓跳台牆', '貓抓板、跳板、觀景台、吊橋一路爬到頂端貓窩', { w: 60, h: 180, material: 'wood', mountHeight: 30 }, [
    ['cat-scratcher', 0, 0], ['cat-step', 20, 52.5], ['cat-lookout', 0, 95], ['cat-bridge', 0, 135], ['cat-bed', 20, 150],
  ]),
];
