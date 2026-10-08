import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG, SIZE_LIMITS, createFurniture, getCatalogItem, normalizeSizeValue } from '../../js/furniture/catalog.js';

const REQUIRED = [
  'sofa', 'armchair', 'coffee-table', 'dining-table', 'dining-chair', 'double-bed', 'single-bed',
  'wardrobe', 'desk', 'tv-stand', 'fridge', 'rug', 'plant',
];

test('目錄包含需求列出的 13 種家具，每種都有中文名稱與正數尺寸', () => {
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
