import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAutosaver } from '../../js/storage/autosave.js';

// 手動推進的計時器
function fakeTimers() {
  let seq = 0;
  const pending = new Map();
  return {
    setTimeout: (fn, ms) => {
      pending.set(++seq, { fn, ms });
      return seq;
    },
    clearTimeout: (id) => pending.delete(id),
    runAll() {
      const jobs = [...pending.values()];
      pending.clear();
      jobs.forEach((j) => j.fn());
    },
    get count() {
      return pending.size;
    },
  };
}

function setup(save = () => {}) {
  const timers = fakeTimers();
  const saved = [];
  const statuses = [];
  const saver = createAutosaver({
    save: (d) => {
      save(d);
      saved.push(d);
    },
    delay: 1000,
    timers,
    now: () => '2026-10-08T10:00:00.000Z',
    onStatus: (s) => statuses.push(s),
  });
  return { timers, saved, statuses, saver };
}

test('延遲期間的多次變更只存最後一版', () => {
  // Arrange
  const { timers, saved, saver } = setup();

  // Act
  saver.schedule({ name: 'v1' });
  saver.schedule({ name: 'v2' });
  saver.schedule({ name: 'v3' });
  timers.runAll();

  // Assert
  assert.equal(saved.length, 1);
  assert.equal(saved[0].name, 'v3');
});

test('存檔時押上修改時間，並依序回報 pending → saving → saved', () => {
  // Arrange
  const { timers, saved, statuses, saver } = setup();

  // Act
  saver.schedule({ name: 'v1', updatedAt: '2000-01-01T00:00:00.000Z' });
  timers.runAll();

  // Assert
  assert.equal(saved[0].updatedAt, '2026-10-08T10:00:00.000Z');
  assert.deepEqual(statuses.map((s) => s.state), ['pending', 'saving', 'saved']);
  assert.equal(statuses.at(-1).at, '2026-10-08T10:00:00.000Z');
});

test('存檔失敗時回報 error 並帶出錯誤，下次變更會重試', () => {
  // Arrange
  let fail = true;
  const { timers, statuses, saved, saver } = setup(() => {
    if (fail) throw new Error('disk full');
  });

  // Act
  saver.schedule({ name: 'v1' });
  timers.runAll();
  fail = false;
  saver.schedule({ name: 'v2' });
  timers.runAll();

  // Assert
  const error = statuses.find((s) => s.state === 'error');
  assert.equal(error.error.message, 'disk full');
  assert.equal(saved.at(-1).name, 'v2');
  assert.equal(statuses.at(-1).state, 'saved');
});

test('flush 立刻存下待存的變更並取消計時器', () => {
  // Arrange
  const { timers, saved, saver } = setup();
  saver.schedule({ name: 'v1' });

  // Act
  const ok = saver.flush();

  // Assert
  assert.equal(ok, true);
  assert.equal(saved.length, 1);
  assert.equal(timers.count, 0);
});

test('flush 沒有待存的變更時不存檔', () => {
  // Arrange
  const { saved, saver } = setup();

  // Act
  saver.flush();

  // Assert
  assert.equal(saved.length, 0);
});

test('flush 存檔失敗時回傳 false', () => {
  // Arrange
  const { saver } = setup(() => {
    throw new Error('x');
  });
  saver.schedule({ name: 'v1' });

  // Act & Assert
  assert.equal(saver.flush(), false);
});

test('cancel 丟掉待存的變更，之後 flush 也不會存', () => {
  // Arrange
  const { timers, saved, saver } = setup();
  saver.schedule({ name: 'v1' });

  // Act
  saver.cancel();
  saver.flush();
  timers.runAll();

  // Assert
  assert.equal(saved.length, 0);
});
