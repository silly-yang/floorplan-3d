import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDxf } from '../../../js/import/dxf.js';
import { guessLayerRoles, summarizeLayers } from '../../../js/import/layers.js';
import { dxf } from './dxfFactory.js';

test('summarizeLayers 統計每個圖層的數量、外框與圖元類型，依數量由多到少', () => {
  // Arrange
  const doc = parseDxf(dxf.document([
    dxf.line('A', [0, 0], [10, 5]),
    dxf.lwpolyline('B', [[-5, 2], [20, 2], [20, 30]], false),
    dxf.line('B', [1, -3], [4, 4]),
    dxf.text('B', [7, 8], 'X'),
  ]));

  // Act
  const summary = summarizeLayers(doc);

  // Assert
  assert.deepEqual(summary, [
    { name: 'B', count: 3, bbox: [-5, -3, 20, 30], types: { LWPOLYLINE: 1, LINE: 1, TEXT: 1 } },
    { name: 'A', count: 1, bbox: [0, 0, 10, 5], types: { LINE: 1 } },
  ]);
});

test('summarizeLayers 數量相同時依圖層名稱排序，圖塊內的圖元不計入', () => {
  // Arrange
  const doc = parseDxf(dxf.document(
    [dxf.line('Z', [0, 0], [1, 1]), dxf.line('M', [0, 0], [1, 1])],
    { DOOR1: [dxf.arc('Z', [0, 0], 90, 0, 90)] },
  ));

  // Act
  const names = summarizeLayers(doc).map((s) => [s.name, s.count]);

  // Assert
  assert.deepEqual(names, [['M', 1], ['Z', 1]]);
});

test('summarizeLayers 圖層上沒有座標的圖元時外框為 null', () => {
  // Arrange
  const doc = parseDxf(dxf.document(['0\nSEQEND\n8\nEMPTY']));

  // Act
  const [layer] = summarizeLayers(doc);

  // Assert
  assert.deepEqual(layer, { name: 'EMPTY', count: 1, bbox: null, types: { SEQEND: 1 } });
});

const layer = (name) => ({ name, count: 1, bbox: [0, 0, 1, 1], types: { LINE: 1 } });

for (const [name, expected] of [
  ['WALL', 'wall'],
  ['A-WALL', 'wall'],
  ['wall2', 'wall'],
  ['RC牆', 'wall'],
  ['WINDOW', 'window'],
  ['OPEN-Window', 'window'],
  ['A-WIN', 'window'],
  ['窗', 'window'],
  ['DOOR', 'door'],
  ['a-door-swing', 'door'],
  ['門', 'door'],
  ['BEAM', 'beam'],
  ['S01-RC大梁', 'beam'],
  ['樑', 'beam'],
]) {
  test(`guessLayerRoles 依常見命名猜用途（不分大小寫）：${name} → ${expected}`, () => {
    // Act
    const roles = guessLayerRoles([layer(name)]);

    // Assert
    const hits = Object.entries(roles).filter(([, names]) => names.includes(name)).map(([role]) => role);
    assert.deepEqual(hits, [expected]);
  });
}

test('guessLayerRoles 猜不到的圖層不歸類，各用途回空陣列', () => {
  // Act
  const roles = guessLayerRoles([layer('L3'), layer('WINDSOR'), layer('DIM')]);

  // Assert
  assert.deepEqual(roles, { wall: [], window: [], door: [], beam: [] });
});

test('guessLayerRoles 同一用途的多個圖層照摘要順序列出', () => {
  // Act
  const roles = guessLayerRoles([layer('WALL2'), layer('DIM'), layer('A-WALL')]);

  // Assert
  assert.deepEqual(roles.wall, ['WALL2', 'A-WALL']);
});
