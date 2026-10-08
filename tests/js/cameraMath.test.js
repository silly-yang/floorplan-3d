import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDoubleTapDetector, focusOn, zoomToward } from '../../js/core/cameraMath.js';

const v = (x, y, z) => ({ x, y, z });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const dir = (from, to) => {
  const d = dist(from, to);
  return [(to.x - from.x) / d, (to.y - from.y) / d, (to.z - from.z) / d];
};
const close = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

test('zoomToward 目標移到點擊處、距離減半、視線方向不變', () => {
  // Arrange
  const camera = v(0, 10, 10);
  const target = v(0, 0, 0);

  // Act
  const view = zoomToward(camera, target, v(2, 0, -1));

  // Assert
  assert.deepEqual(view.target, v(2, 0, -1));
  assert.ok(close(dist(view.position, view.target), dist(camera, target) / 2));
  dir(camera, target).forEach((c, i) => assert.ok(close(c, dir(view.position, view.target)[i])));
});

test('zoomToward 已經很近時不會比最小距離更近', () => {
  // Act
  const view = zoomToward(v(0, 1, 1), v(0, 0, 0), v(0, 0, 0));

  // Assert
  assert.ok(close(dist(view.position, view.target), 1.2));
});

test('focusOn 看向家具中心（含家具離地高度），大家具離得比較遠', () => {
  // Arrange
  const camera = v(0, 6, 6);
  const sofa = { x: 3, y: 2, elevation: 0, size: { w: 210, d: 90, h: 85 } };
  const coffee = { x: 3, y: 2, elevation: 0.9, size: { w: 25, d: 40, h: 35 } };

  // Act
  const big = focusOn(camera, v(0, 0, 0), sofa);
  const small = focusOn(camera, v(0, 0, 0), coffee);

  // Assert：平面 (x, y) → 世界 (x, -y)
  assert.ok(close(big.target.x, 3) && close(big.target.z, -2));
  assert.ok(close(big.target.y, 0.425));
  assert.ok(close(small.target.y, 0.9 + 0.175));
  assert.ok(dist(big.position, big.target) > dist(small.position, small.target));
});

for (const [name, taps, expected] of [
  ['快速點兩下同一處算雙擊', [[100, 100, 0], [104, 102, 200]], [false, true]],
  ['間隔太久不算', [[100, 100, 0], [100, 100, 600]], [false, false]],
  ['兩次位置差太遠不算', [[100, 100, 0], [200, 100, 100]], [false, false]],
  ['雙擊後的第三下重新計算', [[100, 100, 0], [100, 100, 100], [100, 100, 200]], [false, true, false]],
]) {
  test(`createDoubleTapDetector ${name}`, () => {
    // Arrange
    const detector = createDoubleTapDetector();

    // Act
    const results = taps.map(([x, y, t]) => detector.tap(x, y, t));

    // Assert
    assert.deepEqual(results, expected);
  });
}
