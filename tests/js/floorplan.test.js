import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGlass, buildSolids, fixturesToFurniture, missingFixtures, openingAxis, planToWorld, validateFloorplan } from '../../js/core/floorplan.js';

const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

function samplePlan() {
  return {
    version: 1,
    units: 'm',
    bounds: { width: 3, depth: 2 },
    walls: [
      { id: 'wall-1', kind: 'rc', polygon: rect(0, 0, 1, 0.15) },
      { id: 'wall-2', kind: 'rc', polygon: rect(2.6, 0, 3, 0.15) },
    ],
    openings: [
      { id: 'W5-1', kind: 'window', label: 'W5', polygon: rect(1, 0, 2.6, 0.15), sill: 0.9, head: 2.1 },
    ],
    rooms: [{ id: 'living', name: '客廳', rects: [[0, 0.15, 3, 2]] }],
  };
}

test('validateFloorplan 合法資料回傳空陣列', () => {
  // Act
  const errors = validateFloorplan(samplePlan());

  // Assert
  assert.deepEqual(errors, []);
});

test('validateFloorplan 欄位錯誤時逐一指出路徑', () => {
  // Arrange
  const fp = samplePlan();
  fp.version = 99;
  fp.walls[1].polygon = [[0, 0]];
  fp.openings[0].sill = 'x';

  // Act
  const errors = validateFloorplan(fp);

  // Assert
  assert.equal(errors.length, 3);
  assert.ok(errors.some((e) => e.includes('version')));
  assert.ok(errors.some((e) => e.includes('walls[1].polygon')));
  assert.ok(errors.some((e) => e.includes('openings[0].sill')));
});

test('validateFloorplan 不是物件時回傳單一錯誤', () => {
  // Act
  const errors = validateFloorplan(null);

  // Assert
  assert.equal(errors.length, 1);
});

test('buildSolids 牆體從地面擠出到樓高', () => {
  // Act
  const solids = buildSolids(samplePlan(), 2.8);

  // Assert
  const walls = solids.filter((s) => s.kind === 'rc');
  assert.equal(walls.length, 2);
  assert.deepEqual([walls[0].bottom, walls[0].top], [0, 2.8]);
});

test('buildSolids 窗下補窗台牆、窗上補楣樑到樓高', () => {
  // Act
  const solids = buildSolids(samplePlan(), 2.8);

  // Assert
  const sill = solids.find((s) => s.kind === 'sill');
  const lintel = solids.find((s) => s.kind === 'lintel');
  assert.deepEqual([sill.bottom, sill.top], [0, 0.9]);
  assert.deepEqual([lintel.bottom, lintel.top], [2.1, 2.8]);
  assert.deepEqual(sill.polygon, rect(1, 0, 2.6, 0.15));
});

test('buildSolids 開口頂高於樓高時不產生楣樑、窗台為 0 時不產生窗台牆', () => {
  // Arrange
  const fp = samplePlan();
  fp.openings[0].sill = 0;
  fp.openings[0].head = 2.5;

  // Act
  const solids = buildSolids(fp, 2.4);

  // Assert
  assert.equal(solids.filter((s) => s.kind === 'sill' || s.kind === 'lintel').length, 0);
});

test('buildGlass 玻璃沿開口長軸置中、厚度固定', () => {
  // Act
  const [glass] = buildGlass(samplePlan());

  // Assert
  const ys = glass.polygon.map(([, y]) => y);
  assert.ok(Math.abs(Math.min(...ys) - (0.075 - 0.01)) < 1e-9);
  assert.ok(Math.abs(Math.max(...ys) - (0.075 + 0.01)) < 1e-9);
  assert.deepEqual([glass.bottom, glass.top], [0.9, 2.1]);
});

test('buildGlass 門與門洞不產生玻璃', () => {
  // Arrange
  const fp = samplePlan();
  fp.openings[0].kind = 'doorway';

  // Act
  const glass = buildGlass(fp);

  // Assert
  assert.deepEqual(glass, []);
});

