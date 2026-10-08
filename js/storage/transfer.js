// 匯出／匯入 .design.json；不碰 DOM，下載與讀檔由畫面層處理
import { DesignFormatError, parseDesign, uniqueName } from './schema.js';

export const EXPORT_FORMAT = 'floorplan-3d/designs';
const EXPORT_VERSION = 1;

export class ImportError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ImportError';
  }
}

export function buildExport(designs, now) {
  return { format: EXPORT_FORMAT, version: EXPORT_VERSION, exportedAt: now, designs };
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

// 接受三種內容：匯出包、單一設計、設計陣列；回傳 { designs, errors }
// 壞掉的方案不影響其他方案匯入，錯誤逐一列出
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
  return { designs, errors };
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
