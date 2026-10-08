import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gridLines } from '../../js/core/gridLines.js';

const close = (a, b) => Math.abs(a - b) < 1e-9;

test('gridLines 涵蓋 0～width、0～depth，每 10 cm 一條線', () => {
  // Act
  const lines = gridLines({ width: 1, depth: 0.5 });

  // Assert：直線 x = 0, 0.1 … 1.0 共 11 條；橫線 y = 0 … 0.5 共 6 條
  assert.equal(lines.filter((l) => l.axis === 'x').length, 11);
  assert.equal(lines.filter((l) => l.axis === 'y').length, 6);
});

test('gridLines 整公尺的線標記為粗線，其他是細線', () => {
  // Act
  const lines = gridLines({ width: 2, depth: 0.3 });

  // Assert
  const majors = lines.filter((l) => l.major).map((l) => [l.axis, l.at]);
  assert.deepEqual(majors, [['x', 0], ['x', 1], ['x', 2], ['y', 0]]);
});

test('gridLines 寬度不是 10 cm 的倍數時最後一條不超出範圍，且座標沒有浮點誤差', () => {
  // Act
  const xs = gridLines({ width: 0.35, depth: 0.1 }).filter((l) => l.axis === 'x').map((l) => l.at);

  // Assert
  assert.deepEqual(xs, [0, 0.1, 0.2, 0.3]);
});

test('gridLines 線段從一邊拉到另一邊', () => {
  // Act
  const line = gridLines({ width: 1, depth: 0.5 }).find((l) => l.axis === 'x' && close(l.at, 0.3));

  // Assert
  assert.ok(line, '找不到 x = 0.3 的線');
  assert.deepEqual([line.from, line.to], [[0.3, 0], [0.3, 0.5]]);
});
