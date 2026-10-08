// 設計檔格式：版本、建立、遷移、驗證；不依賴瀏覽器 API，可在 node 測試
import { DOOR_TYPES } from '../core/doors.js';
import { getCatalogItem, SIZE_LIMITS } from '../furniture/catalog.js';

export const SCHEMA_VERSION = 3;
export const DEFAULT_CEILING = 2.8;
export const DEFAULT_CEILING_COLOR = '#f4f2ee';
export const CEILING_LIMITS = { min: 2, max: 5 };
const NAME_MAX = 60;

export class DesignFormatError extends Error {
  constructor(problems) {
    super(`設計檔格式錯誤：\n${problems.map((p) => `・${p}`).join('\n')}`);
    this.name = 'DesignFormatError';
    this.problems = problems;
  }
}

// 版本 n → n+1 的轉換；格式改版時在這裡加一筆，舊檔就能一路升到最新版
export const MIGRATIONS = {
  // 第 2 版加入天花板顏色
  1: (d) => ({ ...d, schemaVersion: 2, ceilingColor: DEFAULT_CEILING_COLOR }),
  // 第 3 版加入門設定；空物件＝每個開口都用預設門型
  2: (d) => ({ ...d, schemaVersion: 3, doors: {} }),
};

export function createDesign({ id, name, now, floorplanRef = null }) {
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    name,
    createdAt: now,
    updatedAt: now,
    floorplanRef,
    ceilingHeight: DEFAULT_CEILING,
    ceilingColor: DEFAULT_CEILING_COLOR,
    rooms: {},
    doors: {},
    furniture: [],
  };
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isColor = (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
const isDate = (v) => typeof v === 'string' && !Number.isNaN(Date.parse(v));
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

const DOOR_TYPE_IDS = new Set(DOOR_TYPES.map((t) => t.id));

function validateDoors(doors, errors) {
  if (!isPlainObject(doors)) {
    errors.push('doors 必須是物件');
    return;
  }
  for (const [id, door] of Object.entries(doors)) {
    if (!DOOR_TYPE_IDS.has(door?.type)) errors.push(`doors.${id}.type 必須是 ${[...DOOR_TYPE_IDS].join('／')}`);
    for (const key of ['open', 'flip', 'out']) {
      if (typeof door?.[key] !== 'boolean') errors.push(`doors.${id}.${key} 必須是 true 或 false`);
    }
  }
}

function validateFurniture(list, errors) {
  if (!Array.isArray(list)) {
    errors.push('furniture 必須是陣列');
    return;
  }
  const seen = new Set();
  list.forEach((f, i) => {
    const at = `furniture[${i}]`;
    if (!isPlainObject(f)) {
      errors.push(`${at} 必須是物件`);
      return;
    }
    if (typeof f.id !== 'string' || !f.id) errors.push(`${at}.id 必須是非空字串`);
    else if (seen.has(f.id)) errors.push(`${at}.id 與前面的家具重複（${f.id}）`);
    seen.add(f.id);
    if (!getCatalogItem(f.type)) errors.push(`${at}.type 是未知的家具類型（${f.type}）`);
    for (const key of ['x', 'y', 'rotation']) {
      if (!isNum(f[key])) errors.push(`${at}.${key} 必須是數字`);
    }
    if (!isPlainObject(f.size)) {
      errors.push(`${at}.size 必須是 { w, d, h } 物件`);
    } else {
      for (const key of ['w', 'd', 'h']) {
        const v = f.size[key];
        if (!isNum(v) || v < SIZE_LIMITS.min || v > SIZE_LIMITS.max) {
          errors.push(`${at}.size.${key} 必須是 ${SIZE_LIMITS.min}～${SIZE_LIMITS.max} 的數字（公分）`);
        }
      }
    }
    if (!isColor(f.color)) errors.push(`${at}.color 必須是 #rrggbb 色碼`);
  });
}

export function validateDesign(design) {
  if (!isPlainObject(design)) return ['設計檔內容必須是 JSON 物件'];
  const errors = [];
  if (design.schemaVersion !== SCHEMA_VERSION) errors.push(`schemaVersion 必須是 ${SCHEMA_VERSION}`);
  if (typeof design.id !== 'string' || !design.id) errors.push('id 必須是非空字串');
  if (typeof design.name !== 'string' || !design.name.trim() || design.name.length > NAME_MAX) {
    errors.push(`name 必須是 1～${NAME_MAX} 字的方案名稱`);
  }
  for (const key of ['createdAt', 'updatedAt']) {
    if (!isDate(design[key])) errors.push(`${key} 必須是 ISO 日期時間字串`);
  }
  if (design.floorplanRef !== null && typeof design.floorplanRef !== 'string') errors.push('floorplanRef 必須是字串或 null');
  if (!isNum(design.ceilingHeight) || design.ceilingHeight < CEILING_LIMITS.min || design.ceilingHeight > CEILING_LIMITS.max) {
    errors.push(`ceilingHeight 必須是 ${CEILING_LIMITS.min}～${CEILING_LIMITS.max} 公尺`);
  }
  if (!isColor(design.ceilingColor)) errors.push('ceilingColor 必須是 #rrggbb 色碼');
  if (!isPlainObject(design.rooms)) {
    errors.push('rooms 必須是物件');
  } else {
    for (const [roomId, setting] of Object.entries(design.rooms)) {
      if (!isColor(setting?.floorColor)) errors.push(`rooms.${roomId}.floorColor 必須是 #rrggbb 色碼`);
    }
  }
  validateDoors(design.doors, errors);
  validateFurniture(design.furniture, errors);
  return errors;
}

export function migrateDesign(raw, { migrations = MIGRATIONS, current = SCHEMA_VERSION } = {}) {
  if (!isPlainObject(raw)) throw new DesignFormatError(['設計檔內容必須是 JSON 物件']);
  const from = raw.schemaVersion;
  if (!Number.isInteger(from) || from < 1) throw new DesignFormatError(['缺少 schemaVersion 或不是正整數']);
  if (from > current) {
    throw new DesignFormatError([`這個檔案來自較新版本（第 ${from} 版），目前程式只支援到第 ${current} 版，請先更新網頁`]);
  }
  let design = structuredClone(raw);
  for (let v = from; v < current; v++) {
    const step = migrations[v];
    if (!step) throw new DesignFormatError([`缺少第 ${v} 版升級到第 ${v + 1} 版的轉換`]);
    design = step(design);
  }
  return design;
}

// 讀檔的唯一入口：遷移 → 驗證；有錯就丟 DesignFormatError，不回傳半壞的資料
export function parseDesign(raw) {
  const design = migrateDesign(raw);
  const errors = validateDesign(design);
  if (errors.length) throw new DesignFormatError(errors);
  return design;
}

// 「方案 1」已存在時回傳「方案 1 (2)」，依此類推
export function uniqueName(name, existingNames) {
  const taken = new Set(existingNames);
  if (!taken.has(name)) return name;
  for (let n = 2; ; n++) {
    const candidate = `${name} (${n})`;
    if (!taken.has(candidate)) return candidate;
  }
}

// 平面圖內容的指紋（FNV-1a 32 位元）；換了平面圖時用來提醒舊設計可能對不上
export function fingerprint(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
