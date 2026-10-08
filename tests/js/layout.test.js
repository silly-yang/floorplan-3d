import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addFurniture,
  elevationOf,
  findConflicts,
  findFreeSpot,
  footprint,
  hitsWalls,
  moveToward,
  nearestWallDistance,
  normalizeRotation,
  removeFurniture,
  snapToGrid,
  supportOf,
  updateFurniture,
} from '../../js/core/layout.js';

const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const wall = (polygon, bottom = 0, top = 2.8) => ({ polygon, bottom, top });
// 一道 x = 0~0.15 的直牆
const WALLS = [wall(rect(0, 0, 0.15, 4))];

const item = (over = {}) => ({
  id: 'a', type: 'coffee-table', x: 1, y: 1, rotation: 0, size: { w: 100, d: 50, h: 40 }, color: '#aaaaaa', ...over,
});
const close = (a, b) => Math.abs(a - b) < 1e-9;

for (const [name, input, expected] of [
  ['四捨五入到 5 公分', 1.234, 1.25],
  ['負數也對齊', -0.12, -0.1],
  ['剛好在格線上不變', 2.35, 2.35],
]) {
  test(`snapToGrid ${name}`, () => {
    // Act
    const value = snapToGrid(input);

    // Assert
    assert.ok(close(value, expected), `got ${value}`);
  });
}

for (const [name, input, expected] of [
  ['超過 360 繞回', 375, 15],
  ['負角轉正', -15, 345],
  ['360 等於 0', 360, 0],
]) {
  test(`normalizeRotation ${name}`, () => {
    // Act & Assert
    assert.equal(normalizeRotation(input), expected);
  });
}

test('footprint 把公分換成公尺', () => {
  // Act
  const corners = footprint(item());

  // Assert
  assert.deepEqual(corners, rect(0.5, 0.75, 1.5, 1.25));
});

for (const [name, over, expected] of [
  ['壓到牆', { x: 0.4 }, true],
  ['貼齊牆面不算撞', { x: 0.65 }, false],
  ['離牆很遠', { x: 2 }, false],
  ['轉 90 度後窄邊朝牆就不撞', { x: 0.45, rotation: 90, size: { w: 100, d: 50, h: 40 } }, false],
  ['旋轉 0 度同位置會壓到', { x: 0.45, rotation: 0 }, true],
]) {
  test(`hitsWalls ${name}`, () => {
    // Act
    const result = hitsWalls(item(over), WALLS);

    // Assert
    assert.equal(result, expected);
  });
}

test('hitsWalls 楣樑在家具頭頂上方時不算撞', () => {
  // Arrange：門洞上方 2.1 m 起的楣樑，0.4 m 高的茶几可以放進門洞
  const solids = [wall(rect(0.5, 0.75, 1.5, 1.25), 2.1, 2.8)];

  // Act
  const result = hitsWalls(item(), solids);

  // Assert
  assert.equal(result, false);
});

test('findConflicts 兩件家具重疊時兩個都標出', () => {
  // Arrange
  const furniture = [item({ id: 'a' }), item({ id: 'b', x: 1.5 }), item({ id: 'c', x: 5 })];

  // Act
  const conflicts = findConflicts(furniture);

  // Assert
  assert.deepEqual([...conflicts].sort(), ['a', 'b']);
});

test('findConflicts 地毯壓在家具下不算重疊', () => {
  // Arrange
  const furniture = [item({ id: 'a' }), item({ id: 'rug', type: 'rug', size: { w: 200, d: 140, h: 1 } })];

  // Act
  const conflicts = findConflicts(furniture);

  // Assert
  assert.equal(conflicts.size, 0);
});

test('nearestWallDistance 回傳家具邊緣到最近牆面的距離', () => {
  // Arrange：茶几左緣在 x = 0.45，牆面在 x = 0.15
  const target = item({ x: 0.95 });

  // Act
  const d = nearestWallDistance(target, WALLS);

  // Assert
  assert.ok(close(d, 0.3), `got ${d}`);
});

test('nearestWallDistance 沒有牆時回傳 Infinity', () => {
  // Act & Assert
  assert.equal(nearestWallDistance(item(), []), Infinity);
});

test('findFreeSpot 起點撞牆時找附近不撞牆的位置', () => {
  // Arrange
  const target = item({ x: 0.1, y: 2 });

  // Act
  const spot = findFreeSpot(target, WALLS);

  // Assert
  assert.ok(spot, '應該找得到');
  assert.equal(hitsWalls({ ...target, ...spot }, WALLS), false);
  assert.ok(Math.hypot(spot.x - 0.1, spot.y - 2) <= 1, '應在附近');
});

test('findFreeSpot 起點本來就空時原地回傳', () => {
  // Act
  const spot = findFreeSpot(item({ x: 2, y: 2 }), WALLS);

  // Assert
  assert.deepEqual(spot, { x: 2, y: 2 });
});

test('findFreeSpot 範圍內都撞牆時回傳 null', () => {
  // Arrange：家具整個被一大片牆包住
  const solids = [wall(rect(-10, -10, 10, 10))];

  // Act & Assert
  assert.equal(findFreeSpot(item(), solids, { radius: 0.5 }), null);
});

