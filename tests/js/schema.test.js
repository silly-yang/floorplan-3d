import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DesignFormatError,
  SCHEMA_VERSION,
  createDesign,
  fingerprint,
  migrateDesign,
  parseDesign,
  uniqueName,
  validateDesign,
} from '../../js/storage/schema.js';

const NOW = '2026-10-08T09:00:00.000Z';

function sampleDesign() {
  const design = createDesign({ id: 'd1', name: '方案 1', now: NOW, floorplanRef: 'abc' });
  design.rooms = { living: { floorColor: '#c8a97e' } };
  design.furniture = [
    { id: 'f1', type: 'sofa', x: 2, y: 3, rotation: 15, size: { w: 210, d: 90, h: 85 }, color: '#8c9aa6' },
  ];
  return design;
}

test('createDesign 帶入版本、名稱、時間與預設室內淨高 3.05 m', () => {
  // Act
  const design = createDesign({ id: 'd1', name: '方案 1', now: NOW });

  // Assert
  assert.deepEqual(design, {
    schemaVersion: SCHEMA_VERSION,
    id: 'd1',
    name: '方案 1',
    createdAt: NOW,
    updatedAt: NOW,
    floorplanRef: null,
    // 層高 320 cm 扣掉樓板約 15 cm
    ceilingHeight: 3.05,
    ceilingColor: '#f4f2ee',
    rooms: {},
    doors: {},
    cabinets: [],
    ceilings: {},
    furniture: [],
  });
});

test('validateDesign 合法設計沒有錯誤', () => {
  // Act & Assert
  assert.deepEqual(validateDesign(sampleDesign()), []);
});

for (const [name, mutate, fragment] of [
  ['名稱空白', (d) => (d.name = '  '), 'name'],
  ['時間不是日期', (d) => (d.updatedAt = '昨天'), 'updatedAt'],
  ['樓高超出範圍', (d) => (d.ceilingHeight = 12), 'ceilingHeight'],
  ['天花板顏色不是色碼', (d) => (d.ceilingColor = 'white'), 'ceilingColor'],
  ['門型未知', (d) => (d.doors = { 'FD2-1': { type: 'portal', open: false, flip: false, out: false } }), 'doors.FD2-1.type'],
  ['門的開關不是布林值', (d) => (d.doors = { 'FD2-1': { type: 'hinged', open: 'yes', flip: false, out: false } }), 'doors.FD2-1.open'],
  ['擺放的系統櫃找不到設計', (d) => d.furniture.push({ id: 'f9', type: 'custom-cabinet', cabinetId: 'ghost', x: 1, y: 1, rotation: 0, size: { w: 60, d: 60, h: 90 }, color: '#e9e4dc' }), 'furniture[1].cabinetId'],
  ['櫃子設計格式錯誤', (d) => (d.cabinets = [{ id: 'c1', name: '櫃', size: { w: 60, d: 60, h: 90 }, columns: 'x' }]), 'cabinets[0].columns'],
  ['天花板形式未知', (d) => (d.ceilings = { living: { type: 'dome', height: 2.6 } }), 'ceilings.living.type'],
  ['天花板高度不合理', (d) => (d.ceilings = { living: { type: 'flat', height: 9 } }), 'ceilings.living.height'],
  ['門的內外開不是布林值', (d) => (d.doors = { 'FD2-1': { type: 'hinged', open: false, flip: false, out: 1 } }), 'doors.FD2-1.out'],
  ['地板顏色不是色碼', (d) => (d.rooms.living.floorColor = 'red'), 'rooms.living.floorColor'],
  ['地板材質未知', (d) => (d.rooms.living.floorMaterial = 'lava'), 'rooms.living.floorMaterial'],
  ['家具不是陣列', (d) => (d.furniture = {}), 'furniture'],
  ['家具類型未知', (d) => (d.furniture[0].type = 'spaceship'), 'furniture[0].type'],
  ['家具座標不是數字', (d) => (d.furniture[0].x = '2'), 'furniture[0].x'],
  ['家具尺寸超出上限', (d) => (d.furniture[0].size.w = 9999), 'furniture[0].size.w'],
  ['家具顏色錯誤', (d) => (d.furniture[0].color = '#zzz'), 'furniture[0].color'],
  ['家具 id 重複', (d) => d.furniture.push({ ...d.furniture[0] }), 'furniture[1].id'],
  ['家具離地高度不合理', (d) => (d.furniture[0].elevation = 9), 'furniture[0].elevation'],
  ['家具選項不是物件', (d) => (d.furniture[0].options = 'x'), 'furniture[0].options'],
]) {
  test(`validateDesign ${name}時指出欄位路徑`, () => {
    // Arrange
    const design = sampleDesign();
    mutate(design);

    // Act
    const errors = validateDesign(design);

    // Assert
    assert.equal(errors.length, 1, errors.join(' / '));
    assert.ok(errors[0].includes(fragment), errors[0]);
  });
}

