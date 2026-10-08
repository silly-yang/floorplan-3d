import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG, CATEGORIES, getCatalogItem } from '../../js/furniture/catalog.js';
import { ICONS } from '../../js/ui/icons.js';
import {
  COLOR_TEMPS,
  activeLightSources,
  ceilingHeightAt,
  colorTempToHex,
  isLight,
  lightElevation,
  lightIntensity,
  lightOptionsOf,
  lightingIssues,
  relevelLights,
} from '../../js/core/lighting.js';

const SLAB = 3.05;
const FLOORPLAN = {
  rooms: [
    { id: 'living', name: '客餐廳', rects: [[0, 0, 4, 4]] },
    { id: 'bath', name: '浴室', rects: [[4, 0, 6, 2]] },
  ],
  ceilingZones: [{ id: 'kitchen', name: '廚房', rect: [1, 0, 3, 1.5] }],
};
const close = (a, b) => Math.abs(a - b) < 1e-9;

const light = (type, x, y, over = {}) => ({
  id: `${type}-${x}-${y}`, type, x, y, rotation: 0, size: { w: 30, d: 30, h: 10 }, color: '#ffffff', ...over,
});

const LIGHT_TYPES = ['downlight', 'ceiling-light', 'pendant-light', 'track-light', 'linear-light'];

// ---------- 目錄與 icon ----------

test('照明分類存在，嵌燈、吸頂燈、吊燈、軌道燈、線燈都在裡面', () => {
  // Act
  const types = CATALOG.filter((c) => c.category === 'light').map((c) => c.type);

  // Assert
  assert.ok(CATEGORIES.some((c) => c.id === 'light' && c.name === '照明'));
  assert.deepEqual([...types].sort(), [...LIGHT_TYPES].sort());
});

test('每盞燈都吸頂、110V、有瓦數、光通量與光源種類', () => {
  // Act
  const lights = CATALOG.filter((c) => c.category === 'light');

  // Assert
  for (const l of lights) {
    assert.equal(l.placement, 'ceiling', l.type);
    assert.equal(l.power?.voltage, 110, l.type);
    assert.ok(l.power.watts > 0, l.type);
    assert.ok(l.light.lumens > 0, l.type);
    assert.ok(['spot', 'point', 'linear'].includes(l.light.kind), l.type);
  }
});

for (const [type, kind] of [['downlight', 'spot'], ['track-light', 'spot'], ['ceiling-light', 'point'], ['pendant-light', 'point'], ['linear-light', 'linear']]) {
  test(`${type} 的光源種類是 ${kind}`, () => {
    // Act & Assert
    assert.equal(getCatalogItem(type)?.light?.kind, kind);
  });
}

test('聚光型燈具有 1～90° 的光束角', () => {
  // Assert
  for (const type of ['downlight', 'track-light']) {
    const beam = getCatalogItem(type)?.light?.beam;
    assert.ok(beam > 0 && beam <= 90, `${type} beam ${beam}`);
  }
});

test('白天／夜晚切換的 icon 存在', () => {
  // Assert
  assert.ok(ICONS['day-night']);
});

// ---------- 判斷是不是燈 ----------

for (const [name, type, expected] of [
  ['嵌燈是燈', 'downlight', true],
  ['吊燈是燈', 'pendant-light', true],
  ['立燈是家電不算', 'floor-lamp', false],
  ['沙發不是燈', 'sofa', false],
  ['未知類型不是燈', 'spaceship', false],
]) {
  test(`isLight ${name}`, () => {
    // Act & Assert
    assert.equal(isLight({ type }), expected);
  });
}

// ---------- 燈具選項 ----------

for (const [name, options, expected] of [
  ['沒有選項時預設開燈、3000K', undefined, { on: true, colorTemp: 3000 }],
  ['關燈保留', { on: false }, { on: false, colorTemp: 3000 }],
  ['色溫 4000K 保留', { colorTemp: 4000 }, { on: true, colorTemp: 4000 }],
  ['不支援的色溫退回 3000K', { colorTemp: 6500 }, { on: true, colorTemp: 3000 }],
  ['on 不是布林時視為開', { on: 'yes' }, { on: true, colorTemp: 3000 }],
]) {
  test(`lightOptionsOf ${name}`, () => {
    // Act
    const result = lightOptionsOf({ type: 'downlight', options });

    // Assert
    assert.deepEqual(result, expected);
  });
}

test('色溫可選 2700／3000／4000K', () => {
  // Assert
  assert.deepEqual(COLOR_TEMPS, [2700, 3000, 4000]);
});

