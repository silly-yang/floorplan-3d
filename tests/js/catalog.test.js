import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG, SIZE_LIMITS, createFurniture, getCatalogItem, normalizeSizeValue, sizeLimitsOf } from '../../js/furniture/catalog.js';

const REQUIRED_FURNITURE = [
  'sofa', 'armchair', 'coffee-table', 'dining-table', 'dining-chair', 'double-bed', 'single-bed',
  'wardrobe', 'desk', 'tv-stand', 'fridge', 'rug', 'plant', 'kitchen-island', 'cat-tree',
  'half-wall', 'glass-partition', 'slat-screen',
];
const REQUIRED_APPLIANCES = [
  'coffee-machine', 'microwave', 'rice-cooker', 'laptop', 'desk-lamp',
  'robot-vacuum', 'washing-machine', 'air-purifier', 'fan', 'floor-lamp',
  'air-fryer', 'oven', 'steam-oven', 'kettle', 'dishwasher',
];
const REQUIRED_FIXTURES = ['kitchen-counter', 'toilet', 'basin', 'upper-cabinet', 'shower-screen', 'shower-set'];
const REQUIRED_ELECTRICAL = ['outlet-110', 'outlet-220', 'outlet-dedicated', 'switch', 'tv-jack', 'lan-jack'];
const REQUIRED = [...REQUIRED_FURNITURE, ...REQUIRED_APPLIANCES, ...REQUIRED_FIXTURES, ...REQUIRED_ELECTRICAL];

