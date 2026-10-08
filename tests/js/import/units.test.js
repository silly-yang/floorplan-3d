import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDxf } from '../../../js/import/dxf.js';
import { suggestUnitScale } from '../../../js/import/units.js';
import { dxf } from './dxfFactory.js';

// 一道長 long、厚 15 的牆（圖面單位），插在 (x, y)
const wall = (long, layer = 'L3', x = 0, y = 0) => dxf.lwpolyline(layer, [[x, y], [x + long, y], [x + long, y + 15], [x, y + 15]], true);
const docOf = (entities, insunits) => parseDxf(dxf.document(entities, {}, { insunits }));

for (const [name, insunits, long, expected] of [
  ['檔頭公分且外框合理', 5, 920, { scale: 0.01, source: 'header', headerScale: 0.01 }],
  ['檔頭寫公釐但看起來是公分', 4, 920, { scale: 0.01, source: 'extent', headerScale: 0.001 }],
  ['沒有檔頭，外框看起來是公釐', null, 9200, { scale: 0.001, source: 'extent', headerScale: null }],
  ['檔頭公尺且外框合理', 6, 9.2, { scale: 1, source: 'header', headerScale: 1 }],
  ['檔頭公釐、外框都不合理時照檔頭', 4, 100000, { scale: 0.001, source: 'header', headerScale: 0.001 }],
  ['沒有檔頭、外框都不合理時回 null', null, 100000, { scale: null, source: 'header', headerScale: null }],
]) {
  test(`suggestUnitScale 檔頭與外框互相印證：${name}`, () => {
    // Arrange
    const doc = docOf([wall(long)], insunits);

    // Act
    const result = suggestUnitScale(doc, { layers: ['L3'] });

    // Assert
    assert.deepEqual(result, expected);
  });
}

for (const [name, long, expected] of [
  ['長邊剛好 3 m 算合理', 3, 1],
  ['長邊不到 3 m 不合理', 2.9, null],
  ['長邊剛好 60 m 算合理', 60, 1],
  ['長邊超過 60 m 不合理', 61, null],
]) {
  test(`suggestUnitScale 換算後長邊要在 3～60 m：${name}`, () => {
    // Arrange：用公尺圖，換算不經過浮點乘法誤差
    const doc = docOf([dxf.line('L3', [0, 0], [long, 0])], null);

    // Act
    const { scale } = suggestUnitScale(doc, { layers: ['L3'] });

    // Assert
    assert.equal(scale, expected);
  });
}

test('suggestUnitScale 有牆圖層時只看牆，不被圖框、標題欄撐大', () => {
  // Arrange：牆 920 cm，旁邊有一張 50000 寬的圖框
  const doc = docOf([wall(920), dxf.line('FRAME', [-20000, 0], [30000, 0])], 4);

  // Act
  const result = suggestUnitScale(doc, { layers: ['L3'] });

  // Assert
  assert.deepEqual(result, { scale: 0.01, source: 'extent', headerScale: 0.001 });
});

test('suggestUnitScale 也接受設定格式的 layers，取牆、隔間、柱子圖層', () => {
  // Arrange
  const doc = docOf([wall(920, 'WALL2'), dxf.line('FRAME', [-20000, 0], [30000, 0])], 4);

  // Act
  const result = suggestUnitScale(doc, { layers: { rcWall: ['L3'], partition: ['WALL2'], column: [], window: ['FRAME'] } });

  // Assert
  assert.equal(result.scale, 0.01);
});

test('suggestUnitScale 牆圖層沒有圖元時改看全部圖元', () => {
  // Arrange
  const doc = docOf([wall(920, 'OTHER')], 4);

  // Act
  const result = suggestUnitScale(doc, { layers: ['L3'] });

  // Assert
  assert.deepEqual(result, { scale: 0.01, source: 'extent', headerScale: 0.001 });
});

test('suggestUnitScale 有 clip 時只看 clip 內的點', () => {
  // Arrange：clip 內一戶 920 cm；clip 外還有另一戶，合起來外框超過 60 m
  const doc = docOf([wall(920), wall(920, 'L3', 9000, 0)], 4);

  // Act
  const result = suggestUnitScale(doc, { layers: ['L3'], clip: { xMin: -100, yMin: -100, xMax: 1500, yMax: 1500 } });

  // Assert
  assert.deepEqual(result, { scale: 0.01, source: 'extent', headerScale: 0.001 });
});

test('suggestUnitScale 沒有任何座標時照檔頭', () => {
  // Arrange
  const doc = docOf(['0\nSEQEND\n8\nL3'], 5);

  // Act
  const result = suggestUnitScale(doc, {});

  // Assert
  assert.deepEqual(result, { scale: 0.01, source: 'header', headerScale: 0.01 });
});
