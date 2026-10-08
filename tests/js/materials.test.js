import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FLOOR_MATERIALS, floorMaterialOf, getFloorMaterial } from '../../js/core/materials.js';

test('地板材質包含台灣主流的 8 種＋新增 3 種接在後面（既有 id 不變），每種都有中文名稱、顏色與光澤度', () => {
  // Act
  const ids = FLOOR_MATERIALS.map((m) => m.id);

  // Assert
  assert.deepEqual(ids, ['laminate', 'engineered', 'spc', 'polished-60', 'polished-80', 'wood-tile', 'microcement', 'anti-slip', 'walnut', 'marble', 'mosaic']);
  for (const m of FLOOR_MATERIALS) {
    assert.match(m.name, /[一-鿿]/, m.id);
    assert.match(m.color, /^#[0-9a-f]{6}$/i, m.id);
    assert.ok(m.roughness >= 0 && m.roughness <= 1, m.id);
    assert.ok(['wood', 'tile', 'concrete'].includes(m.pattern), m.id);
    assert.ok(m.tile > 0, m.id);
  }
});

test('拋光石英磚比超耐磨木地板亮（粗糙度低）', () => {
  // Assert
  assert.ok(getFloorMaterial('polished-60').roughness < getFloorMaterial('laminate').roughness);
});

for (const [name, roomId, rooms, expected] of [
  ['客廳沒設定時用超耐磨木地板', 'living', {}, 'laminate'],
  ['浴室沒設定時用止滑地磚', 'bath', {}, 'anti-slip'],
  ['陽台沒設定時用止滑地磚', 'balcony', {}, 'anti-slip'],
  ['有設定時用設定值', 'living', { living: { floorMaterial: 'polished-80' } }, 'polished-80'],
  ['設定了不存在的材質時退回預設', 'living', { living: { floorMaterial: 'lava' } }, 'laminate'],
]) {
  test(`floorMaterialOf ${name}`, () => {
    // Act & Assert
    assert.equal(floorMaterialOf(roomId, rooms).id, expected);
  });
}
