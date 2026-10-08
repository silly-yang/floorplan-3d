// 匯出／匯入 .design.json；不碰 DOM，下載與讀檔由畫面層處理
import { validateFloorplanRecord } from './floorplanStore.js';
import { DesignFormatError, parseDesign, uniqueName } from './schema.js';

export const EXPORT_FORMAT = 'floorplan-3d/designs';
// 第 2 版加上 floorplans（用到的匯入平面圖）與 defaultRefs（屬於預設平面圖的方案 ref）
const EXPORT_VERSION = 2;

export class ImportError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ImportError';
  }
}

export function buildExport(designs, now, { floorplans = [], defaultRefs = [] } = {}) {
  return { format: EXPORT_FORMAT, version: EXPORT_VERSION, exportedAt: now, designs, floorplans, defaultRefs };
}

// 檔名不能有的字元換成底線
const safeName = (name) => name.replace(/[\\/:*?"<>|]/g, '_').trim() || '方案';

export function exportFileName(designs, now) {
  if (designs.length === 1) return `${safeName(designs[0].name)}.design.json`;
  return `全部方案-${now.slice(0, 10).replaceAll('-', '')}.design.json`;
}

function unwrap(data) {
  if (Array.isArray(data)) return data;
  if (data?.format === EXPORT_FORMAT && Array.isArray(data.designs)) return data.designs;
  if (data && typeof data === 'object' && 'schemaVersion' in data) return [data];
  throw new ImportError('檔案內容不是這個工具的設計檔（找不到方案資料）');
}

// 接受三種內容：匯出包、單一設計、設計陣列；回傳 { designs, errors, floorplans, defaultRefs, checksFloorplans }
// 壞掉的方案、平面圖不影響其他的匯入，錯誤逐一列出
// checksFloorplans：檔案有帶平面圖資訊（第 2 版起）才檢查方案的平面圖在不在
export function parseImportText(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ImportError('檔案不是有效的 JSON，可能已損毀或不是 .design.json');
  }
  const designs = [];
  const errors = [];
  unwrap(data).forEach((raw, i) => {
    const label = typeof raw?.name === 'string' && raw.name ? `第 ${i + 1} 個方案「${raw.name}」` : `第 ${i + 1} 個方案`;
    try {
      designs.push(parseDesign(raw));
    } catch (error) {
      if (!(error instanceof DesignFormatError)) throw error;
      errors.push({ label, problems: error.problems });
    }
  });
  const checksFloorplans = data?.format === EXPORT_FORMAT && Array.isArray(data.floorplans);
  const floorplans = [];
  (checksFloorplans ? data.floorplans : []).forEach((record, i) => {
    const problems = validateFloorplanRecord(record);
    if (!problems.length) floorplans.push(record);
    else errors.push({ label: typeof record?.name === 'string' && record.name ? `第 ${i + 1} 張平面圖「${record.name}」` : `第 ${i + 1} 張平面圖`, problems });
  });
  const defaultRefs = checksFloorplans && Array.isArray(data.defaultRefs) ? data.defaultRefs.filter((r) => typeof r === 'string') : [];
  return { designs, errors, floorplans, defaultRefs, checksFloorplans };
}

export function findConflict(design, existing) {
  return existing.find((e) => e.name === design.name) ?? null;
}

// decision：'overwrite' 覆蓋同名方案；'copy' 另存成新名稱；沒衝突時傳 null
export function resolveImport(design, decision, existing, { newId }) {
  const conflict = findConflict(design, existing);
  if (conflict && decision === 'overwrite') return { ...design, id: conflict.id, name: conflict.name };
  if (conflict && decision === 'copy') {
    return { ...design, id: newId(), name: uniqueName(design.name, existing.map((e) => e.name)) };
  }
  // 名稱不同但 id 撞到別的方案：換新 id，避免默默蓋掉
  if (existing.some((e) => e.id === design.id)) return { ...design, id: newId() };
  return design;
}

// 平面圖還原之後呼叫：方案的平面圖不在這台電腦就報錯，不默默放到預設平面圖上
// hasFloorplan(ref)：本機有沒有這張匯入的平面圖；defaultRef：目前預設平面圖的 ref
export function assignFloorplans({ designs, defaultRefs, checksFloorplans }, { hasFloorplan, defaultRef }) {
  if (!checksFloorplans) return { designs, errors: [] };
  const known = (ref) => ref === null || ref === defaultRef || defaultRefs.includes(ref) || hasFloorplan(ref);
  return {
    designs: designs.filter((d) => known(d.floorplanRef)),
    errors: designs
      .filter((d) => !known(d.floorplanRef))
      .map((d) => ({ label: `方案「${d.name}」`, problems: [`用的平面圖（${d.floorplanRef}）不在檔案裡，也不在這個瀏覽器，無法匯入`] })),
  };
}
