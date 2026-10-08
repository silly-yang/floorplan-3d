// 換平面圖的排程：重建場景是又重又同步的工作，連點時不能一次接一次重建
// - 同一輪事件裡的多次要求合併成一次，用最後一個目標；目標就是目前的平面圖時不重建
// - 重建中收到的要求一律忽略，避免重入
// tasks：要在舊場景拆掉後、新場景建立前做的事（例如刪掉使用中的平面圖），照要求順序執行
export function createSwitchGate({ current, rebuild, schedule }) {
  let target;
  let tasks = [];
  let scheduled = false;
  let running = false;

  const run = () => {
    scheduled = false;
    const key = target;
    const pending = tasks;
    tasks = [];
    if (key === current && !pending.length) return;
    running = true;
    try {
      rebuild(key, pending);
      current = key;
    } finally {
      running = false;
    }
  };

  return {
    // 回傳是否收下這次要求
    request(key, task) {
      if (running) return false;
      target = key;
      if (task) tasks.push(task);
      if (!scheduled) {
        scheduled = true;
        schedule(run);
      }
      return true;
    },

    get current() {
      return current;
    },

    get busy() {
      return scheduled || running;
    },
  };
}
