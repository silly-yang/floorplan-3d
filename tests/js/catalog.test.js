import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG, SIZE_LIMITS, createFurniture, getCatalogItem, normalizeSizeValue } from '../../js/furniture/catalog.js';

const REQUIRED_FURNITURE = [
  'sofa', 'armchair', 'coffee-table', 'dining-table', 'dining-chair', 'double-bed', 'single-bed',
  'wardrobe', 'desk', 'tv-stand', 'fridge', 'rug', 'plant', 'kitchen-island',
];
const REQUIRED_APPLIANCES = [
  'coffee-machine', 'microwave', 'rice-cooker', 'laptop', 'desk-lamp',
  'robot-vacuum', 'washing-machine', 'air-purifier', 'fan', 'floor-lamp',
];
const REQUIRED_FIXTURES = ['kitchen-counter', 'toilet', 'basin'];
const REQUIRED = [...REQUIRED_FURNITURE, ...REQUIRED_APPLIANCES, ...REQUIRED_FIXTURES];

test('目錄包含需求列出的家具與家電，每種都有中文名稱與正數尺寸', () => {
  // Act
  const types = CATALOG.map((c) => c.type);

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

test('每個項目都分到家具、家電或廚衛，且放置方式只有地面或檯面兩種', () => {
  // Act
  const byCategory = (cat) => CATALOG.filter((c) => c.category === cat).map((c) => c.type).sort();

  // Assert
  assert.deepEqual(byCategory('furniture'), [...REQUIRED_FURNITURE].sort());
  assert.deepEqual(byCategory('appliance'), [...REQUIRED_APPLIANCES].sort());
  assert.deepEqual(byCategory('fixture'), [...REQUIRED_FIXTURES].sort());
  for (const item of CATALOG) assert.ok(['floor', 'surface'].includes(item.placement), item.type);
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
