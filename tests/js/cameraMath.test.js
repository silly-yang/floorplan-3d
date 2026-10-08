import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arrowOffset, createDoubleTapDetector, focusOn, walkStart, zoomToward } from '../../js/core/cameraMath.js';

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

// ---------- 漫遊起點 ----------

const room = (id, rects) => ({ id, name: id, rects });

test('walkStart 從面積最大的房間開始，站在最大一塊矩形長邊的 20% 處，面向另一端', () => {
  // Arrange：客廳 4×2（東西向較長）比臥室 3×2 大
  const rooms = [room('bed', [[10, 0, 13, 2]]), room('living', [[0, 0, 4, 2], [0, 2, 1, 2.5]])];

  // Act
  const start = walkStart(rooms);

  // Assert：平面 (0.8, 1) → 世界 z = -1；朝 +x 看是 yaw -π/2
  assert.ok(close(start.x, 0.8), `${start.x}`);
  assert.ok(close(start.z, -1), `${start.z}`);
  assert.ok(close(start.yaw, -Math.PI / 2), `${start.yaw}`);
});

test('walkStart 南北向較長的矩形從南端出發、面向北（yaw 0）', () => {
  // Act
  const start = walkStart([room('hall', [[0, 0, 2, 5]])]);

  // Assert：平面 (1, 1) → 世界 z = -1
  assert.ok(close(start.x, 1), `${start.x}`);
  assert.ok(close(start.z, -1), `${start.z}`);
  assert.ok(close(start.yaw, 0), `${start.yaw}`);
});

test('walkStart 房間面積以所有矩形加總比較，不是只看最大的一塊', () => {
  // Arrange：A 單塊 3×1＝3；B 兩塊 2×1＋2×1＝4
  const rooms = [room('a', [[0, 0, 3, 1]]), room('b', [[10, 0, 12, 1], [10, 1, 12, 2]])];

  // Act & Assert
  assert.ok(walkStart(rooms).x >= 10);
});

test('walkStart 沒有房間時回 null', () => {
  // Act & Assert
  assert.equal(walkStart([]), null);
});

// ---------- 方向鍵移動 ----------
// screenUp：畫面「上」在平面上的方向（平面座標 x 向東、y 向北）

const offsetClose = (actual, expected) => actual && close(actual[0], expected[0]) && close(actual[1], expected[1]);

for (const [name, key, screenUp, expected] of [
  ['畫面上方朝北時，↑ 往北', 'ArrowUp', [0, 1], [0, 0.05]],
  ['畫面上方朝北時，→ 往東', 'ArrowRight', [0, 1], [0.05, 0]],
  ['畫面上方朝北時，↓ 往南', 'ArrowDown', [0, 1], [0, -0.05]],
  ['畫面上方朝北時，← 往西', 'ArrowLeft', [0, 1], [-0.05, 0]],
  ['畫面上方朝東時，↑ 往東', 'ArrowUp', [1, 0], [0.05, 0]],
  ['畫面上方朝東時，→ 往南', 'ArrowRight', [1, 0], [0, -0.05]],
  ['斜看時取比較接近的軸（偏北）', 'ArrowUp', [0.4, 0.9], [0, 0.05]],
  ['斜看時取比較接近的軸（偏西）', 'ArrowUp', [-0.9, 0.3], [-0.05, 0]],
]) {
  test(`arrowOffset ${name}`, () => {
    // Act
    const offset = arrowOffset(key, screenUp, 0.05);

    // Assert
    assert.ok(offsetClose(offset, expected), `${offset}`);
  });
}

test('arrowOffset 不是方向鍵時回 null', () => {
  // Act & Assert
  assert.equal(arrowOffset('KeyR', [0, 1], 0.05), null);
});
