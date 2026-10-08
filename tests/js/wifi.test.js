import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  coverageGrid,
  gradeOf,
  obstaclesOf,
  pathLoss,
  roomRatings,
  signalAt,
  wallLoss,
  wallsBetween,
  wirelessDevices,
} from '../../js/core/wifi.js';

const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const wall = (kind, polygon) => ({ kind, polygon });
const device = (over = {}) => ({ id: 'd1', x: 0, y: 0, txPower: 20, ...over });
const close = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
// 設備在原點，量測點在 (10, 0)；擋在 x = 5 的一道牆
const BLOCK = rect(4.9, -1, 5.1, 1);

for (const [kind, expected] of [
  ['rc', 12],
  ['partition', 4],
  ['column', 15],
  ['window', 3],
  ['doorway', 0],
]) {
  test(`wallLoss ${kind} 損失 ${expected} dB`, () => {
    // Act & Assert
    assert.equal(wallLoss(kind), expected);
  });
}

for (const [name, distance, expected] of [
  ['1 公尺為 40 dB', 1, 40],
  ['10 公尺為 60 dB', 10, 60],
  ['不到 0.5 公尺以 0.5 公尺計，不會無限大', 0, 40 + 20 * Math.log10(0.5)],
]) {
  test(`pathLoss ${name}`, () => {
    // Act
    const loss = pathLoss(distance);

    // Assert
    assert.ok(close(loss, expected), `got ${loss}`);
  });
}

test('signalAt 沒有牆時為發射功率減去路徑損失', () => {
  // Act
  const rssi = signalAt([10, 0], device(), []);

  // Assert
  assert.ok(close(rssi, -40), `got ${rssi}`);
});

test('signalAt 距離越遠訊號越弱', () => {
  // Act
  const values = [1, 3, 6, 12].map((x) => signalAt([x, 0], device(), []));

  // Assert
  for (let i = 1; i < values.length; i++) assert.ok(values[i] < values[i - 1], `${values}`);
});

for (const [kind, drop] of [
  ['rc', 12],
  ['partition', 4],
  ['column', 15],
  ['window', 3],
]) {
  test(`signalAt 多穿一道 ${kind} 掉 ${drop} dB`, () => {
    // Arrange
    const open = signalAt([10, 0], device(), []);

    // Act
    const blocked = signalAt([10, 0], device(), [wall(kind, BLOCK)]);

    // Assert
    assert.ok(close(open - blocked, drop), `got ${open - blocked}`);
  });
}

test('signalAt 沒擋在路徑上的牆不扣分', () => {
  // Act
  const rssi = signalAt([10, 0], device(), [wall('rc', rect(4.9, 2, 5.1, 4))]);

  // Assert
  assert.ok(close(rssi, -40), `got ${rssi}`);
});

test('signalAt 穿過 L 形牆的兩段要扣兩次', () => {
  // Arrange：x = 3 與 x = 7 兩段直牆，在上方連成一個 ㄇ 形
  const u = [[2.9, -1], [3.1, -1], [3.1, 1.8], [6.9, 1.8], [6.9, -1], [7.1, -1], [7.1, 2], [2.9, 2]];

  // Act
  const rssi = signalAt([10, 0], device(), [wall('rc', u)]);

  // Assert
  assert.ok(close(rssi, -40 - 24), `got ${rssi}`);
});

test('wallsBetween 只數牆、柱，不數窗戶', () => {
  // Arrange
  const walls = [wall('rc', rect(2.9, -1, 3.1, 1)), wall('partition', BLOCK), wall('window', rect(6.9, -1, 7.1, 1))];

  // Act
  const count = wallsBetween([0, 0], [10, 0], walls);

  // Assert
  assert.equal(count, 2);
});

test('coverageGrid 在房間內以格子中心取樣', () => {
  // Arrange
  const rooms = [{ id: 'r', name: '房', rects: [[0, 0, 1, 0.5]] }];

  // Act
  const grid = coverageGrid(rooms, [device({ x: 0.5, y: 0.25 })], [], 0.25);

  // Assert
  assert.deepEqual(
    grid.map((p) => [p.x, p.y]),
    [[0.125, 0.125], [0.375, 0.125], [0.625, 0.125], [0.875, 0.125], [0.125, 0.375], [0.375, 0.375], [0.625, 0.375], [0.875, 0.375]],
  );
  assert.ok(grid.every((p) => p.roomId === 'r' && Number.isFinite(p.rssi)));
});

test('coverageGrid 兩台設備取較強的訊號', () => {
  // Arrange
  const rooms = [{ id: 'r', name: '房', rects: [[9.75, 0, 10.25, 0.5]] }];
  const far = device({ id: 'far', x: 0, y: 0.25 });
  const near = device({ id: 'near', x: 12, y: 0.25 });

  // Act
  const grid = coverageGrid(rooms, [far, near], [], 0.5);

  // Assert
  assert.equal(grid.length, 1);
  assert.ok(close(grid[0].rssi, signalAt([10, 0.25], near, [])), `got ${grid[0].rssi}`);
});

test('coverageGrid 沒有無線設備時回空陣列', () => {
  // Act
  const grid = coverageGrid([{ id: 'r', name: '房', rects: [[0, 0, 1, 1]] }], [], []);

  // Assert
  assert.deepEqual(grid, []);
});

