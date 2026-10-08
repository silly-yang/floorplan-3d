import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PEGBOARD_ACCESSORIES,
  PEGBOARD_MATERIALS,
  addAccessory,
  createPegboard,
  deletePegboardDesign,
  getAccessory,
  moveAccessory,
  pegboardFootprint,
  pegboardIssues,
  placePegboard,
  removeAccessory,
  resizePegboard,
  savePegboardDesign,
  updatePegboard,
} from '../../js/core/pegboard.js';

const base = (over = {}) => createPegboard({ id: 'p1', name: '工作桌洞洞板', ...over });
const kinds = (board) => pegboardIssues(board).map((i) => i.kind).sort();
const add = (board, type, id, x, y) => addAccessory(board, type, { id, x, y });

test('createPegboard 預設 120×80、木質、孔距 2.5 cm、下緣離地 90 cm、沒有配件', () => {
  // Act
  const board = base();

  // Assert
  assert.deepEqual(
    { ...board, color: undefined },
    { id: 'p1', name: '工作桌洞洞板', size: { w: 120, h: 80 }, material: 'wood', color: undefined, pitch: 2.5, mountHeight: 90, accessories: [] },
  );
  assert.match(board.color, /^#[0-9a-f]{6}$/i);
});

test('材質有木質、金屬烤漆、塑膠三種，各有預設顏色', () => {
  // Assert
  assert.deepEqual(PEGBOARD_MATERIALS.map((m) => [m.id, m.name]), [['wood', '木質'], ['metal', '金屬烤漆'], ['plastic', '塑膠']]);
  for (const m of PEGBOARD_MATERIALS) assert.match(m.color, /^#[0-9a-f]{6}$/i, m.id);
});

test('配件目錄分一般與貓爬架兩組，每個都有中文名稱、正數尺寸與顏色', () => {
  // Act
  const ids = (category) => PEGBOARD_ACCESSORIES.filter((a) => a.category === category).map((a) => a.id).sort();

  // Assert
  assert.deepEqual(ids('general'), ['basket', 'hook', 'pen-holder', 'shelf', 'storage-box', 'tool-rack']);
  assert.deepEqual(ids('cat'), ['cat-bed', 'cat-bridge', 'cat-lookout', 'cat-scratcher', 'cat-step']);
  for (const a of PEGBOARD_ACCESSORIES) {
    assert.match(a.name, /[一-鿿]/, a.id);
    assert.ok(a.size.w > 0 && a.size.h > 0 && a.size.d > 0, a.id);
    assert.match(a.color, /^#[0-9a-f]{6}$/i, a.id);
  }
  assert.equal(getAccessory('cat-step').name, '貓跳板');
});

test('addAccessory 座標對齊孔距，不改原物件', () => {
  // Arrange
  const original = base();

  // Act
  const board = add(original, 'hook', 'a1', 13, 7);

  // Assert
  assert.deepEqual(board.accessories, [{ id: 'a1', type: 'hook', x: 12.5, y: 7.5 }]);
  assert.deepEqual(original.accessories, []);
});

test('addAccessory 超出板子時夾回板內', () => {
  // Act：層板寬 40，放在 x=200 → 最多到 120-40=80
  const board = add(base(), 'shelf', 'a1', 200, -10);

  // Assert
  assert.deepEqual(board.accessories[0], { id: 'a1', type: 'shelf', x: 80, y: 0 });
});

test('addAccessory 沒給位置時自動找不重疊的空位', () => {
  // Act
  let board = base();
  for (const id of ['a1', 'a2', 'a3', 'a4']) board = addAccessory(board, 'basket', { id });

  // Assert
  assert.equal(board.accessories.length, 4);
  assert.deepEqual(pegboardIssues(board), []);
});

test('addAccessory 未知的配件類型丟錯並帶類型名稱', () => {
  // Act & Assert
  assert.throws(() => add(base(), 'rocket', 'a1', 0, 0), /rocket/);
});

test('moveAccessory 對齊孔距並夾在板內；removeAccessory 拿掉指定配件', () => {
  // Arrange
  const board = add(add(base(), 'hook', 'a1', 0, 0), 'shelf', 'a2', 0, 40);

  // Act
  const moved = moveAccessory(board, 'a1', { x: 33.4, y: 999 });
  const removed = removeAccessory(moved, 'a2');

  // Assert：掛勾高 10 → y 最多 70
  assert.deepEqual(moved.accessories[0], { id: 'a1', type: 'hook', x: 32.5, y: 70 });
  assert.deepEqual(removed.accessories.map((a) => a.id), ['a1']);
});

test('resizePegboard 改尺寸不搬動配件，最小 20 cm', () => {
  // Arrange
  const board = add(base(), 'shelf', 'a1', 80, 0);

  // Act
  const after = resizePegboard(board, { w: 5, h: 150 });

  // Assert
  assert.deepEqual(after.size, { w: 20, h: 150 });
  assert.deepEqual(after.accessories[0], { id: 'a1', type: 'shelf', x: 80, y: 0 });
});

test('updatePegboard 換材質時顏色跟著換成該材質的預設色；有指定顏色就用指定的', () => {
  // Act
  const metal = updatePegboard(base(), { material: 'metal' });
  const custom = updatePegboard(base(), { material: 'plastic', color: '#123456' });

  // Assert
  assert.equal(metal.color, PEGBOARD_MATERIALS.find((m) => m.id === 'metal').color);
  assert.equal(custom.color, '#123456');
});

test('updatePegboard 改孔距時配件重新對齊新的孔距；掛牆高度夾在 0～300', () => {
  // Arrange
  const board = add(base(), 'hook', 'a1', 12.5, 7.5);

  // Act
  const after = updatePegboard(board, { pitch: 5, mountHeight: 999 });

  // Assert
  assert.deepEqual(after.accessories[0], { id: 'a1', type: 'hook', x: 15, y: 10 });
  assert.equal(after.mountHeight, 300);
  assert.equal(updatePegboard(board, { mountHeight: -5 }).mountHeight, 0);
});

// ---------- 檢查 ----------

test('pegboardIssues 配件都在板內、沒有重疊時沒有提醒', () => {
  // Act & Assert
  assert.deepEqual(pegboardIssues(add(add(base(), 'shelf', 'a1', 0, 0), 'hook', 'a2', 50, 0)), []);
});

test('pegboardIssues 板子縮小後配件超出範圍，訊息寫出超出幾公分', () => {
  // Arrange：層板放在 80～120，板寬改成 110
  const board = resizePegboard(add(base(), 'shelf', 'a1', 80, 0), { w: 110, h: 80 });

  // Act
  const issues = pegboardIssues(board);

  // Assert
  assert.deepEqual(issues.map((i) => [i.kind, i.accessoryIds]), [['out-of-bounds', ['a1']]]);
  assert.match(issues[0].message, /右側 10 cm/);
});

test('pegboardIssues 配件互相重疊時標出兩個配件與重疊尺寸', () => {
  // Arrange：層板 40×3 在 (0,0)，收納盒 20×12 在 (10,0) → 重疊 20×3
  const board = add(add(base(), 'shelf', 'a1', 0, 0), 'storage-box', 'a2', 10, 0);

  // Act
  const issues = pegboardIssues(board);

  // Assert
  assert.deepEqual(issues.map((i) => [i.kind, i.accessoryIds]), [['overlap', ['a1', 'a2']]]);
  assert.match(issues[0].message, /20×3 cm/);
});

test('pegboardIssues 剛好貼齊邊緣的兩個配件不算重疊', () => {
  // Arrange：層板 0～40、收納盒從 40 開始
  const board = add(add(base(), 'shelf', 'a1', 0, 0), 'storage-box', 'a2', 40, 0);

  // Act & Assert
  assert.deepEqual(kinds(board), []);
});

for (const [material, type, expected] of [
  ['plastic', 'cat-step', ['weak-board']],
  ['plastic', 'cat-bed', ['weak-board']],
  ['plastic', 'shelf', []],
  ['wood', 'cat-step', []],
  ['metal', 'cat-bed', []],
]) {
  test(`pegboardIssues ${material} 板裝 ${type} → ${expected.join('、') || '沒有提醒'}`, () => {
    // Arrange
    const board = add(updatePegboard(base(), { material }), type, 'a1', 0, 0);

    // Act & Assert
    assert.deepEqual(kinds(board), expected);
  });
}

test('pegboardIssues 塑膠板的承重警告建議改木質或金屬並鎖牆', () => {
  // Arrange
  const board = add(updatePegboard(base(), { material: 'plastic' }), 'cat-step', 'a1', 0, 0);

  // Act
  const issue = pegboardIssues(board)[0];

  // Assert
  assert.match(issue.message, /承重/);
  assert.match(issue.message, /木質或金屬/);
  assert.match(issue.message, /鎖/);
});

for (const [name, secondY, expected] of [
  ['上下兩塊貓跳板差 60 cm 太遠', 60, ['cat-gap']],
  ['差 45 cm 貓跳得上去', 45, []],
  ['剛好 50 cm 不提醒', 50, []],
]) {
  test(`pegboardIssues ${name}`, () => {
    // Arrange：兩塊貓跳板（高 3）錯開擺放，頂面高度差＝secondY
    const board = add(add(base({ h: 150 }), 'cat-step', 'a1', 0, 0), 'cat-step', 'a2', 60, secondY);

    // Act & Assert
    assert.deepEqual(kinds(board), expected);
  });
}

test('pegboardIssues 貓跳板間距太大時，訊息寫出間距與多出幾公分', () => {
  // Arrange
  const board = add(add(base({ h: 150 }), 'cat-step', 'a1', 0, 0), 'cat-lookout', 'a2', 60, 65);

  // Act：貓跳板頂面 3、觀景台（高 5）頂面 70 → 間距 67，多 17
  const issue = pegboardIssues(board).find((i) => i.kind === 'cat-gap');

  // Assert
  assert.ok(issue);
  assert.deepEqual(issue.accessoryIds, ['a1', 'a2']);
  assert.match(issue.message, /67 cm/);
  assert.match(issue.message, /17 cm/);
});

test('pegboardIssues 貓抓板不是跳台，不算進垂直間距', () => {
  // Arrange：貓跳板頂面 3、48，貓抓板（高 50）頂面 100；若把貓抓板當跳台，48→100 會超過 50
  let board = add(base({ h: 150 }), 'cat-step', 'a1', 0, 0);
  board = add(board, 'cat-step', 'a2', 60, 45);
  board = add(board, 'cat-scratcher', 'a3', 60, 50);

  // Act & Assert
  assert.deepEqual(kinds(board), []);
});

// ---------- 存進方案、擺到場景 ----------

const emptyDesign = () => ({ cabinets: [], furniture: [] });

test('pegboardFootprint 深度＝板厚 2 cm＋最深的配件', () => {
  // Act & Assert
  assert.deepEqual(pegboardFootprint(base()), { w: 120, d: 2, h: 80 });
  assert.deepEqual(pegboardFootprint(add(add(base(), 'cat-bed', 'a1', 0, 0), 'hook', 'a2', 60, 0)), { w: 120, d: 37, h: 80 });
});

test('savePegboardDesign 方案還沒有 pegboards 欄位時建立；同 id 再存一次就覆蓋', () => {
  // Act
  const once = savePegboardDesign(emptyDesign(), base());
  const twice = savePegboardDesign(once, { ...base(), name: '改名' });

  // Assert
  assert.equal(once.pegboards.length, 1);
  assert.deepEqual(twice.pegboards.map((p) => p.name), ['改名']);
});

test('placePegboard 建立 custom-pegboard 家具，離地高度取掛牆高度', () => {
  // Arrange
  const design = savePegboardDesign(emptyDesign(), add(base(), 'shelf', 'a1', 0, 0));

  // Act
  const placed = placePegboard(design, 'p1', { id: 'f1', x: 2, y: 3 });

  // Assert
  assert.deepEqual(placed.furniture[0], {
    id: 'f1', type: 'custom-pegboard', pegboardId: 'p1', x: 2, y: 3, rotation: 0,
    size: { w: 120, d: 22, h: 80 }, color: base().color, elevation: 0.9,
  });
});

test('placePegboard 找不到設計時丟錯', () => {
  // Act & Assert
  assert.throws(() => placePegboard(emptyDesign(), 'ghost', { id: 'f1', x: 0, y: 0 }), /ghost/);
});

test('savePegboardDesign 改了板子時，場景裡用到它的洞洞板一起更新尺寸、顏色與高度', () => {
  // Arrange
  const design = placePegboard(savePegboardDesign(emptyDesign(), base()), 'p1', { id: 'f1', x: 2, y: 3 });
  const changed = updatePegboard(resizePegboard(base(), { w: 60, h: 100 }), { mountHeight: 120, color: '#336699' });

  // Act
  const after = savePegboardDesign(design, changed);

  // Assert
  assert.deepEqual(after.furniture[0].size, { w: 60, d: 2, h: 100 });
  assert.equal(after.furniture[0].color, '#336699');
  assert.equal(after.furniture[0].elevation, 1.2);
  assert.equal(after.furniture[0].x, 2);
});

test('deletePegboardDesign 刪掉設計時，場景裡用到它的洞洞板一起移除', () => {
  // Arrange
  let design = placePegboard(savePegboardDesign(emptyDesign(), base()), 'p1', { id: 'f1', x: 2, y: 3 });
  design = { ...design, furniture: [...design.furniture, { id: 'sofa', type: 'sofa' }] };

  // Act
  const after = deletePegboardDesign(design, 'p1');

  // Assert
  assert.deepEqual(after.pegboards, []);
  assert.deepEqual(after.furniture.map((f) => f.id), ['sofa']);
});
