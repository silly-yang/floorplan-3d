import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convertDxf } from '../../../js/import/convert.js';
import { parseDxf } from '../../../js/import/dxf.js';
import { DxfFormatError, FloorplanError } from '../../../js/import/errors.js';
import { summarizeLayers } from '../../../js/import/layers.js';
import {
  applyRoomEdits,
  buildConfig,
  checkFile,
  clipFromCorners,
  countInClip,
  defaultClip,
  explainError,
  fitView,
  focusBox,
  formatSize,
  goBack,
  goNext,
  initialRoles,
  panBy,
  previewShapes,
  roomAt,
  rolesToLayers,
  STEPS,
  stepError,
  summarizeFloorplan,
  toDrawing,
  toScreen,
  unitHint,
  wallExtent,
  windowLabels,
  zoomAt,
} from '../../../js/import/wizard.js';
import { baseConfig, dxf } from './dxfFactory.js';

const MB = 1024 * 1024;
const near = (actual, expected, eps = 1e-9) => assert.ok(Math.abs(actual - expected) <= eps, `${actual} ≉ ${expected}`);
const nearPoint = (actual, expected) => {
  assert.equal(actual.length, expected.length);
  actual.forEach((v, i) => near(v, expected[i]));
};

// 300×200（cm）、牆厚 15 的房間，下牆中間留 90 的門洞
const roomEntities = (o = 1000) => [
  ...dxf.rectLines('L3', o + 0, o + 0, o + 100, o + 15),
  ...dxf.rectLines('L3', o + 190, o + 0, o + 300, o + 15),
  ...dxf.rectLines('L3', o + 0, o + 185, o + 300, o + 200),
  ...dxf.rectLines('L3', o + 0, o + 15, o + 15, o + 185),
  ...dxf.rectLines('L3', o + 285, o + 15, o + 300, o + 185),
];

// ---------- 步驟 ----------

test('STEPS 依選檔、框選、圖層、單位、預覽、完成的順序排列', () => {
  // Assert
  assert.deepEqual(STEPS.map((s) => s.id), ['file', 'clip', 'layers', 'units', 'preview', 'finish']);
});

test('goNext 這一步檢查通過就往下一步並清掉錯誤', () => {
  // Arrange
  const state = { step: 0, doc: {}, error: '舊的錯誤' };

  // Act
  const next = goNext(state);

  // Assert
  assert.equal(next.step, 1);
  assert.equal(next.error, null);
});

test('goNext 檢查不過時停在原步驟並帶出原因', () => {
  // Arrange
  const state = { step: 0, doc: null, error: null };

  // Act
  const next = goNext(state);

  // Assert
  assert.equal(next.step, 0);
  assert.equal(next.error, '請先選擇 DXF 檔');
});

test('goNext 在最後一步不再往後', () => {
  // Arrange
  const state = { step: STEPS.length - 1, name: '我的家', error: null };

  // Act
  const next = goNext(state);

  // Assert
  assert.equal(next.step, STEPS.length - 1);
});

for (const [name, step, expected] of [
  ['一般步驟退一步', 3, 2],
  ['第一步不再往前', 0, 0],
]) {
  test(`goBack 回上一步並清掉錯誤：${name}`, () => {
    // Act
    const prev = goBack({ step, error: '錯誤' });

    // Assert
    assert.equal(prev.step, expected);
    assert.equal(prev.error, null);
  });
}

const clipDoc = () => parseDxf(dxf.document(roomEntities()));
const wallRoles = { L3: 'rcWall' };

