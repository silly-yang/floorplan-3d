// 設計狀態與復原／取消復原；狀態一律以新物件取代，不就地修改

export const HISTORY_LIMIT = 100;

export function createStore(initial, { limit = HISTORY_LIMIT } = {}) {
  let state = initial;
  let past = [];
  let future = [];
  const listeners = new Set();

  const emit = (source) => listeners.forEach((l) => l(state, { source }));

  return {
    getState: () => state,

    // base：拖曳這類連續操作開始前的狀態；undo 會回到它，而不是最後一次 preview
    commit(next, { base = state } = {}) {
      past = [...past, base].slice(-limit);
      future = [];
      state = next;
      emit('commit');
    },

    preview(next) {
      state = next;
      emit('preview');
    },

    undo() {
      if (past.length === 0) return;
      future = [state, ...future];
      state = past[past.length - 1];
      past = past.slice(0, -1);
      emit('undo');
    },

    redo() {
      if (future.length === 0) return;
      past = [...past, state];
      state = future[0];
      future = future.slice(1);
      emit('redo');
    },

    replace(next) {
      state = next;
      past = [];
      future = [];
      emit('replace');
    },

    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
