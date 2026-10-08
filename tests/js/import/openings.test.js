import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDxf } from '../../../js/import/dxf.js';
import { ConfigError } from '../../../js/import/errors.js';
import { polygonArea } from '../../../js/import/geometry.js';
import { findGaps, findOpenings } from '../../../js/import/openings.js';
import { extractWalls } from '../../../js/import/walls.js';
import { baseConfig, dxf } from './dxfFactory.js';

// 兩段 RC 牆沿 x 軸排列，中間留 gap 寬的開口（x 從 100 到 100+gap，牆厚 15）
const twoWalls = (gap) => [...dxf.rectLines('L3', 0, 0, 100, 15), ...dxf.rectLines('L3', 100 + gap, 0, 300 + gap, 15)];

function setup(entities, config = baseConfig(), blocks = {}) {
  const doc = parseDxf(dxf.document(entities, blocks));
  return { doc, config, walls: extractWalls(doc, config).walls };
}

const brief = (o) => [o.id, o.kind, o.label, o.sill, o.head];

test('findGaps 90 的開口回傳一個橫跨牆厚的矩形（兩側射線去重）', () => {
  // Arrange
  const { walls } = setup(twoWalls(90));

  // Act
  const gaps = findGaps(walls, 30, 250, 0.01);

  // Assert
  assert.equal(gaps.length, 1);
  const xs = [...new Set(gaps[0].map(([x]) => x))].sort((a, b) => a - b);
  const ys = [...new Set(gaps[0].map(([, y]) => y))].sort((a, b) => a - b);
  assert.deepEqual([xs, ys], [[100, 190], [0, 15]]);
});

test('findGaps 隔間牆端面朝向另一道牆的長邊也算開口', () => {
  // Arrange
  const { walls } = setup([
    dxf.lwpolyline('WALL2', [[0, 0], [300, 0], [300, 10], [0, 10]], true),
    dxf.lwpolyline('WALL2', [[100, 100], [110, 100], [110, 400], [100, 400]], true),
  ]);

  // Act
  const gaps = findGaps(walls, 30, 250, 0.01);

  // Assert
  assert.equal(gaps.length, 1);
  assert.equal(Math.abs(polygonArea(gaps[0])), 10 * 90);
});

for (const [name, gap] of [['牆相接', 0], ['小於下限', 20], ['大於上限', 400]]) {
  test(`findGaps 寬度不在範圍內時忽略：${name}`, () => {
    // Arrange
    const { walls } = setup(twoWalls(gap));

    // Act
    const gaps = findGaps(walls, 30, 250, 0.01);

    // Assert
    assert.deepEqual(gaps, []);
  });
}

test('findOpenings 開口內有窗線時分類為窗並套用窗型高度', () => {
  // Arrange
  const { doc, config, walls } = setup([
    ...twoWalls(160),
    dxf.line('OPEN-Window', [100, 7.5], [260, 7.5]),
    dxf.attrib('OPEN-Window', [170, 60], 'NO.', 'W5'),
  ]);

  // Act
  const openings = findOpenings(doc, walls, config);

  // Assert
  assert.deepEqual(openings.map(brief), [['W5-1', 'window', 'W5', 0.9, 2.1]]);
});

test('findOpenings 窗編號不在 windowTypes 時丟出設定錯誤', () => {
  // Arrange
  const { doc, config, walls } = setup([
    ...twoWalls(160),
    dxf.line('OPEN-Window', [100, 7.5], [260, 7.5]),
    dxf.attrib('OPEN-Window', [170, 60], 'NO.', 'W9'),
  ]);

  // Act & Assert
  assert.throws(() => findOpenings(doc, walls, config), (err) => err instanceof ConfigError && /W9/.test(err.message));
});