for (const [rssi, expected] of [
  [-45, 'excellent'],
  [-60, 'excellent'],
  [-60.1, 'good'],
  [-70, 'good'],
  [-70.1, 'fair'],
  [-80, 'fair'],
  [-80.1, 'poor'],
]) {
  test(`gradeOf ${rssi} dBm 為 ${expected}`, () => {
    // Act & Assert
    assert.equal(gradeOf(rssi).id, expected);
  });
}

test('gradeOf 的等級名稱為優、良、普通、差', () => {
  // Act
  const labels = [-50, -65, -75, -90].map((v) => gradeOf(v).label);

  // Assert
  assert.deepEqual(labels, ['優', '良', '普通', '差']);
});

test('roomRatings 同房間的路由器：等級優、零道牆、沒有建議', () => {
  // Arrange
  const rooms = [{ id: 'living', name: '客廳', rects: [[0, 0, 2, 2]] }];

  // Act
  const [rating] = roomRatings(rooms, [device({ x: 1, y: 1 })], []);

  // Assert
  assert.equal(rating.id, 'living');
  assert.equal(rating.name, '客廳');
  assert.equal(rating.grade.id, 'excellent');
  assert.equal(rating.walls, 0);
  assert.equal(rating.suggestion, null);
  assert.ok(rating.min <= rating.avg);
});

for (const [name, walls, suggested] of [
  ['穿過 2 道牆就建議加 Mesh', [wall('partition', rect(2.9, -1, 3.1, 1)), wall('partition', BLOCK)], true],
  ['只穿過 1 道牆不建議', [wall('partition', BLOCK)], false],
]) {
  test(`roomRatings ${name}`, () => {
    // Arrange：房間中心在 (10, 0)
    const rooms = [{ id: 'bed', name: '臥室', rects: [[9.5, -0.5, 10.5, 0.5]] }];

    // Act
    const [rating] = roomRatings(rooms, [device()], walls);

    // Assert
    assert.equal(rating.walls, walls.length);
    assert.equal(rating.suggestion !== null, suggested, rating.suggestion);
    if (suggested) assert.match(rating.suggestion, /Mesh/);
  });
}

for (const [name, txPower, suggested] of [
  ['最低訊號低於 −75 dBm 就建議', -20, true],
  ['最低訊號在 −75 dBm 以上不建議', -10, false],
]) {
  test(`roomRatings ${name}`, () => {
    // Arrange：房間離設備約 10 公尺、中間沒有牆
    const rooms = [{ id: 'bed', name: '臥室', rects: [[9.9, -0.1, 10.1, 0.1]] }];

    // Act
    const [rating] = roomRatings(rooms, [device({ txPower })], [], { step: 0.1 });

    // Assert
    assert.equal(rating.walls, 0);
    assert.equal(rating.suggestion !== null, suggested, `min ${rating.min}`);
  });
}

test('roomRatings 等級看平均訊號，不是最弱處', () => {
  // Arrange：細長房間，近端 −34 dBm、遠端約 −74 dBm，平均約 −66 dBm
  const rooms = [{ id: 'r', name: '走廊', rects: [[0, -0.25, 30, 0.25]] }];

  // Act
  const [rating] = roomRatings(rooms, [device({ txPower: -5 })], [], { step: 0.5 });

  // Assert
  assert.ok(rating.min < -70 && rating.avg > -70, `min ${rating.min} avg ${rating.avg}`);
  assert.equal(rating.grade.id, 'good');
});

test('roomRatings 牆數以離房間中心最近的設備計算', () => {
  // Arrange：近的設備在牆後、遠的在同側
  const rooms = [{ id: 'r', name: '房', rects: [[9.5, -0.5, 10.5, 0.5]] }];
  const near = device({ id: 'near', x: 12, y: 0 });
  const far = device({ id: 'far', x: 0, y: 0 });

  // Act
  const [rating] = roomRatings(rooms, [far, near], [wall('rc', rect(10.9, -1, 11.1, 1))]);

  // Assert
  assert.equal(rating.walls, 1);
});

test('roomRatings 沒有無線設備時回空陣列', () => {
  // Act & Assert
  assert.deepEqual(roomRatings([{ id: 'r', name: '房', rects: [[0, 0, 1, 1]] }], [], []), []);
});

test('wirelessDevices 只挑有無線參數的網路設備，弱電箱與一般家具不算', () => {
  // Arrange
  const furniture = [
    { id: 'a', type: 'wifi-router', x: 1, y: 2 },
    { id: 'b', type: 'network-panel', x: 0, y: 0 },
    { id: 'c', type: 'sofa', x: 3, y: 3 },
    { id: 'd', type: 'ceiling-ap', x: 4, y: 5 },
  ];

  // Act
  const devices = wirelessDevices(furniture);

  // Assert
  assert.deepEqual(devices.map((d) => [d.id, d.x, d.y]), [['a', 1, 2], ['d', 4, 5]]);
  assert.ok(devices.every((d) => typeof d.txPower === 'number'));
});

test('obstaclesOf 收牆與窗戶，門與門洞不擋訊號', () => {
  // Arrange
  const floorplan = {
    walls: [wall('rc', rect(0, 0, 1, 0.2)), wall('partition', rect(2, 0, 3, 0.1))],
    openings: [
      { id: 'w', kind: 'window', polygon: rect(1, 0, 2, 0.2) },
      { id: 'd', kind: 'door', polygon: rect(3, 0, 4, 0.1) },
      { id: 'o', kind: 'doorway', polygon: rect(4, 0, 5, 0.1) },
    ],
  };

  // Act
  const kinds = obstaclesOf(floorplan).map((o) => o.kind);

  // Assert
  assert.deepEqual(kinds, ['rc', 'partition', 'window']);
});
