import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DesignNotFoundError,
  DesignStore,
  StorageFullError,
  StorageUnavailableError,
} from '../../js/storage/localStore.js';
import { DesignFormatError, createDesign } from '../../js/storage/schema.js';

// 模擬 localStorage；quota 為可寫入的總字元數上限
class FakeStorage {
  constructor({ quota = Infinity, broken = false } = {}) {
    this.map = new Map();
    this.quota = quota;
    this.broken = broken;
    this.denyKeys = new Set();
  }
  get length() {
    return this.map.size;
  }
  key(i) {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k) {
    if (this.denyKeys.has(k)) throw Object.assign(new Error('denied'), { name: 'SecurityError' });
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

const design = (id, name = `方案 ${id}`) => createDesign({ id, name, now: '2026-10-08T09:00:00.000Z' });

test('save 後 load 取回完全相同的設計', () => {
  // Arrange
  const store = new DesignStore(new FakeStorage());
  const original = design('a');
  original.furniture.push({ id: 'f1', type: 'sofa', x: 1, y: 2, rotation: 0, size: { w: 210, d: 90, h: 85 }, color: '#8c9aa6' });

  // Act
  store.save(original);
  const loaded = store.load('a');

  // Assert
  assert.deepEqual(loaded, original);
});

test('list 依建立順序列出所有方案', () => {
  // Arrange
  const store = new DesignStore(new FakeStorage());
  store.save(design('b', '客廳版'));
  store.save(design('a', '臥室版'));
  store.save(design('b', '客廳版改'));

  // Act
  const { designs, broken } = store.list();

  // Assert
  assert.deepEqual(designs.map((d) => [d.id, d.name]), [['b', '客廳版改'], ['a', '臥室版']]);
  assert.deepEqual(broken, []);
});

test('save 不合法的設計時丟出格式錯誤，且什麼都不寫入', () => {
  // Arrange
  const storage = new FakeStorage();
  const store = new DesignStore(storage);
  const bad = { ...design('a'), name: '' };

  // Act & Assert
  assert.throws(() => store.save(bad), DesignFormatError);
  assert.equal(storage.length, 0);
});

test('容量不足時丟出 StorageFullError，原本存好的版本保持完整', () => {
  // Arrange
  const storage = new FakeStorage({ quota: 1200 });
  const store = new DesignStore(storage);
  store.save(design('a'));
  const bigger = design('a');
  bigger.furniture = Array.from({ length: 30 }, (_, i) => ({
    id: `f${i}`, type: 'sofa', x: 1, y: 1, rotation: 0, size: { w: 210, d: 90, h: 85 }, color: '#8c9aa6',
  }));

  // Act & Assert
  assert.throws(() => store.save(bigger), StorageFullError);
  assert.equal(store.load('a').furniture.length, 0);
});

test('某個方案的資料損毀時列在 broken，其他方案照常列出', () => {
  // Arrange
  const storage = new FakeStorage();
  const store = new DesignStore(storage);
  store.save(design('a'));
  store.save(design('b'));
  storage.setItem('fp3d.design.b', '{這不是 JSON');

  // Act
  const { designs, broken } = store.list();

  // Assert
  assert.deepEqual(designs.map((d) => d.id), ['a']);
  assert.deepEqual(broken.map((b) => b.id), ['b']);
});

test('索引損毀時從現有資料重建，不會弄丟方案', () => {
  // Arrange
  const storage = new FakeStorage();
  const store = new DesignStore(storage);
  store.save(design('a'));
  store.save(design('b'));
  storage.setItem('fp3d.index', 'garbage');

  // Act
  const { designs } = new DesignStore(storage).list();

  // Assert
  assert.deepEqual(designs.map((d) => d.id).sort(), ['a', 'b']);
});

test('remove 刪除資料與索引；刪掉的是目前方案時清掉 activeId', () => {
  // Arrange
  const storage = new FakeStorage();
  const store = new DesignStore(storage);
  store.save(design('a'));
  store.save(design('b'));
  store.setActive('a');

  // Act
  store.remove('a');

  // Assert
  assert.deepEqual(store.list().designs.map((d) => d.id), ['b']);
  assert.equal(storage.getItem('fp3d.design.a'), null);
  assert.equal(store.activeId, null);
});

test('activeId 在重新建立 DesignStore（等同重新整理頁面）後仍保留', () => {
  // Arrange
  const storage = new FakeStorage();
  const store = new DesignStore(storage);
  store.save(design('a'));
  store.setActive('a');

  // Act
  const reloaded = new DesignStore(storage);

  // Assert
  assert.equal(reloaded.activeId, 'a');
});

test('瀏覽器禁止使用儲存空間時丟出 StorageUnavailableError', () => {
  // Arrange
  const store = new DesignStore(new FakeStorage({ broken: true }));

  // Act & Assert
  assert.throws(() => store.list(), StorageUnavailableError);
  assert.throws(() => store.save(design('a')), StorageUnavailableError);
});

test('load 不存在的方案時丟出 DesignNotFoundError 並帶 id', () => {
  // Arrange
  const store = new DesignStore(new FakeStorage());

  // Act & Assert
  assert.throws(() => store.load('ghost'), (e) => e instanceof DesignNotFoundError && e.message.includes('ghost'));
});

test('讀方案時才被瀏覽器拒絕，要回報儲存不可用，不能當成損毀默默略過', () => {
  // Arrange
  const storage = new FakeStorage();
  const store = new DesignStore(storage);
  store.save(design('a'));
  storage.denyKeys.add('fp3d.design.a');

  // Act & Assert
  assert.throws(() => store.list(), StorageUnavailableError);
});
