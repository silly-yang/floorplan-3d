import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGlass, buildSolids, planToWorld, validateFloorplan } from '../../js/core/floorplan.js';

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