// ---------- 天花板高度 ----------

for (const [name, point, ceilings, expected] of [
  ['不包的房間用樓板底高度', [0.5, 3], {}, SLAB],
  ['建商平釘的廚房用 2.6 m', [2, 1], {}, 2.6],
  ['造型天花板用設定高度', [0.5, 3], { living: { type: 'cove', height: 2.7 } }, 2.7],
  ['平釘用設定高度', [5, 1], { bath: { type: 'flat', height: 2.4 } }, 2.4],
  ['包樑仍是樓板底高度', [5, 1], { bath: { type: 'beam-wrap', height: 2.4 } }, SLAB],
  ['平釘設得比樓板還高時以樓板為準', [5, 1], { bath: { type: 'flat', height: 3.4 } }, SLAB],
  ['不在任何分區用樓板底高度', [10, 10], {}, SLAB],
]) {
  test(`ceilingHeightAt ${name}`, () => {
    // Act
    const height = ceilingHeightAt(point, FLOORPLAN, ceilings, SLAB);

    // Assert
    assert.ok(close(height, expected), `${height}`);
  });
}

// ---------- 燈具離地高度 ----------

for (const [name, item, ceilings, expected] of [
  ['吸頂燈貼著樓板底', light('ceiling-light', 0.5, 3, { size: { w: 50, d: 50, h: 10 } }), {}, 2.95],
  ['嵌燈貼著廚房平釘天花板', light('downlight', 2, 1, { size: { w: 10, d: 10, h: 2 } }), {}, 2.58],
  ['吊燈在高天花板吊到天花板下 80 cm', light('pendant-light', 0.5, 3, { size: { w: 35, d: 35, h: 30 } }), {}, 2.25],
  ['吊燈在 2.6 m 天花板至少離地 2.1 m', light('pendant-light', 2, 1, { size: { w: 35, d: 35, h: 30 } }), {}, 2.1],
  ['吊燈在很低的天花板就貼著天花板', light('pendant-light', 0.5, 3, { size: { w: 35, d: 35, h: 30 } }), { living: { type: 'flat', height: 2.3 } }, 2.0],
]) {
  test(`lightElevation ${name}`, () => {
    // Act
    const elevation = lightElevation(item, FLOORPLAN, ceilings, SLAB);

    // Assert
    assert.ok(close(elevation, expected), `${elevation}`);
  });
}

// ---------- 提醒 ----------

for (const [name, item, ceilings, expectedKinds] of [
  ['嵌燈裝在不包的區域沒有天花板可嵌', light('downlight', 0.5, 3), {}, ['no-ceiling']],
  ['嵌燈裝在包樑的區域一樣沒有天花板', light('downlight', 0.5, 3), { living: { type: 'beam-wrap', height: 2.6 } }, ['no-ceiling']],
  ['嵌燈裝在平釘天花板沒問題', light('downlight', 2, 1), {}, []],
  ['嵌燈裝在造型天花板沒問題', light('downlight', 0.5, 3), { living: { type: 'cove', height: 2.7 } }, []],
  ['吊燈在 2.6 m 天花板有壓迫感', light('pendant-light', 2, 1), {}, ['low-ceiling']],
  ['吊燈在剛好 2.8 m 不提醒', light('pendant-light', 0.5, 3), { living: { type: 'flat', height: 2.8 } }, []],
  ['吊燈在 3.05 m 不提醒', light('pendant-light', 0.5, 3), {}, []],
  ['吸頂燈裝在不包的區域沒問題', light('ceiling-light', 0.5, 3), {}, []],
  ['不是燈不檢查', { id: 's', type: 'sofa', x: 0.5, y: 3, rotation: 0, size: { w: 200, d: 90, h: 85 } }, {}, []],
]) {
  test(`lightingIssues ${name}`, () => {
    // Act
    const issues = lightingIssues(item, FLOORPLAN, ceilings, SLAB);

    // Assert
    assert.deepEqual(issues.map((i) => i.kind), expectedKinds);
    for (const issue of issues) assert.match(issue.message, /[一-鿿]/);
  });
}

// ---------- 色溫顏色 ----------

for (const [kelvin, expected] of [[2700, '#ffa757'], [3000, '#ffb46b'], [4000, '#ffd1a3']]) {
  test(`colorTempToHex ${kelvin}K`, () => {
    // Act & Assert
    assert.equal(colorTempToHex(kelvin), expected);
  });
}