test('validateDesign 不是物件時回傳單一錯誤', () => {
  // Act & Assert
  assert.equal(validateDesign('hello').length, 1);
});

test('migrateDesign 依序套用每一版的遷移，且不修改原物件', () => {
  // Arrange：假設格式已經改到第 3 版
  const migrations = {
    1: (d) => ({ ...d, schemaVersion: 2, wallColor: '#ffffff' }),
    2: (d) => ({ ...d, schemaVersion: 3, furniture: d.furniture.map((f) => ({ ...f, locked: false })) }),
  };
  const old = { schemaVersion: 1, furniture: [{ id: 'f1' }] };

  // Act
  const migrated = migrateDesign(old, { migrations, current: 3 });

  // Assert
  assert.equal(migrated.schemaVersion, 3);
  assert.equal(migrated.wallColor, '#ffffff');
  assert.equal(migrated.furniture[0].locked, false);
  assert.equal(old.schemaVersion, 1);
  assert.equal(old.furniture[0].locked, undefined);
});

for (const [name, raw, fragment] of [
  ['比程式還新的版本', { schemaVersion: 99 }, '較新版本'],
  ['沒有版本號', { name: 'x' }, 'schemaVersion'],
  ['版本號不是整數', { schemaVersion: '1' }, 'schemaVersion'],
]) {
  test(`migrateDesign ${name}時丟出格式錯誤`, () => {
    // Act & Assert
    assert.throws(() => migrateDesign(raw), (e) => e instanceof DesignFormatError && e.message.includes(fragment));
  });
}

test('migrateDesign 缺少中間版本的遷移時丟出格式錯誤', () => {
  // Act & Assert
  assert.throws(
    () => migrateDesign({ schemaVersion: 1 }, { migrations: {}, current: 2 }),
    (e) => e instanceof DesignFormatError && e.message.includes('1'),
  );
});

test('parseDesign 合法時回傳設計、不合法時丟出列出所有問題的錯誤', () => {
  // Arrange
  const bad = sampleDesign();
  bad.name = '';
  bad.furniture[0].x = null;

  // Act & Assert
  assert.equal(parseDesign(sampleDesign()).name, '方案 1');
  assert.throws(
    () => parseDesign(bad),
    (e) => e instanceof DesignFormatError && e.problems.length === 2,
  );
});

for (const [name, input, existing, expected] of [
  ['沒衝突原樣回傳', '方案 1', ['方案 2'], '方案 1'],
  ['衝突時加上 (2)', '方案 1', ['方案 1'], '方案 1 (2)'],
  ['(2) 也被用掉就用 (3)', '方案 1', ['方案 1', '方案 1 (2)'], '方案 1 (3)'],
]) {
  test(`uniqueName ${name}`, () => {
    // Act & Assert
    assert.equal(uniqueName(input, existing), expected);
  });
}

test('fingerprint 同內容相同、不同內容不同', () => {
  // Act & Assert
  assert.equal(fingerprint('abc'), fingerprint('abc'));
  assert.notEqual(fingerprint('abc'), fingerprint('abd'));
  assert.match(fingerprint('abc'), /^[0-9a-f]{8}$/);
});

test('migrateDesign 遷移函式就地修改時，原物件也不受影響', () => {
  // Arrange：遷移寫法不小心直接改傳入的物件
  const migrations = {
    1: (d) => {
      d.schemaVersion = 2;
      d.furniture.push({ id: 'added' });
      return d;
    },
  };
  const old = { schemaVersion: 1, furniture: [] };

  // Act
  migrateDesign(old, { migrations, current: 2 });

  // Assert
  assert.equal(old.schemaVersion, 1);
  assert.equal(old.furniture.length, 0);
});

test('第 1 版設計檔讀取時自動升到目前版本，補上預設天花板顏色', () => {
  // Arrange：第 1 版還沒有 ceilingColor、doors、cabinets
  const v1 = sampleDesign();
  v1.schemaVersion = 1;
  delete v1.ceilingColor;
  delete v1.doors;
  delete v1.cabinets;
  delete v1.ceilings;

  // Act
  const design = parseDesign(v1);

  // Assert
  assert.equal(design.schemaVersion, SCHEMA_VERSION);
  assert.equal(design.ceilingColor, '#f4f2ee');
  assert.deepEqual(design.furniture, v1.furniture);
});