for (const [name, stepId, patch, expected] of [
  ['選檔：還沒選', 'file', { doc: null }, '請先選擇 DXF 檔'],
  ['選檔：已選', 'file', {}, null],
  ['框選：範圍內沒有圖元', 'clip', { clip: { xMin: 0, yMin: 0, xMax: 10, yMax: 10 } }, '框選範圍內沒有任何線條，請重新框出要的那一戶'],
  ['框選：範圍內有圖元', 'clip', {}, null],
  ['圖層：全部不用', 'layers', { roles: { L3: 'none' } }, '至少要把一個圖層設成 RC 牆、輕隔間或柱，才找得到牆'],
  ['圖層：只有窗', 'layers', { roles: { L3: 'window' } }, '至少要把一個圖層設成 RC 牆、輕隔間或柱，才找得到牆'],
  ['圖層：有柱就算有牆', 'layers', { roles: { L3: 'column' } }, null],
  ['單位：沒選', 'units', { unitScale: null }, '請選擇圖面單位'],
  ['單位：框選範圍換算後超過 200 m', 'units', { clip: { xMin: 0, yMin: 0, xMax: 20001, yMax: 100 } }, '框選範圍約 200.0 × 1.0 m，太大了；請回「框選範圍」只框出要的那一戶'],
  ['單位：剛好 200 m 可以', 'units', { clip: { xMin: 0, yMin: 0, xMax: 20000, yMax: 100 } }, null],
  ['預覽：還沒轉出平面圖', 'preview', { result: null }, '還沒有轉換結果，請回上一步重新確認'],
  ['預覽：房間全刪光', 'preview', { result: { floorplan: { rooms: [{ id: 'room-1' }] } }, removed: ['room-1'] }, '至少要保留一個房間'],
  ['完成：名稱空白', 'finish', { name: '   ' }, '請輸入平面圖名稱'],
  ['完成：有名稱', 'finish', { name: '我的家' }, null],
]) {
  test(`stepError 每一步離開前的檢查：${name}`, () => {
    // Arrange
    const state = {
      doc: clipDoc(),
      clip: { xMin: 900, yMin: 900, xMax: 1400, yMax: 1300 },
      roles: wallRoles,
      unitScale: 0.01,
      result: { floorplan: { rooms: [{ id: 'room-1' }] } },
      removed: [],
      name: '',
      ...patch,
    };

    // Act
    const error = stepError(stepId, state);

    // Assert
    assert.equal(error, expected);
  });
}

// ---------- 選檔 ----------

for (const [name, file, expected] of [
  ['一般 DXF', { name: 'plan.dxf', size: 12 * MB }, null],
  ['副檔名大寫', { name: 'PLAN.DXF', size: 1 }, null],
  ['剛好 50 MB', { name: 'plan.dxf', size: 50 * MB }, null],
  ['超過 50 MB', { name: 'plan.dxf', size: 50 * MB + 1 }, '檔案超過 50 MB，瀏覽器可能處理不了；請在 CAD 裡刪掉不需要的圖面再存一次'],
  ['DWG', { name: 'plan.dwg', size: 1 }, '這是 DWG 檔，請先轉成 DXF（ASCII）再選；做法見下方說明'],
  ['其他檔案', { name: 'plan.pdf', size: 1 }, '請選擇 .dxf 檔'],
  ['沒有副檔名', { name: 'dxf', size: 1 }, '請選擇 .dxf 檔'],
]) {
  test(`checkFile 檢查副檔名與大小：${name}`, () => {
    // Act
    const error = checkFile(file);

    // Assert
    assert.equal(error, expected);
  });
}

// ---------- 框選範圍 ----------

test('defaultClip 預設是所有圖層外框的聯集', () => {
  // Arrange
  const summary = summarizeLayers(parseDxf(dxf.document([
    dxf.line('A', [0, 0], [10, 5]),
    dxf.line('B', [-5, 2], [3, 30]),
    '0\nSEQEND\n8\nEMPTY',
  ])));

  // Act
  const clip = defaultClip(summary);

  // Assert
  assert.deepEqual(clip, { xMin: -5, yMin: 0, xMax: 10, yMax: 30 });
});

test('defaultClip 沒有任何座標時回 null', () => {
  // Arrange
  const summary = summarizeLayers(parseDxf(dxf.document(['0\nSEQEND\n8\nEMPTY'])));

  // Act
  const clip = defaultClip(summary);

  // Assert
  assert.equal(clip, null);
});

