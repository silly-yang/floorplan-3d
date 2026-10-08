import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StorageFullError, StorageUnavailableError } from '../../js/storage/localStore.js';
import { FloorplanFormatError, FloorplanNotFoundError, FloorplanStore } from '../../js/storage/floorplanStore.js';

// 模擬 localStorage；quota 為可寫入的總字元數上限
class FakeStorage {
  constructor({ quota = Infinity, broken = false } = {}) {
    this.map = new Map();
    this.quota = quota;
    this.broken = broken;
  }
  get length() {
    return this.map.size;
  }
  key(i) {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k) {
    if (this.broken) throw Object.assign(new Error('denied'), { name: 'SecurityError' });
    return this.map.has(k) ? this.map.get(k) : null;
  }
  setItem(k, v) {
    if (this.broken) throw Object.assign(new Error('denied'), { name: 'SecurityError' });
    const used = [...this.map].reduce((s, [key, val]) => s + (key === k ? 0 : key.length + val.length), 0);
    if (used + k.length + v.length > this.quota) throw Object.assign(new Error('full'), { name: 'QuotaExceededError' });
    this.map.set(k, String(v));
  }
  removeItem(k) {
    this.map.delete(k);
  }
}

const plan = (width = 3) => ({
  version: 1,
  units: 'm',
  bounds: { width, depth: 2 },
  walls: [{ id: 'wall-1', kind: 'rc', polygon: [[0, 0], [1, 0], [1, 0.15]] }],
  openings: [],
  rooms: [{ id: 'room-1', name: '客廳', rects: [[0, 0, 1, 1]] }],
  fixtures: [],
  outlets: [],
});

const record = (ref, name = `平面圖 ${ref}`, createdAt = '2026-10-09T09:00:00.000Z') => ({ ref, name, createdAt, floorplan: plan() });

test('save 後 load 取回完全相同的紀錄，存在 fp3d.floorplan.<ref>', () => {
  // Arrange
  const storage = new FakeStorage();
  const store = new FloorplanStore(storage);

  // Act
  store.save(record('abc123'));
  const loaded = store.load('abc123');

  // Assert
  assert.deepEqual(loaded, record('abc123'));
  assert.deepEqual(JSON.parse(storage.getItem('fp3d.floorplan.abc123')), record('abc123'));
});

for (const [name, broken, fragment] of [
  ['平面圖格式錯誤', { ...record('a'), floorplan: { ...plan(), walls: 'x' } }, 'walls'],
  ['名稱空白', { ...record('a'), name: '  ' }, 'name'],
  ['名稱太長', { ...record('a'), name: '長'.repeat(41) }, 'name'],
  ['ref 不是字串', { ...record('a'), ref: 7 }, 'ref'],
  ['建立日期不是日期', { ...record('a'), createdAt: 'yesterday' }, 'createdAt'],
]) {
  test(`save 驗證不過時丟出 FloorplanFormatError 且什麼都不寫入：${name}`, () => {
    // Arrange
    const storage = new FakeStorage();
    const store = new FloorplanStore(storage);

    // Act & Assert
    assert.throws(() => store.save(broken), (e) => e instanceof FloorplanFormatError && e.problems.some((p) => p.includes(fragment)));
    assert.equal(storage.length, 0);
  });
}

test('容量不足時丟出 StorageFullError，已存的平面圖保持完整', () => {
  // Arrange
  const storage = new FakeStorage({ quota: 1200 });
  const store = new FloorplanStore(storage);
  store.save(record('a'));

  // Act & Assert
  assert.throws(() => store.save({ ...record('b'), floorplan: { ...plan(), rooms: Array.from({ length: 30 }, (_, i) => ({ id: `r${i}`, name: '房間', rects: [[0, 0, 1, 1]] })) } }), StorageFullError);
  assert.deepEqual(store.load('a'), record('a'));
  assert.equal(storage.getItem('fp3d.floorplan.b'), null);
});