test('第 2 版設計檔讀取時補上空的門設定（全部用預設門型）', () => {
  // Arrange
  const v2 = sampleDesign();
  v2.schemaVersion = 2;
  delete v2.doors;
  delete v2.cabinets;
  delete v2.ceilings;

  // Act
  const design = parseDesign(v2);

  // Assert
  assert.equal(design.schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(design.doors, {});
  assert.equal(design.ceilingColor, v2.ceilingColor);
});

test('第 3 版設計檔讀取時補上空的櫃子清單', () => {
  // Arrange
  const v3 = sampleDesign();
  v3.schemaVersion = 3;
  delete v3.cabinets;
  delete v3.ceilings;

  // Act
  const design = parseDesign(v3);

  // Assert
  assert.equal(design.schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(design.cabinets, []);
});

test('第 4 版設計檔讀取時補上空的天花板設定', () => {
  // Arrange
  const v4 = sampleDesign();
  v4.schemaVersion = 4;
  delete v4.ceilings;

  // Act
  const design = parseDesign(v4);

  // Assert
  assert.equal(design.schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(design.ceilings, {});
});

test('validateDesign 家具可以帶選填的 elevation 與 options', () => {
  // Arrange
  const design = sampleDesign();
  design.furniture[0].elevation = 1.2;
  design.furniture[0].options = { colorTemp: 3000, on: true };

  // Act & Assert
  assert.deepEqual(validateDesign(design), []);
});

// ---------- 洞洞板（選填欄位） ----------

const board = () => ({
  id: 'p1', name: '洞洞板', size: { w: 120, h: 80 }, material: 'wood', color: '#c8a27a', pitch: 2.5, mountHeight: 90,
  accessories: [{ id: 'a1', type: 'cat-step', x: 0, y: 0 }],
});
const placedBoard = { id: 'f9', type: 'custom-pegboard', pegboardId: 'p1', x: 1, y: 1, rotation: 0, size: { w: 120, d: 27, h: 80 }, color: '#c8a27a', elevation: 0.9 };

test('validateDesign 沒有 pegboards 欄位的舊設計仍然合法', () => {
  // Arrange
  const design = sampleDesign();
  delete design.pegboards;

  // Act & Assert
  assert.deepEqual(validateDesign(design), []);
});

test('validateDesign 有洞洞板設計並擺進場景時沒有錯誤', () => {
  // Arrange
  const design = { ...sampleDesign(), pegboards: [board()] };
  design.furniture.push(placedBoard);

  // Act & Assert
  assert.deepEqual(validateDesign(design), []);
});

for (const [name, mutate, fragment] of [
  // 這兩種連帶讓擺放的洞洞板找不到設計，先拿掉擺放的那件，只看設計本身的錯
  ['pegboards 不是陣列', (d) => ((d.pegboards = {}), d.furniture.pop()), 'pegboards'],
  ['洞洞板沒有 id', (d) => ((d.pegboards[0].id = ''), d.furniture.pop()), 'pegboards[0].id'],
  ['洞洞板尺寸不是正數', (d) => (d.pegboards[0].size = { w: 0, h: 80 }), 'pegboards[0].size'],
  ['洞洞板材質未知', (d) => (d.pegboards[0].material = 'glass'), 'pegboards[0].material'],
  ['洞洞板顏色不是色碼', (d) => (d.pegboards[0].color = 'brown'), 'pegboards[0].color'],
  ['孔距不是正數', (d) => (d.pegboards[0].pitch = 0), 'pegboards[0].pitch'],
  ['掛牆高度不是數字', (d) => (d.pegboards[0].mountHeight = '90'), 'pegboards[0].mountHeight'],
  ['配件類型未知', (d) => (d.pegboards[0].accessories[0].type = 'rocket'), 'pegboards[0].accessories[0].type'],
  ['配件座標不是數字', (d) => (d.pegboards[0].accessories[0].x = null), 'pegboards[0].accessories[0]'],
  ['擺放的洞洞板找不到設計', (d) => (d.furniture[1].pegboardId = 'ghost'), 'furniture[1].pegboardId'],
]) {
  test(`validateDesign ${name}時指出欄位路徑`, () => {
    // Arrange
    const design = { ...sampleDesign(), pegboards: [board()] };
    design.furniture.push({ ...placedBoard });
    mutate(design);

    // Act
    const errors = validateDesign(design);

    // Assert
    assert.equal(errors.length, 1, errors.join(' / '));
    assert.ok(errors[0].includes(fragment), errors[0]);
  });
}

test('validateDesign 沒有 pegboards 欄位卻擺了洞洞板時指出 pegboardId', () => {
  // Arrange
  const design = sampleDesign();
  design.furniture.push({ ...placedBoard });

  // Act
  const errors = validateDesign(design);

  // Assert
  assert.equal(errors.length, 1, errors.join(' / '));
  assert.ok(errors[0].includes('furniture[1].pegboardId'), errors[0]);
});
