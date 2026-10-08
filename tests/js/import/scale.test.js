import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convertDxf } from '../../../js/import/convert.js';
import { parseDxf } from '../../../js/import/dxf.js';
import { RoomLeakError } from '../../../js/import/errors.js';
import { baseConfig, dxf } from './dxfFactory.js';

// 同一個平面以不同圖面單位畫：k 是相對公分圖的座標倍率（公釐圖 k = 10、公尺圖 k = 0.01）
// 左房 300×200、右房 140×200；下牆有 160 寬的窗、隔間有 90 寬的門、上牆有 40 寬的門洞、右側是欄杆
// 左上角柱子用三條線畫、缺一邊，其中一個端點差 0.3；兩支樑：寬 30 有標註深 50、寬 40 沒標註且一端歪 0.2
// 隔間每段都長於 30，否則它的側面會被當成牆端面
function scene(k, { seeded, seeds = [[150, 100], [400, 100]], labelK = k, beamLabelScale }) {
  const p = (x, y) => [(1000 + x) * k, (1000 + y) * k];
  const rect = (layer, x0, y0, x1, y1) => dxf.lwpolyline(layer, [p(x0, y0), p(x1, y0), p(x1, y1), p(x0, y1)], true);
  const entities = [
    rect('L3', 0, 0, 100, 15),
    rect('L3', 260, 0, 480, 15),
    rect('L3', 0, 215, 400, 230),
    rect('L3', 440, 215, 480, 230),
    rect('L3', 0, 15, 15, 215),
    dxf.line('L23', p(470, 15), p(470, 215)),
    rect('WALL2', 315, 15, 325, 60),
    rect('WALL2', 315, 150, 325, 215),
    dxf.line('L12', p(15, 195), p(55, 195)),
    dxf.line('L12', p(55, 195.3), p(55, 215)),
    dxf.line('L12', p(55, 215), p(15, 215)),
    dxf.line('OPEN-Window', p(100, 7.5), p(260, 7.5)),
    dxf.attrib('OPEN-Window', p(170, -40), 'NO.', 'W5'),
    dxf.insert('OPEN-Door', 'DOOR1', p(320, 60)),
    dxf.attdef('OPEN-Door', p(360, 105), 'FD2', 'D7'),
    dxf.line('S01', p(100, 20), p(100, 180)),
    dxf.line('S01', p(130, 20), p(130, 180)),
    dxf.text('S01', p(160, 100), `J10(${30 * labelK}x${50 * labelK})`),
    dxf.line('S01', p(30, 50), p(280, 50)),
    dxf.line('S01', p(30, 90), p(280, 90.2)),
  ];
  const base = baseConfig();
  const config = {
    ...base,
    unitScale: 0.01 / k,
    clip: { xMin: 500 * k, yMin: 500 * k, xMax: 2000 * k, yMax: 2000 * k },
    layers: { ...base.layers, beam: ['S01'] },
    gapMin: 30 * k,
    gapMax: 250 * k,
    rooms: seeded ? seeds.map(([x, y], i) => ({ id: `room-${i}`, name: `房間 ${i}`, seed: p(x, y) })) : [],
    ...(beamLabelScale === undefined ? {} : { beamLabelScale }),
  };
  return convertDxf(parseDxf(dxf.document(entities, { DOOR1: [dxf.arc('OPEN-Door', [0, 0], 90 * k, 0, 90)] })), config).floorplan;
}

// 逐欄比較，數字容許 1e-6；回傳不符的路徑
function mismatches(expected, actual, path = '', out = []) {
  if (typeof expected === 'number' && typeof actual === 'number') {
    if (Math.abs(expected - actual) > 1e-6) out.push(`${path}: ${expected} ≠ ${actual}`);
  } else if (Array.isArray(expected) && Array.isArray(actual)) {
    if (expected.length !== actual.length) out.push(`${path}.length: ${expected.length} ≠ ${actual.length}`);
    expected.forEach((v, i) => mismatches(v, actual[i], `${path}[${i}]`, out));
  } else if (expected && typeof expected === 'object' && actual && typeof actual === 'object') {
    for (const key of new Set([...Object.keys(expected), ...Object.keys(actual)])) mismatches(expected[key], actual[key], `${path}.${key}`, out);
  } else if (expected !== actual) {
    out.push(`${path}: ${JSON.stringify(expected)} ≠ ${JSON.stringify(actual)}`);
  }
  return out;
}

for (const seeded of [true, false]) {
  const rooms = seeded ? '種子房間' : '自動偵測房間';

  test(`公分版場景本身涵蓋牆、門窗、樑與房間（${rooms}）`, () => {
    // Act
    const fp = scene(1, { seeded });

    // Assert
    assert.equal(fp.walls.length, 8);
    assert.deepEqual(fp.walls.filter((w) => w.kind === 'column').map((w) => w.polygon.length), [4]);
    assert.deepEqual(fp.openings.map((o) => [o.id, o.kind]), [['W5-1', 'window'], ['FD2-1', 'door'], ['doorway-1', 'doorway']]);
    assert.deepEqual(fp.beams, [{ rect: [1, 0.2, 1.3, 1.8], depth: 0.5 }, { rect: [0.3, 0.5, 2.8, 0.9], depth: 0.6 }]);
    assert.deepEqual(fp.rooms.map((r) => r.id), seeded ? ['room-0', 'room-1'] : ['room-1', 'room-2']);
  });

  for (const [unit, k] of [['公釐圖', 10], ['公尺圖', 0.01]]) {
    test(`convertDxf ${unit}與公分圖輸出逐欄相同（${rooms}）`, () => {
      // Arrange
      const expected = scene(1, { seeded });

      // Act
      const actual = scene(k, { seeded });

      // Assert
      assert.deepEqual(mismatches(expected, actual), []);
    });
  }
}

for (const [name, k, labelK, beamLabelScale] of [
  ['公釐圖配公分標註', 10, 1, 0.01],
  ['公分圖配公釐標註', 1, 10, 0.001],
  ['公尺圖配公分標註', 0.01, 1, 0.01],
]) {
  test(`convertDxf 樑標註單位與圖面不同時依 beamLabelScale 換算：${name}`, () => {
    // Arrange
    const expected = scene(1, { seeded: true }).beams;

    // Act
    const actual = scene(k, { seeded: true, labelK, beamLabelScale }).beams;

    // Assert
    assert.deepEqual(mismatches(expected, actual), []);
  });
}

for (const [unit, k] of [['公分圖', 1], ['公釐圖', 10], ['公尺圖', 0.01]]) {
  test(`convertDxf ${unit}種子點落在牆外 30 cm 時回報漏水（填色範圍外擴 0.5 m）`, () => {
    // Act & Assert
    assert.throws(() => scene(k, { seeded: true, seeds: [[-30, 100]] }), RoomLeakError);
  });
}
