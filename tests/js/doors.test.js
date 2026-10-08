import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DOOR_TYPES, blocksPassage, defaultDoor, doorOptions, doorPanels, doorStateOf, doorStopPoint, swingSide } from '../../js/core/doors.js';

const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
// 沿 x 軸、寬 0.9 m、牆厚 0.15 m 的開口
const opening = (over = {}) => ({ id: 'D-1', kind: 'door', label: 'D', polygon: rect(1, 0, 1.9, 0.15), sill: 0, head: 2.1, ...over });
const close = (a, b) => Math.abs(a - b) < 1e-6;

test('門型有無門、一般門、拉門、陽台玻璃門', () => {
  // Assert
  assert.deepEqual(DOOR_TYPES.map((t) => t.id), ['none', 'hinged', 'sliding', 'glass-sliding']);
  assert.ok(DOOR_TYPES.every((t) => /[一-鿿]/.test(t.name)));
});

for (const [name, over, expected] of [
  ['一般門口可裝無門、一般門、拉門', { kind: 'door' }, ['none', 'hinged', 'sliding']],
  ['門洞也可以裝門', { kind: 'doorway' }, ['none', 'hinged', 'sliding']],
  ['落地窗可裝陽台玻璃門或拉門', { kind: 'window', sill: 0 }, ['none', 'sliding', 'glass-sliding']],
  ['有窗台的窗戶不能裝門', { kind: 'window', sill: 0.9 }, []],
]) {
  test(`doorOptions ${name}`, () => {
    // Act & Assert
    assert.deepEqual(doorOptions(opening(over)), expected);
  });
}

for (const [name, over, expectedType] of [
  ['門口預設一般門', { kind: 'door' }, 'hinged'],
  ['門洞預設無門', { kind: 'doorway' }, 'none'],
  ['落地窗預設陽台玻璃門', { kind: 'window', sill: 0 }, 'glass-sliding'],
]) {
  test(`defaultDoor ${name}，而且是關著的`, () => {
    // Act
    const door = defaultDoor(opening(over));

    // Assert
    assert.deepEqual(door, { type: expectedType, open: false, flip: false, out: false });
  });
}

test('doorStateOf 有設定時用設定、沒設定時用預設', () => {
  // Arrange
  const doors = { 'D-1': { type: 'sliding', open: true, flip: true, out: true } };

  // Act & Assert
  assert.deepEqual(doorStateOf(doors, opening()), { type: 'sliding', open: true, flip: true, out: true });
  assert.deepEqual(doorStateOf({}, opening()), { type: 'hinged', open: false, flip: false, out: false });
});

for (const [name, state, expected] of [
  ['關著的門擋路', { type: 'hinged', open: false }, true],
  ['開著的門不擋路', { type: 'hinged', open: true }, false],
  ['沒裝門不擋路', { type: 'none', open: false }, false],
]) {
  test(`blocksPassage ${name}`, () => {
    // Act & Assert
    assert.equal(blocksPassage(state), expected);
  });
}

test('doorPanels 一般門關著時門片在開口正中、沿牆方向', () => {
  // Act
  const [leaf] = doorPanels(opening(), { type: 'hinged', open: false, flip: false }, 0);

  // Assert
  assert.ok(close(leaf.center[0], 1.45) && close(leaf.center[1], 0.075), `${leaf.center}`);
  assert.ok(close(leaf.rotation, 0));
  assert.ok(leaf.width > 0.85 && leaf.width <= 0.9);
  assert.equal(leaf.glass, false);
});

test('doorPanels 一般門全開時繞門軸轉 90 度、門片垂直於牆', () => {
  // Act
  const [leaf] = doorPanels(opening(), { type: 'hinged', open: true, flip: false }, 1);

  // Assert：門軸在 x≈1，門片轉到牆的一側，中心離牆約半個門寬
  assert.ok(close(Math.abs(leaf.rotation) % 180, 90), `${leaf.rotation}`);
  assert.ok(Math.abs(leaf.center[0] - 1) < 0.05, `${leaf.center}`);
  assert.ok(Math.abs(leaf.center[1] - 0.075) > 0.4, `${leaf.center}`);
});