test('clipFromCorners 兩個角不論拖曳方向都排成最小、最大', () => {
  // Act
  const clip = clipFromCorners([30, 5], [10, 20]);

  // Assert
  assert.deepEqual(clip, { xMin: 10, yMin: 5, xMax: 30, yMax: 20 });
});

test('countInClip 只算有座標落在範圍內的圖元', () => {
  // Arrange
  const doc = parseDxf(dxf.document([
    dxf.line('A', [0, 0], [10, 0]),
    dxf.line('A', [50, 50], [60, 60]),
    dxf.line('A', [-10, 5], [5, 5]),
    dxf.text('A', [100, 100], 'X'),
  ]));

  // Act
  const count = countInClip(doc, { xMin: 0, yMin: 0, xMax: 20, yMax: 20 });

  // Assert
  assert.equal(count, 2);
});

test('fitView 讓外框置中塞進畫布並留邊', () => {
  // Arrange：200×100 的圖放進 440×300 的畫布、四邊各留 20；寬度先頂到，上下多出的空間平分
  const box = [0, 0, 200, 100];

  // Act
  const view = fitView(box, 440, 300, 20);

  // Assert
  near(view.k, 2);
  nearPoint(toScreen(view, [0, 100]), [20, 50]);
  nearPoint(toScreen(view, [200, 0]), [420, 250]);
});

test('toScreen 與 toDrawing 互為反函數，y 軸朝上轉成畫布朝下', () => {
  // Arrange
  const view = fitView([0, 0, 200, 100], 440, 220, 20);

  // Act
  const back = toDrawing(view, toScreen(view, [37, 81]));

  // Assert
  nearPoint(back, [37, 81]);
  assert.ok(toScreen(view, [0, 100])[1] < toScreen(view, [0, 0])[1]);
});

test('zoomAt 以游標為中心縮放，游標下的那一點不動', () => {
  // Arrange
  const view = fitView([0, 0, 200, 100], 440, 220, 20);
  const cursor = [123, 45];
  const before = toDrawing(view, cursor);

  // Act
  const zoomed = zoomAt(view, 2.5, cursor);

  // Assert
  near(zoomed.k, view.k * 2.5);
  nearPoint(toDrawing(zoomed, cursor), before);
});

test('panBy 平移畫面，圖面上的點跟著移動同樣的像素', () => {
  // Arrange
  const view = fitView([0, 0, 200, 100], 440, 220, 20);
  const before = toScreen(view, [50, 50]);

  // Act
  const moved = panBy(view, 15, -7);

  // Assert
  nearPoint(toScreen(moved, [50, 50]), [before[0] + 15, before[1] - 7]);
});

test('focusBox 去掉頭尾 2% 的離群點，畫面才不會被圖框外的零星圖元縮成一點', () => {
  // Arrange：100 個點擠在 0～99，另有 1 個遠在 (10 萬, −10 萬)；101 點的 2% 是兩端各去掉 2 個
  const shapes = [
    ...Array.from({ length: 100 }, (_, i) => ({ layer: 'A', points: [[i, i]] })),
    { layer: 'B', points: [[100000, -100000]] },
  ];

  // Act
  const box = focusBox(shapes);

  // Assert
  assert.deepEqual(box, [2, 1, 98, 97]);
});

test('focusBox 沒有任何點時回 null', () => {
  // Act & Assert
  assert.equal(focusBox([]), null);
});

test('previewShapes 把線、多段線、圓弧轉成折線，文字不畫', () => {
  // Arrange
  const doc = parseDxf(dxf.document([
    dxf.line('A', [0, 0], [10, 0]),
    dxf.lwpolyline('B', [[0, 0], [5, 0], [5, 5]], true),
    dxf.arc('C', [0, 0], 10, 0, 90),
    dxf.text('D', [1, 1], '地址'),
    dxf.insert('E', 'DOOR1', [7, 8]),
  ]));

  // Act
  const shapes = previewShapes(doc);

  // Assert
  assert.deepEqual(shapes.slice(0, 2), [
    { layer: 'A', points: [[0, 0], [10, 0]] },
    { layer: 'B', points: [[0, 0], [5, 0], [5, 5], [0, 0]] },
  ]);
  const arc = shapes[2];
  assert.equal(arc.layer, 'C');
  nearPoint(arc.points[0], [10, 0]);
  nearPoint(arc.points.at(-1), [0, 10]);
  assert.ok(arc.points.every(([x, y]) => Math.abs(Math.hypot(x, y) - 10) < 1e-9));
  assert.deepEqual(shapes[3], { layer: 'E', points: [[7, 8]] });
  assert.equal(shapes.length, 4);
});

