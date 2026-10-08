// 方案管理：哪個方案正在編輯、自動儲存、新增／改名／複製／刪除／切換／匯入
// 方案資訊（id、名稱、建立時間）不放進 store，復原時才不會把名稱一起改回去
import { createAutosaver } from '../storage/autosave.js';
import { createDesign, uniqueName } from '../storage/schema.js';

export const DEFAULT_NAME = '方案 1';
const NAME_PREFIX = '方案';

const contentOf = (design) => ({
  ceilingHeight: design.ceilingHeight,
  ceilingColor: design.ceilingColor,
  rooms: design.rooms,
  doors: design.doors,
  cabinets: design.cabinets,
  ceilings: design.ceilings,
  furniture: design.furniture,
});

// defaultFurniture：新方案預先擺好的家具（建商附的廚衛），每次呼叫要給新的 id
export function createSession({ designStore, store, now, newId, floorplanRef = null, timers = globalThis, onStatus = () => {}, defaultFurniture = () => [] }) {
  let meta = null; // 目前方案除了 store 內容以外的欄位
  const listeners = new Set();
  const emit = () => listeners.forEach((l) => l());

  const compose = () => ({ ...meta, ...contentOf(store.getState()) });

  const autosaver = createAutosaver({
    save: (design) => {
      designStore.save(design);
      meta = { ...meta, updatedAt: design.updatedAt };
    },
    timers,
    now,
    onStatus,
  });

  store.subscribe((_, { source }) => {
    // 拖曳中的 preview 不存，放開（commit）才存；replace 是換方案，不算變更
    if (meta && source !== 'preview' && source !== 'replace') autosaver.schedule(compose());
  });

  const open = (design) => {
    meta = { ...design };
    delete meta.ceilingHeight;
    delete meta.ceilingColor;
    delete meta.doors;
    delete meta.cabinets;
    delete meta.ceilings;
    delete meta.rooms;
    delete meta.furniture;
    designStore.setActive(design.id);
    store.replace(contentOf(design));
    emit();
  };

  const names = () => designStore.list().designs.map((d) => d.name);

  const createAndOpen = (name) => {
    const design = { ...createDesign({ id: newId(), name, now: now(), floorplanRef }), furniture: defaultFurniture() };
    designStore.save(design);
    open(design);
    return design;
  };

  const nextDefaultName = () => {
    const taken = new Set(names());
    for (let n = 1; ; n++) if (!taken.has(`${NAME_PREFIX} ${n}`)) return `${NAME_PREFIX} ${n}`;
  };

  const session = {
    // 回傳 { warnings }：損毀的方案、找不到的方案都只警告，不讓頁面壞掉
    init() {
      const warnings = [];
      const { designs, broken } = designStore.list();
      for (const b of broken) warnings.push(`方案資料損毀，已略過（${b.id}）：${b.error.message}`);
      const preferred = designStore.activeId;
      const candidates = [preferred, ...designs.map((d) => d.id)].filter((id, i, all) => id && all.indexOf(id) === i);
      for (const id of candidates) {
        try {
          open(designStore.load(id));
          return { warnings };
        } catch (error) {
          if (id === preferred && !broken.some((b) => b.id === id)) warnings.push(`上次開啟的方案無法讀取：${error.message}`);
        }
      }
      createAndOpen(nextDefaultName());
      return { warnings };
    },

    get current() {
      return meta && compose();
    },

    list() {
      return designStore.list().designs;
    },

    load(id) {
      return designStore.load(id);
    },

    // 切換、關頁前呼叫；回傳是否成功
    flush() {
      return autosaver.flush();
    },

    switchTo(id) {
      if (id === meta?.id) return;
      autosaver.flush();
      open(designStore.load(id));
    },

    createNew(name) {
      autosaver.flush();
      return createAndOpen(name ? uniqueName(name, names()) : nextDefaultName());
    },

    rename(name) {
      const trimmed = (name ?? '').trim();
      if (!trimmed) throw new Error('方案名稱不能空白');
      if (names().some((n) => n === trimmed && n !== meta.name)) throw new Error(`已經有名為「${trimmed}」的方案`);
      autosaver.flush();
      meta = { ...meta, name: trimmed, updatedAt: now() };
      designStore.save(compose());
      emit();
    },

    duplicate() {
      autosaver.flush();
      const copy = { ...compose(), id: newId(), name: uniqueName(`${meta.name} 複本`, names()), createdAt: now(), updatedAt: now() };
      designStore.save(copy);
      open(copy);
    },

    remove(id) {
      const removingCurrent = id === meta?.id;
      if (!removingCurrent) autosaver.flush();
      designStore.remove(id);
      if (removingCurrent) {
        autosaver.cancel(); // 待存的內容是刪掉的方案，存下去會把它寫回來
        meta = null;
        const next = designStore.list().designs[0];
        if (next) open(designStore.load(next.id));
        else createAndOpen(nextDefaultName());
      }
      emit();
    },

    // design 已經過驗證與衝突處理；覆蓋到目前開著的方案時畫面一起更新
    importDesign(design) {
      autosaver.flush();
      designStore.save(design);
      if (design.id === meta?.id) open(design);
      else emit();
    },

    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return session;
}
