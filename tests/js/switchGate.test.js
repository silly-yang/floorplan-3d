import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSwitchGate } from '../../js/app/switchGate.js';

// 排程先收著，run() 才執行，模擬「這一輪事件處理完才重建」
function setup(current = 'A', rebuild = () => {}) {
  const jobs = [];
  const calls = [];
  const gate = createSwitchGate({
    current,
    rebuild: (key, tasks) => {
      calls.push([key, tasks.length]);
      rebuild(key, tasks);
    },
    schedule: (fn) => jobs.push(fn),
  });
  const run = () => jobs.splice(0).forEach((fn) => fn());
  return { gate, calls, run, jobs };
}

test('同一輪連續要求切換只重建一次，用最後一個目標', () => {
  // Arrange
  const { gate, calls, run } = setup('A');

  // Act
  gate.request('B');
  gate.request('C');
  gate.request('D');
  run();

  // Assert
  assert.deepEqual(calls, [['D', 0]]);
  assert.equal(gate.current, 'D');
});

test('同一輪只排一次重建', () => {
  // Arrange
  const { gate, jobs } = setup('A');

  // Act
  gate.request('B');
  gate.request('C');

  // Assert
  assert.equal(jobs.length, 1);
});

for (const [name, requests] of [
  ['目標就是目前的平面圖', ['A']],
  ['來回切換最後回到原本那張', ['B', 'A']],
  ['預設平面圖（null）切到預設', [null]],
]) {
  test(`不用重建時什麼都不做：${name}`, () => {
    // Arrange
    const start = requests[0] === null ? null : 'A';
    const { gate, calls, run } = setup(start);

    // Act
    requests.forEach((key) => gate.request(key));
    run();

    // Assert
    assert.deepEqual(calls, []);
    assert.equal(gate.current, start);
  });
}

test('重建進行中收到的切換一律忽略，不會重入', () => {
  // Arrange
  let inner = null;
  const { gate, calls, run, jobs } = setup('A', () => {
    inner = gate.request('C');
  });

  // Act
  gate.request('B');
  run();

  // Assert
  assert.equal(inner, false);
  assert.deepEqual(calls, [['B', 0]]);
  assert.equal(jobs.length, 0);
});

test('重建完成後可以再切換', () => {
  // Arrange
  const { gate, calls, run } = setup('A');
  gate.request('B');
  run();

  // Act
  gate.request('A');
  run();

  // Assert
  assert.deepEqual(calls, [['B', 0], ['A', 0]]);
  assert.equal(gate.current, 'A');
});

test('附帶的工作照順序交給重建，目標被後來的要求換掉也不會遺失', () => {
  // Arrange
  const order = [];
  const { gate, run } = setup('A', (key, tasks) => tasks.forEach((t) => t()));

  // Act
  gate.request(null, () => order.push('刪除 A'));
  gate.request('B', () => order.push('其他'));
  run();

  // Assert
  assert.deepEqual(order, ['刪除 A', '其他']);
  assert.equal(gate.current, 'B');
});

test('有附帶工作時即使目標是目前的平面圖也要重建', () => {
  // Arrange
  const { gate, calls, run } = setup('A');

  // Act
  gate.request('A', () => {});
  run();

  // Assert
  assert.deepEqual(calls, [['A', 1]]);
});

test('重建失敗時目前的平面圖不變，之後還能再切換', () => {
  // Arrange
  let fail = true;
  const { gate, calls, run } = setup('A', () => {
    if (fail) throw new Error('壞了');
  });
  gate.request('B');
  assert.throws(() => run(), /壞了/);
  fail = false;

  // Act
  gate.request('C');
  run();

  // Assert
  assert.equal(gate.current, 'C');
  assert.deepEqual(calls, [['B', 0], ['C', 0]]);
});

test('busy 在排程中與重建中為真，完成後為假', () => {
  // Arrange
  let during = null;
  const { gate, run } = setup('A', () => {
    during = gate.busy;
  });

  // Act
  const before = gate.busy;
  gate.request('B');
  const scheduled = gate.busy;
  run();

  // Assert
  assert.deepEqual([before, scheduled, during, gate.busy], [false, true, true, false]);
});

test('附帶的工作只做一次，下一次切換不會再執行', () => {
  // Arrange
  let count = 0;
  const { gate, run } = setup('A', (key, tasks) => tasks.forEach((t) => t()));
  gate.request(null, () => count++);
  run();

  // Act
  gate.request('B');
  run();

  // Assert
  assert.equal(count, 1);
});
