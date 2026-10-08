import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLoops,
  centroid,
  floorDiv,
  pointInPolygon,
  polygonArea,
  pySum,
  rayHit,
  roundHalfEven,
} from '../../../js/import/geometry.js';

const SQUARE = [[0, 0], [10, 0], [10, 10], [0, 10]];
const approx = (actual, expected, eps = 1e-9) => assert.ok(Math.abs(actual - expected) <= eps, `${actual} ≉ ${expected}`);

test('buildLoops 打亂順序且方向相反的正方形仍串成一個輪廓', () => {
  // Arrange
  const segments = [
    [[10, 10], [10, 0]],
    [[0, 0], [10, 0]],
    [[0, 10], [0, 0]],
    [[0, 10], [10, 10]],
  ];

  // Act
  const [loops, openChains] = buildLoops(segments);

  // Assert
  assert.equal(loops.length, 1);
  assert.equal(loops[0].length, 4);
  approx(Math.abs(polygonArea(loops[0])), 100);
  assert.deepEqual(openChains, []);
});

test('buildLoops 端點在容差內視為相接', () => {
  // Arrange
  const segments = [
    [[0, 0], [10, 0]],
    [[10.3, 0], [10, 10]],
    [[10, 10], [0, 10]],
    [[0, 10.2], [0, 0]],
  ];

  // Act
  const [loops] = buildLoops(segments, 0.5);

  // Assert
  assert.equal(loops.length, 1);
});

test('buildLoops 開放鏈兩端夠近時補線封閉（牆接柱子沒畫封口）', () => {
  // Arrange：U 形牆，開口 15
  const segments = [[[0, 0], [0, 100]], [[0, 0], [15, 0]], [[15, 0], [15, 100]]];

  // Act
  const [loops, openChains] = buildLoops(segments, 0.5, 25);

  // Assert
  assert.equal(loops.length, 1);
  approx(Math.abs(polygonArea(loops[0])), 1500);
  assert.deepEqual(openChains, []);
});

test('buildLoops 開放鏈兩端太遠時回報為開放鏈', () => {
  // Arrange
  const segments = [[[0, 0], [100, 0]], [[100, 0], [100, 100]]];

  // Act
  const [loops, openChains] = buildLoops(segments, 0.5, 25);

  // Assert
  assert.deepEqual(loops, []);
  assert.equal(openChains.length, 1);
});

for (const [name, pt, expected] of [
  ['中心點在內', [5, 5], true],
  ['右側在外', [15, 5], false],
  ['左下在外', [-1, -1], false],
]) {
  test(`pointInPolygon 分辨內外：${name}`, () => {
    // Act
    const result = pointInPolygon(pt, SQUARE);

    // Assert
    assert.equal(result, expected);
  });
}

for (const [name, origin, direction, maxDist, expected] of [
  ['向右碰到左邊', [-5, 5], [1, 0], 100, 5],
  ['向下碰到上邊', [5, 20], [0, -1], 100, 10],
  ['背向不會碰到', [-5, 5], [-1, 0], 100, null],
  ['超過最大距離', [-50, 5], [1, 0], 30, null],
]) {
  test(`rayHit 回傳到第一條邊的距離：${name}`, () => {
    // Act
    const result = rayHit(origin, direction, [SQUARE], maxDist);

    // Assert
    if (expected === null) assert.equal(result, null);
    else approx(result, expected);
  });
}

test('buildLoops 兩個方塊共用頂點（8 字形）拆成兩個輪廓', () => {
  // Arrange：線段順序讓走訪在共用頂點 (10, 10) 先轉進另一個方塊
  const segments = [
    [[0, 0], [10, 0]],
    [[10, 0], [10, 10]],
    [[10, 10], [20, 10]],
    [[20, 10], [20, 20]],
    [[20, 20], [10, 20]],
    [[10, 20], [10, 10]],
    [[10, 10], [0, 10]],
    [[0, 10], [0, 0]],
  ];

  // Act
  const [loops] = buildLoops(segments);

  // Assert
  assert.deepEqual(loops.map((l) => Math.abs(polygonArea(l))).sort((a, b) => a - b), [100, 100]);
});

test('buildLoops 兩條平行的開放鏈配對成一個輪廓（L 形牆內外線）', () => {
  // Arrange
  const segments = [
    [[0, 0], [0, 100]],
    [[0, 100], [100, 100]],
    [[10, 0], [10, 90]],
    [[10, 90], [100, 90]],
  ];

  // Act
  const [loops, openChains] = buildLoops(segments, 0.5, 25);

  // Assert
  assert.deepEqual(openChains, []);
  assert.equal(loops.length, 1);
  approx(Math.abs(polygonArea(loops[0])), 100 * 10 + 90 * 10);
});

for (const [name, value, expected] of [
  ['剛好一半時取偶數（捨）', 0.0625, 0.062],
  ['剛好一半時取偶數（入）', 0.1875, 0.188],
  ['負數剛好一半', -0.0625, -0.062],
  ['大數剛好一半', 4.3125, 4.312],
  ['二進位略小於一半時捨去', 1.0005, 1],
  ['一般四捨五入', 2.0005, 2.001],
  ['不需進位', 3.0004999, 3],
]) {
  test(`roundHalfEven 與 Python round(x, 3) 一致：${name}`, () => {
    // Act
    const result = roundHalfEven(value, 3);

    // Assert
    assert.equal(result, expected);
  });
}

for (const [name, a, b, expected] of [
  ['浮點商略小於整數時往下取', 1, 0.1, 9],
  ['一般情形', 7, 2.5, 2],
  ['負數往負無限大取', -7.5, 5, -2],
]) {
  test(`floorDiv 與 Python 的 // 一致：${name}`, () => {
    // Act
    const result = floorDiv(a, b);

    // Assert
    assert.equal(result, expected);
  });
}

test('pySum 與 Python sum() 一樣做補償加總', () => {
  // Act
  const total = pySum(Array(10).fill(0.1));

  // Assert
  assert.equal(total, 1);
});

test('centroid 取頂點平均並用補償加總', () => {
  // Act
  const center = centroid(Array(10).fill([0.1, 0.3]));

  // Assert
  assert.deepEqual(center, [0.1, 0.3]);
});
