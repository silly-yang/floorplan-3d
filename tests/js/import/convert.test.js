import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateFloorplan } from '../../../js/core/floorplan.js';
import { convertDxf, detectRooms } from '../../../js/import/convert.js';
import { parseDxf } from '../../../js/import/dxf.js';
import { ConfigError, RoomLeakError } from '../../../js/import/errors.js';
import { baseConfig, dxf } from './dxfFactory.js';

const OFFSET = 1000;
const o = OFFSET;
const area = (rects) => rects.reduce((sum, [x0, y0, x1, y1]) => sum + (x1 - x0) * (y1 - y0), 0);
const near = (actual, expected, eps = 1e-9) => assert.ok(Math.abs(actual - expected) <= eps, `${actual} ≉ ${expected}`);

// 一個 300×200（cm）、牆厚 15 的房間，下牆中間留 90 的門洞；整體平移 OFFSET 模擬圖面座標
const roomEntities = () => [
  ...dxf.rectLines('L3', o + 0, o + 0, o + 100, o + 15),
  ...dxf.rectLines('L3', o + 190, o + 0, o + 300, o + 15),
  ...dxf.rectLines('L3', o + 0, o + 185, o + 300, o + 200),
  ...dxf.rectLines('L3', o + 0, o + 15, o + 15, o + 185),
  ...dxf.rectLines('L3', o + 285, o + 15, o + 300, o + 185),
];

function build(config = baseConfig(), extra = []) {
  const withSeed = { ...config, rooms: [{ id: 'living', name: '客廳', seed: [o + 150, o + 100] }] };
  return convertDxf(parseDxf(dxf.document([...roomEntities(), ...extra])), withSeed);
}

const withBeamLayer = () => ({ ...baseConfig(), layers: { ...baseConfig().layers, beam: ['S01'] } });

test('convertDxf 輸出帶版本、公尺單位的平面圖', () => {
  // Act
  const { floorplan } = build();

  // Assert
  assert.equal(floorplan.version, 1);
  assert.equal(floorplan.units, 'm');
  assert.deepEqual(floorplan.bounds, { width: 3, depth: 2 });
  assert.equal(floorplan.walls.length, 5);
  assert.deepEqual([...new Set(floorplan.walls.map((w) => w.kind))], ['rc']);
});

test('convertDxf 原點平移到牆體外框左下角並換算成公尺', () => {
  // Act
  const { floorplan } = build();

  // Assert
  const points = floorplan.walls.flatMap((w) => w.polygon);
  assert.equal(Math.min(...points.map(([x]) => x)), 0);
  assert.equal(Math.min(...points.map(([, y]) => y)), 0);
  assert.equal(Math.max(...points.map(([x]) => x)), 3);
  assert.equal(Math.max(...points.map(([, y]) => y)), 2);
});

test('convertDxf 座標四捨五入到公釐', () => {
  // Arrange
  const config = { ...baseConfig(), clip: { xMin: 0, yMin: 0, xMax: 5000, yMax: 5000 } };
  const extra = dxf.rectLines('WALL2', o + 50.12345, o + 50, o + 60.12345, o + 90);

  // Act
  const { floorplan } = build(config, extra);

  // Assert
  const xs = floorplan.walls.filter((w) => w.kind === 'partition').flatMap((w) => w.polygon.map(([x]) => x));
  assert.deepEqual([...new Set(xs)].sort(), [0.501, 0.601]);
});

test('convertDxf 座標剛好落在半公釐時與 Python round 一樣取偶數', () => {
  // Arrange：56.25 cm × 0.01 = 0.5625 m，二進位可精確表示的一半；Python 取 0.562，toFixed 會給 0.563
  const extra = dxf.rectLines('WALL2', o + 56.25, o + 50, o + 66.25, o + 90);

  // Act
  const { floorplan } = build(baseConfig(), extra);

  // Assert
  const xs = floorplan.walls.filter((w) => w.kind === 'partition').flatMap((w) => w.polygon.map(([x]) => x));
  assert.deepEqual([...new Set(xs)].sort(), [0.562, 0.662]);
});

test('convertDxf 輸出門洞與照種子命名的房間', () => {
  // Act
  const { floorplan } = build();

  // Assert
  assert.deepEqual(floorplan.openings.map((op) => [op.id, op.kind]), [['doorway-1', 'doorway']]);
  assert.deepEqual(floorplan.rooms.map((r) => [r.id, r.name]), [['living', '客廳']]);
  near(area(floorplan.rooms[0].rects), 2.7 * 1.7);
});

