import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clipRuns, wallFaceRuns } from '../../js/core/trim.js';

const wall = (id, polygon, kind = 'rc') => ({ id, kind, polygon });
const ends = (runs) => runs.map((r) => [r.start, r.end]);
const run = (over = {}) => ({ wallId: 'w', a: [0, 0], b: [4, 0], dir: [1, 0], out: [0, 1], start: 'convex', end: 'reflex', ...over });

test('wallFaceRuns 方柱四邊各一段，外角兩端都是 convex', () => {
  // Act
  const runs = wallFaceRuns([wall('w', [[0, 0], [2, 0], [2, 2], [0, 2]])]);

  // Assert
  assert.equal(runs.length, 4);
  assert.deepEqual(ends(runs), Array(4).fill(['convex', 'convex']));
  assert.deepEqual(runs[0], { wallId: 'w', a: [0, 0], b: [2, 0], dir: [1, 0], out: [0, -1], start: 'convex', end: 'convex' });
});

test('wallFaceRuns 順時針的多邊形，out 一樣朝牆外', () => {
  // Act
  const runs = wallFaceRuns([wall('w', [[0, 0], [0, 2], [2, 2], [2, 0]])]);

  // Assert
  assert.deepEqual(runs.slice(0, 2).map((r) => r.out), [[-1, 0], [0, 1]]);
});

test('wallFaceRuns L 形牆的內角是 reflex，其他是 convex', () => {
  // Act
  const runs = wallFaceRuns([wall('w', [[0, 0], [3, 0], [3, 1], [1, 1], [1, 3], [0, 3]])]);

  // Assert：第 3 段（3,1→1,1）的終點與第 4 段（1,1→1,3）的起點是內角
  assert.deepEqual(ends(runs), [
    ['convex', 'convex'],
    ['convex', 'convex'],
    ['convex', 'reflex'],
    ['reflex', 'convex'],
    ['convex', 'convex'],
    ['convex', 'convex'],
  ]);
});

test('wallFaceRuns 太短的邊（牆端面）不貼，相鄰兩段在那一端是 square', () => {
  // Act
  const runs = wallFaceRuns([wall('w', [[0, 0], [3, 0], [3, 0.1], [0, 0.1]])]);

  // Assert
  assert.equal(runs.length, 2);
  assert.deepEqual(ends(runs), [['square', 'square'], ['square', 'square']]);
});

test('wallFaceRuns 端點頂到另一道牆的牆面時是 butt', () => {
  // Arrange：B 牆從 A 牆的上緣往上長
  const a = wall('A', [[0, 0], [3, 0], [3, 0.1], [0, 0.1]]);
  const b = wall('B', [[1, 0.1], [1.1, 0.1], [1.1, 2], [1, 2]]);

  // Act
  const runs = wallFaceRuns([a, b]).filter((r) => r.wallId === 'B');

  // Assert
  assert.deepEqual(runs.map((r) => [r.a, r.b, r.start, r.end]), [
    [[1.1, 0.1], [1.1, 2], 'butt', 'square'],
    [[1, 2], [1, 0.1], 'square', 'butt'],
  ]);
});

test('wallFaceRuns 與另一道牆頭尾相接、牆面連成一直線時是 square', () => {
  // Arrange：牆 A 右端接著開口上方的楣樑 L
  const a = wall('A', [[0, 0], [2, 0], [2, 0.15], [0, 0.15]]);
  const lintel = wall('L', [[2, 0], [3, 0], [3, 0.15], [2, 0.15]], 'lintel');

  // Act
  const runs = wallFaceRuns([a, lintel]);

  // Assert
  assert.deepEqual(runs.map((r) => [r.wallId, r.start, r.end]), [
    ['A', 'square', 'square'],
    ['A', 'square', 'square'],
    ['L', 'square', 'square'],
    ['L', 'square', 'square'],
  ]);
});

test('wallFaceRuns 柱子不貼，頂到柱子也不算 butt', () => {
  // Arrange
  const column = wall('C', [[0, 0], [3, 0], [3, 0.1], [0, 0.1]], 'column');
  const b = wall('B', [[1, 0.1], [1.1, 0.1], [1.1, 2], [1, 2]]);

  // Act
  const runs = wallFaceRuns([column, b]);

  // Assert
  assert.ok(runs.every((r) => r.wallId === 'B'));
  assert.deepEqual(ends(runs), [['square', 'square'], ['square', 'square']]);
});

test('wallFaceRuns 可以指定最短邊長', () => {
  // Act
  const runs = wallFaceRuns([wall('w', [[0, 0], [3, 0], [3, 0.1], [0, 0.1]])], { minEdge: 0.05 });

  // Assert
  assert.equal(runs.length, 4);
});

test('clipRuns 整段都在區域內：保留原本的轉角接法並帶上高度', () => {
  // Act
  const pieces = clipRuns([run()], [{ rect: [-1, 0, 5, 2], height: 2.6 }]);

  // Assert
  assert.deepEqual(pieces, [{ ...run(), height: 2.6 }]);
});

test('clipRuns 只有一部分在區域內：裁切處改成 square', () => {
  // Act
  const pieces = clipRuns([run()], [{ rect: [1, 0, 3, 2], height: 2.6 }]);

  // Assert
  assert.deepEqual(pieces, [{ ...run(), a: [1, 0], b: [3, 0], start: 'square', end: 'square', height: 2.6 }]);
});

test('clipRuns 區域在牆的另一側時沒有線板', () => {
  // Act
  const pieces = clipRuns([run()], [{ rect: [0, -2, 4, 0], height: 2.6 }]);

  // Assert
  assert.deepEqual(pieces, []);
});

test('clipRuns 跨兩個區域：各自一段、各自高度', () => {
  // Act
  const pieces = clipRuns([run()], [{ rect: [0, 0, 2, 2], height: 2.6 }, { rect: [2, 0, 4, 2], height: 2.4 }]);

  // Assert
  assert.deepEqual(pieces.map((p) => [p.a, p.b, p.start, p.end, p.height]), [
    [[0, 0], [2, 0], 'convex', 'square', 2.6],
    [[2, 0], [4, 0], 'square', 'reflex', 2.4],
  ]);
});