test('doorPanels 一般門反向時門軸換到另一側', () => {
  // Act
  const [leaf] = doorPanels(opening(), { type: 'hinged', open: true, flip: true }, 1);

  // Assert
  assert.ok(Math.abs(leaf.center[0] - 1.9) < 0.05, `${leaf.center}`);
});

test('doorPanels 拉門全開時沿牆滑開、讓出開口', () => {
  // Act
  const [closed] = doorPanels(opening(), { type: 'sliding', open: false, flip: false }, 0);
  const [opened] = doorPanels(opening(), { type: 'sliding', open: true, flip: false }, 1);

  // Assert
  assert.ok(close(closed.center[0], 1.45));
  assert.ok(opened.center[0] - closed.center[0] > 0.8, `${opened.center}`);
  assert.ok(close(opened.rotation, closed.rotation));
});

test('doorPanels 陽台玻璃門是兩片玻璃，打開時一片滑到另一片後面', () => {
  // Act
  const closed = doorPanels(opening({ kind: 'window', sill: 0 }), { type: 'glass-sliding', open: false, flip: false }, 0);
  const opened = doorPanels(opening({ kind: 'window', sill: 0 }), { type: 'glass-sliding', open: true, flip: false }, 1);

  // Assert
  assert.equal(closed.length, 2);
  assert.ok(closed.every((p) => p.glass));
  assert.ok(Math.abs(opened[1].center[0] - opened[0].center[0]) < 0.05, '開啟後兩片重疊');
  assert.ok(Math.abs(closed[1].center[0] - closed[0].center[0]) > 0.4, '關閉時並排');
});

test('doorPanels 沒裝門時沒有門板', () => {
  // Act & Assert
  assert.deepEqual(doorPanels(opening(), { type: 'none', open: false, flip: false }, 0), []);
});

// 開口 y=0~0.15；北側（y 大）是客廳 4×4、南側（y 小）是浴室 2×2
const LIVING = { id: 'living', rects: [[0, 0.15, 4, 4.15]] };
const BATH = { id: 'bath', rects: [[0, -2, 2, 0]] };

for (const [name, rooms, expected] of [
  ['只有一側是房間時往房間那側開（大門朝室內）', [LIVING], 1],
  ['只有南側是房間時往南開', [BATH], -1],
  ['兩側都是房間時往比較小的那間開（浴室門往浴室開）', [LIVING, BATH], -1],
  ['兩側都不是房間時用預設方向', [], 1],
]) {
  test(`swingSide ${name}`, () => {
    // Act & Assert：+1＝開口 across 方向（這個開口是北側）
    assert.equal(swingSide(opening(), rooms), expected);
  });
}

test('doorPanels 一般門往指定那一側開；out 時改往另一側', () => {
  // Act
  const [inward] = doorPanels(opening(), { type: 'hinged', open: true, flip: false, out: false }, 1, -1);
  const [outward] = doorPanels(opening(), { type: 'hinged', open: true, flip: false, out: true }, 1, -1);

  // Assert：開口中線 y=0.075；side=-1 往南（y 變小），out 反過來往北
  assert.ok(inward.center[1] < 0.075 - 0.4, `${inward.center}`);
  assert.ok(outward.center[1] > 0.075 + 0.4, `${outward.center}`);
});

for (const [name, state, side, expected] of [
  ['一般門：門全開時門片尾端的內側，地上放門檔', { type: 'hinged', open: false, flip: false, out: false }, 1, [0.97, 0.905]],
  ['門軸換邊：門檔跟著到另一端', { type: 'hinged', open: false, flip: true, out: false }, 1, [1.93, 0.905]],
  ['往外開：門檔在牆的另一側', { type: 'hinged', open: false, flip: false, out: true }, 1, [0.97, -0.755]],
  ['房間在 across 反向：門檔跟著換側', { type: 'hinged', open: false, flip: false, out: false }, -1, [0.97, -0.755]],
]) {
  test(`doorStopPoint ${name}`, () => {
    // Act
    const point = doorStopPoint(opening(), state, side);

    // Assert
    assert.ok(point && close(point[0], expected[0]) && close(point[1], expected[1]), JSON.stringify(point));
  });
}

for (const type of ['none', 'sliding', 'glass-sliding']) {
  test(`doorStopPoint ${type} 沒有門檔`, () => {
    // Act & Assert
    assert.equal(doorStopPoint(opening(), { type, open: false, flip: false, out: false }), null);
  });
}