test('convertDxf 絕不輸出圖面文字', () => {
  // Arrange：圖面文字可能含地址、社區名、樓層
  const secret = '某某市某某路1號3F';
  const extra = [dxf.text('表格', [o + 50, o + 50], secret), dxf.attrib('OPEN-Window', [o + 50, o + 60], 'NO.', secret)];

  // Act
  const { floorplan } = build(baseConfig(), extra);

  // Assert
  assert.ok(!JSON.stringify(floorplan).includes(secret));
});

test('convertDxf 牆線沒封閉時給警告', () => {
  // Arrange
  const extra = [dxf.line('L3', [o + 50, o + 50], [o + 120, o + 50])];

  // Act
  const { warnings } = build(baseConfig(), extra);

  // Assert
  assert.ok(warnings.some((w) => w.includes('沒有封閉')));
});

test('convertDxf 欄杆線把陽台封起來，填色不越過欄杆', () => {
  // Arrange：上方沒有牆，只有一條欄杆線；欄杆刻意不落在填色格子中心上
  const entities = [
    ...dxf.rectLines('L3', o + 0, o + 0, o + 100, o + 15),
    ...dxf.rectLines('L3', o + 190, o + 0, o + 300, o + 15),
    ...dxf.rectLines('L3', o + 0, o + 15, o + 15, o + 200),
    ...dxf.rectLines('L3', o + 285, o + 15, o + 300, o + 200),
    dxf.line('L23', [o + 15, o + 190], [o + 285, o + 190]),
  ];
  const config = { ...baseConfig(), rooms: [{ id: 'balcony', name: '陽台', seed: [o + 150, o + 100] }] };

  // Act
  const { floorplan } = convertDxf(parseDxf(dxf.document(entities)), config);

  // Assert
  assert.equal(floorplan.rooms.length, 1);
  assert.ok(Math.max(...floorplan.rooms[0].rects.map((r) => r[3])) <= 1.9);
});

test('convertDxf 兩條平行樑線配成一支樑，深度取寬度相符的標註，樑代號不輸出', () => {
  // Arrange：寬 30 的樑；更近處有一個寬度不符的標註要忽略
  const extra = [
    dxf.line('S01', [o + 100, o + 20], [o + 100, o + 180]),
    dxf.line('S01', [o + 130, o + 20], [o + 130, o + 180]),
    dxf.text('S01', [o + 135, o + 100], 'B99(60x90)'),
    dxf.text('S01', [o + 160, o + 100], 'J10(30x50)'),
  ];

  // Act
  const { floorplan } = build(withBeamLayer(), extra);

  // Assert
  assert.deepEqual(floorplan.beams, [{ rect: [1, 0.2, 1.3, 1.8], depth: 0.5 }]);
  assert.ok(!JSON.stringify(floorplan).includes('J10'));
});

test('convertDxf 沒有標註的樑用預設深度', () => {
  // Arrange
  const extra = [
    dxf.line('S01', [o + 20, o + 100], [o + 280, o + 100]),
    dxf.line('S01', [o + 20, o + 140], [o + 280, o + 140]),
  ];

  // Act
  const { floorplan } = build(withBeamLayer(), extra);

  // Assert
  assert.deepEqual(floorplan.beams.map((b) => b.depth), [0.6]);
});

test('convertDxf 相距太遠的平行線不配成樑', () => {
  // Arrange：相距 150，比任何樑都寬，是兩支樑各自的一邊
  const extra = [
    dxf.line('S01', [o + 50, o + 20], [o + 50, o + 180]),
    dxf.line('S01', [o + 200, o + 20], [o + 200, o + 180]),
  ];

  // Act
  const { floorplan } = build(withBeamLayer(), extra);

  // Assert
  assert.deepEqual(floorplan.beams, []);
});

test('convertDxf 三條平行樑線時配最近的那條', () => {
  // Arrange：間距 20 與 50 都在樑寬範圍內，要配間距 20 的
  const extra = [
    dxf.line('S01', [o + 100, o + 20], [o + 100, o + 180]),
    dxf.line('S01', [o + 120, o + 20], [o + 120, o + 180]),
    dxf.line('S01', [o + 150, o + 20], [o + 150, o + 180]),
  ];

  // Act
  const { floorplan } = build(withBeamLayer(), extra);

  // Assert
  assert.deepEqual(floorplan.beams, [{ rect: [1, 0.2, 1.2, 1.8], depth: 0.6 }]);
});

