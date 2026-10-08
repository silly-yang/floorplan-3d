import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BRANCH_BELOW_SLAB, SPRINKLER_HEAD_HEIGHT, ceilingServiceLayout, splitByZones } from '../../js/core/ceilingServices.js';
import { ceilingZones } from '../../js/core/ceilings.js';

const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const SLAB = 3.0;

// 客廳 [0,0,6,4] 左下角是廚房（建商平釘 2.6 m）；x=6 有一道 10 cm 隔間，右邊是浴室
function samplePlan() {
  return {
    version: 1,
    units: 'm',
    bounds: { width: 8, depth: 4 },
    walls: [
      { id: 'wall-1', kind: 'rc', polygon: rect(-0.2, -0.2, 8.2, 0) },
      { id: 'wall-2', kind: 'rc', polygon: rect(-0.2, 0, 0, 4) },
      { id: 'wall-3', kind: 'partition', polygon: rect(6, 0, 6.1, 4) },
    ],
    openings: [],
    rooms: [
      { id: 'living', name: 'L', rects: [[0, 0, 6, 4]] },
      { id: 'bath', name: 'B', rects: [[6.1, 0, 8, 4]] },
    ],
    ceilingZones: [{ id: 'kitchen', name: 'K', rect: [0, 0, 2, 1.5] }],
    ceilingServices: {
      sprinklers: [
        { x: 1, y: 1 },
        { x: 3, y: 1 },
        { x: 5, y: 0.8 },
        { x: 4, y: 3 },
        { x: 7, y: 2 },
      ],
      detectors: [
        { type: 'smoke', x: 3, y: 3 },
        { type: 'heat', x: 1, y: 0.5 },
        { type: 'smoke', x: 5.8, y: 2 },
      ],
      ducts: [{ type: 'range-hood', path: [[1, 0.5], [1, 3.5], [7, 3.5]], size: { w: 0.16, h: 0.16 } }],
      vents: [{ x: 7, y: 3.5 }],
    },
  };
}

const visiblePieces = (segments) => segments.filter((s) => s.visible).map((s) => [s.from, s.to]);
const length = (segments) => segments.reduce((sum, s) => sum + Math.abs(s.to[0] - s.from[0]) + Math.abs(s.to[1] - s.from[1]), 0);
const close = (a, b) => Math.abs(a - b) < 1e-6;

test('ceilingServiceLayout 平面圖沒有天花板設備時全部為空', () => {
  // Arrange
  const fp = samplePlan();
  delete fp.ceilingServices;

  // Act
  const layout = ceilingServiceLayout(fp, {}, SLAB);

  // Assert
  assert.deepEqual(layout, { sprinklers: [], detectors: [], vents: [], ducts: [], branches: [] });
});

test('ceilingServiceLayout 不包區的灑水頭從樓板垂到離地 2.3 m；平釘區的貼在板面', () => {
  // Act
  const { sprinklers } = ceilingServiceLayout(samplePlan(), {}, SLAB);

  // Assert
  assert.equal(SPRINKLER_HEAD_HEIGHT, 2.3);
  assert.deepEqual(
    sprinklers.map((s) => [s.zoneId, s.top, s.height]),
    [
      ['kitchen', 2.6, 2.6],
      ['living', 3, 2.3],
      ['living', 3, 2.3],
      ['living', 3, 2.3],
      ['bath', 3, 2.3],
    ],
  );
});

for (const [name, setting, expected] of [
  ['平釘高度隨設定', { type: 'flat', height: 2.7 }, [2.7, 2.7]],
  ['包樑貼在樓板底', { type: 'beam-wrap', height: 2.6 }, [3, 3]],
  ['造型天花板中間內凹處往上 12 cm', { type: 'cove', height: 2.6 }, [2.72, 2.72]],
]) {
  test(`ceilingServiceLayout 客廳${name}，其他區不變`, () => {
    // Act
    const { sprinklers } = ceilingServiceLayout(samplePlan(), { living: setting }, SLAB);

    // Assert
    assert.equal(sprinklers.length, 5);
    const living = sprinklers.find((s) => s.x === 4 && s.y === 3);
    const bath = sprinklers.find((s) => s.zoneId === 'bath');
    assert.deepEqual([living.top, living.height], expected);
    assert.deepEqual([bath.top, bath.height], [3, 2.3]);
  });
}

test('ceilingServiceLayout 探測器貼樓板底；平釘區貼板面；造型天花板靠邊的落在下降帶', () => {
  // Act
  const exposed = ceilingServiceLayout(samplePlan(), {}, SLAB).detectors;
  const cove = ceilingServiceLayout(samplePlan(), { living: { type: 'cove', height: 2.6 } }, SLAB).detectors;

  // Assert
  assert.deepEqual(exposed.map((d) => [d.type, d.zoneId, d.height]), [
    ['smoke', 'living', 3],
    ['heat', 'kitchen', 2.6],
    ['smoke', 'living', 3],
  ]);
  assert.deepEqual(cove.map((d) => d.height), [2.72, 2.6, 2.6]);
});

test('ceilingServiceLayout 排風口在所在區的天花板面上', () => {
  // Act
  const { vents } = ceilingServiceLayout(samplePlan(), { bath: { type: 'flat', height: 2.4 } }, SLAB);

  // Assert
  assert.deepEqual(vents, [{ x: 7, y: 3.5, zoneId: 'bath', height: 2.4 }]);
});

