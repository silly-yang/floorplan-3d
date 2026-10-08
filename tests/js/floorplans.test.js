import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFloorplanCatalog, DEFAULT_FLOORPLAN_NAME, floorplanRefOf } from '../../js/app/floorplans.js';
import { FloorplanStore } from '../../js/storage/floorplanStore.js';
import { DesignStore } from '../../js/storage/localStore.js';
import { createDesign, fingerprint } from '../../js/storage/schema.js';

class MemoryStorage {
  constructor() {
    this.map = new Map();
  }
  get length() {
    return this.map.size;
  }
  key(i) {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k) {
    return this.map.get(k) ?? null;
  }
  setItem(k, v) {
    this.map.set(k, String(v));
  }
  removeItem(k) {
    this.map.delete(k);
  }
}

const NOW = '2026-10-09T09:00:00.000Z';

const plan = (width) => ({
  version: 1,
  units: 'm',
  bounds: { width, depth: 2 },
  walls: [{ id: 'wall-1', kind: 'rc', polygon: [[0, 0], [width, 0], [width, 0.15]] }],
  openings: [],
  rooms: [{ id: 'room-1', name: '客廳', rects: [[0, 0, 1, 1]] }],
  fixtures: [],
  outlets: [],
});

const DEFAULT_PLAN = plan(10);
const DEFAULT_REF = floorplanRefOf(DEFAULT_PLAN);

function setup(storage = new MemoryStorage()) {
  const designStore = new DesignStore(storage);
  const floorplanStore = new FloorplanStore(storage);
  const catalog = createFloorplanCatalog({ floorplanStore, designStore, defaultFloorplan: DEFAULT_PLAN, defaultRef: DEFAULT_REF });
  return { storage, designStore, floorplanStore, catalog };
}

const design = (id, floorplanRef, name = `方案 ${id}`) => createDesign({ id, name, now: NOW, floorplanRef });

test('floorplanRefOf 只看牆、門窗、房間與外框；建商設備變動不算換了平面圖', () => {
  // Arrange
  const withFixture = { ...plan(10), fixtures: [{ type: 'toilet', x: 1, y: 1, rotation: 0, size: { w: 40, d: 70, h: 80 } }] };

  // Act & Assert
  assert.equal(floorplanRefOf(withFixture), floorplanRefOf(plan(10)));
  assert.notEqual(floorplanRefOf(plan(11)), floorplanRefOf(plan(10)));
});

test('floorplanRefOf 與升級前的算法相同，舊方案記的 ref 才對得上', () => {
  // Arrange
  const fp = plan(10);

  // Act
  const ref = floorplanRefOf(fp);

  // Assert
  assert.equal(ref, fingerprint(JSON.stringify([fp.bounds, fp.walls, fp.openings, fp.rooms])));
});

test('舊資料（只有預設平面圖的方案）照常開在預設平面圖上，清單只有預設一項', () => {
  // Arrange：升級前的使用者資料，沒有任何平面圖紀錄
  const { designStore, catalog } = setup();
  designStore.save(design('old-1', DEFAULT_REF));
  designStore.save(design('old-2', null));
  designStore.save(design('old-3', 'stale-default-ref'));

  // Act
  const { entry, warning } = catalog.startup();
  const entries = catalog.entries();

  // Assert
  assert.deepEqual([entry.key, entry.ref, entry.name, entry.isDefault, entry.floorplan], [null, DEFAULT_REF, DEFAULT_FLOORPLAN_NAME, true, DEFAULT_PLAN]);
  assert.equal(warning, null);
  assert.deepEqual(entries, [{ key: null, ref: DEFAULT_REF, name: DEFAULT_FLOORPLAN_NAME, createdAt: null, isDefault: true, designCount: 3 }]);
});