test('convertDxf clip 範圍外的樑不輸出', () => {
  // Arrange
  const config = { ...withBeamLayer(), clip: { xMin: 0, yMin: 0, xMax: o + 400, yMax: 5000 } };
  const extra = [
    dxf.line('S01', [o + 600, o + 20], [o + 600, o + 180]),
    dxf.line('S01', [o + 630, o + 20], [o + 630, o + 180]),
  ];

  // Act
  const { floorplan } = build(config, extra);

  // Assert
  assert.deepEqual(floorplan.beams, []);
});

test('convertDxf clip 範圍外的欄杆線不當障礙，陽台填色會漏出去', () => {
  // Arrange：clip 逐個圖元看起點；側牆畫成一條多段線、起點在 clip 內，欄杆起點 y=190 在 clip 外
  const entities = [
    ...dxf.rectLines('L3', o + 0, o + 0, o + 100, o + 15),
    ...dxf.rectLines('L3', o + 190, o + 0, o + 300, o + 15),
    dxf.lwpolyline('L3', [[o + 0, o + 15], [o + 15, o + 15], [o + 15, o + 200], [o + 0, o + 200]], true),
    dxf.lwpolyline('L3', [[o + 285, o + 15], [o + 300, o + 15], [o + 300, o + 200], [o + 285, o + 200]], true),
    dxf.line('L23', [o + 15, o + 190], [o + 285, o + 190]),
  ];
  const config = {
    ...baseConfig(),
    clip: { xMin: 0, yMin: 0, xMax: 5000, yMax: o + 186 },
    rooms: [{ id: 'balcony', name: '陽台', seed: [o + 150, o + 100] }],
  };

  // Act & Assert
  assert.throws(() => convertDxf(parseDxf(dxf.document(entities)), config), RoomLeakError);
});

test('convertDxf 輸出通過 validateFloorplan，且不含水電、建商家具與天花板分區', () => {
  // Arrange
  const extra = [
    dxf.line('S01', [o + 100, o + 20], [o + 100, o + 180]),
    dxf.line('S01', [o + 130, o + 20], [o + 130, o + 180]),
  ];

  // Act
  const { floorplan } = build(withBeamLayer(), extra);

  // Assert
  assert.deepEqual(validateFloorplan(floorplan), []);
  assert.deepEqual([floorplan.fixtures, floorplan.outlets, floorplan.ceilingZones], [[], [], []]);
});

test('convertDxf CRLF 換行的 DXF 轉出相同結果', () => {
  // Arrange
  const config = { ...baseConfig(), rooms: [{ id: 'living', name: '客廳', seed: [o + 150, o + 100] }] };

  // Act
  const lf = convertDxf(parseDxf(dxf.document(roomEntities())), config).floorplan;
  const crlf = convertDxf(parseDxf(dxf.document(roomEntities(), {}, { eol: '\r\n' })), config).floorplan;

  // Assert
  assert.equal(crlf.walls.length, 5);
  assert.deepEqual(crlf, lf);
});

for (const [name, patch, field] of [
  ['缺 unitScale', { unitScale: undefined }, 'unitScale'],
  ['gapMax 不大於 gapMin', { gapMax: 30 }, 'gapMax'],
  ['clip 最小值大於最大值', { clip: { xMin: 10, yMin: 0, xMax: 0, yMax: 10 } }, 'clip'],
  ['圖層不是陣列', { layers: { rcWall: 'L3' } }, 'layers.rcWall'],
]) {
  test(`convertDxf 設定不合法時丟出設定錯誤：${name}`, () => {
    // Arrange
    const doc = parseDxf(dxf.document(roomEntities()));

    // Act & Assert
    assert.throws(
      () => convertDxf(doc, { ...baseConfig(), ...patch }),
      (err) => err instanceof ConfigError && err.problems.some((p) => p.startsWith(field)),
    );
  });
}