test('previewShapes 跨過 0° 的圓弧逆時針從起點畫到終點', () => {
  // Arrange
  const doc = parseDxf(dxf.document([dxf.arc('C', [0, 0], 1, 270, 90)]));

  // Act
  const [{ points }] = previewShapes(doc);

  // Assert
  nearPoint(points[0], [0, -1]);
  nearPoint(points.at(-1), [0, 1]);
  assert.ok(points.every(([x]) => x > -1e-9));
});

// ---------- 指定圖層 ----------

test('initialRoles 用圖層名稱預填用途，猜到牆的當 RC 牆，猜不到的設成不用', () => {
  // Arrange
  const summary = ['WALL2', 'OPEN-Window', 'OPEN-Door', 'S01-RC大梁', 'L3', 'DIM'].map((name) => ({ name, count: 1, bbox: null, types: {} }));

  // Act
  const roles = initialRoles(summary);

  // Assert
  assert.deepEqual(roles, {
    'WALL2': 'rcWall',
    'OPEN-Window': 'window',
    'OPEN-Door': 'door',
    'S01-RC大梁': 'beam',
    'L3': 'none',
    'DIM': 'none',
  });
});

test('initialRoles 名稱同時像窗又像門時，取先列的用途', () => {
  // Arrange
  const summary = [{ name: 'DOOR-WINDOW', count: 1, bbox: null, types: {} }];

  // Act
  const roles = initialRoles(summary);

  // Assert
  assert.deepEqual(roles, { 'DOOR-WINDOW': 'window' });
});

test('rolesToLayers 把每層的用途轉成設定的 layers，不用的圖層不列', () => {
  // Arrange
  const roles = { L3: 'rcWall', WALL2: 'partition', L12: 'column', W: 'window', D: 'door', L23: 'barrier', S01: 'beam', DIM: 'none', L4: 'rcWall' };

  // Act
  const layers = rolesToLayers(roles);

  // Assert
  assert.deepEqual(layers, {
    rcWall: ['L3', 'L4'],
    partition: ['WALL2'],
    column: ['L12'],
    window: ['W'],
    door: ['D'],
    barrier: ['L23'],
    beam: ['S01'],
  });
});

// ---------- 確認單位 ----------

for (const [name, suggestion, expected] of [
  ['檔頭寫公釐、看起來是公分', { scale: 0.01, source: 'extent', headerScale: 0.001 }, '檔頭寫公釐，但看起來是公分'],
  ['檔頭沒寫、看起來是公釐', { scale: 0.001, source: 'extent', headerScale: null }, '檔頭沒有寫單位，看起來是公釐'],
  ['檔頭可信', { scale: 0.01, source: 'header', headerScale: 0.01 }, null],
  ['完全判斷不出來', { scale: null, source: 'header', headerScale: null }, '判斷不出圖面單位，請手動選擇'],
]) {
  test(`unitHint 單位建議的提示文字：${name}`, () => {
    // Act
    const hint = unitHint(suggestion);

    // Assert
    assert.equal(hint, expected);
  });
}

test('wallExtent 只看牆圖層落在框選範圍內的點', () => {
  // Arrange：範圍外另有一份同樣的牆、範圍內有一條非牆圖層的長線
  const doc = parseDxf(dxf.document([
    ...roomEntities(1000),
    ...roomEntities(5000),
    dxf.line('DIM', [900, 900], [1900, 900]),
  ]));
  const layers = rolesToLayers({ L3: 'rcWall', DIM: 'none' });

  // Act
  const extent = wallExtent(doc, layers, { xMin: 0, yMin: 0, xMax: 2000, yMax: 2000 });

  // Assert
  assert.deepEqual(extent, [300, 200]);
});

