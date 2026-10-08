import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PLINTH,
  addItem,
  cabinetIssues,
  cellBox,
  createCabinet,
  removeCell,
  removeColumn,
  removeItem,
  resizeCabinet,
  setCellHeight,
  setColumnWidth,
  splitCell,
  splitColumn,
  updateCell,
} from '../../js/core/cabinet.js';

const base = () => createCabinet({ id: 'c1', name: '家電櫃', w: 120, d: 60, h: 210 });
const widths = (cab) => cab.columns.map((c) => c.width);
const heights = (cab, col) => cab.columns[col].cells.map((c) => c.height);
const sum = (a) => a.reduce((s, v) => s + v, 0);

test('createCabinet 預設一欄一格、格高扣掉踢腳', () => {
  // Act
  const cab = base();

  // Assert
  assert.deepEqual(cab.size, { w: 120, d: 60, h: 210 });
  assert.deepEqual(widths(cab), [120]);
  assert.deepEqual(heights(cab, 0), [210 - PLINTH]);
  assert.deepEqual(cab.columns[0].cells[0], { height: 202, kind: 'door', outlet: 'none', items: [] });
});

test('splitColumn 把一欄對半分成兩欄，總寬不變', () => {
  // Act
  const cab = splitColumn(base(), 0);

  // Assert
  assert.deepEqual(widths(cab), [60, 60]);
  assert.equal(cab.columns[1].cells.length, 1);
});

test('splitCell 把一格對半分成上下兩格，總高不變、不改原物件', () => {
  // Arrange
  const original = base();

  // Act
  const cab = splitCell(original, 0, 0);

  // Assert
  assert.deepEqual(heights(cab, 0), [101, 101]);
  assert.deepEqual(heights(original, 0), [202]);
});

test('removeColumn 刪掉的寬度併給隔壁；只剩一欄時不能刪', () => {
  // Arrange
  const two = splitColumn(base(), 0);

  // Act
  const one = removeColumn(two, 1);

  // Assert
  assert.deepEqual(widths(one), [120]);
  assert.deepEqual(widths(removeColumn(one, 0)), [120]);
});

test('removeCell 刪掉的高度併給同一欄的隔壁格', () => {
  // Arrange
  const cab = splitCell(splitCell(base(), 0, 0), 0, 0);

  // Act
  const after = removeCell(cab, 0, 1);

  // Assert
  assert.equal(sum(heights(after, 0)), 202);
  assert.equal(after.columns[0].cells.length, 2);
});

test('setColumnWidth 調寬一欄時由右邊那欄吸收差額，總寬不變', () => {
  // Arrange
  const cab = splitColumn(base(), 0);

  // Act
  const after = setColumnWidth(cab, 0, 45);

  // Assert
  assert.deepEqual(widths(after), [45, 75]);
});

test('setColumnWidth 不能把隔壁擠到比最小寬度還窄', () => {
  // Arrange
  const cab = splitColumn(base(), 0);

  // Act
  const after = setColumnWidth(cab, 0, 110);

  // Assert
  assert.deepEqual(widths(after), [100, 20]);
});

test('setCellHeight 調高一格時由上面那格吸收差額；最上面一格改由下面吸收', () => {
  // Arrange
  const cab = splitCell(base(), 0, 0);

  // Act
  const bottom = setCellHeight(cab, 0, 0, 45);
  const top = setCellHeight(cab, 0, 1, 45);

  // Assert
  assert.deepEqual(heights(bottom, 0), [45, 157]);
  assert.deepEqual(heights(top, 0), [157, 45]);
});

test('resizeCabinet 依比例縮放各欄寬與各格高，總和等於新尺寸', () => {
  // Arrange
  const cab = setColumnWidth(splitColumn(splitCell(base(), 0, 0), 0), 0, 40);

  // Act
  const after = resizeCabinet(cab, { w: 180, d: 45, h: 240 });

  // Assert
  assert.deepEqual(after.size, { w: 180, d: 45, h: 240 });
  assert.equal(sum(widths(after)), 180);
  assert.equal(sum(heights(after, 0)), 240 - PLINTH);
  assert.equal(after.columns[0].width, 60);
});

test('cellBox 回傳格子在櫃體正面的位置（含踢腳）', () => {
  // Arrange
  const cab = splitCell(splitColumn(base(), 0), 1, 0);

  // Act
  const box = cellBox(cab, 1, 1);

  // Assert
  assert.deepEqual(box, { x: 60, y: PLINTH + 101, w: 60, h: 101 });
});

test('addItem／removeItem 在格子裡放入與拿掉家電', () => {
  // Arrange
  const cab = base();

  // Act
  const added = addItem(addItem(cab, 0, 0, 'microwave'), 0, 0, 'air-fryer');
  const removed = removeItem(added, 0, 0, 0);

  // Assert
  assert.deepEqual(added.columns[0].cells[0].items.map((i) => i.type), ['microwave', 'air-fryer']);
  assert.deepEqual(removed.columns[0].cells[0].items.map((i) => i.type), ['air-fryer']);
});

