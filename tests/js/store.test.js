import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../js/app/store.js';

const design = (n) => ({ name: `v${n}`, furniture: [] });

test('commit 後可以 undo 回上一版、再 redo 回來', () => {
  // Arrange
  const store = createStore(design(0));
  store.commit(design(1));

  // Act
  store.undo();
  const afterUndo = store.getState().name;
  store.redo();

  // Assert
  assert.equal(afterUndo, 'v0');
  assert.equal(store.getState().name, 'v1');
});

test('undo 之後再 commit 會清掉 redo', () => {
  // Arrange
  const store = createStore(design(0));
  store.commit(design(1));
  store.undo();

  // Act
  store.commit(design(2));

  // Assert
  assert.equal(store.canRedo(), false);
  assert.equal(store.getState().name, 'v2');
});

test('preview 只更新畫面不進歷史，commit 指定 base 時 undo 回到 base', () => {
  // Arrange：拖曳中連續 preview，放開時以拖曳前的狀態為 base 提交
  const store = createStore(design(0));
  const before = store.getState();
  store.preview(design(1));
  store.preview(design(2));

  // Act
  store.commit(design(3), { base: before });
  store.undo();

  // Assert
  assert.equal(store.getState().name, 'v0');
  assert.equal(store.canUndo(), false);
});

test('歷史超過上限時丟掉最舊的', () => {
  // Arrange
  const store = createStore(design(0), { limit: 3 });
  for (let i = 1; i <= 5; i++) store.commit(design(i));

  // Act
  let steps = 0;
  while (store.canUndo()) {
    store.undo();
    steps++;
  }

  // Assert
  assert.equal(steps, 3);
  assert.equal(store.getState().name, 'v2');
});

test('replace 換成另一個方案時清空歷史', () => {
  // Arrange
  const store = createStore(design(0));
  store.commit(design(1));

  // Act
  store.replace(design(9));

  // Assert
  assert.equal(store.getState().name, 'v9');
  assert.equal(store.canUndo(), false);
  assert.equal(store.canRedo(), false);
});

test('subscribe 收到每次變更的來源，取消後不再收到', () => {
  // Arrange
  const store = createStore(design(0));
  const sources = [];
  const off = store.subscribe((_, meta) => sources.push(meta.source));

  // Act
  store.commit(design(1));
  store.preview(design(2));
  store.undo();
  off();
  store.redo();

  // Assert
  assert.deepEqual(sources, ['commit', 'preview', 'undo']);
});

test('沒有歷史時 undo／redo 不改變狀態也不通知', () => {
  // Arrange
  const store = createStore(design(0));
  let calls = 0;
  store.subscribe(() => calls++);

  // Act
  store.undo();
  store.redo();

  // Assert
  assert.equal(store.getState().name, 'v0');
  assert.equal(calls, 0);
});
