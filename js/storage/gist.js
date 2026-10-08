// GitHub 私密 Gist 雲端同步：所有方案放在同一個私密 Gist，一個方案一個檔案
import { DesignFormatError, parseDesign } from './schema.js';

export const GIST_DESCRIPTION = 'floorplan-3d 設計方案（由網頁自動建立，請勿手動改名）';
export const FILE_SUFFIX = '.design.json';
const PAGE_SIZE = 100;
const MAX_PAGES = 10;

export class GistError extends Error {
  constructor(kind, message, cause) {
    super(message, { cause });
    this.name = 'GistError';
    this.kind = kind; // auth | permission | network | not-found | http
  }
}

export class GistClient {
  constructor({ token, fetch: fetchImpl = globalThis.fetch?.bind(globalThis), api = 'https://api.github.com' }) {
    this.token = (token ?? '').trim();
    this.fetch = fetchImpl;
    this.api = api;
    this.gistId = undefined; // undefined＝還沒查過；null＝查過但沒有
  }

  // Token 只放在標頭；網址與錯誤訊息都不會帶到它
  async #request(path, { method = 'GET', body } = {}) {
    if (!this.token) throw new GistError('auth', '尚未設定 GitHub Token');
    const url = path.startsWith('http') ? path : `${this.api}${path}`;
    let response;
    try {
      response = await this.fetch(url, {
        method,
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${this.token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (error) {
      throw new GistError('network', '連不上 GitHub，請確認網路連線後再試一次', error);
    }
    if (response.status === 401) throw new GistError('auth', 'GitHub Token 無效或已過期，請到「雲端」頁重新設定');
    if (response.status === 403) throw new GistError('permission', 'Token 沒有 Gist 讀寫權限，請建立具有 Gists：Read and write 權限的 Token');
    if (response.status === 404) throw new GistError('not-found', '雲端找不到這筆資料');
    if (!response.ok) throw new GistError('http', `GitHub 回應錯誤（HTTP ${response.status}）`);
    return response.json();
  }

  async #findGistId() {
    if (this.gistId !== undefined) return this.gistId;
    for (let page = 1; page <= MAX_PAGES; page++) {
      const gists = await this.#request(`/gists?per_page=${PAGE_SIZE}&page=${page}`);
      const found = gists.find((g) => g.description === GIST_DESCRIPTION);
      if (found) return (this.gistId = found.id);
      if (gists.length < PAGE_SIZE) break;
    }
    return (this.gistId = null);
  }

  async #files() {
    const id = await this.#findGistId();
    if (!id) return {};
    const gist = await this.#request(`/gists/${id}`);
    return Object.fromEntries(Object.entries(gist.files ?? {}).filter(([name]) => name.endsWith(FILE_SUFFIX)));
  }

  // 超過 1 MB 的檔案 API 只給部分內容，要改讀 raw_url
  async #content(file) {
    if (!file.truncated) return file.content;
    return JSON.stringify(await this.#request(file.raw_url));
  }

  async #parse(name, file) {
    let raw;
    try {
      raw = JSON.parse(await this.#content(file));
    } catch (error) {
      if (error instanceof GistError) throw error;
      throw new DesignFormatError([`${name} 不是有效的 JSON`]);
    }
    return parseDesign(raw);
  }

  async listRemote() {
    const designs = [];
    const broken = [];
    for (const [name, file] of Object.entries(await this.#files())) {
      try {
        const design = await this.#parse(name, file);
        designs.push({ id: design.id, name: design.name, updatedAt: design.updatedAt });
      } catch (error) {
        if (!(error instanceof DesignFormatError)) throw error;
        broken.push({ file: name, problems: error.problems });
      }
    }
    return { designs, broken };
  }

  async download(id) {
    const name = `${id}${FILE_SUFFIX}`;
    const file = (await this.#files())[name];
    if (!file) throw new GistError('not-found', '雲端沒有這個方案，可能已在其他裝置刪除');
    return this.#parse(name, file);
  }

  async upload(design) {
    const files = { [`${design.id}${FILE_SUFFIX}`]: { content: JSON.stringify(design, null, 2) } };
    const id = await this.#findGistId();
    if (id) {
      await this.#request(`/gists/${id}`, { method: 'PATCH', body: { files } });
      return;
    }
    const created = await this.#request('/gists', { method: 'POST', body: { description: GIST_DESCRIPTION, public: false, files } });
    this.gistId = created.id;
  }
}

// 以修改時間判斷哪一版比較新
export function compareVersions(local, remote) {
  const a = Date.parse(local.updatedAt);
  const b = Date.parse(remote.updatedAt);
  if (a === b) return 'same';
  return a > b ? 'local-newer' : 'remote-newer';
}