test('ceilingServiceLayout 風管跨區時只在不包區那幾段顯示，貼在樓板下', () => {
  // Act
  const { ducts } = ceilingServiceLayout(samplePlan(), {}, SLAB);

  // Assert：廚房（平釘）那段藏起來；隔間牆兩側都是不包，穿牆那段照樣畫
  assert.equal(ducts.length, 1);
  const [duct] = ducts;
  assert.equal(duct.type, 'range-hood');
  assert.deepEqual(duct.size, { w: 0.16, h: 0.16 });
  assert.equal(duct.height, 2.92);
  assert.deepEqual(visiblePieces(duct.segments), [
    [[1, 1.5], [1, 3.5]],
    [[1, 3.5], [6, 3.5]],
    [[6, 3.5], [6.1, 3.5]],
    [[6.1, 3.5], [7, 3.5]],
  ]);
});

test('ceilingServiceLayout 風管另一端的區改成平釘時，穿牆段跟著藏起來', () => {
  // Act
  const { ducts } = ceilingServiceLayout(samplePlan(), { bath: { type: 'flat', height: 2.6 } }, SLAB);

  // Assert
  assert.equal(ducts.length, 1);
  const [duct] = ducts;
  assert.deepEqual(visiblePieces(duct.segments), [
    [[1, 1.5], [1, 3.5]],
    [[1, 3.5], [6, 3.5]],
  ]);
});

test('ceilingServiceLayout 全部不是不包時，風管與支管都不顯示', () => {
  // Arrange
  const covered = { type: 'beam-wrap', height: 2.6 };

  // Act
  const layout = ceilingServiceLayout(samplePlan(), { living: covered, bath: covered }, SLAB);

  // Assert
  assert.equal(layout.ducts.length, 1);
  assert.deepEqual(visiblePieces(layout.ducts[0].segments), []);
  assert.deepEqual(layout.branches, []);
});

test('ceilingServiceLayout 層高改變時灑水頭的管、風管跟著樓板走', () => {
  // Act
  const layout = ceilingServiceLayout(samplePlan(), {}, 2.8);

  // Assert
  assert.equal(layout.ducts.length, 1);
  const living = layout.sprinklers.find((s) => s.zoneId === 'living');
  assert.deepEqual([living.top, living.height], [2.8, 2.3]);
  assert.equal(layout.ducts[0].height, 2.72);
  assert.ok(layout.branches.every((b) => b.height === Math.round((2.8 - BRANCH_BELOW_SLAB) * 1000) / 1000));
});

test('ceilingServiceLayout 灑水支管：同區不包的灑水頭以直角最小生成樹串起，再接到最近的牆', () => {
  // Act
  const { branches } = ceilingServiceLayout(samplePlan(), {}, SLAB);

  // Assert：客廳三顆，樹長 2.2 + 3，(5, 0.8) 往下 0.8 接到下方外牆；浴室一顆往左 0.9 接到隔間
  assert.deepEqual(branches.map((b) => [b.zoneId, b.estimated]), [['living', true], ['bath', true]]);
  const [living, bath] = branches;
  assert.ok(living.segments.every((s) => s.from[0] === s.to[0] || s.from[1] === s.to[1]), '直角走線');
  assert.ok(close(length(living.segments), 6), `${length(living.segments)}`);
  assert.ok(living.segments.some((s) => s.to[0] === 5 && s.to[1] === 0), '接到牆面 (5, 0)');
  assert.ok(close(length(bath.segments), 0.9), `${length(bath.segments)}`);
  assert.deepEqual(visiblePieces(bath.segments).at(-1)[1], [6.1, 2]);
  assert.equal(living.height, SLAB - BRANCH_BELOW_SLAB);
});

test('ceilingServiceLayout 灑水支管轉角選在同一區內，不穿過平釘區', () => {
  // Arrange：兩顆對角相望，轉角若選 (1, 0.5) 會落進廚房
  const fp = samplePlan();
  fp.ceilingServices.sprinklers = [{ x: 1, y: 3 }, { x: 3, y: 0.5 }];

  // Act
  const { branches } = ceilingServiceLayout(fp, {}, SLAB);

  // Assert
  assert.deepEqual(branches.map((b) => b.zoneId), ['living']);
  const [living] = branches;
  assert.ok(living.segments.every((s) => s.visible));
  assert.ok(living.segments.some((s) => s.to[0] === 3 && s.to[1] === 3) || living.segments.some((s) => s.from[0] === 3 && s.from[1] === 3));
});

test('ceilingServiceLayout 平釘區的灑水頭不推估支管', () => {
  // Act
  const { branches } = ceilingServiceLayout(samplePlan(), { living: { type: 'flat', height: 2.6 } }, SLAB);

  // Assert
  assert.deepEqual(branches.map((b) => b.zoneId), ['bath']);
});

test('splitByZones 線段依區域邊界切開，不在任何區的那段 zoneId 為 null', () => {
  // Act
  const pieces = splitByZones([1, 3.5], [7, 3.5], ceilingZones(samplePlan()));

  // Assert
  assert.deepEqual(pieces, [
    { from: [1, 3.5], to: [6, 3.5], zoneId: 'living' },
    { from: [6, 3.5], to: [6.1, 3.5], zoneId: null },
    { from: [6.1, 3.5], to: [7, 3.5], zoneId: 'bath' },
  ]);
});