test('planToWorld 平面 y 朝上對應世界 -z、高度放到 y', () => {
  // Act
  const p = planToWorld([1.5, 2], 0.9);

  // Assert
  assert.deepEqual(p, { x: 1.5, y: 0.9, z: -2 });
});

test('validateFloorplan 預設廚衛格式錯誤時指出欄位', () => {
  // Arrange
  const fp = samplePlan();
  fp.fixtures = [{ type: 'toilet', x: 'a', y: 1, rotation: 0, size: { w: 40, d: 70, h: 75 } }];

  // Act
  const errors = validateFloorplan(fp);

  // Assert
  assert.equal(errors.length, 1);
  assert.ok(errors[0].includes('fixtures[0]'));
});

test('fixturesToFurniture 轉成家具並配上新 id 與目錄顏色，未知類型略過', () => {
  // Arrange
  let n = 0;
  const fixtures = [
    { type: 'toilet', x: 7.15, y: 1.1, rotation: 180, size: { w: 40, d: 70, h: 75 } },
    { type: 'ufo', x: 1, y: 1, rotation: 0, size: { w: 1, d: 1, h: 1 } },
  ];

  // Act
  const furniture = fixturesToFurniture(fixtures, () => `f${++n}`);

  // Assert
  assert.deepEqual(furniture, [
    { id: 'f1', type: 'toilet', x: 7.15, y: 1.1, rotation: 180, size: { w: 40, d: 70, h: 75 }, color: '#fafafa' },
  ]);
});

test('openingAxis 矩形從短邊（牆厚）開始排列時，仍算出正確的中線與方向', () => {
  // Arrange：轉換器產生的開口是 [牆端a, 牆端b, 對面b, 對面a]，第一條邊是 15 cm 的牆厚
  const polygon = [[1, 0], [1, 0.15], [2.1, 0.15], [2.1, 0]];

  // Act
  const axis = openingAxis(polygon);

  // Assert：開口沿 x 寬 1.1 m、中線在 y=0.075
  assert.ok(Math.abs(axis.width - 1.1) < 1e-9);
  assert.ok(Math.abs(axis.thickness - 0.15) < 1e-9);
  assert.deepEqual(axis.dir.map((v) => Math.round(v * 1e6) / 1e6), [1, 0]);
  assert.ok(Math.abs(axis.start[0] - 1) < 1e-9 && Math.abs(axis.start[1] - 0.075) < 1e-9, `start=${axis.start}`);
  assert.ok(Math.abs(axis.across[0]) < 1e-9 && Math.abs(Math.abs(axis.across[1]) - 1) < 1e-9, `across=${axis.across}`);
});

const FIXTURES = [
  { type: 'toilet', x: 7.15, y: 1.1, rotation: 180, size: { w: 40, d: 70, h: 75 } },
  { type: 'basin', x: 6.45, y: 0.975, rotation: 180, size: { w: 60, d: 45, h: 85 } },
];
const placed = (type, x, y) => ({ id: type, type, x, y, rotation: 0, size: { w: 40, d: 40, h: 40 }, color: '#ffffff' });

for (const [name, furniture, expected] of [
  ['舊方案完全沒有廚衛時全部都缺', [], ['toilet', 'basin']],
  ['已在原位附近的不重複加', [placed('toilet', 7.2, 1.05)], ['basin']],
  ['同類型但被搬到很遠的地方，原位仍算缺', [placed('toilet', 2, 4)], ['toilet', 'basin']],
  ['都在原位時沒有缺', [placed('toilet', 7.15, 1.1), placed('basin', 6.45, 0.975)], []],
  ['原位放的是別種家具，仍算缺', [placed('plant', 7.15, 1.1)], ['toilet', 'basin']],
]) {
  test(`missingFixtures ${name}`, () => {
    // Act
    const missing = missingFixtures(furniture, FIXTURES);

    // Assert
    assert.deepEqual(missing.map((f) => f.type), expected);
  });
}