// 左邊 300×200 的大房間；右邊 140×200 扣掉右上角 L 形隔間圍出的 50×80 儲藏室（< 1 m²）
// L 形隔間畫成一條多段線，否則牆的自由端會被當成門洞的牆端
const twoRoomEntities = () => [
  ...dxf.rectLines('L3', o + 0, o + 0, o + 480, o + 15),
  ...dxf.rectLines('L3', o + 0, o + 215, o + 480, o + 230),
  ...dxf.rectLines('L3', o + 0, o + 15, o + 15, o + 215),
  ...dxf.rectLines('L3', o + 465, o + 15, o + 480, o + 215),
  ...dxf.rectLines('WALL2', o + 315, o + 15, o + 325, o + 215),
  dxf.lwpolyline('WALL2', [[o + 325, o + 125], [o + 385, o + 125], [o + 385, o + 215], [o + 375, o + 215], [o + 375, o + 135], [o + 325, o + 135]], true),
];

test('detectRooms 沒有種子時自動找出被牆圍住的區域，依面積由大到小編號，小於 1 m² 丟掉', () => {
  // Arrange
  const doc = parseDxf(dxf.document(twoRoomEntities()));

  // Act
  const rooms = detectRooms(doc, baseConfig());

  // Assert
  assert.deepEqual(rooms.map((r) => r.id), ['room-1', 'room-2']);
  near(rooms[0].area, 3.0 * 2.0);
  near(rooms[1].area, 1.4 * 2.0 - 0.5 * 0.8 - 0.14);
  for (const room of rooms) {
    near(area(room.rects), room.area);
    const [cx, cy] = room.center;
    assert.ok(room.rects.some(([x0, y0, x1, y1]) => cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1));
  }
});

test('detectRooms 碰到 clip 邊界的區域視為戶外丟掉', () => {
  // Arrange：只有三面牆的 ㄈ 形，開口朝外
  const entities = [
    ...dxf.rectLines('L3', o + 0, o + 0, o + 300, o + 15),
    ...dxf.rectLines('L3', o + 0, o + 15, o + 15, o + 200),
    ...dxf.rectLines('L3', o + 285, o + 15, o + 300, o + 200),
  ];
  const config = { ...baseConfig(), clip: { xMin: o - 50, yMin: o - 50, xMax: o + 350, yMax: o + 400 } };

  // Act
  const rooms = detectRooms(parseDxf(dxf.document(entities)), config);

  // Assert
  assert.deepEqual(rooms, []);
});

// 與 roomEntities 相同的房間，上牆畫成一條多段線，起點 y=185 才會在下面測試的 clip 內
const roomWithPolylineTop = () => [
  ...roomEntities().filter((_, i) => i < 8 || i >= 12),
  dxf.lwpolyline('L3', [[o + 0, o + 185], [o + 300, o + 185], [o + 300, o + 200], [o + 0, o + 200]], true),
];

test('detectRooms clip 邊界切過室內時，該區域視為戶外丟掉', () => {
  // Arrange：clip 上緣剛好是室內上緣，最上一列格子落在室內
  const config = { ...baseConfig(), clip: { xMin: o - 50, yMin: o - 50, xMax: o + 350, yMax: o + 185 } };

  // Act
  const rooms = detectRooms(parseDxf(dxf.document(roomWithPolylineTop())), config);

  // Assert
  assert.deepEqual(rooms, []);
});

test('detectRooms 同一間房 clip 留有餘裕時找得到', () => {
  // Arrange：與上一條相同的房間，clip 上緣放寬
  const config = { ...baseConfig(), clip: { xMin: o - 50, yMin: o - 50, xMax: o + 350, yMax: o + 250 } };

  // Act
  const rooms = detectRooms(parseDxf(dxf.document(roomWithPolylineTop())), config);

  // Assert
  assert.deepEqual(rooms.map((r) => r.id), ['room-1']);
  near(rooms[0].area, 2.7 * 1.7);
});

test('detectRooms 有種子時照種子命名', () => {
  // Arrange
  const config = { ...baseConfig(), rooms: [{ id: 'living', name: '客廳', seed: [o + 150, o + 100] }] };

  // Act
  const rooms = detectRooms(parseDxf(dxf.document(twoRoomEntities())), config);

  // Assert
  assert.deepEqual(rooms.map((r) => [r.id, r.name]), [['living', '客廳']]);
  near(rooms[0].area, 3.0 * 2.0);
});

test('convertDxf 沒有種子時用自動偵測的房間', () => {
  // Act
  const { floorplan } = convertDxf(parseDxf(dxf.document(twoRoomEntities())), baseConfig());

  // Assert
  assert.deepEqual(floorplan.rooms.map((r) => [r.id, r.name]), [['room-1', '房間 1'], ['room-2', '房間 2']]);
  near(area(floorplan.rooms[0].rects), 6);
});