// 家電格、110V、高 50 cm、寬 60 的櫃子
const applianceCell = (over = {}) => {
  let cab = createCabinet({ id: 'c', w: 60, d: 60, h: 58 });
  cab = updateCell(cab, 0, 0, { kind: 'appliance', outlet: '110v', ...over });
  return cab;
};
const kinds = (cab) => cabinetIssues(cab).map((i) => i.kind).sort();

test('cabinetIssues 微波爐放進有 110V 的家電格、空間足夠時沒有問題', () => {
  // Act & Assert
  assert.deepEqual(kinds(addItem(applianceCell(), 0, 0, 'microwave')), []);
});

for (const [name, over, type, expected] of [
  ['沒有插座', { outlet: 'none' }, 'microwave', ['no-outlet']],
  ['電壓不符（110V 家電放 220V 插座格）', { outlet: '220v' }, 'microwave', ['wrong-voltage']],
  ['放在有門的格子', { kind: 'door' }, 'microwave', ['closed-cell']],
]) {
  test(`cabinetIssues ${name}`, () => {
    // Act & Assert
    assert.deepEqual(kinds(addItem(applianceCell(over), 0, 0, type)), expected);
  });
}

test('cabinetIssues 兩台並排太寬時標出 too-wide', () => {
  // Arrange：60 cm 寬的格子放微波爐（50）＋氣炸鍋（30）
  const cab = addItem(addItem(applianceCell(), 0, 0, 'microwave'), 0, 0, 'air-fryer');

  // Act & Assert
  assert.ok(kinds(cab).includes('too-wide'));
});

test('cabinetIssues 家電比格子高時標出 too-tall，上方散熱不足時標出 vent', () => {
  // Arrange：格高 50；微波爐高 30、建議上方留 10 → 剛好；格高調成 35 → 散熱不足；調成 25 → 放不下
  const tight = setCellHeight(splitCell(applianceCell(), 0, 0), 0, 0, 35);
  const tiny = setCellHeight(splitCell(applianceCell(), 0, 0), 0, 0, 25);

  // Act & Assert
  assert.deepEqual(kinds(addItem(tight, 0, 0, 'microwave')), ['vent']);
  assert.ok(kinds(addItem(tiny, 0, 0, 'microwave')).includes('too-tall'));
});

test('cabinetIssues 家電比櫃子深時標出 too-deep，訊息帶出差幾公分', () => {
  // Arrange：深 30 的櫃子放微波爐（深 40）
  const cab = addItem(updateCell(createCabinet({ id: 'c', w: 60, d: 30, h: 58 }), 0, 0, { kind: 'appliance', outlet: '110v' }), 0, 0, 'microwave');

  // Act
  const issue = cabinetIssues(cab).find((i) => i.kind === 'too-deep');

  // Assert
  assert.ok(issue);
  assert.match(issue.message, /\d+ ?cm/);
});

// ---------- 存進方案、擺到場景 ----------
import { deleteCabinetDesign, placeCabinet, saveCabinetDesign } from '../../js/core/cabinet.js';

const emptyDesign = () => ({ cabinets: [], furniture: [] });

test('saveCabinetDesign 新的櫃子加進方案，同 id 再存一次就覆蓋', () => {
  // Arrange
  const cab = base();

  // Act
  const once = saveCabinetDesign(emptyDesign(), cab);
  const twice = saveCabinetDesign(once, { ...cab, name: '改名' });

  // Assert
  assert.equal(once.cabinets.length, 1);
  assert.equal(twice.cabinets.length, 1);
  assert.equal(twice.cabinets[0].name, '改名');
});

test('placeCabinet 擺到場景時建立 custom-cabinet 家具，尺寸取自櫃子設計', () => {
  // Arrange
  const design = saveCabinetDesign(emptyDesign(), base());

  // Act
  const placed = placeCabinet(design, 'c1', { id: 'f1', x: 2, y: 3 });

  // Assert
  assert.deepEqual(placed.furniture[0], {
    id: 'f1', type: 'custom-cabinet', cabinetId: 'c1', x: 2, y: 3, rotation: 0, size: { w: 120, d: 60, h: 210 }, color: '#e9e4dc',
  });
});

test('saveCabinetDesign 改了櫃子尺寸時，場景裡用到它的櫃子一起更新尺寸', () => {
  // Arrange
  const design = placeCabinet(saveCabinetDesign(emptyDesign(), base()), 'c1', { id: 'f1', x: 2, y: 3 });

  // Act
  const after = saveCabinetDesign(design, resizeCabinet(base(), { w: 90, d: 45, h: 200 }));

  // Assert
  assert.deepEqual(after.furniture[0].size, { w: 90, d: 45, h: 200 });
});

test('deleteCabinetDesign 刪掉櫃子設計時，場景裡用到它的櫃子一起移除', () => {
  // Arrange
  let design = saveCabinetDesign(emptyDesign(), base());
  design = placeCabinet(design, 'c1', { id: 'f1', x: 2, y: 3 });
  design = { ...design, furniture: [...design.furniture, { id: 'sofa', type: 'sofa' }] };

  // Act
  const after = deleteCabinetDesign(design, 'c1');

  // Assert
  assert.deepEqual(after.cabinets, []);
  assert.deepEqual(after.furniture.map((f) => f.id), ['sofa']);
});
