// localStorage 多方案儲存；所有讀寫都包 try/catch，錯誤轉成看得懂的例外
import { parseDesign, validateDesign, DesignFormatError } from './schema.js';

export class StorageFullError extends Error {
  constructor(cause) {
    super('瀏覽器儲存空間已滿，這次的變更沒有存到。請先「匯出全部」備份，再刪除用不到的方案。', { cause });
    this.name = 'StorageFullError';
  }
}

export class StorageUnavailableError extends Error {
  constructor(cause) {
    super('瀏覽器不允許這個網頁使用儲存空間（可能是無痕模式或隱私設定），設計無法自動保存，請記得匯出。', { cause });
    this.name = 'StorageUnavailableError';
  }
}

export class DesignNotFoundError extends Error {
  constructor(id) {
    super(`找不到方案（id：${id}）`);
    this.name = 'DesignNotFoundError';
  }
}

// 各瀏覽器表示「容量不足」的方式不一樣
export const isQuotaError = (error) =>
  error?.name === 'QuotaExceededError' || error?.name === 'NS_ERROR_DOM_QUOTA_REACHED' || error?.code === 22 || error?.code === 1014;

export class DesignStore {
  constructor(storage, { prefix = 'fp3d.' } = {}) {
    this.storage = storage;
    this.prefix = prefix;
  }

  #designKey(id) {
    return `${this.prefix}design.${id}`;
  }

  get #indexKey() {
    return `${this.prefix}index`;
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

  // 索引壞掉時掃描所有方案的 key 重建，資料本身還在就不會遺失
  #readIndex() {
    const raw = this.#get(this.#indexKey);
    try {
      const index = JSON.parse(raw);
      if (Array.isArray(index?.ids)) return { ids: index.ids.filter((id) => typeof id === 'string'), activeId: index.activeId ?? null };
    } catch {
      // 落到下面重建
    }
    const prefix = `${this.prefix}design.`;
    const ids = [];
    for (let i = 0; i < this.storage.length; i++) {
      const key = this.storage.key(i);
      if (key?.startsWith(prefix)) ids.push(key.slice(prefix.length));
    }
    return { ids, activeId: null };
  }

  #writeIndex(index) {
    this.#set(this.#indexKey, JSON.stringify({ version: 1, ...index }));
  }

  list() {
    const { ids } = this.#readIndex();
    const designs = [];
    const broken = [];
    for (const id of ids) {
      try {
        const design = this.load(id);
        designs.push({ id, name: design.name, updatedAt: design.updatedAt, floorplanRef: design.floorplanRef });
      } catch (error) {
        if (error instanceof StorageUnavailableError) throw error;
        broken.push({ id, error });
      }
    }
    return { designs, broken };
  }

  load(id) {
    const raw = this.#get(this.#designKey(id));
    if (raw == null) throw new DesignNotFoundError(id);
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new DesignFormatError([`方案 ${id} 的儲存資料損毀，無法解析`]);
    }
    return parseDesign(parsed);
  }

  // 先寫方案再寫索引：方案寫失敗時索引不變，舊版本保持完整
  save(design) {
    const errors = validateDesign(design);
    if (errors.length) throw new DesignFormatError(errors);
    this.#set(this.#designKey(design.id), JSON.stringify(design));
    const index = this.#readIndex();
    if (!index.ids.includes(design.id)) this.#writeIndex({ ...index, ids: [...index.ids, design.id] });
  }

  remove(id) {
    const index = this.#readIndex();
    this.#remove(this.#designKey(id));
    this.#writeIndex({ ids: index.ids.filter((x) => x !== id), activeId: index.activeId === id ? null : index.activeId });
  }

  get activeId() {
    return this.#readIndex().activeId;
  }

  setActive(id) {
    this.#writeIndex({ ...this.#readIndex(), activeId: id });
  }

  // 本程式用掉的儲存量（字元數 × 2 ≈ 位元組）
  usageBytes() {
    let total = 0;
    for (let i = 0; i < this.storage.length; i++) {
      const key = this.storage.key(i);
      if (key?.startsWith(this.prefix)) total += (key.length + (this.#get(key)?.length ?? 0)) * 2;
    }
    return total;
  }
}
