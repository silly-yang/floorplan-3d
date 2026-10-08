// 自動儲存：變更後等 delay 毫秒沒有新變更才存，狀態透過 onStatus 回報給畫面

export const AUTOSAVE_DELAY = 1000;

export function createAutosaver({ save, delay = AUTOSAVE_DELAY, timers = globalThis, now = () => new Date().toISOString(), onStatus = () => {} }) {
  let pending = null;
  let timer = null;

  const run = () => {
    timer = null;
    if (!pending) return true;
    const design = { ...pending, updatedAt: now() };
    pending = null;
    onStatus({ state: 'saving' });
    try {
      save(design);
    } catch (error) {
      onStatus({ state: 'error', error });
      return false;
    }
    onStatus({ state: 'saved', at: design.updatedAt });
    return true;
  };

  return {
    schedule(design) {
      pending = design;
      if (timer !== null) timers.clearTimeout(timer);
      timer = timers.setTimeout(run, delay);
      onStatus({ state: 'pending' });
    },

    cancel() {
      pending = null;
    },

    // 切換方案、關閉頁面前呼叫，確保最後的變更有存到
    flush() {
      if (timer !== null) timers.clearTimeout(timer);
      return run();
    },
  };
}
