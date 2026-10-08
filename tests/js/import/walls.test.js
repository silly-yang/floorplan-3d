import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDxf } from '../../../js/import/dxf.js';
import { polygonArea } from '../../../js/import/geometry.js';
import { extractWalls } from '../../../js/import/walls.js';
import { baseConfig, dxf } from './dxfFactory.js';

const areas = (walls) => walls.map((w) => Math.abs(polygonArea(w.polygon))).sort((a, b) => a - b);

test('extractWalls RC 牆的四條線組成 rc 多邊形', () => {
  // Arrange
  const doc = parseDxf(dxf.document(dxf.rectLines('L3', 0, 0, 300, 15)));

  // Act
  const result = extractWalls(doc, baseConfig());

  // Assert
  assert.deepEqual(result.walls.map((w) => w.kind), ['rc']);
  assert.deepEqual(areas(result.walls), [4500]);
  assert.equal(result.openChains, 0);
});

for (const [layer, kind] of [['WALL2', 'partition'], ['L12', 'column']]) {
  test(`extractWalls 封閉 LWPOLYLINE 依圖層對應牆種：${layer} → ${kind}`, () => {
    // Arrange
    const square = [[0, 0], [10, 0], [10, 120], [0, 120]];
    const doc = parseDxf(dxf.document([dxf.lwpolyline(layer, square, true)]));

    // Act
    const result = extractWalls(doc, baseConfig());

    // Assert
    assert.deepEqual(result.walls.map((w) => w.kind), [kind]);
    assert.deepEqual(areas(result.walls), [1200]);
  });
}

test('extractWalls 忽略其他圖層與 clip 範圍外的牆', () => {
  // Arrange
  const config = { ...baseConfig(), clip: { xMin: 0, yMin: 0, xMax: 1000, yMax: 1000 } };
  const entities = [
    ...dxf.rectLines('L3', 0, 0, 300, 15),
    ...dxf.rectLines('L3', 2300, 0, 2600, 15),
    ...dxf.rectLines('S01-RC大梁', 0, 100, 300, 130),
  ];
  const doc = parseDxf(dxf.document(entities));

  // Act
  const result = extractWalls(doc, config);

  // Assert
  assert.equal(result.walls.length, 1);
});

test('extractWalls 沒封閉的牆線計入開放鏈數', () => {
  // Arrange
  const doc = parseDxf(dxf.document([dxf.line('L3', [0, 0], [300, 0]), dxf.line('L3', [300, 0], [300, 300])]));

  // Act
  const result = extractWalls(doc, baseConfig());

  // Assert
  assert.deepEqual(result.walls, []);
  assert.equal(result.openChains, 1);
});

test('extractWalls 共用頂點的封閉 LWPOLYLINE 各自成牆', () => {
  // Arrange：ㄈ 形三塊隔間牆，中間那塊的兩端都和上下兩塊共用頂點
  const doc = parseDxf(dxf.document([
    dxf.lwpolyline('WALL2', [[0, 0], [300, 0], [300, 10], [0, 10]], true),
    dxf.lwpolyline('WALL2', [[0, 10], [10, 10], [10, 190], [0, 190]], true),
    dxf.lwpolyline('WALL2', [[0, 190], [300, 190], [300, 200], [0, 200]], true),
  ]));

  // Act
  const result = extractWalls(doc, baseConfig());

  // Assert
  assert.deepEqual(areas(result.walls), [1800, 3000, 3000]);
});

test('extractWalls 共用頂點的 LINE 矩形各自成牆（四岔路口）', () => {
  // Arrange
  const doc = parseDxf(dxf.document([
    ...dxf.rectLines('L3', 0, 0, 300, 15),
    ...dxf.rectLines('L3', 0, 15, 15, 185),
    ...dxf.rectLines('L3', 0, 185, 300, 200),
  ]));

  // Act
  const result = extractWalls(doc, baseConfig());

  // Assert
  assert.deepEqual(areas(result.walls), [2550, 4500, 4500]);
});
