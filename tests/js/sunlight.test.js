import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exteriorSide, shadowFrustum, sunDirection } from '../../js/core/sunlight.js';

const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const close = (a, b) => Math.abs(a - b) < 1e-6;
const assertVec = (actual, expected) => assert.ok(actual.every((v, i) => close(v, expected[i])), `${actual} ≠ ${expected}`);
const deg = Math.PI / 180;
const room = { id: 'a', rects: [[0, 0, 4, 3]] };
const northWindow = { id: 'W-N', kind: 'window', polygon: rect(1, 3, 2.5, 3.15), sill: 0.9, head: 2.1 };
const southWindow = { id: 'W-S', kind: 'window', polygon: rect(1, -0.15, 2.5, 0), sill: 0.9, head: 2.1 };
const westWindow = { id: 'W-W', kind: 'window', polygon: rect(-0.15, 1, 0, 2.5), sill: 0.9, head: 2.1 };
const plan = (openings, rooms = [room]) => ({ openings, rooms });
// 往 (hx, hy) 水平方向、仰角 35° 的單位向量
const toward = (hx, hy, elevation = 35) => [hx * Math.cos(elevation * deg), hy * Math.cos(elevation * deg), Math.sin(elevation * deg)];

for (const [name, opening, rooms, expected] of [
  ['北牆的窗戶外側是 across 正向', northWindow, [room], 1],
  ['南牆的窗戶外側是 across 負向', southWindow, [room], -1],
  ['兩側都是房間時沒有外側', northWindow, [room, { id: 'b', rects: [[0, 3.15, 4, 5]] }], 0],
  ['兩側都不是房間時沒有外側', northWindow, [], 0],
]) {
  test(`exteriorSide ${name}`, () => {
    // Act & Assert
    assert.equal(exteriorSide(opening, rooms), expected);
  });
}

for (const [name, openings, rooms, expected] of [
  ['只有朝北的窗：陽光從北方偏西 30° 照進來', [northWindow], [room], toward(-Math.sin(30 * deg), Math.cos(30 * deg))],
  ['只有朝南的窗：從南方偏西 30°（西南）', [southWindow], [room], toward(-Math.sin(30 * deg), -Math.cos(30 * deg))],
  ['只有朝西的窗：偏轉兩邊一樣西時取偏南', [westWindow], [room], toward(-Math.cos(30 * deg), -Math.sin(30 * deg))],
  ['沒有對外窗時用預設的西南向', [], [room], toward(-Math.SQRT1_2, -Math.SQRT1_2)],
  ['門不算窗', [{ ...northWindow, kind: 'door' }], [room], toward(-Math.SQRT1_2, -Math.SQRT1_2)],
]) {
  test(`sunDirection ${name}`, () => {
    // Act
    const sun = sunDirection(plan(openings, rooms));

    // Assert
    assertVec(sun, expected);
  });
}

test('sunDirection 仰角與偏轉角可以調整', () => {
  // Act
  const sun = sunDirection(plan([northWindow]), { elevation: 50, skew: 0 });

  // Assert
  assertVec(sun, toward(0, 1, 50));
});

test('sunDirection 大窗的朝向權重比小窗大', () => {
  // Arrange：北窗 3 m 寬、西窗 0.5 m 寬
  const bigNorth = { ...northWindow, polygon: rect(0.5, 3, 3.5, 3.15) };
  const smallWest = { ...westWindow, polygon: rect(-0.15, 1, 0, 1.5) };

  // Act
  const [x, y] = sunDirection(plan([bigNorth, smallWest]), { skew: 0 });

  // Assert：主要朝北，略偏西
  assert.ok(y > 0 && x < 0 && y > Math.abs(x) * 3, `${x}, ${y}`);
});

test('shadowFrustum 太陽在水平 +x 方向時，範圍剛好包住盒子', () => {
  // Arrange：盒子 4 × 3 × 2，中心 (2, 1.5, -1)
  const box = { min: { x: 0, y: 0, z: -2 }, max: { x: 4, y: 3, z: 0 } };

  // Act
  const f = shadowFrustum(box, { x: 1, y: 0, z: 0 });

  // Assert
  assert.deepEqual(f.center, { x: 2, y: 1.5, z: -1 });
  assert.ok(close(f.left, -1) && close(f.right, 1), `${f.left}, ${f.right}`);
  assert.ok(close(f.bottom, -1.5) && close(f.top, 1.5), `${f.bottom}, ${f.top}`);
  assert.ok(close(f.near, f.distance - 2) && close(f.far, f.distance + 2), `${f.near}, ${f.far}, ${f.distance}`);
  assert.ok(f.near > 0);
});

test('shadowFrustum 斜射的太陽：投影到光源座標後的範圍', () => {
  // Arrange
  const box = { min: { x: 0, y: 0, z: -2 }, max: { x: 4, y: 3, z: 0 } };
  const s = Math.SQRT1_2;
  const reach = s * (1.5 + 1); // 半高 1.5、半深 1 在斜 45° 軸上的投影

  // Act
  const f = shadowFrustum(box, { x: 0, y: s, z: s });

  // Assert
  assert.ok(close(f.left, -2) && close(f.right, 2), `${f.left}, ${f.right}`);
  assert.ok(close(f.bottom, -reach) && close(f.top, reach), `${f.bottom}, ${f.top}`);
  assert.ok(close(f.near, f.distance - reach) && close(f.far, f.distance + reach));
});

test('shadowFrustum 四周留邊', () => {
  // Arrange
  const box = { min: { x: 0, y: 0, z: -2 }, max: { x: 4, y: 3, z: 0 } };

  // Act
  const f = shadowFrustum(box, { x: 1, y: 0, z: 0 }, 0.5);

  // Assert
  assert.ok(close(f.left, -1.5) && close(f.right, 1.5) && close(f.bottom, -2) && close(f.top, 2));
  assert.ok(close(f.near, f.distance - 2.5) && close(f.far, f.distance + 2.5));
});