test('list 依建立時間排序，只看平面圖的 key，損毀的列在 broken', () => {
  // Arrange
  const storage = new FakeStorage();
  const store = new FloorplanStore(storage);
  store.save(record('late', '後來的', '2026-10-09T10:00:00.000Z'));
  store.save(record('early', '先建的', '2026-10-09T08:00:00.000Z'));
  storage.setItem('fp3d.design.x', '{}');
  storage.setItem('fp3d.index', '{}');
  storage.setItem('fp3d.floorplan.bad', '{壞掉');

  // Act
  const { floorplans, broken } = store.list();

  // Assert
  assert.deepEqual(floorplans, [
    { ref: 'early', name: '先建的', createdAt: '2026-10-09T08:00:00.000Z' },
    { ref: 'late', name: '後來的', createdAt: '2026-10-09T10:00:00.000Z' },
  ]);
  assert.deepEqual(broken.map((b) => b.ref), ['bad']);
});

test('has 只在平面圖存在時為真', () => {
  // Arrange
  const store = new FloorplanStore(new FakeStorage());
  store.save(record('a'));

  // Act & Assert
  assert.equal(store.has('a'), true);
  assert.equal(store.has('b'), false);
  assert.equal(store.has(null), false);
});

test('load 不存在的平面圖時丟出 FloorplanNotFoundError', () => {
  // Arrange
  const store = new FloorplanStore(new FakeStorage());

  // Act & Assert
  assert.throws(() => store.load('nope'), FloorplanNotFoundError);
});

test('rename 只改名稱，平面圖內容不動；空白名稱拒絕', () => {
  // Arrange
  const store = new FloorplanStore(new FakeStorage());
  store.save(record('a', '原名'));

  // Act
  store.rename('a', ' 新名稱 ');

  // Assert
  assert.deepEqual(store.load('a'), { ...record('a'), name: '新名稱' });
  assert.throws(() => store.rename('a', ' '), FloorplanFormatError);
});

test('remove 刪掉平面圖；刪的是目前使用中的就清掉，回到預設', () => {
  // Arrange
  const store = new FloorplanStore(new FakeStorage());
  store.save(record('a'));
  store.setCurrent('a');

  // Act
  store.remove('a');

  // Assert
  assert.equal(store.has('a'), false);
  assert.equal(store.currentRef, null);
});

test('目前使用的平面圖預設是 null（預設平面圖），重新開頁後仍記得', () => {
  // Arrange
  const storage = new FakeStorage();
  const before = new FloorplanStore(storage).currentRef;

  // Act
  new FloorplanStore(storage).setCurrent('a');
  const after = new FloorplanStore(storage).currentRef;
  new FloorplanStore(storage).setCurrent(null);

  // Assert
  assert.equal(before, null);
  assert.equal(after, 'a');
  assert.equal(new FloorplanStore(storage).currentRef, null);
});

test('每張平面圖各自記得最後開的方案，預設平面圖用 null', () => {
  // Arrange
  const storage = new FakeStorage();
  const store = new FloorplanStore(storage);

  // Act
  store.setActiveDesign(null, 'd-default');
  store.setActiveDesign('a', 'd-a');

  // Assert
  const reopened = new FloorplanStore(storage);
  assert.equal(reopened.activeDesignOf(null), 'd-default');
  assert.equal(reopened.activeDesignOf('a'), 'd-a');
  assert.equal(reopened.activeDesignOf('b'), null);
});

test('狀態資料損毀時當成沒有紀錄，不讓頁面壞掉', () => {
  // Arrange
  const storage = new FakeStorage();
  storage.setItem('fp3d.floorplanState', '{壞掉');

  // Act
  const store = new FloorplanStore(storage);

  // Assert
  assert.equal(store.currentRef, null);
  assert.equal(store.activeDesignOf(null), null);
});

test('瀏覽器禁止使用儲存空間時丟出 StorageUnavailableError', () => {
  // Arrange
  const store = new FloorplanStore(new FakeStorage({ broken: true }));

  // Act & Assert
  assert.throws(() => store.load('a'), StorageUnavailableError);
  assert.throws(() => store.save(record('a')), StorageUnavailableError);
});