test('add 把匯入的平面圖另存成新的一張，預設平面圖不受影響', () => {
  // Arrange
  const { catalog, floorplanStore } = setup();

  // Act
  const { key, existed } = catalog.add(plan(5), '匯入測試', NOW);

  // Assert
  assert.equal(key, floorplanRefOf(plan(5)));
  assert.equal(existed, false);
  assert.deepEqual(floorplanStore.load(key), { ref: key, name: '匯入測試', createdAt: NOW, floorplan: plan(5) });
  assert.deepEqual(catalog.entries().map((e) => [e.key, e.name, e.isDefault]), [[null, DEFAULT_FLOORPLAN_NAME, true], [key, '匯入測試', false]]);
  assert.deepEqual(catalog.open(null).floorplan, DEFAULT_PLAN);
});

test('add 同一份平面圖第二次時沿用原本那張，不重複存', () => {
  // Arrange
  const { catalog, floorplanStore } = setup();
  const first = catalog.add(plan(5), '第一次', NOW);

  // Act
  const second = catalog.add(plan(5), '第二次', NOW);

  // Assert
  assert.deepEqual(second, { key: first.key, existed: true });
  assert.equal(floorplanStore.load(first.key).name, '第一次');
  assert.equal(floorplanStore.list().floorplans.length, 1);
});

test('add 內容與預設平面圖相同時就是預設平面圖', () => {
  // Arrange
  const { catalog, floorplanStore } = setup();

  // Act
  const result = catalog.add(plan(10), '其實是預設', NOW);

  // Assert
  assert.deepEqual(result, { key: null, existed: true });
  assert.equal(floorplanStore.list().floorplans.length, 0);
});

for (const [name, ref, expected] of [
  ['匯入的平面圖', 'IMPORTED', 'IMPORTED'],
  ['目前預設平面圖', DEFAULT_REF, null],
  ['舊版預設平面圖（指紋對不上）', 'stale', null],
  ['沒有記錄平面圖的舊方案', null, null],
]) {
  test(`keyOf 方案的 floorplanRef 對應到哪張平面圖：${name}`, () => {
    // Arrange
    const { catalog } = setup();
    const { key } = catalog.add(plan(5), '匯入', NOW);

    // Act
    const result = catalog.keyOf(ref === 'IMPORTED' ? key : ref);

    // Assert
    assert.equal(result, expected === 'IMPORTED' ? key : expected);
  });
}

test('keyOf 儲存裡有和預設平面圖同 ref 的紀錄時，方案仍屬於預設平面圖', () => {
  // Arrange
  const { catalog, floorplanStore } = setup();
  floorplanStore.save({ ref: DEFAULT_REF, name: '同 ref', createdAt: NOW, floorplan: DEFAULT_PLAN });

  // Act
  const key = catalog.keyOf(DEFAULT_REF);

  // Assert
  assert.equal(key, null);
});

test('entries 列出各平面圖的方案數', () => {
  // Arrange
  const { catalog, designStore } = setup();
  const { key } = catalog.add(plan(5), '匯入', NOW);
  designStore.save(design('d1', DEFAULT_REF));
  designStore.save(design('i1', key));
  designStore.save(design('i2', key));

  // Act
  const counts = catalog.entries().map((e) => [e.key, e.designCount]);

  // Assert
  assert.deepEqual(counts, [[null, 1], [key, 2]]);
});

test('startup 開上次使用的匯入平面圖', () => {
  // Arrange
  const { catalog } = setup();
  const { key } = catalog.add(plan(5), '匯入', NOW);
  catalog.setCurrent(key);

  // Act
  const { entry, warning } = catalog.startup();

  // Assert
  assert.deepEqual([entry.key, entry.name, entry.isDefault, entry.floorplan], [key, '匯入', false, plan(5)]);
  assert.equal(warning, null);
});

test('startup 上次使用的平面圖不見了就退回預設並提示，下次不再提示', () => {
  // Arrange
  const { catalog, floorplanStore } = setup();
  floorplanStore.setCurrent('gone');

  // Act
  const first = catalog.startup();
  const second = catalog.startup();

  // Assert
  assert.equal(first.entry.key, null);
  assert.match(first.warning, /找不到/);
  assert.equal(floorplanStore.currentRef, null);
  assert.equal(second.warning, null);
});

