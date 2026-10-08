import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TV_DEFAULTS,
  TV_INCHES,
  isWallTv,
  nearestSeatDistance,
  tvChange,
  tvElevation,
  tvOptionsOf,
  tvSize,
  tvWatts,
  viewingDistance,
} from '../../js/core/tv.js';

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} ≠ ${expected}`);
// 只需要位置與朝向；不依賴目錄
const place = (type, id, x, y, extra = {}) => ({ id, type, x, y, rotation: 0, size: { w: 100, d: 50, h: 50 }, color: '#1d1f22', ...extra });

// ---------- 尺寸 ----------

test('吋數選項為 43／50／55／65／75／85，預設 55 吋放櫃上、壁掛中心離地 110 cm', () => {
  // Assert
  assert.deepEqual(TV_INCHES, [43, 50, 55, 65, 75, 85]);
  assert.deepEqual(TV_DEFAULTS, { inch: 55, mount: 'stand', centerHeight: 110 });
});

// 16:9 由對角線換算機身寬高，含邊框 1 cm，四捨五入到公分
for (const [inch, w, h] of [
  [43, 96, 55],
  [50, 112, 63],
  [55, 123, 69],
  [65, 145, 82],
  [75, 167, 94],
  [85, 189, 107],
]) {
  test(`tvSize ${inch} 吋壁掛為 ${w}×4×${h} cm`, () => {
    // Act & Assert
    assert.deepEqual(tvSize(inch, 'wall'), { w, d: 4, h });
  });

  test(`tvSize ${inch} 吋放櫃上連腳座深 25 cm、高度多出腳座 6 cm`, () => {
    // Act & Assert
    assert.deepEqual(tvSize(inch, 'stand'), { w, d: 25, h: h + 6 });
  });
}

test('tvWatts 依吋數遞增：55 吋 120 W、85 吋 300 W', () => {
  // Act
  const watts = TV_INCHES.map(tvWatts);

  // Assert
  assert.deepEqual(watts, [80, 100, 120, 160, 220, 300]);
});

// ---------- 壁掛高度 ----------

for (const [inch, center, expected] of [
  [55, 110, 0.755],
  [65, 110, 0.69],
  [43, 60, 0.325],
]) {
  test(`tvElevation ${inch} 吋中心離地 ${center} cm 時底部離地 ${expected} m`, () => {
    // Act & Assert
    near(tvElevation(inch, center), expected);
  });
}

test('tvOptionsOf 沒有 options 時用預設，有的欄位以家具自己的為準', () => {
  // Act & Assert
  assert.deepEqual(tvOptionsOf({ type: 'tv' }), TV_DEFAULTS);
  assert.deepEqual(tvOptionsOf({ type: 'tv', options: { mount: 'wall' } }), { inch: 55, mount: 'wall', centerHeight: 110 });
});

test('isWallTv 只認壁掛的電視', () => {
  // Act & Assert
  assert.equal(isWallTv({ type: 'tv', options: { mount: 'wall' } }), true);
  assert.equal(isWallTv({ type: 'tv', options: { mount: 'stand' } }), false);
  assert.equal(isWallTv({ type: 'tv' }), false);
  assert.equal(isWallTv({ type: 'upper-cabinet', options: { mount: 'wall' } }), false);
});

// ---------- 觀看距離 ----------

for (const [inch, min, max] of [
  [43, 1.09, 1.64],
  [55, 1.4, 2.1],
  [65, 1.65, 2.48],
  [85, 2.16, 3.24],
]) {
  test(`viewingDistance ${inch} 吋建議 ${min}～${max} m（4K：對角線 1～1.5 倍）`, () => {
    // Act & Assert
    assert.deepEqual(viewingDistance(inch), { min, max });
  });
}

test('nearestSeatDistance 取最近的沙發或單椅中心的水平距離', () => {
  // Arrange
  const tv = place('tv', 't', 0, 0);
  const furniture = [tv, place('sofa', 's', 0, 3), place('armchair', 'a', 1.2, 1.6), place('coffee-table', 'c', 0, 0.5)];

  // Act & Assert
  near(nearestSeatDistance(tv, furniture), 2);
});

test('nearestSeatDistance 沒有沙發或單椅時回 null', () => {
  // Arrange
  const tv = place('tv', 't', 0, 0);

  // Act & Assert
  assert.equal(nearestSeatDistance(tv, [tv, place('dining-chair', 'c', 0, 2)]), null);
});

// ---------- 切換 ----------

test('tvChange 換吋數：尺寸跟著變、位置不動', () => {
  // Arrange
  const tv = place('tv', 't', 1, 2, { rotation: 90, size: tvSize(55, 'stand') });

  // Act
  const patch = tvChange(tv, { inch: 75 });

  // Assert
  assert.deepEqual(patch.size, tvSize(75, 'stand'));
  assert.deepEqual(patch.options, { inch: 75, mount: 'stand', centerHeight: 110 });
  assert.equal(patch.x, 1);
  assert.equal(patch.y, 2);
  assert.equal(patch.elevation, undefined);
});

test('tvChange 改壁掛：尺寸變薄、底部高度由中心高度算出，背面留在原處（往後退半個厚度差）', () => {
  // Arrange：rotation 0 正面朝 −y，背面在 +y
  const tv = place('tv', 't', 1, 2, { size: tvSize(55, 'stand') });

  // Act
  const patch = tvChange(tv, { mount: 'wall' });

  // Assert
  assert.deepEqual(patch.size, tvSize(55, 'wall'));
  assert.equal(patch.options.mount, 'wall');
  near(patch.elevation, 0.755);
  near(patch.x, 1);
  near(patch.y, 2.105);
});

test('tvChange 壁掛改回放櫃上：拿掉離地高度交給檯面推算，背面留在原處', () => {
  // Arrange：rotation 90 正面朝 +x
  const tv = place('tv', 't', 1, 2, { rotation: 90, size: tvSize(55, 'wall'), elevation: 0.755, options: { inch: 55, mount: 'wall', centerHeight: 110 } });

  // Act
  const patch = tvChange(tv, { mount: 'stand' });

  // Assert
  assert.deepEqual(patch.size, tvSize(55, 'stand'));
  assert.ok('elevation' in patch && patch.elevation === undefined);
  near(patch.x, 1.105);
  near(patch.y, 2);
});

test('tvChange 壁掛時改中心高度：夾在 60～200 cm，底部高度跟著變', () => {
  // Arrange
  const tv = place('tv', 't', 1, 2, { size: tvSize(55, 'wall'), elevation: 0.755, options: { inch: 55, mount: 'wall', centerHeight: 110 } });

  // Act
  const high = tvChange(tv, { centerHeight: 250 });
  const low = tvChange(tv, { centerHeight: 30 });

  // Assert
  assert.equal(high.options.centerHeight, 200);
  near(high.elevation, 1.655);
  assert.equal(low.options.centerHeight, 60);
  near(low.elevation, 0.255);
});

test('tvChange 不修改原物件', () => {
  // Arrange
  const tv = place('tv', 't', 1, 2, { options: { inch: 55, mount: 'stand', centerHeight: 110 } });
  const before = structuredClone(tv);

  // Act
  tvChange(tv, { inch: 85, mount: 'wall' });

  // Assert
  assert.deepEqual(tv, before);
});