test('addFurniture／updateFurniture／removeFurniture 回傳新物件、不改原本的 design', () => {
  // Arrange
  const design = { name: 'x', furniture: [item({ id: 'a' })] };

  // Act
  const added = addFurniture(design, item({ id: 'b' }));
  const updated = updateFurniture(added, 'a', { x: 3 });
  const removed = removeFurniture(updated, 'b');

  // Assert
  assert.equal(design.furniture.length, 1);
  assert.equal(design.furniture[0].x, 1);
  assert.deepEqual(added.furniture.map((f) => f.id), ['a', 'b']);
  assert.equal(updated.furniture[0].x, 3);
  assert.deepEqual(removed.furniture.map((f) => f.id), ['a']);
});

test('moveToward 一次跳過薄牆時停在牆前，不會穿過去', () => {
  // Arrange：茶几在牆右側，目標在牆左側（中間隔一道 15 cm 的牆）
  const target = item({ x: 1 });

  // Act
  const spot = moveToward(target, { x: -1, y: 1 }, WALLS);

  // Assert：茶几左緣（x - 0.5）應停在牆面 0.15 右側
  assert.ok(spot.x - 0.5 >= 0.15 - 1e-9, `穿牆了：${spot.x}`);
  assert.ok(spot.x - 0.5 < 0.25, `停得太早：${spot.x}`);
});

test('moveToward 路上沒有牆時直接到目標', () => {
  // Act
  const spot = moveToward(item({ x: 1 }), { x: 3, y: 2 }, WALLS);

  // Assert
  assert.deepEqual(spot, { x: 3, y: 2 });
});

// ---------- 疊放：桌上型家電放到檯面上 ----------
const table = (over = {}) => item({ id: 'table', type: 'dining-table', x: 2, y: 2, size: { w: 150, d: 85, h: 75 }, ...over });
const coffee = (over = {}) => item({ id: 'coffee', type: 'coffee-machine', x: 2.3, y: 2.1, size: { w: 25, d: 40, h: 35 }, ...over });

test('supportOf 桌上型家電中心落在餐桌上時回傳餐桌', () => {
  // Act & Assert
  assert.equal(supportOf(coffee(), [table(), coffee()])?.id, 'table');
});

for (const [name, furniture, target] of [
  ['不在任何檯面上', () => [table(), coffee({ x: 5 })], () => coffee({ x: 5 })],
  ['落地型家電（掃地機器人）不會被抬上桌', () => [table(), item({ id: 'r', type: 'robot-vacuum', x: 2, y: 2, size: { w: 35, d: 35, h: 9 } })], () => item({ id: 'r', type: 'robot-vacuum', x: 2, y: 2, size: { w: 35, d: 35, h: 9 } })],
  ['沙發沒有檯面', () => [item({ id: 's', type: 'sofa', x: 2, y: 2, size: { w: 200, d: 90, h: 85 } }), coffee()], () => coffee()],
]) {
  test(`supportOf ${name}時回傳 null`, () => {
    // Act & Assert
    assert.equal(supportOf(target(), furniture()), null);
  });
}

test('elevationOf 放在餐桌上的咖啡機離地高度等於桌高', () => {
  // Act & Assert
  assert.equal(elevationOf(coffee(), [table(), coffee()]), 0.75);
  assert.equal(elevationOf(table(), [table(), coffee()]), 0);
});

test('elevationOf 疊在多個檯面重疊處時取最高的那個', () => {
  // Arrange：茶几（42 cm）塞在餐桌（75 cm）底下
  const low = item({ id: 'low', type: 'coffee-table', x: 2.3, y: 2.1, size: { w: 60, d: 50, h: 42 } });

  // Act & Assert
  assert.equal(elevationOf(coffee(), [table(), low, coffee()]), 0.75);
});

test('findConflicts 咖啡機放在桌上不算與桌子重疊', () => {
  // Act & Assert
  assert.equal(findConflicts([table(), coffee()]).size, 0);
});

test('findConflicts 同一張桌上兩台家電擠在一起仍算重疊', () => {
  // Arrange
  const other = coffee({ id: 'coffee2', x: 2.35 });

  // Act & Assert
  assert.deepEqual([...findConflicts([table(), coffee(), other])].sort(), ['coffee', 'coffee2']);
});

test('hitsWalls 抬高的家電只跟它那個高度範圍內的量體比較', () => {
  // Arrange：只在 0~0.5 m 的矮牆（像窗台）；放在 0.75 m 桌上的家電不會撞到
  const sill = [wall(rect(0, 0, 0.15, 4), 0, 0.5)];
  const target = item({ x: 0.4 });

  // Act & Assert
  assert.equal(hitsWalls(target, sill, 0.75), false);
  assert.equal(hitsWalls(target, sill, 0), true);
});

test('elevationOf 吊櫃不管下面有什麼，都掛在固定高度', () => {
  // Arrange
  const upper = item({ id: 'upper', type: 'upper-cabinet', x: 2, y: 2, size: { w: 225, d: 35, h: 70 } });

  // Act & Assert
  assert.equal(elevationOf(upper, [upper]), 1.45);
  assert.equal(elevationOf(upper, [table(), upper]), 1.45);
});

test('findConflicts 吊櫃掛在流理台上方不算重疊', () => {
  // Arrange
  const counter = item({ id: 'counter', type: 'kitchen-counter', x: 2, y: 2, size: { w: 225, d: 60, h: 90 } });
  const upper = item({ id: 'upper', type: 'upper-cabinet', x: 2, y: 2.1, size: { w: 225, d: 35, h: 70 } });

  // Act & Assert
  assert.equal(findConflicts([counter, upper]).size, 0);
});
