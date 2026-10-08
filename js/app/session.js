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
  // 選填：舊方案沒有這個欄位就不帶，讀的地方一律當空陣列
  ...(design.pegboards ? { pegboards: design.pegboards } : {}),
});

// defaultFurniture：新方案預先擺好的家具（建商附的廚衛），每次呼叫要給新的 id
// ownsRef：方案的 floorplanRef 是否屬於目前的平面圖；清單、預設名稱、刪除後改開的方案都只看這些
// preferredId：開頁時優先開的方案，沒給就用上次開的
export function createSession({
  designStore,
  store,
  now,
  newId,
  floorplanRef = null,
  ownsRef = () => true,
  preferredId = null,
  timers = globalThis,
  onStatus = () => {},
  defaultFurniture = () => [],
}) {
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
    delete meta.pegboards;
    delete meta.ceilings;
    delete meta.rooms;
    delete meta.furniture;
    designStore.setActive(design.id);
    store.replace(contentOf(design));
    emit();
  };

  const ownDesigns = (designs) => designs.filter((d) => ownsRef(d.floorplanRef));
  const names = () => ownDesigns(designStore.list().designs).map((d) => d.name);

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
      const listed = designStore.list();
      const designs = ownDesigns(listed.designs);
      const broken = listed.broken;
      for (const b of broken) warnings.push(`方案資料損毀，已略過（${b.id}）：${b.error.message}`);
      // 上次開的方案屬於別張平面圖時不開
      const wanted = preferredId ?? designStore.activeId;
      const preferred = listed.designs.some((d) => d.id === wanted && !ownsRef(d.floorplanRef)) ? null : wanted;
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
      return ownDesigns(designStore.list().designs);
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

    // 目前方案的內容換回新方案的預設（建商附的廚衛、插座），名稱與 id 不變；可以復原
    reset() {
      const fresh = { ...createDesign({ id: meta.id, name: meta.name, now: now(), floorplanRef }), furniture: defaultFurniture() };
      store.commit(contentOf(fresh));
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
        const next = ownDesigns(designStore.list().designs)[0];
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