test('findOpenings 開口旁有門圖塊時分類為門，編號取 ATTDEF 的 tag', () => {
  // Arrange
  const { doc, config, walls } = setup(
    [...twoWalls(110), dxf.insert('OPEN-Door', 'DOOR1', [100, 15]), dxf.attdef('OPEN-Door', [150, -60], 'FD2', 'D7')],
    baseConfig(),
    { DOOR1: [dxf.arc('OPEN-Door', [0, 0], 100, 270, 0)] },
  );

  // Act
  const openings = findOpenings(doc, walls, config);

  // Assert
  assert.deepEqual(openings.map(brief), [['FD2-1', 'door', 'FD2', 0, 2.1]]);
});

test('findOpenings 開口內什麼都沒有時分類為門洞', () => {
  // Arrange
  const { doc, config, walls } = setup(twoWalls(90));

  // Act
  const openings = findOpenings(doc, walls, config);

  // Assert
  assert.deepEqual(openings.map(brief), [['doorway-1', 'doorway', '', 0, 2.2]]);
});

test('findOpenings ignoreOpenings 列出的開口不輸出', () => {
  // Arrange
  const { doc, config, walls } = setup(twoWalls(90), { ...baseConfig(), ignoreOpenings: ['doorway-1'] });

  // Act
  const openings = findOpenings(doc, walls, config);

  // Assert
  assert.deepEqual(openings, []);
});

test('findOpenings 圖面上的自由文字不當成編號（避免地址外流）', () => {
  // Arrange
  const { doc, config, walls } = setup([
    ...twoWalls(160),
    dxf.line('OPEN-Window', [100, 7.5], [260, 7.5]),
    dxf.attrib('OPEN-Window', [170, 60], 'NO.', '某某路1號'),
  ]);

  // Act & Assert
  assert.throws(() => findOpenings(doc, walls, config), (err) => err instanceof ConfigError && /沒有編號/.test(err.message));
});

for (const [name, label] of [['小寫', 'w5'], ['字母太多', 'ABCD1'], ['數字太多', 'W1234'], ['夾帶其他文字', 'W5 3F']]) {
  test(`findOpenings 編號只接受大寫 1～3 字母加 1～3 數字：${name}`, () => {
    // Arrange
    const config = { ...baseConfig(), windowTypes: { [label]: { sill: 0.9, head: 2.1 } } };
    const { doc, walls } = setup([
      ...twoWalls(160),
      dxf.line('OPEN-Window', [100, 7.5], [260, 7.5]),
      dxf.attrib('OPEN-Window', [170, 60], 'NO.', label),
    ], config);

    // Act & Assert
    assert.throws(() => findOpenings(doc, walls, config), (err) => err instanceof ConfigError && /沒有編號/.test(err.message));
  });
}

test('findOpenings clip 範圍外的編號不採用', () => {
  // Arrange：編號在開口旁邊，但落在 clip 外（同一張圖上別戶的編號）
  const config = { ...baseConfig(), clip: { xMin: -1000, yMin: -1000, xMax: 5000, yMax: 50 } };
  const { doc, walls } = setup([
    ...twoWalls(160),
    dxf.line('OPEN-Window', [100, 7.5], [260, 7.5]),
    dxf.attrib('OPEN-Window', [170, 60], 'NO.', 'W5'),
  ], config);

  // Act & Assert
  assert.throws(() => findOpenings(doc, walls, config), (err) => err instanceof ConfigError && /沒有編號/.test(err.message));
});

test('findOpenings 門圖塊只歸給最近的開口，旁邊的開口仍是門洞', () => {
  // Arrange：三段牆留兩個開口，門的插入點貼著第一個、離第二個 20 單位
  const { doc, config, walls } = setup(
    [
      ...dxf.rectLines('L3', 0, 0, 100, 15),
      ...dxf.rectLines('L3', 175, 0, 195, 15),
      ...dxf.rectLines('L3', 285, 0, 400, 15),
      dxf.insert('OPEN-Door', 'DOOR1', [165, 15]),
    ],
    baseConfig(),
    { DOOR1: [dxf.arc('OPEN-Door', [0, 0], 70, 180, 270)] },
  );

  // Act
  const openings = findOpenings(doc, walls, config);

  // Assert
  assert.deepEqual(openings.map((o) => o.kind), ['door', 'doorway']);
});