test('wallExtent 範圍內沒有牆時回 null', () => {
  // Arrange
  const doc = parseDxf(dxf.document(roomEntities(1000)));

  // Act
  const extent = wallExtent(doc, rolesToLayers({ L3: 'rcWall' }), { xMin: 0, yMin: 0, xMax: 10, yMax: 10 });

  // Assert
  assert.equal(extent, null);
});

for (const [name, extent, scale, expected] of [
  ['公分', [920, 720], 0.01, '9.2 × 7.2 m'],
  ['公釐、四捨五入到一位小數', [9249, 7151], 0.001, '9.2 × 7.2 m'],
  ['整數也保留一位小數', [3000, 2000], 0.001, '3.0 × 2.0 m'],
]) {
  test(`formatSize 換算成公尺顯示：${name}`, () => {
    // Act
    const text = formatSize(extent, scale);

    // Assert
    assert.equal(text, expected);
  });
}

// ---------- 組設定 ----------

test('buildConfig 組出 convertDxf 可用的設定，距離類依單位換算', () => {
  // Arrange
  const clip = { xMin: 1, yMin: 2, xMax: 3, yMax: 4 };

  // Act
  const config = buildConfig({ clip, roles: { L3: 'rcWall', S01: 'beam' }, unitScale: 0.001, beamLabelScale: 0.01, windowLabels: [] });

  // Assert
  assert.deepEqual(config, {
    unitScale: 0.001,
    beamLabelScale: 0.01,
    clip,
    layers: { rcWall: ['L3'], partition: [], column: [], window: [], door: [], barrier: [], beam: ['S01'] },
    windowTypes: {},
    doorHead: 2.1,
    doorwayHead: 2.2,
    gapMin: 300,
    gapMax: 2500,
    rooms: [],
    ignoreOpenings: [],
  });
});

for (const [name, unitScale, gapMin, gapMax] of [
  ['公分', 0.01, 30, 250],
  ['公尺', 1, 0.3, 2.5],
]) {
  test(`buildConfig 開口寬度 0.3～2.5 m 換成圖面單位且沒有浮點尾數：${name}`, () => {
    // Act
    const config = buildConfig({ clip: { xMin: 0, yMin: 0, xMax: 1, yMax: 1 }, roles: {}, unitScale, beamLabelScale: 0.01, windowLabels: [] });

    // Assert
    assert.equal(config.gapMin, gapMin);
    assert.equal(config.gapMax, gapMax);
  });
}

test('buildConfig 窗編號 D 開頭當落地窗，其餘當一般窗', () => {
  // Act
  const config = buildConfig({ clip: { xMin: 0, yMin: 0, xMax: 1, yMax: 1 }, roles: {}, unitScale: 0.01, beamLabelScale: 0.01, windowLabels: ['W5', 'DW4'] });

  // Assert
  assert.deepEqual(config.windowTypes, { W5: { sill: 0.9, head: 2.1 }, DW4: { sill: 0, head: 2.2 } });
});

test('windowLabels 列出框選範圍內窗圖層上的窗編號，去重排序，其他文字不列', () => {
  // Arrange
  const doc = parseDxf(dxf.document([
    dxf.attrib('OPEN-Window', [10, 10], 'NO.', 'W5'),
    dxf.attrib('OPEN-Window', [20, 10], 'NO.', 'W5'),
    dxf.text('OPEN-Window', [30, 10], 'DW4'),
    dxf.text('OPEN-Window', [40, 10], '台北市某某路'),
    dxf.text('OPEN-Window', [9000, 10], 'W9'),
    dxf.text('DIM', [50, 10], 'W7'),
  ]));

  // Act
  const labels = windowLabels(doc, ['OPEN-Window'], { xMin: 0, yMin: 0, xMax: 100, yMax: 100 });

  // Assert
  assert.deepEqual(labels, ['DW4', 'W5']);
});

