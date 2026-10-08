import { test } from 'node:test';
import assert from 'node:assert/strict';
import { curtainPlan } from '../../js/core/curtains.js';

const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const close = (a, b) => Math.abs(a - b) < 1e-6;
const closePt = (p, q) => close(p[0], q[0]) && close(p[1], q[1]);
// 北牆的窗：牆面在 y = 3，房間在南側
const window = (over = {}) => ({ id: 'W', kind: 'window', polygon: rect(1, 3, 2.5, 3.15), sill: 0.9, head: 2.1, ...over });
const south = { id: 's', rects: [[0, 0, 4, 3]] };

test('curtainPlan 軌道掛在室內那一側、離牆 10 cm、兩端各超出窗 15 cm', () => {
  // Act
  const plan = curtainPlan(window(), [south], { ceiling: 2.8 });

  // Assert
  assert.equal(plan.side, -1);
  assert.ok(closePt(plan.track.a, [0.85, 2.9]) && closePt(plan.track.b, [2.65, 2.9]), JSON.stringify(plan.track));
  assert.ok(close(plan.track.height, 2.22));
  assert.ok(close(plan.bottom, 0.015));
});

test('curtainPlan 天花板太低時軌道貼著天花板下方', () => {
  // Act
  const plan = curtainPlan(window(), [south], { ceiling: 2.15 });

  // Assert
  assert.ok(close(plan.track.height, 2.13), plan.track.height);
});

test('curtainPlan 簾片收在兩側，各佔軌道長度的 15%，摺數依寬度', () => {
  // Act
  const { panels } = curtainPlan(window(), [south], { ceiling: 2.8 });

  // Assert：軌道長 1.8 m → 每側 0.27 m、5 摺
  assert.equal(panels.length, 2);
  assert.ok(closePt(panels[0].a, [0.85, 2.9]) && closePt(panels[0].b, [1.12, 2.9]), JSON.stringify(panels[0]));
  assert.ok(closePt(panels[1].a, [2.38, 2.9]) && closePt(panels[1].b, [2.65, 2.9]), JSON.stringify(panels[1]));
  assert.deepEqual(panels.map((p) => p.folds), [5, 5]);
});

for (const [name, width, expected] of [
  ['很寬的窗每側最多 45 cm', 4, 0.45],
  ['很窄的窗每側至少 20 cm', 0.5, 0.2],
]) {
  test(`curtainPlan ${name}`, () => {
    // Arrange
    const opening = window({ polygon: rect(1, 3, 1 + width, 3.15) });

    // Act
    const [left] = curtainPlan(opening, [south], { ceiling: 2.8 }).panels;

    // Assert
    assert.ok(close(left.b[0] - left.a[0], expected), `${left.b[0] - left.a[0]}`);
  });
}

for (const [name, north, expectedSide] of [
  ['兩側都是房間時掛在大的那間（南側較大）', { id: 'n', rects: [[0, 3.15, 4, 4.5]] }, -1],
  ['兩側都是房間時掛在大的那間（北側較大）', { id: 'n', rects: [[0, 3.15, 6, 8]] }, 1],
]) {
  test(`curtainPlan ${name}`, () => {
    // Act
    const plan = curtainPlan(window(), [south, north], { ceiling: 2.8 });

    // Assert
    assert.equal(plan.side, expectedSide);
  });
}

test('curtainPlan 兩側都不是房間時不掛', () => {
  // Act & Assert
  assert.equal(curtainPlan(window(), [], { ceiling: 2.8 }), null);
});
