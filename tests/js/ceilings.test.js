import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CEILING_TYPES, ceilingStateOf, ceilingZones, clipRect, subtractRect } from '../../js/core/ceilings.js';

const area = (rects) => rects.reduce((s, [x0, y0, x1, y1]) => s + (x1 - x0) * (y1 - y0), 0);
const close = (a, b) => Math.abs(a - b) < 1e-9;

test('天花板形式有不包、包樑、平釘、造型間接照明', () => {
  // Assert
  assert.deepEqual(CEILING_TYPES.map((t) => t.id), ['exposed', 'beam-wrap', 'flat', 'cove']);
  assert.ok(CEILING_TYPES.every((t) => /[一-鿿]/.test(t.name) && t.icon));
});

for (const [name, cut, expectedArea, pieces] of [
  ['中間挖一塊', [1, 1, 2, 2], 9 - 1, 4],
  ['切掉一角', [2, 2, 5, 5], 9 - 1, 2],
  ['完全不重疊', [5, 5, 6, 6], 9, 1],
  ['整塊被蓋住', [-1, -1, 4, 4], 0, 0],
]) {
  test(`subtractRect ${name}`, () => {
    // Act
    const rest = subtractRect([0, 0, 3, 3], cut);

    // Assert
    assert.ok(close(area(rest), expectedArea), `${area(rest)}`);
    assert.equal(rest.length, pieces);
  });
}

test('clipRect 回傳交集；不相交時回傳 null', () => {
  // Act & Assert
  assert.deepEqual(clipRect([0, 0, 3, 3], [2, 1, 5, 2]), [2, 1, 3, 2]);
  assert.equal(clipRect([0, 0, 1, 1], [2, 2, 3, 3]), null);
});

const FLOORPLAN = {
  rooms: [
    { id: 'living', name: '客餐廳', rects: [[0, 0, 4, 4]] },
    { id: 'bath', name: '浴室', rects: [[4, 0, 6, 2]] },
  ],
  ceilingZones: [{ id: 'kitchen', name: '廚房', rect: [1, 0, 3, 1.5] }],
};

test('ceilingZones 房間扣掉廚房區，廚房另成一區，總面積不變', () => {
  // Act
  const zones = ceilingZones(FLOORPLAN);

  // Assert
  assert.deepEqual(zones.map((z) => z.id), ['living', 'bath', 'kitchen']);
  assert.ok(close(area(zones[0].rects), 16 - 3));
  assert.ok(close(area(zones[2].rects), 3));
});

test('ceilingZones 平面圖沒有建商天花板區時，就是各個房間', () => {
  // Act
  const zones = ceilingZones({ ...FLOORPLAN, ceilingZones: undefined });

  // Assert
  assert.deepEqual(zones.map((z) => z.id), ['living', 'bath']);
});

for (const [name, ceilings, zoneId, expected] of [
  ['廚房沒設定時是平釘 2.6 m', {}, 'kitchen', { type: 'flat', height: 2.6 }],
  ['房間沒設定時是不包', {}, 'living', { type: 'exposed', height: 2.6 }],
  ['有設定時用設定值', { living: { type: 'cove', height: 2.7 } }, 'living', { type: 'cove', height: 2.7 }],
]) {
  test(`ceilingStateOf ${name}`, () => {
    // Act & Assert
    assert.deepEqual(ceilingStateOf(ceilings, zoneId, FLOORPLAN), expected);
  });
}