test('buildConfig 的結果可以直接交給 convertDxf', () => {
  // Arrange
  const doc = parseDxf(dxf.document(roomEntities()));
  const config = buildConfig({ clip: { xMin: 0, yMin: 0, xMax: 2000, yMax: 2000 }, roles: { L3: 'rcWall' }, unitScale: 0.01, beamLabelScale: 0.01, windowLabels: [] });

  // Act
  const { floorplan } = convertDxf(doc, config);

  // Assert
  assert.equal(floorplan.walls.length, 5);
  assert.deepEqual(floorplan.openings.map((o) => o.kind), ['doorway']);
  assert.deepEqual(floorplan.rooms.map((r) => r.name), ['房間 1']);
});

// ---------- 預覽與命名 ----------

const sampleFloorplan = () => ({
  ...convertDxf(parseDxf(dxf.document(roomEntities())), baseConfig()).floorplan,
  rooms: [
    { id: 'room-1', name: '房間 1', rects: [[0, 0, 2, 2], [2, 0, 3, 1]] },
    { id: 'room-2', name: '房間 2', rects: [[2, 1, 3, 2]] },
    { id: 'room-3', name: '房間 3', rects: [[5, 5, 6, 6]] },
  ],
});

test('applyRoomEdits 套上使用者取的名稱、刪掉誤判的房間，其餘欄位不動', () => {
  // Arrange
  const floorplan = sampleFloorplan();

  // Act
  const edited = applyRoomEdits(floorplan, { names: { 'room-1': ' 客廳 ', 'room-2': '' }, removed: ['room-3'] });

  // Assert
  assert.deepEqual(edited.rooms.map((r) => [r.id, r.name]), [['room-1', '客廳'], ['room-2', '房間 2']]);
  assert.deepEqual(edited.rooms[0].rects, floorplan.rooms[0].rects);
  assert.deepEqual(edited.walls, floorplan.walls);
  assert.equal(floorplan.rooms[0].name, '房間 1');
});

for (const [name, point, expected] of [
  ['落在第一個矩形', [1, 1], 'room-1'],
  ['落在同一房間的第二個矩形', [2.5, 0.5], 'room-1'],
  ['落在另一個房間', [2.5, 1.5], 'room-2'],
  ['不在任何房間', [4, 4], null],
]) {
  test(`roomAt 找出點擊位置的房間：${name}`, () => {
    // Act
    const id = roomAt(sampleFloorplan().rooms, point);

    // Assert
    assert.equal(id, expected);
  });
}

test('summarizeFloorplan 統計牆、門、窗、門洞、房間與樑的數量', () => {
  // Arrange
  const floorplan = {
    walls: [{}, {}, {}],
    openings: [{ kind: 'door' }, { kind: 'window' }, { kind: 'window' }, { kind: 'doorway' }],
    rooms: [{}, {}],
    beams: [{}],
  };

  // Act
  const summary = summarizeFloorplan(floorplan);

  // Assert
  assert.deepEqual(summary, { walls: 3, doors: 1, windows: 2, doorways: 1, rooms: 2, beams: 1 });
});

// ---------- 錯誤說明 ----------

for (const [name, error, expected] of [
  ['DXF 格式錯誤補上 ASCII 提示', new DxfFormatError('找不到 ENTITIES 區段'), '找不到 ENTITIES 區段\n請確認存成 DXF（ASCII）格式，不是 DWG 或二進位 DXF'],
  ['轉換錯誤照原訊息', new FloorplanError('clip 範圍內找不到牆'), 'clip 範圍內找不到牆'],
  ['非預期錯誤', new TypeError('x is undefined'), '發生非預期的錯誤：x is undefined'],
]) {
  test(`explainError 把例外轉成給使用者看的說明：${name}`, () => {
    // Act
    const message = explainError(error);

    // Assert
    assert.equal(message, expected);
  });
}
