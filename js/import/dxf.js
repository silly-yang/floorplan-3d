// DXF（ASCII）最小解析器：只取用得到的圖元、圖塊與 HEADER 變數，不依賴第三方套件
import { DxfFormatError } from './errors.js';

export class Entity {
  constructor(type, layer, codes) {
    this.type = type;
    this.layer = layer;
    this.codes = codes; // [[群組碼, 字串值], ...]
  }

  // 取第一個指定群組碼的值；不存在回 null
  first(code) {
    const hit = this.codes.find(([c]) => c === code);
    return hit ? hit[1] : null;
  }

  // 取所有指定群組碼的值（LWPOLYLINE 的頂點會重複出現）
  all(code) {
    return this.codes.filter(([c]) => c === code).map(([, v]) => v);
  }

  // 取第一個指定群組碼並轉成數字；不存在回 fallback
  num(code, fallback = 0) {
    const value = this.first(code);
    return value === null ? fallback : toNumber(value);
  }
}

// 空字串或非數字視為格式錯誤，不默默變成 0 或 NaN
export function toNumber(value) {
  const n = Number(value);
  if (value.trim() === '' || Number.isNaN(n)) throw new DxfFormatError(`無法把 ${JSON.stringify(value)} 當成數字`);
  return n;
}

// 與 Python str.splitlines() 相同的斷行字元
const LINE_BREAK = /\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/;

function pairs(text) {
  const lines = text.split(LINE_BREAK);
  if (lines.at(-1) === '') lines.pop(); // 結尾的換行不算一行
  const result = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = lines[i].trim();
    if (!/^-?\d+$/.test(code)) {
      throw new DxfFormatError(`第 ${i + 1} 行應為群組碼數字，收到 ${JSON.stringify(code)}；找不到可解析的 ENTITIES`);
    }
    result.push([Number(code), lines[i + 1].trim()]);
  }
  return result;
}

class Reader {
  entities = [];
  blocks = new Map();
  header = new Map(); // 變數名稱（含 $）→ [[群組碼, 值], ...]
  section = null;
  blockName = null; // '' 代表剛進 BLOCK、還沒讀到名稱
  headerVar = null;
  currentType = null;
  currentCodes = [];

  flush() {
    if (this.currentType === null) return;
    const layer = this.currentCodes.find(([c]) => c === 8)?.[1] ?? '';
    const entity = new Entity(this.currentType, layer, this.currentCodes);
    if (this.section === 'ENTITIES') this.entities.push(entity);
    else if (this.section === 'BLOCKS' && this.blockName) this.blocks.get(this.blockName).push(entity);
    this.currentType = null;
    this.currentCodes = [];
  }

  start(value) {
    this.flush();
    if (this.section === 'BLOCKS' && value === 'BLOCK') {
      this.blockName = '';
      return;
    }
    if (this.section === 'BLOCKS' && value === 'ENDBLK') {
      this.blockName = null;
      return;
    }
    this.currentType = value;
  }

  feed(code, value) {
    // BLOCK 標頭的群組碼 2 是圖塊名稱，不是圖元內容
    if (this.blockName === '' && this.currentType === null) {
      if (code === 2) {
        this.blockName = value;
        if (!this.blocks.has(value)) this.blocks.set(value, []);
      }
      return;
    }
    if (this.currentType !== null) this.currentCodes.push([code, value]);
  }

  // HEADER 以群組碼 9 開頭一個變數，後面跟著它的值
  feedHeader(code, value) {
    if (code === 9) {
      this.headerVar = value;
      if (!this.header.has(value)) this.header.set(value, []);
      return;
    }
    if (this.headerVar !== null) this.header.get(this.headerVar).push([code, value]);
  }
}

export function parseDxf(text) {
  const reader = new Reader();
  let expectingSectionName = false;
  let seenEntities = false;
  for (const [code, value] of pairs(text)) {
    if (expectingSectionName) {
      expectingSectionName = false;
      reader.section = value;
      seenEntities ||= value === 'ENTITIES';
      continue;
    }
    if (code === 0 && value === 'SECTION') {
      expectingSectionName = true;
      continue;
    }
    if (code === 0 && value === 'ENDSEC') {
      reader.flush();
      reader.section = null;
      reader.blockName = null;
      reader.headerVar = null;
      continue;
    }
    if (reader.section === 'HEADER') {
      reader.feedHeader(code, value);
      continue;
    }
    if (reader.section !== 'ENTITIES' && reader.section !== 'BLOCKS') continue;
    if (code === 0) {
      reader.start(value);
      continue;
    }
    reader.feed(code, value);
  }
  if (!seenEntities) throw new DxfFormatError('找不到 ENTITIES 區段，這不是有效的 DXF 文字檔');
  return { entities: reader.entities, blocks: reader.blocks, header: reader.header };
}

// $INSUNITS 代碼 → 換算成公尺的倍率；其他代碼（含 0 未指定）交給使用者確認
const INSUNITS_SCALE = { 4: 0.001, 5: 0.01, 6: 1 };

export function detectUnitScale(doc) {
  const value = doc.header.get('$INSUNITS')?.find(([c]) => c === 70)?.[1];
  return INSUNITS_SCALE[value] ?? null;
}
