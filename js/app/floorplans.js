// 平面圖清單：預設平面圖（data/floorplan.json）加上匯入的平面圖
// 平面圖用 key 識別：預設平面圖是 null，匯入的是它的 ref
// 方案的 floorplanRef 是匯入平面圖的 ref 才屬於它；其餘（含舊版預設的指紋、null）都屬於預設平面圖
import { FloorplanNotFoundError } from '../storage/floorplanStore.js';
import { fingerprint } from '../storage/schema.js';

export const DEFAULT_FLOORPLAN_NAME = '預設平面圖';

// 指紋只看格局（牆、門窗、房間），新增預設廚衛這類變動不算換了平面圖
// 舊方案都存著這個值，算法不能改
export const floorplanRefOf = (floorplan) =>
  fingerprint(JSON.stringify([floorplan.bounds, floorplan.walls, floorplan.openings, floorplan.rooms]));

export function createFloorplanCatalog({ floorplanStore, designStore, defaultFloorplan, defaultRef }) {
  const keyOf = (designRef) => (designRef !== defaultRef && floorplanStore.has(designRef) ? designRef : null);

  const defaultEntry = () => ({ key: null, ref: defaultRef, name: DEFAULT_FLOORPLAN_NAME, isDefault: true, floorplan: defaultFloorplan });

  const open = (key) => {
    if (key === null) return defaultEntry();
    const { ref, name, floorplan } = floorplanStore.load(key);
    return { key: ref, ref, name, isDefault: false, floorplan };
  };

  return {
    keyOf,
    open,

    // 預設平面圖排第一，匯入的依建立時間
    entries() {
      const counts = new Map();
      for (const d of designStore.list().designs) {
        const key = keyOf(d.floorplanRef);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      const imported = floorplanStore.list().floorplans;
      return [
        { key: null, ref: defaultRef, name: DEFAULT_FLOORPLAN_NAME, createdAt: null, isDefault: true, designCount: counts.get(null) ?? 0 },
        ...imported.map((f) => ({ key: f.ref, ref: f.ref, name: f.name, createdAt: f.createdAt, isDefault: false, designCount: counts.get(f.ref) ?? 0 })),
      ];
    },

    // 開頁時用上次的平面圖；找不到或讀不出來就退回預設，並清掉紀錄免得每次都提示
    startup() {
      const current = floorplanStore.currentRef;
      if (current === null) return { entry: defaultEntry(), warning: null };
      try {
        return { entry: open(current), warning: null };
      } catch (error) {
        floorplanStore.setCurrent(null);
        const warning = '找不到上次使用的平面圖，已改開預設平面圖';
        return { entry: defaultEntry(), warning: error instanceof FloorplanNotFoundError ? warning : `${warning}（${error.message}）` };
      }
    },

    setCurrent(key) {
      floorplanStore.setCurrent(key);
    },

    // 內容相同（ref 相同）就沿用既有的那張，不重複存
    add(floorplan, name, now) {
      const ref = floorplanRefOf(floorplan);
      if (ref === defaultRef) return { key: null, existed: true };
      if (floorplanStore.has(ref)) return { key: ref, existed: true };
      floorplanStore.save({ ref, name, createdAt: now, floorplan });
      return { key: ref, existed: false };
    },

    rename(key, name) {
      if (key === null) throw new Error('預設平面圖不能改名');
      floorplanStore.rename(key, name);
    },

    // 連同用它的方案一起刪；回傳刪掉幾個方案
    remove(key) {
      if (key === null) throw new Error('預設平面圖不能刪除');
      const designs = designStore.list().designs.filter((d) => keyOf(d.floorplanRef) === key);
      designs.forEach((d) => designStore.remove(d.id));
      floorplanStore.remove(key);
      return designs.length;
    },

    // 匯出時帶上方案用到的匯入平面圖；預設平面圖不帶內容，只記下這些方案的 ref
    exportBundle(designs) {
      const importedRefs = new Set();
      const defaultRefs = new Set();
      for (const d of designs) {
        const key = keyOf(d.floorplanRef);
        if (key !== null) importedRefs.add(key);
        else if (d.floorplanRef !== null) defaultRefs.add(d.floorplanRef);
      }
      return { floorplans: [...importedRefs].map((ref) => floorplanStore.load(ref)), defaultRefs: [...defaultRefs] };
    },

    // 還原匯入檔裡的平面圖；已存在或就是預設平面圖的略過，回傳新增幾張
    restore(records) {
      let restored = 0;
      for (const record of records) {
        if (record.ref === defaultRef || floorplanStore.has(record.ref)) continue;
        floorplanStore.save(record);
        restored++;
      }
      return restored;
    },

    // 舊資料沒有各平面圖的紀錄，預設平面圖沿用原本的 activeId
    preferredDesign(key) {
      return floorplanStore.activeDesignOf(key) ?? (key === null ? designStore.activeId : null);
    },

    rememberDesign(key, designId) {
      floorplanStore.setActiveDesign(key, designId);
    },
  };
}
