import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLINTH, cabinetIssues } from '../../js/core/cabinet.js';
import { CAT_MAX_GAP, getAccessory, pegboardIssues } from '../../js/core/pegboard.js';
import { CABINET_PRESETS, PEGBOARD_PRESETS } from '../../js/core/presets.js';

const findPreset = (list, id) => {
  const preset = list.find((p) => p.id === id);
  assert.ok(preset, `找不到預設 ${id}`);
  return preset;
};
// 每一格寫成 [高, 類型, 插座, [家電]]，方便整欄比對
const layoutOf = (cab) => cab.columns.map((c) => ({ width: c.width, cells: c.cells.map((x) => [x.height, x.kind, x.outlet, x.items.map((it) => it.type)]) }));
const rectOf = (a) => {
  const { w, h } = getAccessory(a.type).size;
  return { x0: a.x, y0: a.y, x1: a.x + w, y1: a.y + h };
};
const countTypes = (board) => board.accessories.reduce((m, a) => ({ ...m, [a.type]: (m[a.type] ?? 0) + 1 }), {});

const none = (h, kind) => [h, kind, 'none', []];

const CABINETS = [
  ['appliance-cabinet', '電器櫃', { w: 60, d: 60, h: 210 }, [
    { width: 60, cells: [none(70, 'drawer'), [48, 'pullout', '110v', ['rice-cooker']], [45, 'appliance', '110v', ['microwave']], none(39, 'door')] },
  ]],
  ['tall-appliance-cabinet', '高身電器櫃', { w: 90, d: 60, h: 210 }, [
    { width: 64, cells: [none(40, 'drawer'), [50, 'appliance', '220v', ['steam-oven']], [45, 'appliance', '110v', ['air-fryer', 'coffee-machine']], none(67, 'door')] },
    { width: 26, cells: [none(120, 'door'), none(82, 'door')] },
  ]],
  ['wardrobe', '衣櫃', { w: 120, d: 60, h: 240 }, [
    { width: 60, cells: [none(192, 'open'), none(40, 'door')] },
    { width: 60, cells: [none(60, 'drawer'), none(132, 'open'), none(40, 'door')] },
  ]],
  ['shoe-cabinet', '鞋櫃', { w: 90, d: 35, h: 110 }, [
    { width: 45, cells: [none(34, 'door'), none(34, 'door'), none(34, 'door')] },
    { width: 45, cells: [none(34, 'door'), none(34, 'door'), none(34, 'door')] },
  ]],
  ['bookcase', '書櫃', { w: 120, d: 35, h: 200 }, [
    { width: 60, cells: [none(38, 'open'), none(38, 'open'), none(38, 'open'), none(38, 'open'), none(40, 'open')] },
    { width: 60, cells: [none(38, 'open'), none(38, 'open'), none(38, 'open'), none(38, 'open'), none(40, 'open')] },
  ]],
  ['tv-cabinet', '電視下櫃', { w: 180, d: 45, h: 50 }, [
    { width: 60, cells: [none(42, 'drawer')] },
    { width: 60, cells: [[42, 'open', '110v', []]] },
    { width: 60, cells: [none(42, 'drawer')] },
  ]],
];

test('櫃子預設依序是電器櫃、高身電器櫃、衣櫃、鞋櫃、書櫃、電視下櫃，各有中文名稱與一句說明', () => {
  // Assert
  assert.deepEqual(CABINET_PRESETS.map((p) => [p.id, p.name]), CABINETS.map(([id, name]) => [id, name]));
  for (const p of CABINET_PRESETS) {
    assert.ok(typeof p.description === 'string' && p.description.length > 0, p.id);
    assert.equal(typeof p.build, 'function', p.id);
  }
});

for (const [id, name, size, layout] of CABINETS) {
  test(`櫃子預設「${name}」的尺寸、欄格、插座與家電`, () => {
    // Act
    const cab = findPreset(CABINET_PRESETS, id).build({ id: 'c1', name: `${name} 1` });

    // Assert
    assert.equal(cab.id, 'c1');
    assert.equal(cab.name, `${name} 1`);
    assert.deepEqual(cab.size, size);
    assert.deepEqual(layoutOf(cab), layout);
  });

  test(`櫃子預設「${name}」欄寬加總等於櫃寬、每欄格高加總等於櫃高扣踢腳、檢查 0 個提醒`, () => {
    // Act
    const cab = findPreset(CABINET_PRESETS, id).build({ id: 'c1', name });

    // Assert
    assert.equal(cab.columns.reduce((s, c) => s + c.width, 0), cab.size.w);
    for (const column of cab.columns) assert.equal(column.cells.reduce((s, c) => s + c.height, 0), cab.size.h - PLINTH);
    assert.deepEqual(cabinetIssues(cab), []);
  });
}