test('remove 刪掉匯入的平面圖與用它的方案，預設平面圖的方案不受影響', () => {
  // Arrange
  const { catalog, designStore, floorplanStore } = setup();
  const { key } = catalog.add(plan(5), '匯入', NOW);
  designStore.save(design('d1', DEFAULT_REF));
  designStore.save(design('i1', key));
  designStore.save(design('i2', key));
  catalog.setCurrent(key);

  // Act
  const removed = catalog.remove(key);

  // Assert
  assert.equal(removed, 2);
  assert.deepEqual(designStore.list().designs.map((d) => d.id), ['d1']);
  assert.equal(floorplanStore.has(key), false);
  assert.equal(floorplanStore.currentRef, null);
});

test('預設平面圖不能刪除也不能改名', () => {
  // Arrange
  const { catalog } = setup();

  // Act & Assert
  assert.throws(() => catalog.remove(null), /預設平面圖/);
  assert.throws(() => catalog.rename(null, '新名'), /預設平面圖/);
});

test('rename 改匯入平面圖的名稱', () => {
  // Arrange
  const { catalog } = setup();
  const { key } = catalog.add(plan(5), '匯入', NOW);

  // Act
  catalog.rename(key, '我家');

  // Assert
  assert.equal(catalog.open(key).name, '我家');
});

test('exportBundle 只帶被匯出方案用到的匯入平面圖；預設平面圖記下方案的 ref', () => {
  // Arrange
  const { catalog } = setup();
  const a = catalog.add(plan(5), 'A', NOW).key;
  catalog.add(plan(6), '沒用到', NOW);
  const designs = [design('d1', DEFAULT_REF), design('d2', 'stale'), design('d3', null), design('i1', a), design('i2', a)];

  // Act
  const bundle = catalog.exportBundle(designs);

  // Assert
  assert.deepEqual(bundle.floorplans, [{ ref: a, name: 'A', createdAt: NOW, floorplan: plan(5) }]);
  assert.deepEqual(bundle.defaultRefs, [DEFAULT_REF, 'stale']);
});

test('restore 還原匯入檔裡的平面圖；已存在或等於預設的不重複存', () => {
  // Arrange
  const { catalog, floorplanStore } = setup();
  const existing = catalog.add(plan(5), '本機的名稱', NOW).key;
  const records = [
    { ref: existing, name: '檔案裡的名稱', createdAt: NOW, floorplan: plan(5) },
    { ref: floorplanRefOf(plan(7)), name: '新的', createdAt: NOW, floorplan: plan(7) },
    { ref: DEFAULT_REF, name: '預設', createdAt: NOW, floorplan: DEFAULT_PLAN },
  ];

  // Act
  const restored = catalog.restore(records);

  // Assert
  assert.equal(restored, 1);
  assert.equal(floorplanStore.load(existing).name, '本機的名稱');
  assert.equal(floorplanStore.load(floorplanRefOf(plan(7))).name, '新的');
  assert.equal(floorplanStore.has(DEFAULT_REF), false);
});

test('每張平面圖各自記得最後開的方案', () => {
  // Arrange
  const { catalog } = setup();
  const { key } = catalog.add(plan(5), '匯入', NOW);

  // Act
  catalog.rememberDesign(null, 'd1');
  catalog.rememberDesign(key, 'i1');

  // Assert
  assert.equal(catalog.preferredDesign(null), 'd1');
  assert.equal(catalog.preferredDesign(key), 'i1');
});

test('舊資料沒有記錄各平面圖的方案時，預設平面圖沿用原本的 activeId', () => {
  // Arrange
  const { catalog, designStore } = setup();
  designStore.save(design('old-1', DEFAULT_REF));
  designStore.save(design('old-2', DEFAULT_REF));
  designStore.setActive('old-2');

  // Act
  const preferred = catalog.preferredDesign(null);

  // Assert
  assert.equal(preferred, 'old-2');
});

test('匯入的平面圖沒有記錄時不借用其他平面圖的 activeId', () => {
  // Arrange
  const { catalog, designStore } = setup();
  const { key } = catalog.add(plan(5), '匯入', NOW);
  designStore.save(design('old-1', DEFAULT_REF));
  designStore.setActive('old-1');

  // Act
  const preferred = catalog.preferredDesign(key);

  // Assert
  assert.equal(preferred, null);
});
