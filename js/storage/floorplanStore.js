// 匯入的平面圖存在 localStorage：每張一個 key（fp3d.floorplan.<ref>），另一個 key 記目前用哪張、各張最後開的方案
// 預設平面圖（data/floorplan.json）不存在這裡，ref 一律用 null 表示
import { validateFloorplan } from '../core/floorplan.js';
import { isQuotaError, StorageFullError, StorageUnavailableError } from './localStore.js';

const NAME_MAX = 40;
const DEFAULT_SLOT = ''; // 狀態裡預設平面圖的位置；匯入的 ref 是十六進位指紋，不會是空字串

export class FloorplanFormatError extends Error {
  constructor(problems) {
    super(`平面圖格式錯誤：\n${problems.map((p) => `・${p}`).join('\n')}`);
    this.name = 'FloorplanFormatError';
    this.problems = problems;
  }
}

export class FloorplanNotFoundError extends Error {
  constructor(ref) {
    super(`找不到平面圖（${ref}）`);
    this.name = 'FloorplanNotFoundError';
  }
}

const validName = (name) => typeof name === 'string' && name.trim().length > 0 && name.trim().length <= NAME_MAX;

export function validateFloorplanRecord(record) {
  if (!record || typeof record !== 'object') return ['平面圖紀錄必須是物件'];
  const problems = [];
  if (typeof record.ref !== 'string' || !record.ref) problems.push('ref 必須是非空字串');
  if (!validName(record.name)) problems.push(`name 必須是 1～${NAME_MAX} 字的平面圖名稱`);
  if (typeof record.createdAt !== 'string' || Number.isNaN(Date.parse(record.createdAt))) problems.push('createdAt 必須是 ISO 日期時間字串');
  // validateFloorplan 遇到不是陣列的 walls 等欄位會直接丟例外，先擋掉
  const notArrays = ['walls', 'openings', 'rooms'].filter((key) => !Array.isArray(record.floorplan?.[key]));
  const floorplanProblems = notArrays.length ? notArrays.map((key) => `${key} 必須是陣列`) : validateFloorplan(record.floorplan);
  problems.push(...floorplanProblems.map((p) => `floorplan：${p}`));
  return problems;
}

export class FloorplanStore {
  constructor(storage, { prefix = 'fp3d.' } = {}) {
    this.storage = storage;
    this.prefix = prefix;
  }

  get #recordPrefix() {
    return `${this.prefix}floorplan.`;
  }

  get #stateKey() {
    return `${this.prefix}floorplanState`;
  }

  #get(key) {
    try {
      return this.storage.getItem(key);
    } catch (error) {
      throw new StorageUnavailableError(error);
    }
  }

  #set(key, value) {
    try {
      this.storage.setItem(key, value);
    } catch (error) {
      if (isQuotaError(error)) throw new StorageFullError(error);
      throw new StorageUnavailableError(error);
    }
  }

  #remove(key) {
    try {
      this.storage.removeItem(key);
    } catch (error) {
      throw new StorageUnavailableError(error);
    }
  }

  // 壞掉的狀態當成沒有紀錄：最壞只是開回預設平面圖
  #readState() {
    try {
      const state = JSON.parse(this.#get(this.#stateKey));
      return { current: typeof state?.current === 'string' ? state.current : null, active: { ...state?.active } };
    } catch (error) {
      if (error instanceof StorageUnavailableError) throw error;
      return { current: null, active: {} };
    }
  }

  #writeState(state) {
    this.#set(this.#stateKey, JSON.stringify({ version: 1, ...state }));
  }

  save(record) {
    const problems = validateFloorplanRecord(record);
    if (problems.length) throw new FloorplanFormatError(problems);
    this.#set(this.#recordPrefix + record.ref, JSON.stringify({ ...record, name: record.name.trim() }));
  }

  load(ref) {
    const raw = this.#get(this.#recordPrefix + ref);
    if (raw == null) throw new FloorplanNotFoundError(ref);
    let record;
    try {
      record = JSON.parse(raw);
    } catch {
      throw new FloorplanFormatError([`平面圖 ${ref} 的儲存資料損毀，無法解析`]);
    }
    const problems = validateFloorplanRecord(record);
    if (problems.length) throw new FloorplanFormatError(problems);
    return record;
  }

  has(ref) {
    return typeof ref === 'string' && this.#get(this.#recordPrefix + ref) != null;
  }

  list() {
    const refs = [];
    for (let i = 0; i < this.storage.length; i++) {
      const key = this.storage.key(i);
      if (key?.startsWith(this.#recordPrefix)) refs.push(key.slice(this.#recordPrefix.length));
    }
    const floorplans = [];
    const broken = [];
    for (const ref of refs) {
      try {
        const { name, createdAt } = this.load(ref);
        floorplans.push({ ref, name, createdAt });
      } catch (error) {
        if (error instanceof StorageUnavailableError) throw error;
        broken.push({ ref, error });
      }
    }
    floorplans.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
    return { floorplans, broken };
  }

  rename(ref, name) {
    if (!validName(name)) throw new FloorplanFormatError([`平面圖名稱必須是 1～${NAME_MAX} 字`]);
    this.save({ ...this.load(ref), name: name.trim() });
  }

  remove(ref) {
    this.#remove(this.#recordPrefix + ref);
    const state = this.#readState();
    const active = { ...state.active };
    delete active[ref];
    this.#writeState({ current: state.current === ref ? null : state.current, active });
  }

  get currentRef() {
    return this.#readState().current;
  }

  setCurrent(ref) {
    this.#writeState({ ...this.#readState(), current: ref ?? null });
  }

  activeDesignOf(ref) {
    return this.#readState().active[ref ?? DEFAULT_SLOT] ?? null;
  }

  setActiveDesign(ref, designId) {
    const state = this.#readState();
    this.#writeState({ ...state, active: { ...state.active, [ref ?? DEFAULT_SLOT]: designId } });
  }
}
