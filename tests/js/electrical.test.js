import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createElectrical,
  isElectrical,
  missingOutlets,
  mountSurfaces,
  needsDedicatedCircuit,
  outletsToFurniture,
  outletSpec,
  powerIssues,
  snapToWall,
} from '../../js/core/electrical.js';
import { createFurniture } from '../../js/furniture/catalog.js';

// 逆時針的矩形；cw 為順時針，用來確認牆的頂點順序不影響朝向
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const cw = (poly) => [...poly].reverse();

// 3 × 2 m 的房間，牆厚 15 cm；上牆用順時針
function roomWalls() {
  return [
    { id: 'bottom', polygon: rect(0, 0, 3, 0.15) },
    { id: 'left', polygon: rect(0, 0.15, 0.15, 1.85) },
    { id: 'top', polygon: cw(rect(0, 1.85, 3, 2)) },
    { id: 'right', polygon: rect(2.85, 0.15, 3, 1.85) },
  ];
}

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} ≠ ${expected}`);

function assertSpot(spot, { x, y, rotation }) {
  assert.ok(spot, '應該要貼到牆上');
  near(spot.x, x);
  near(spot.y, y);
  near(spot.rotation, rotation);
}

// ---------- 貼牆 ----------

test('snapToWall 貼到最近的牆面，位置在牆面外半個面板深，正面朝房間內', () => {
  // Arrange
  const walls = roomWalls();

  // Act & Assert：下牆朝北（180°）、左牆朝東（90°）、上牆朝南（0°）、右牆朝西（270°）
  assertSpot(snapToWall([1, 0.4], walls), { x: 1, y: 0.17, rotation: 180 });
  assertSpot(snapToWall([0.3, 1], walls), { x: 0.17, y: 1, rotation: 90 });
  assertSpot(snapToWall([1.5, 1.6], walls), { x: 1.5, y: 1.83, rotation: 0 });
  assertSpot(snapToWall([2.6, 1], walls), { x: 2.83, y: 1, rotation: 270 });
});

test('snapToWall 離牆超過 0.6 m 回 null；maxDistance 放寬後找得到', () => {
  // Arrange
  const walls = roomWalls();

  // Act
  const far = snapToWall([1.5, 1.0], walls);
  const loose = snapToWall([1.5, 0.9], walls, { maxDistance: Infinity });

  // Assert
  assert.equal(far, null);
  assertSpot(loose, { x: 1.5, y: 0.17, rotation: 180 });
});

test('snapToWall 剛好 0.6 m 還算在範圍內', () => {
  // Act
  const spot = snapToWall([1, 0.75], roomWalls());

  // Assert
  assertSpot(spot, { x: 1, y: 0.17, rotation: 180 });
});

test('snapToWall 落點壓在牆裡時推到最近的牆面外側', () => {
  // Act
  const spot = snapToWall([1, 0.1], roomWalls());

  // Assert
  assertSpot(spot, { x: 1, y: 0.17, rotation: 180 });
});

test('snapToWall 不會貼到兩道牆相接的那一面（會卡進另一道牆）', () => {
  // Arrange：B 疊在 A 上，共用 y = 0.15 那條邊；落點在 B 裡、離共用邊最近
  const walls = [
    { id: 'A', polygon: rect(0, 0, 1, 0.15) },
    { id: 'B', polygon: rect(0, 0.15, 1, 0.25) },
  ];

  // Act
  const spot = snapToWall([0.5, 0.17], walls);

  // Assert
  assertSpot(spot, { x: 0.5, y: 0.27, rotation: 180 });
});

test('snapToWall 面板不超出牆的端點', () => {
  // Arrange：牆只到 x = 1，面板寬 12 cm
  const walls = [{ id: 'short', polygon: rect(0, 0, 1, 0.15) }];

  // Act
  const spot = snapToWall([0.98, 0.5], walls);

  // Assert
  assertSpot(spot, { x: 0.94, y: 0.17, rotation: 180 });
});

// ---------- 建立插座 ----------

test('isElectrical 只認水電類', () => {
  // Assert
  assert.equal(isElectrical('outlet-110'), true);
  assert.equal(isElectrical('switch'), true);
  assert.equal(isElectrical('sofa'), false);
  assert.equal(isElectrical('nope'), false);
});

test('createElectrical 依類型帶入預設高度與選項，並貼牆', () => {
  // Arrange
  const walls = roomWalls();

  // Act
  const outlet = createElectrical('outlet-110', { id: 'o1', x: 1, y: 0.4 }, walls);
  const aircon = createElectrical('outlet-220', { id: 'o2', x: 1, y: 0.4 }, walls);
  const sw = createElectrical('switch', { id: 'o3', x: 1, y: 0.4 }, walls);

  // Assert
  assert.ok(outlet && aircon && sw, '三種都要建立成功');
  assert.equal(outlet.id, 'o1');
  assert.equal(outlet.type, 'outlet-110');
  assertSpot(outlet, { x: 1, y: 0.17, rotation: 180 });
  assert.deepEqual(outlet.size, { w: 12, d: 4, h: 12 });
  assert.equal(outlet.elevation, 0.3);
  assert.deepEqual(outlet.options, { voltage: 110, dedicated: false });
  assert.equal(aircon.elevation, 2.3);
  assert.deepEqual(aircon.options, { voltage: 220, dedicated: true });
  assert.equal(sw.elevation, 1.2);
  assert.deepEqual(sw.options, {});
});

test('createElectrical 離牆太遠回 null，放寬距離則貼到最近的牆', () => {
  // Arrange
  const walls = roomWalls();

  // Act
  const far = createElectrical('outlet-110', { id: 'o1', x: 1.5, y: 1 }, walls);
  const loose = createElectrical('outlet-110', { id: 'o1', x: 1.5, y: 0.9 }, walls, { maxDistance: Infinity });

  // Assert
  assert.equal(far, null);
  assertSpot(loose, { x: 1.5, y: 0.17, rotation: 180 });
});

test('createElectrical 非水電類型回 null', () => {
  // Act & Assert
  assert.equal(createElectrical('sofa', { id: 's', x: 1, y: 0.4 }, roomWalls()), null);
});

test('outletSpec 以家具自己的選項為準，沒有才用類型預設', () => {
  // Act & Assert
  assert.deepEqual(outletSpec({ type: 'outlet-110' }), { voltage: 110, dedicated: false });
  assert.deepEqual(outletSpec({ type: 'outlet-110', options: { voltage: 220 } }), { voltage: 220, dedicated: false });
  assert.deepEqual(outletSpec({ type: 'outlet-dedicated' }), { voltage: 110, dedicated: true });
  assert.deepEqual(outletSpec({ type: 'switch' }), { voltage: null, dedicated: false });
});

// ---------- 建商預設插座 ----------

test('outletsToFurniture 貼牆、帶入圖面高度與類型預設選項', () => {
  // Arrange
  let n = 0;
  const outlets = [{ type: 'outlet-220', x: 1, y: 0.3, height: 2.3 }, { type: 'tv-jack', x: 0.25, y: 1, height: 0.3 }];

  // Act
  const items = outletsToFurniture(outlets, roomWalls(), () => `id-${++n}`);

  // Assert
  assert.equal(items.length, 2);
  assert.equal(items[0].id, 'id-1');
  assert.equal(items[0].type, 'outlet-220');
  assertSpot(items[0], { x: 1, y: 0.17, rotation: 180 });
  assert.equal(items[0].elevation, 2.3);
  assert.deepEqual(items[0].options, { voltage: 220, dedicated: true });
  assertSpot(items[1], { x: 0.17, y: 1, rotation: 90 });
});

test('outletsToFurniture 略過未知類型與格式錯誤；圖面上離牆較遠的也貼到最近的牆', () => {
  // Arrange：圖面符號常畫在離牆一段距離的地方
  const outlets = [
    { type: 'nope', x: 1, y: 0.3, height: 0.3 },
    { type: 'switch', x: 'a', y: 0.3, height: 1.2 },
    { type: 'switch', x: 1.5, y: 0.9, height: 1.2 },
  ];

  // Act
  const items = outletsToFurniture(outlets, roomWalls(), () => 'id');

  // Assert
  assert.equal(items.length, 1);
  assertSpot(items[0], { x: 1.5, y: 0.17, rotation: 180 });
  assert.equal(items[0].elevation, 1.2);
});

test('mountSurfaces 牆加上有窗台的窗，不含門、門洞與落地窗', () => {
  // Arrange
  const fp = {
    walls: [{ id: 'w1', polygon: rect(0, 0, 1, 0.15) }],
    openings: [
      { id: 'W5-1', kind: 'window', polygon: rect(1, 0, 2, 0.15), sill: 0.9, head: 2.1 },
      { id: 'DW4-1', kind: 'window', polygon: rect(2, 0, 3, 0.15), sill: 0, head: 2.2 },
      { id: 'D2-1', kind: 'door', polygon: rect(3, 0, 4, 0.15), sill: 0, head: 2.1 },
      { id: 'doorway-1', kind: 'doorway', polygon: rect(4, 0, 5, 0.15), sill: 0, head: 2.2 },
    ],
  };

  // Act
  const ids = mountSurfaces(fp).map((s) => s.id);

  // Assert
  assert.deepEqual(ids, ['w1', 'W5-1']);
});

test('outletsToFurniture 沒有 outlets 欄位回空陣列', () => {
  // Act & Assert
  assert.deepEqual(outletsToFurniture(undefined, roomWalls(), () => 'id'), []);
});

test('missingOutlets 一個插座只抵一個原位，同類型才算', () => {
  // Arrange：兩個冷氣插座相距 20 cm，只剩一個；另一個位置放的是別種
  const outlets = [
    { type: 'outlet-220', x: 1, y: 0.17, height: 2.3 },
    { type: 'outlet-220', x: 1.2, y: 0.17, height: 2.3 },
    { type: 'switch', x: 2, y: 0.17, height: 1.2 },
  ];
  const furniture = [
    { id: 'a', type: 'outlet-220', x: 1.05, y: 0.17 },
    { id: 'b', type: 'outlet-110', x: 2, y: 0.17 },
  ];

  // Act
  const missing = missingOutlets(furniture, outlets, roomWalls());

  // Assert
  assert.deepEqual(missing, [outlets[1], outlets[2]]);
});

test('missingOutlets 以貼牆後的位置比對，圖面上離牆較遠的插座放回後不會一直算缺', () => {
  // Arrange：圖面位置離牆 45 cm，貼牆後在 y = 0.17
  const outlets = [{ type: 'switch', x: 1, y: 0.6, height: 1.2 }];
  const furniture = [{ id: 'a', type: 'switch', x: 1, y: 0.17 }];

  // Act
  const missing = missingOutlets(furniture, outlets, roomWalls());

  // Assert
  assert.deepEqual(missing, []);
});

// ---------- 用電檢查 ----------

const place = (type, id, x, y, extra = {}) => ({ ...createFurniture(type, { id, x, y }), ...extra });
const outlet = (id, x, y, { elevation = 0.3, voltage = 110, dedicated = false, type = 'outlet-110' } = {}) => ({
  ...place(type, id, x, y),
  rotation: 180,
  elevation,
  options: { voltage, dedicated },
});
const issuesOf = (furniture) => powerIssues({ furniture, cabinets: [] });

test('powerIssues 家電附近沒有插座時提醒電壓', () => {
  // Arrange
  const purifier = place('air-purifier', 'p', 1, 1);

  // Act
  const issues = issuesOf([purifier]);

  // Assert
  assert.equal(issues.length, 1);
  assert.equal(issues[0].furnitureId, 'p');
  assert.equal(issues[0].kind, 'no-outlet');
  assert.match(issues[0].message, /附近沒有 110V 插座/);
});

test('powerIssues 1.5 m 內有電壓相符的插座就不提醒', () => {
  // Arrange：清淨機底面離插座 0.68 m
  const furniture = [place('air-purifier', 'p', 1, 1), outlet('o', 1, 0.17)];

  // Act & Assert
  assert.deepEqual(issuesOf(furniture), []);
});

test('powerIssues 插座太遠時寫出最近的距離', () => {
  // Arrange：底面離插座 1.88 m
  const furniture = [place('air-purifier', 'p', 1, 2.2), outlet('o', 1, 0.17)];

  // Act
  const issues = issuesOf(furniture);

  // Assert
  assert.equal(issues.length, 1);
  assert.match(issues[0].message, /附近沒有 110V 插座（最近的在 1\.9 m/);
});

test('powerIssues 距離只比 1.5 m 多一點時無條件進位，不會寫成 1.5 m', () => {
  // Arrange：底面離插座 1.53 m
  const furniture = [place('air-purifier', 'p', 1, 1.85), outlet('o', 1, 0.17)];

  // Act
  const issues = issuesOf(furniture);

  // Assert
  assert.match(issues[0].message, /最近的在 1\.6 m/);
});

test('powerIssues 提醒不重複家電名稱（清單與屬性面板已經標示是哪一件）', () => {
  // Arrange
  const furniture = [place('air-fryer', 'f', 1, 0.6), outlet('o', 1, 0.17)];

  // Act
  const issues = issuesOf([place('steam-oven', 's', 1, 1), ...furniture]);

  // Assert
  assert.equal(issues.length, 2);
  for (const issue of issues) assert.doesNotMatch(issue.message, /蒸烤爐|氣炸鍋/);
});

test('powerIssues 剛好 1.5 m 還算附近', () => {
  // Arrange：清淨機寬深 30 cm，底面前緣 y = 1.67，與插座差 1.5 m
  const furniture = [place('air-purifier', 'p', 1, 1.82), outlet('o', 1, 0.17)];

  // Act & Assert
  assert.deepEqual(issuesOf(furniture), []);
});

test('powerIssues 電壓不符不算', () => {
  // Arrange
  const furniture = [place('air-purifier', 'p', 1, 1), outlet('o', 1, 0.17, { voltage: 220 })];

  // Act
  const issues = issuesOf(furniture);

  // Assert
  assert.deepEqual(issues.map((i) => i.kind), ['no-outlet']);
  assert.match(issues[0].message, /110V/);
});

test('powerIssues 檯面上的家電把高度差算進距離', () => {
  // Arrange：熱水瓶在廚具上（離地 0.9 m），與插座平面距離約 1.13 m
  const counter = place('kitchen-counter', 'k', 1.5, 0.47, { rotation: 180 });
  const kettle = place('kettle', 'kt', 1, 0.62);
  const low = outlet('low', 2.2, 0.17, { elevation: 0.3 });
  const high = outlet('high', 2.2, 0.17, { elevation: 1.1 });

  // Act
  const withLow = issuesOf([counter, kettle, low]).filter((i) => i.furnitureId === 'kt');
  const withHigh = issuesOf([counter, kettle, high]);

  // Assert：低插座要再往下 0.6 m，超過 1.5 m
  assert.deepEqual(withLow.map((i) => i.kind), ['no-outlet']);
  assert.deepEqual(withHigh, []);
});

test('powerIssues 220V 或 1200W 以上的家電，附近插座不是專用迴路時建議拉專用迴路', () => {
  // Arrange
  const steam = place('steam-oven', 's', 1, 0.6);
  const fryer = place('air-fryer', 'f', 2, 0.6);
  const furniture = [steam, fryer, outlet('o1', 1, 0.17, { voltage: 220 }), outlet('o2', 2, 0.17)];

  // Act
  const issues = issuesOf(furniture);

  // Assert
  assert.deepEqual(issues.map((i) => [i.furnitureId, i.kind]), [['s', 'needs-dedicated'], ['f', 'needs-dedicated']]);
  assert.match(issues[0].message, /專用迴路/);
  assert.match(issues[1].message, /1500W/);
});

test('powerIssues 附近有專用迴路就不建議', () => {
  // Arrange
  const furniture = [
    place('steam-oven', 's', 1, 0.6),
    place('air-fryer', 'f', 2, 0.6),
    outlet('o1', 1, 0.17, { voltage: 220, dedicated: true, type: 'outlet-220' }),
    outlet('o2', 2, 0.17, { dedicated: true, type: 'outlet-dedicated' }),
  ];

  // Act & Assert
  assert.deepEqual(issuesOf(furniture), []);
});

for (const [name, power, expected] of [
  ['220V 就算瓦數低也要', { voltage: 220, watts: 800 }, true],
  ['110V 1200W 要', { voltage: 110, watts: 1200 }, true],
  ['110V 1199W 不用', { voltage: 110, watts: 1199 }, false],
]) {
  test(`needsDedicatedCircuit ${name}`, () => {
    // Act & Assert
    assert.equal(needsDedicatedCircuit(power), expected);
  });
}

test('powerIssues 1200W 剛好要專用迴路，800W 不用', () => {
  // Arrange
  const furniture = [
    place('microwave', 'm', 1, 0.6),
    place('rice-cooker', 'r', 2, 0.6),
    outlet('o1', 1, 0.17),
    outlet('o2', 2, 0.17),
  ];

  // Act
  const issues = issuesOf(furniture);

  // Assert
  assert.deepEqual(issues.map((i) => [i.furnitureId, i.kind]), [['m', 'needs-dedicated']]);
});

test('powerIssues 大功率家電完全沒插座時，同一則提醒一併建議專用迴路', () => {
  // Act
  const issues = issuesOf([place('steam-oven', 's', 1, 1)]);

  // Assert
  assert.deepEqual(issues.map((i) => i.kind), ['no-outlet']);
  assert.match(issues[0].message, /220V/);
  assert.match(issues[0].message, /專用迴路/);
});

test('powerIssues 系統櫃格子裡的家電不重複檢查', () => {
  // Arrange：櫃子本身沒有用電，格內的微波爐由櫃子的檢查負責
  const cabinet = { id: 'c1', name: '櫃', size: { w: 60, d: 60, h: 210 }, columns: [{ width: 60, cells: [{ height: 202, kind: 'open', outlet: 'none', items: [{ type: 'microwave' }] }] }] };
  const furniture = [place('custom-cabinet', 'cab', 1, 1, { cabinetId: 'c1' })];

  // Act & Assert
  assert.deepEqual(powerIssues({ furniture, cabinets: [cabinet] }), []);
});

test('powerIssues 插座在落地家具底面範圍內且比家具低時提醒被擋住', () => {
  // Arrange：沙發貼牆，底面 y 從 0.17 起
  const furniture = [place('sofa', 'sofa', 1, 0.62), outlet('o', 1, 0.17)];

  // Act
  const issues = issuesOf(furniture);

  // Assert
  assert.equal(issues.length, 1);
  assert.equal(issues[0].furnitureId, 'o');
  assert.equal(issues[0].kind, 'blocked');
  assert.match(issues[0].message, /插座被「沙發」擋住/);
});

test('powerIssues 插座比家具高、或家具離牆超過容差就不算擋住', () => {
  // Arrange
  const high = [place('sofa', 'sofa', 1, 0.62), outlet('o', 1, 0.17, { elevation: 1.2 })];
  const gap = [place('sofa', 'sofa', 1, 0.68), outlet('o', 1, 0.17)];
  const withinTolerance = [place('sofa', 'sofa', 1, 0.66), outlet('o', 1, 0.17)];

  // Act & Assert：離牆 6 cm 不算、4 cm 算
  assert.deepEqual(issuesOf(high), []);
  assert.deepEqual(issuesOf(gap), []);
  assert.deepEqual(issuesOf(withinTolerance).map((i) => i.kind), ['blocked']);
});

test('powerIssues 家具在插座旁邊（沒有擋在正前方）不算擋住', () => {
  // Arrange：馬桶貼牆、在插座右邊 4 cm 處開始
  const furniture = [place('toilet', 't', 1.24, 0.52), outlet('o', 1, 0.17, { elevation: 0.45 })];

  // Act & Assert
  assert.deepEqual(issuesOf(furniture), []);
});

test('powerIssues 會用電的家電、地毯、吊櫃不算擋住插座', () => {
  // Arrange
  const furniture = [
    place('fridge', 'fr', 1, 0.52),
    place('rug', 'rug', 2, 0.9),
    place('upper-cabinet', 'up', 2.5, 0.35),
    outlet('o1', 1, 0.17),
    outlet('o2', 2, 0.17),
    outlet('o3', 2.5, 0.17),
  ];

  // Act & Assert
  assert.deepEqual(issuesOf(furniture), []);
});

test('powerIssues 開關被擋住時寫開關', () => {
  // Arrange
  const sw = { ...place('switch', 'sw', 1, 0.17), rotation: 180, elevation: 1.2, options: {} };
  const furniture = [place('wardrobe', 'w', 1, 0.47), sw];

  // Act
  const issues = issuesOf(furniture);

  // Assert
  assert.deepEqual(issues.map((i) => [i.furnitureId, i.kind]), [['sw', 'blocked']]);
  assert.match(issues[0].message, /開關被「衣櫃」擋住/);
});
