import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../js/app/store.js';
import { createSession } from '../../js/app/session.js';
import { DesignStore } from '../../js/storage/localStore.js';
import { createDesign } from '../../js/storage/schema.js';

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

function fakeTimers() {
  const jobs = new Map();
  let seq = 0;
  return {
    setTimeout: (fn) => (jobs.set(++seq, fn), seq),
    clearTimeout: (id) => jobs.delete(id),
    run: () => [...jobs.values()].forEach((fn, i, all) => (jobs.clear(), fn())),
  };
}

// 開一個「頁面」：同一個 storage 再開一次就等於重新整理
function openPage(storage) {
  let clock = 0;
  let ids = 0;
  const store = createStore({ ceilingHeight: 2.8, rooms: {}, furniture: [] });
  const timers = fakeTimers();
  const session = createSession({
    designStore: new DesignStore(storage),
    store,
    now: () => new Date(Date.UTC(2026, 9, 8, 9, 0, clock++)).toISOString(),
    newId: () => `id-${++ids}-${Math.random().toString(36).slice(2, 6)}`,
    floorplanRef: 'fp1',
    timers,
    defaultFurniture: () => [{ ...sofa, id: `default-${++ids}` }],
  });
  return { store, session, timers };
}

const sofa = { id: 'f1', type: 'sofa', x: 2, y: 3, rotation: 30, size: { w: 200, d: 90, h: 85 }, color: '#112233' };

test('空的瀏覽器第一次開啟時建立並儲存「方案 1」', () => {
  // Arrange
  const storage = new MemoryStorage();
  const { session } = openPage(storage);

  // Act
  session.init();

  // Assert
  assert.equal(session.current.name, '方案 1');
  assert.deepEqual(session.list().map((d) => d.name), ['方案 1']);
});

test('重新整理頁面後設計完整保留（含家具、樓高、天花板、地板色與門）', () => {
  // Arrange
  const storage = new MemoryStorage();
  const page1 = openPage(storage);
  page1.session.init();
  page1.store.commit({ ceilingHeight: 3.1, ceilingColor: '#ddeeff', rooms: { living: { floorColor: '#445566' } }, doors: { 'FD2-1': { type: 'sliding', open: true, flip: false, out: false } }, cabinets: [], ceilings: {}, furniture: [sofa] });
  page1.timers.run();

  // Act
  const page2 = openPage(storage);
  page2.session.init();

  // Assert
  assert.deepEqual(page2.store.getState(), { ceilingHeight: 3.1, ceilingColor: '#ddeeff', rooms: { living: { floorColor: '#445566' } }, doors: { 'FD2-1': { type: 'sliding', open: true, flip: false, out: false } }, cabinets: [], ceilings: {}, furniture: [sofa] });
  assert.equal(page2.session.current.id, page1.session.current.id);
});

test('拖曳中的 preview 不觸發存檔，commit 才存', () => {
  // Arrange
  const storage = new MemoryStorage();
  const { session, store, timers } = openPage(storage);
  session.init();

  const baseline = store.getState().furniture.length;
  const plusSofa = { ...store.getState(), furniture: [...store.getState().furniture, { ...sofa, id: 'extra' }] };

  // Act
  store.preview(plusSofa);
  timers.run();
  const afterPreview = new DesignStore(storage).load(session.current.id).furniture.length;
  store.commit(plusSofa);
  timers.run();

  // Assert
  assert.equal(afterPreview, baseline);
  assert.equal(new DesignStore(storage).load(session.current.id).furniture.length, baseline + 1);
});

test('新增方案時自動取不重複名稱、切過去且清空復原歷史', () => {
  // Arrange
  const { session, store } = openPage(new MemoryStorage());
  session.init();
  store.commit({ ...store.getState(), furniture: [sofa] });

  // Act
  session.createNew();

  // Assert：只剩預設家具，前一個方案加的沙發不會帶過來
  assert.equal(session.current.name, '方案 2');
  assert.deepEqual(store.getState().furniture.map((f) => f.id), [store.getState().furniture[0].id]);
  assert.ok(store.getState().furniture[0].id.startsWith('default-'));
  assert.equal(store.canUndo(), false);
});

test('切換方案前先把目前方案未存的變更存起來', () => {
  // Arrange
  const storage = new MemoryStorage();
  const { session, store } = openPage(storage);
  session.init();
  const firstId = session.current.id;
  session.createNew();
  session.switchTo(firstId);
  store.commit({ ...store.getState(), furniture: [sofa] });

  // Act：還沒等到自動儲存就切走
  const secondId = session.list().find((d) => d.id !== firstId).id;
  session.switchTo(secondId);

  // Assert
  assert.equal(new DesignStore(storage).load(firstId).furniture.length, 1);
});

test('重新命名不會因為復原而被改回去', () => {
  // Arrange
  const { session, store } = openPage(new MemoryStorage());
  session.init();
  store.commit({ ...store.getState(), furniture: [sofa] });

  // Act
  session.rename('客廳版');
  store.undo();

  // Assert
  assert.equal(session.current.name, '客廳版');
  assert.equal(session.list()[0].name, '客廳版');
});

test('重新命名為空白或與其他方案同名時拒絕', () => {
  // Arrange
  const { session } = openPage(new MemoryStorage());
  session.init();
  session.createNew();

  // Act & Assert
  assert.throws(() => session.rename('   '), /名稱/);
  assert.throws(() => session.rename('方案 1'), /已經有/);
});

