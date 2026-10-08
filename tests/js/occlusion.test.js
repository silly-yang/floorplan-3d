import { test } from 'node:test';
import assert from 'node:assert/strict';
import { occludingWalls } from '../../js/core/occlusion.js';

const rect = (id, x0, y0, x1, y1, kind = 'rc') => ({ id, kind, polygon: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], bottom: 0, top: 3 });

// 一間 0~4 × 0~4 的房間：西牆 x -0.15~0、南牆 y -0.15~0；房內一道隔間 x 2~2.1
const west = rect('west', -0.15, 0, 0, 4);
const south = rect('south', 0, -0.15, 4, 0);
const partition = rect('partition', 2, 1, 2.1, 4, 'partition');
// 凹形牆（L 形）：鏡頭→目標的線段兩端都在缺口外，中間只碰到缺口
const ell = { id: 'ell', kind: 'rc', polygon: [[5, 0], [6, 0], [6, 0.2], [5.2, 0.2], [5.2, 1], [5, 1]], bottom: 0, top: 3 };
const solids = [west, south, partition, ell];

for (const [name, camera, target, expected] of [
  ['線段穿過西牆', [-3, 2], [1, 2], ['west']],
  ['沒穿過任何牆', [1, 2], [1.5, 3], []],
  ['穿過西牆與隔間', [-3, 2.5], [3, 2.5], ['partition', 'west']],
  ['只擦過西牆與南牆交會的角點不算', [-1, -1], [1, 1], []],
  ['目標貼著西牆內側牆面、鏡頭在房內', [1, 2], [0, 2], []],
  ['目標正好在西牆牆面上、鏡頭在牆外', [-3, 2], [0, 2], []],
  ['目標在牆裡，那道牆不算', [-3, 2], [-0.05, 2], []],
  ['目標在牆裡，鏡頭這側的其他牆照算', [-3, 2.5], [2.05, 2.5], ['west']],
  ['目標在西牆裡，鏡頭在隔間另一側', [3, 2.5], [-0.05, 2.5], ['partition']],
  ['鏡頭在房內、與目標同一間', [0.5, 0.5], [1.5, 3], []],
  ['沿著隔間牆面平行經過不算', [2, 0.5], [2, 4.5], []],
  ['俯視：鏡頭在目標正上方', [1, 2], [1, 2], []],
  ['凹形牆：線段只經過缺口', [5.5, 0.5], [5.9, 0.9], []],
  ['凹形牆：線段穿過牆身', [5.5, -1], [5.5, 0.5], ['ell']],
]) {
  test(`occludingWalls ${name}`, () => {
    // Act
    const result = occludingWalls(solids, camera, target);

    // Assert
    assert.deepEqual([...result].sort(), expected);
  });
}