test('目錄包含需求列出的家具與家電，每種都有中文名稱與正數尺寸', () => {
  // Act：自己設計的系統櫃（custom）不在一般清單裡；照明（light）由 lighting.test.js 檢查
  const types = CATALOG.filter((c) => !['custom', 'light'].includes(c.category)).map((c) => c.type);

  // Assert
  assert.deepEqual([...types].sort(), [...REQUIRED].sort());
  for (const item of CATALOG) {
    assert.match(item.name, /[一-鿿]/, item.type);
    assert.ok(item.size.w > 0 && item.size.d > 0 && item.size.h > 0, item.type);
    assert.match(item.color, /^#[0-9a-f]{6}$/i, item.type);
  }
});

test('createFurniture 帶入預設尺寸與顏色，且不共用目錄的尺寸物件', () => {
  // Act
  const sofa = createFurniture('sofa', { id: 'f1', x: 1, y: 2 });
  sofa.size.w = 999;

  // Assert
  assert.deepEqual(
    { id: sofa.id, type: sofa.type, x: sofa.x, y: sofa.y, rotation: sofa.rotation },
    { id: 'f1', type: 'sofa', x: 1, y: 2, rotation: 0 },
  );
  assert.notEqual(getCatalogItem('sofa').size.w, 999);
  assert.equal(sofa.color, getCatalogItem('sofa').color);
});

test('createFurniture 未知類型丟出錯誤並帶類型名稱', () => {
  // Act & Assert
  assert.throws(() => createFurniture('spaceship', { id: 'f1', x: 0, y: 0 }), /spaceship/);
});

test('地毯允許與其他家具重疊，沙發不允許', () => {
  // Assert
  assert.equal(getCatalogItem('rug').allowOverlap, true);
  assert.equal(getCatalogItem('sofa').allowOverlap, false);
});

for (const [name, input, expected] of [
  ['一般數字取整', '182.4', 182],
  ['小於下限夾到下限', 0, SIZE_LIMITS.min],
  ['大於上限夾到上限', 9999, SIZE_LIMITS.max],
  ['非數字回 null', 'abc', null],
  ['空字串回 null', '', null],
]) {
  test(`normalizeSizeValue ${name}`, () => {
    // Act
    const value = normalizeSizeValue(input);

    // Assert
    assert.equal(value, expected);
  });
}

test('每個項目都分到家具、家電或廚衛，放置方式只有地面、檯面、掛牆三種', () => {
  // Act
  const byCategory = (cat) => CATALOG.filter((c) => c.category === cat).map((c) => c.type).sort();

  // Assert
  assert.deepEqual(byCategory('furniture'), [...REQUIRED_FURNITURE].sort());
  assert.deepEqual(byCategory('appliance'), [...REQUIRED_APPLIANCES].sort());
  assert.deepEqual(byCategory('fixture'), [...REQUIRED_FIXTURES].sort());
  assert.deepEqual(byCategory('electrical'), [...REQUIRED_ELECTRICAL].sort());
  for (const item of CATALOG) assert.ok(['floor', 'surface', 'wall', 'ceiling'].includes(item.placement), item.type);
});

for (const [type, placement] of [
  ['coffee-machine', 'surface'],
  ['rice-cooker', 'surface'],
  ['robot-vacuum', 'floor'],
  ['washing-machine', 'floor'],
  ['sofa', 'floor'],
]) {
  test(`${type} 的放置方式是 ${placement}`, () => {
    // Act & Assert
    assert.equal(getCatalogItem(type).placement, placement);
  });
}

test('桌子、櫃子、中島櫃、流理台的檯面可以放東西，沙發、床不行', () => {
  // Assert
  for (const type of ['coffee-table', 'dining-table', 'desk', 'tv-stand', 'kitchen-island', 'kitchen-counter']) {
    assert.equal(getCatalogItem(type).surface, true, type);
  }
  for (const type of ['sofa', 'double-bed', 'rug', 'coffee-machine']) {
    assert.equal(getCatalogItem(type).surface, false, type);
  }
});

test('每台家電都有電壓（110 或 220）、瓦數與建議的上方散熱空間', () => {
  // Act
  const appliances = CATALOG.filter((c) => c.category === 'appliance');

  // Assert
  for (const a of appliances) {
    assert.ok([110, 220].includes(a.power?.voltage), `${a.type} voltage`);
    assert.ok(a.power.watts > 0, `${a.type} watts`);
    assert.ok(a.vent >= 0, `${a.type} vent`);
  }
});

for (const [type, voltage] of [['microwave', 110], ['air-fryer', 110], ['steam-oven', 220], ['dishwasher', 220]]) {
  test(`${type} 使用 ${voltage}V`, () => {
    // Act & Assert
    assert.equal(getCatalogItem(type).power.voltage, voltage);
  });
}

test('自己設計的系統櫃有獨立類型，不混進家具清單', () => {
  // Act
  const custom = getCatalogItem('custom-cabinet');

  // Assert
  assert.equal(custom.category, 'custom');
  assert.equal(custom.surface, true);
});

test('吊櫃掛在牆上、有固定的掛牆高度', () => {
  // Act
  const upper = getCatalogItem('upper-cabinet');

  // Assert
  assert.equal(upper.placement, 'wall');
  assert.ok(upper.mountHeight >= 130 && upper.mountHeight <= 170);
});

test('自己設計的洞洞板有獨立類型、掛在牆上，不混進家具清單', () => {
  // Act
  const custom = getCatalogItem('custom-pegboard');

  // Assert
  assert.equal(custom.category, 'custom');
  assert.equal(custom.placement, 'wall');
});

for (const [type, height, options] of [
  ['outlet-110', 30, { voltage: 110, dedicated: false }],
  ['outlet-220', 230, { voltage: 220, dedicated: true }],
  ['outlet-dedicated', 110, { voltage: 110, dedicated: true }],
  ['switch', 120, {}],
  ['tv-jack', 30, {}],
  ['lan-jack', 30, {}],
]) {
  test(`${type} 是掛牆面板，預設離地 ${height} cm`, () => {
    // Act
    const spec = getCatalogItem(type);

    // Assert：面板會跟貼牆的家具疊在一起，擋住與否另外檢查，不算重疊
    assert.equal(spec.placement, 'wall');
    assert.equal(spec.allowOverlap, true);
    assert.deepEqual(spec.size, { w: 12, d: 4, h: 12 });
    assert.equal(spec.mountHeight, height);
    assert.deepEqual(spec.options, options);
  });
}

// ---------- 隔間 ----------

const PARTITIONS = ['half-wall', 'glass-partition', 'slat-screen'];

test('隔間都會擋住漫遊，一般家具不會', () => {
  // Assert
  for (const type of PARTITIONS) assert.equal(getCatalogItem(type).blocksWalk, true, type);
  assert.equal(getCatalogItem('sofa').blocksWalk, false);
});

test('半牆頂部可以放東西，玻璃隔間與格柵屏風不行', () => {
  // Assert
  assert.equal(getCatalogItem('half-wall').surface, true);
  assert.equal(getCatalogItem('glass-partition').surface, false);
  assert.equal(getCatalogItem('slat-screen').surface, false);
});

test('半牆預設 寬 120 × 厚 10 × 高 110 cm，厚度對齊 5 cm 網格才貼得齊牆', () => {
  // Assert
  assert.deepEqual(getCatalogItem('half-wall').size, { w: 120, d: 10, h: 110 });
});

for (const [type, key, expected] of [
  ['half-wall', 'w', [20, 600]],
  ['half-wall', 'd', [8, 30]],
  ['half-wall', 'h', [30, 305]],
  ['glass-partition', 'd', [4, 15]],
  ['slat-screen', 'd', [4, 20]],
  ['sofa', 'w', [1, 600]],
  ['sofa', 'h', [1, 600]],
]) {
  test(`sizeLimitsOf ${type} 的 ${key} 範圍是 ${expected.join('～')}（室內淨高 3.05 m）`, () => {
    // Act & Assert
    assert.deepEqual(sizeLimitsOf(type, key, 3.05), expected);
  });
}

test('sizeLimitsOf 隔間高度上限跟著室內淨高', () => {
  // Act & Assert
  assert.deepEqual(sizeLimitsOf('half-wall', 'h', 2.8), [30, 280]);
});

for (const [name, input, expected] of [
  ['低於下限夾到下限', 3, 8],
  ['高於上限夾到上限', 45, 30],
  ['範圍內取整', '12.4', 12],
]) {
  test(`normalizeSizeValue 指定範圍時${name}`, () => {
    // Act & Assert
    assert.equal(normalizeSizeValue(input, [8, 30]), expected);
  });
}

test('淋浴龍頭組（頂噴＋手持）掛在牆上，龍頭離地 100 cm、頂噴約 215 cm', () => {
  // Act
  const shower = getCatalogItem('shower-set');

  // Assert
  assert.equal(shower.category, 'fixture');
  assert.equal(shower.placement, 'wall');
  assert.equal(shower.mountHeight, 100);
  assert.equal(shower.mountHeight + shower.size.h, 215);
});