test('colorTempToHex 色溫越高藍色成分越多，不支援的值取最接近的', () => {
  // Act
  const blue = (hex) => parseInt(hex.slice(5, 7), 16);

  // Assert
  assert.ok(blue(colorTempToHex(2700)) < blue(colorTempToHex(3000)));
  assert.ok(blue(colorTempToHex(3000)) < blue(colorTempToHex(4000)));
  assert.equal(colorTempToHex(3200), colorTempToHex(3000));
  assert.equal(colorTempToHex(9000), colorTempToHex(4000));
});

// ---------- 光源強度 ----------

// 點光源把光通量平均到整個球面；聚光燈集中在光束角的圓錐內
const sphereCandela = (lm) => lm / (4 * Math.PI);
const coneCandela = (lm, beam) => lm / (2 * Math.PI * (1 - Math.cos(((beam / 2) * Math.PI) / 180)));

for (const [name, type, expectedOf] of [
  ['點光源把光通量平均到整個球面', 'ceiling-light', (spec) => sphereCandela(spec.lumens)],
  ['聚光燈把光通量集中在光束角內', 'downlight', (spec) => coneCandela(spec.lumens, spec.beam)],
]) {
  test(`lightIntensity ${name}`, () => {
    // Arrange
    const spec = getCatalogItem(type)?.light ?? { lumens: 1000, beam: 36 };

    // Act
    const intensity = lightIntensity({ type });

    // Assert
    assert.ok(Math.abs(intensity - expectedOf(spec)) < 1e-6, `${intensity}`);
  });
}

test('lightIntensity 不是燈回傳 0', () => {
  // Act & Assert
  assert.equal(lightIntensity({ type: 'sofa' }), 0);
});

// ---------- 光源數量上限 ----------

test('activeLightSources 只挑開著的燈，略過關燈與一般家具', () => {
  // Arrange
  const furniture = [
    light('downlight', 1, 1),
    light('downlight', 2, 2, { options: { on: false } }),
    { id: 'sofa', type: 'sofa', x: 1, y: 1, rotation: 0, size: { w: 200, d: 90, h: 85 } },
    light('ceiling-light', 3, 3),
  ];

  // Act
  const active = activeLightSources(furniture, 16);

  // Assert
  assert.deepEqual(active.map((f) => f.id), ['downlight-1-1', 'ceiling-light-3-3']);
});

test('activeLightSources 超過上限的只保留前面幾盞', () => {
  // Arrange
  const furniture = Array.from({ length: 20 }, (_, i) => light('downlight', i, 0));

  // Act
  const active = activeLightSources(furniture, 16);

  // Assert
  assert.equal(active.length, 16);
  assert.equal(active[15].id, 'downlight-15-0');
});

// ---------- 天花板改了之後重算燈具高度 ----------

test('relevelLights 依新的天花板重算每盞燈的高度，一般家具不動', () => {
  // Arrange
  const sofa = { id: 'sofa', type: 'sofa', x: 0.5, y: 3, rotation: 0, size: { w: 200, d: 90, h: 85 }, color: '#888888' };
  const design = {
    ceilingHeight: SLAB,
    ceilings: { living: { type: 'flat', height: 2.5 } },
    furniture: [light('ceiling-light', 0.5, 3, { elevation: 2.95 }), sofa],
  };

  // Act
  const next = relevelLights(design, FLOORPLAN);

  // Assert
  assert.ok(close(next.furniture[0].elevation, 2.4), `${next.furniture[0].elevation}`);
  assert.equal(next.furniture[1], sofa);
  assert.equal(design.furniture[0].elevation, 2.95);
});

test('relevelLights 高度都沒變時回傳原本的設計物件', () => {
  // Arrange
  const design = { ceilingHeight: SLAB, ceilings: {}, furniture: [light('ceiling-light', 0.5, 3, { elevation: 2.95 })] };

  // Act
  const next = relevelLights(design, FLOORPLAN);

  // Assert
  assert.equal(next, design);
});

test('relevelLights 吸頂 AP 這類非燈具的吸頂物件也跟著天花板重算', () => {
  // Arrange：AP 高 5 cm，客廳改成 2.5 m 平釘，AP 要貼在 2.45 m
  const ap = { id: 'ap', type: 'ceiling-ap', x: 0.5, y: 3, rotation: 0, size: { w: 20, d: 20, h: 5 }, color: '#f4f4f2', elevation: 3.0 };
  const design = { ceilingHeight: SLAB, ceilings: { living: { type: 'flat', height: 2.5 } }, furniture: [ap] };

  // Act
  const next = relevelLights(design, FLOORPLAN);

  // Assert
  assert.ok(close(next.furniture[0].elevation, 2.45), `${next.furniture[0].elevation}`);
});