test('同一個櫃子預設建兩次是兩份獨立的設計', () => {
  // Arrange
  const preset = findPreset(CABINET_PRESETS, 'appliance-cabinet');

  // Act
  const a = preset.build({ id: 'a', name: '電器櫃 1' });
  const b = preset.build({ id: 'b', name: '電器櫃 2' });
  a.columns[0].cells[0].kind = 'open';

  // Assert
  assert.equal(b.id, 'b');
  assert.equal(b.columns[0].cells[0].kind, 'drawer');
});

const PEGBOARDS = [
  ['entryway', '玄關收納', { w: 60, h: 90 }, 'wood', 90, { hook: 4, basket: 1, shelf: 1 }],
  ['kitchen', '廚房收納', { w: 80, h: 60 }, 'metal', 90, { shelf: 2, hook: 4, 'storage-box': 1 }],
  ['desk-wall', '書桌工作牆', { w: 120, h: 60 }, 'wood', 90, { shelf: 1, 'pen-holder': 1, 'storage-box': 2, hook: 1 }],
  ['tool-wall', '工具牆', { w: 120, h: 80 }, 'metal', 90, { 'tool-rack': 2, hook: 6, shelf: 1 }],
  ['cat-wall', '貓跳台牆', { w: 60, h: 180 }, 'wood', 30, { 'cat-step': 1, 'cat-lookout': 1, 'cat-bed': 1, 'cat-bridge': 1, 'cat-scratcher': 1 }],
];

test('洞洞板預設依序是玄關收納、廚房收納、書桌工作牆、工具牆、貓跳台牆，各有中文名稱與一句說明', () => {
  // Assert
  assert.deepEqual(PEGBOARD_PRESETS.map((p) => [p.id, p.name]), PEGBOARDS.map(([id, name]) => [id, name]));
  for (const p of PEGBOARD_PRESETS) {
    assert.ok(typeof p.description === 'string' && p.description.length > 0, p.id);
    assert.equal(typeof p.build, 'function', p.id);
  }
});

for (const [id, name, size, material, mountHeight, counts] of PEGBOARDS) {
  test(`洞洞板預設「${name}」的尺寸、材質、掛牆高度與配件數量`, () => {
    // Act
    const board = findPreset(PEGBOARD_PRESETS, id).build({ id: 'p1', name: `${name} 1` });

    // Assert
    assert.equal(board.id, 'p1');
    assert.equal(board.name, `${name} 1`);
    assert.deepEqual(board.size, size);
    assert.equal(board.material, material);
    assert.equal(board.mountHeight, mountHeight);
    assert.deepEqual(countTypes(board), counts);
  });

  test(`洞洞板預設「${name}」配件都在板內、互不重疊、檢查 0 個提醒`, () => {
    // Act
    const board = findPreset(PEGBOARD_PRESETS, id).build({ id: 'p1', name });
    const rects = board.accessories.map(rectOf);

    // Assert
    for (const r of rects) assert.ok(r.x0 >= 0 && r.y0 >= 0 && r.x1 <= board.size.w && r.y1 <= board.size.h, JSON.stringify(r));
    rects.forEach((p, i) => rects.slice(i + 1).forEach((q) => {
      const overlap = Math.min(p.x1, q.x1) > Math.max(p.x0, q.x0) && Math.min(p.y1, q.y1) > Math.max(p.y0, q.y0);
      assert.equal(overlap, false, `${JSON.stringify(p)} 與 ${JSON.stringify(q)} 重疊`);
    }));
    assert.deepEqual(pegboardIssues(board), []);
  });
}

test('貓跳台牆相鄰兩個跳台的頂面高度差都不超過 CAT_MAX_GAP', () => {
  // Act
  const board = findPreset(PEGBOARD_PRESETS, 'cat-wall').build({ id: 'p1', name: '貓跳台牆 1' });
  const tops = board.accessories.filter((a) => getAccessory(a.type).jump).map((a) => rectOf(a).y1).sort((p, q) => p - q);

  // Assert
  assert.equal(tops.length, 4);
  for (let i = 1; i < tops.length; i++) assert.ok(tops[i] - tops[i - 1] <= CAT_MAX_GAP, `${tops[i - 1]} → ${tops[i]}`);
});

test('同一個洞洞板預設建兩次，板子與每個配件的 id 都不重複', () => {
  // Arrange
  const preset = findPreset(PEGBOARD_PRESETS, 'tool-wall');

  // Act
  const a = preset.build({ id: 'a', name: '工具牆 1' });
  const b = preset.build({ id: 'b', name: '工具牆 2' });
  const ids = [...a.accessories, ...b.accessories].map((x) => x.id);

  // Assert
  assert.notEqual(a.id, b.id);
  assert.equal(ids.length, 18);
  assert.ok(ids.every((x) => typeof x === 'string' && x.length > 0));
  assert.equal(new Set(ids).size, ids.length);
});
