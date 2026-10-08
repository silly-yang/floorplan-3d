import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FloorplanError, RoomLeakError } from '../../../js/import/errors.js';
import { enclosedRegions, traceRoom } from '../../../js/import/rooms.js';

const BOUNDS = { xMin: -50, yMin: -50, xMax: 200, yMax: 200 };
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const area = (rects) => rects.reduce((sum, [x0, y0, x1, y1]) => sum + (x1 - x0) * (y1 - y0), 0);

// 內部淨空 0~100 × 0~100、牆厚 10 的四面牆
const closedBox = () => [rect(-10, -10, 110, 0), rect(-10, 100, 110, 110), rect(-10, 0, 0, 100), rect(100, 0, 110, 100)];
const withoutRightWall = () => closedBox().slice(0, 3);

test('traceRoom 封閉牆內填色剛好涵蓋室內', () => {
  // Act
  const rects = traceRoom([50, 50], closedBox(), BOUNDS, 5);

  // Assert
  assert.equal(area(rects), 100 * 100);
  assert.equal(Math.min(...rects.map((r) => r[0])), 0);
  assert.equal(Math.max(...rects.map((r) => r[2])), 100);
});

test('traceRoom 牆的缺口被邊界封住時不會漏出去', () => {
  // Arrange：右牆中間開 40 的口，再用一塊邊界把口封起來
  const walls = [...withoutRightWall(), rect(100, 0, 110, 30), rect(100, 70, 110, 100), rect(100, 30, 110, 70)];

  // Act
  const rects = traceRoom([50, 50], walls, BOUNDS, 5);

  // Assert
  assert.equal(area(rects), 100 * 100);
});

test('traceRoom 牆沒封閉時丟出漏水錯誤', () => {
  // Act & Assert
  assert.throws(() => traceRoom([50, 50], withoutRightWall(), BOUNDS, 5), RoomLeakError);
});

test('traceRoom 種子點落在牆內時丟出錯誤', () => {
  // Act & Assert
  assert.throws(() => traceRoom([-5, 50], closedBox(), BOUNDS, 5), (err) => err instanceof FloorplanError && /種子點/.test(err.message));
});

test('enclosedRegions 找出所有被牆圍住的區域，碰到範圍邊界的視為戶外', () => {
  // Arrange：左右兩間，中間共用一道牆
  const walls = [...closedBox(), rect(110, -10, 160, 0), rect(110, 100, 160, 110), rect(150, 0, 160, 100)];

  // Act
  const regions = enclosedRegions(walls, BOUNDS, 5);

  // Assert
  assert.deepEqual(regions.map(area).sort((a, b) => a - b), [40 * 100, 100 * 100]);
});

test('enclosedRegions 牆沒封閉的區域連到外面，不算房間', () => {
  // Act
  const regions = enclosedRegions(withoutRightWall(), BOUNDS, 5);

  // Assert
  assert.deepEqual(regions, []);
});