test('複製方案得到新 id、名稱加「複本」、內容相同', () => {
  // Arrange
  const { session, store } = openPage(new MemoryStorage());
  session.init();
  store.commit({ ...store.getState(), furniture: [sofa] });
  const originalId = session.current.id;

  // Act
  session.duplicate();

  // Assert
  assert.notEqual(session.current.id, originalId);
  assert.equal(session.current.name, '方案 1 複本');
  assert.deepEqual(store.getState().furniture, [sofa]);
  assert.equal(session.list().length, 2);
});

test('刪除目前方案時切到另一個；刪到最後一個時自動建立新的空方案', () => {
  // Arrange
  const { session } = openPage(new MemoryStorage());
  session.init();
  session.createNew();
  const [first, second] = session.list();

  // Act
  session.remove(second.id);
  const afterFirstRemove = session.current.id;
  session.remove(first.id);

  // Assert
  assert.equal(afterFirstRemove, first.id);
  assert.equal(session.list().length, 1);
  assert.notEqual(session.current.id, first.id);
});

test('目前方案的儲存資料損毀時改開其他方案並提出警告', () => {
  // Arrange
  const storage = new MemoryStorage();
  const page1 = openPage(storage);
  page1.session.init();
  page1.session.createNew();
  const brokenId = page1.session.current.id;
  storage.setItem(`fp3d.design.${brokenId}`, '{壞掉');

  // Act
  const page2 = openPage(storage);
  const { warnings } = page2.session.init();

  // Assert
  assert.notEqual(page2.session.current.id, brokenId);
  assert.ok(warnings.length >= 1);
});

test('匯入覆蓋目前開著的方案時，畫面內容跟著換成匯入的版本', () => {
  // Arrange
  const { session, store } = openPage(new MemoryStorage());
  session.init();
  const incoming = { ...createDesign({ id: session.current.id, name: '方案 1', now: '2026-10-09T00:00:00.000Z' }), furniture: [sofa] };

  // Act
  session.importDesign(incoming);

  // Assert
  assert.deepEqual(store.getState().furniture, [sofa]);
});

test('匯入新方案會存進清單但不切換目前方案', () => {
  // Arrange
  const { session } = openPage(new MemoryStorage());
  session.init();
  const currentId = session.current.id;

  // Act
  session.importDesign(createDesign({ id: 'imported', name: '匯入的', now: '2026-10-09T00:00:00.000Z' }));

  // Assert
  assert.equal(session.current.id, currentId);
  assert.ok(session.list().some((d) => d.name === '匯入的'));
});

test('刪除目前方案時若還有未存的變更，不會把刪掉的方案又寫回去', () => {
  // Arrange
  const storage = new MemoryStorage();
  const { session, store } = openPage(storage);
  session.init();
  session.createNew();
  const doomed = session.current.id;
  store.commit({ ...store.getState(), furniture: [sofa] });

  // Act：自動儲存還在等待中就刪除
  session.remove(doomed);

  // Assert
  assert.equal(storage.getItem(`fp3d.design.${doomed}`), null);
  assert.ok(!session.list().some((d) => d.id === doomed));
});

test('load 讀取其他方案的完整內容，不切換目前方案', () => {
  // Arrange
  const { session, store } = openPage(new MemoryStorage());
  session.init();
  store.commit({ ...store.getState(), furniture: [sofa] });
  session.flush();
  const firstId = session.current.id;
  session.createNew();

  // Act
  const loaded = session.load(firstId);

  // Assert
  assert.deepEqual(loaded.furniture, [sofa]);
  assert.notEqual(session.current.id, firstId);
});

test('新方案會帶入預設家具（建商附的廚衛），每次 id 都不同', () => {
  // Arrange
  const { session, store } = openPage(new MemoryStorage());
  session.init();
  const firstIds = store.getState().furniture.map((f) => f.id);

  // Act
  session.createNew();
  const secondIds = store.getState().furniture.map((f) => f.id);

  // Assert
  assert.equal(firstIds.length, 1);
  assert.equal(secondIds.length, 1);
  assert.notDeepEqual(firstIds, secondIds);
});

test('洞洞板設計會跟著方案存檔，重新整理後還在', () => {
  // Arrange
  const storage = new MemoryStorage();
  const page1 = openPage(storage);
  page1.session.init();
  const pegboards = [{ id: 'p1', name: '洞洞板', size: { w: 120, h: 80 }, material: 'wood', color: '#c8a27a', pitch: 2.5, mountHeight: 90, accessories: [] }];
  page1.store.commit({ ...page1.store.getState(), pegboards });
  page1.timers.run();

  // Act
  const page2 = openPage(storage);
  page2.session.init();

  // Assert
  assert.deepEqual(page2.store.getState().pegboards, pegboards);
  assert.deepEqual(page2.session.current.pegboards, pegboards);
});

test('重置方案：內容回到新方案的預設，名稱與 id 不變，可以復原，並會存檔', () => {
  // Arrange：改過樓高、天花板、加了一張沙發
  const storage = new MemoryStorage();
  const { session, store, timers } = openPage(storage);
  session.init();
  const { id, name } = session.current;
  store.commit({ ...store.getState(), ceilingHeight: 2.6, ceilings: { living: { type: 'flat', height: 2.4 } }, furniture: [...store.getState().furniture, sofa] });
  const edited = store.getState();

  // Act
  session.reset();
  timers.run();

  // Assert
  const state = store.getState();
  assert.equal(state.ceilingHeight, 3.05);
  assert.deepEqual(state.ceilings, {});
  assert.equal(state.furniture.length, 1);
  assert.match(state.furniture[0].id, /^default-/);
  assert.deepEqual([session.current.id, session.current.name], [id, name]);
  assert.equal(new DesignStore(storage).load(id).ceilingHeight, 3.05);
  store.undo();
  assert.deepEqual(store.getState(), edited);
});
