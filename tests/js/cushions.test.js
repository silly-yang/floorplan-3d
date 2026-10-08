import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cushionSpans } from '../../js/core/cushions.js';

const close = (a, b) => Math.abs(a - b) < 1e-6;

for (const [name, width, expected] of [
  ['三人沙發座面 1.74 m 分三塊', 1.74, [[-0.58333333, 0.57333333], [0, 0.57333333], [0.58333333, 0.57333333]]],
  ['單椅座面 0.56 m 一整塊', 0.56, [[0, 0.56]]],
  ['很窄也至少一塊', 0.3, [[0, 0.3]]],
  ['1.3 m 分兩塊', 1.3, [[-0.3275, 0.645], [0.3275, 0.645]]],
  ['1.5 m 四捨五入還是兩塊，不會每塊太窄', 1.5, [[-0.3775, 0.745], [0.3775, 0.745]]],
]) {
  test(`cushionSpans ${name}`, () => {
    // Act
    const spans = cushionSpans(width);

    // Assert
    assert.equal(spans.length, expected.length);
    spans.forEach((s, i) => assert.ok(close(s.center, expected[i][0]) && close(s.width, expected[i][1]), JSON.stringify(s)));
  });
}
