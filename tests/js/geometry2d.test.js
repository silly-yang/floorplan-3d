import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pointInPolygon,
  pointSegmentDistance,
  polygonDistance,
  polygonsIntersect,
  rectCorners,
} from '../../js/core/geometry2d.js';

const square = (x0, y0, s) => [[x0, y0], [x0 + s, y0], [x0 + s, y0 + s], [x0, y0 + s]];
const close = (a, b) => Math.abs(a - b) < 1e-9;

for (const [name, pt, expected] of [
  ['中心在內', [0.5, 0.5], true],
  ['右側在外', [1.5, 0.5], false],
  ['左下在外', [-0.1, -0.1], false],
]) {
  test(`pointInPolygon ${name}`, () => {
    // Act
    const result = pointInPolygon(pt, square(0, 0, 1));

    // Assert
    assert.equal(result, expected);
  });
}

for (const [name, p, expected] of [
  ['垂足落在線段內', [0.5, 2], 2],
  ['超過端點取端點距離', [4, 4], 5],
  ['點在線段上', [0.3, 0], 0],
]) {
  test(`pointSegmentDistance ${name}`, () => {
    // Act
    const d = pointSegmentDistance(p, [0, 0], [1, 0]);

    // Assert
    assert.ok(close(d, expected), `got ${d}`);
  });
}

for (const [name, b, expected] of [
  ['邊相交', square(0.5, 0.5, 1), true],
  ['完全包含', square(0.25, 0.25, 0.5), true],
  ['分離', square(2, 0, 1), false],
  ['只碰到邊不算重疊', square(1, 0, 1), false],
]) {
  test(`polygonsIntersect ${name}`, () => {
    // Act
    const result = polygonsIntersect(square(0, 0, 1), b);

    // Assert
    assert.equal(result, expected);
  });
}

test('polygonDistance 分離時回傳最近邊距', () => {
  // Act
  const d = polygonDistance(square(0, 0, 1), square(1.3, 0.2, 1));

  // Assert
  assert.ok(close(d, 0.3), `got ${d}`);
});

test('polygonDistance 相交時為 0', () => {
  // Act
  const d = polygonDistance(square(0, 0, 1), square(0.5, 0.5, 1));

  // Assert
  assert.equal(d, 0);
});

test('rectCorners 未旋轉時為軸對齊矩形', () => {
  // Act
  const corners = rectCorners(1, 1, 2, 1, 0);

  // Assert
  assert.deepEqual(corners, [[0, 0.5], [2, 0.5], [2, 1.5], [0, 1.5]]);
});

test('rectCorners 旋轉 90 度時寬深對調', () => {
  // Act
  const corners = rectCorners(0, 0, 2, 1, 90);

  // Assert
  const xs = corners.map(([x]) => x);
  const ys = corners.map(([, y]) => y);
  assert.ok(close(Math.max(...xs) - Math.min(...xs), 1));
  assert.ok(close(Math.max(...ys) - Math.min(...ys), 2));
});
