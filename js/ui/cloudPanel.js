// 「雲端」分頁：GitHub Token 設定、上傳／下載方案、版本衝突時讓使用者選
import { compareVersions, GistClient, GistError } from '../storage/gist.js';
import { findConflict, resolveImport } from '../storage/transfer.js';
import { $, chooseDialog, confirmDialog, el, toast } from './dom.js';

// Token 只存在這個瀏覽器；key 與方案資料分開，清除 Token 不會動到方案
const TOKEN_KEY = 'fp3d-gist-token';

function readToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}

function writeToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
    return true;
  } catch {
    return false;
  }
}

const dateTimeOf = (iso) => new Date(iso).toLocaleString('zh-TW', { dateStyle: 'short', timeStyle: 'short', hour12: false });

export function setupCloudPanel({ session }) {
  const panel = $('#cloud-panel');
  let client = null;
  let remote = null; // 最近一次的雲端清單
  let busy = false;

  const getClient = () => {
    const token = readToken();
    if (!token) throw new GistError('auth', '請先在下方貼上 GitHub Token');
    if (!client || client.token !== token) client = new GistClient({ token });
    return client;
  };

  const run = async (label, task) => {
    if (busy) return;
    busy = true;
    render(label);
    try {
      await task();
    } catch (error) {
      toast(error instanceof GistError ? error.message : `雲端操作失敗：${error.message}`, { error: true, duration: 6000 });
    } finally {
      busy = false;
      render();
    }
  };

  const refresh = () =>
    run('讀取雲端清單中…', async () => {
      remote = await getClient().listRemote();
      if (remote.broken.length) toast(`雲端有 ${remote.broken.length} 個檔案格式錯誤，已略過`, { error: true });
    });

  // 雲端較新時詢問，避免把別台裝置的修改蓋掉
  const uploadDesign = async (design, gist) => {
    const listing = remote ?? (remote = await gist.listRemote());
    const cloud = listing.designs.find((d) => d.id === design.id);
    if (cloud && compareVersions(design, cloud) === 'remote-newer') {
      const choice = await chooseDialog(
        '雲端版本比較新',
        `「${design.name}」在雲端的版本（${dateTimeOf(cloud.updatedAt)}）比這台裝置的（${dateTimeOf(design.updatedAt)}）新。要用這台裝置的版本覆蓋雲端嗎？`,
        [{ label: '用這台的覆蓋雲端', value: 'local', class: 'danger' }],
      );
      if (choice !== 'local') return false;
    }
    await gist.upload(design);
    return true;
  };

  const uploadCurrent = () =>
    run('上傳中…', async () => {
      session.flush();
      const gist = getClient();
      if (await uploadDesign(session.current, gist)) toast(`已上傳「${session.current.name}」`);
      remote = await gist.listRemote();
    });

  const uploadAll = () =>
    run('上傳全部方案中…', async () => {
      session.flush();
      const gist = getClient();
      let count = 0;
      for (const { id } of session.list()) {
        const design = id === session.current.id ? session.current : session.load(id);
        if (await uploadDesign(design, gist)) count++;
      }
      remote = await gist.listRemote();
      toast(`已上傳 ${count} 個方案`);
    });

  const download = (id) =>
    run('下載中…', async () => {
      session.flush();
      const cloud = await getClient().download(id);
      const existing = session.list();
      const sameId = existing.find((d) => d.id === cloud.id);
      if (sameId) {
        const local = sameId.id === session.current.id ? session.current : session.load(sameId.id);
        const order = compareVersions(local, cloud);
        if (order === 'same') {
          toast('這台裝置已經是最新版本');
          return;
        }
        const message =
          order === 'local-newer'
            ? `這台裝置的「${local.name}」（${dateTimeOf(local.updatedAt)}）比雲端（${dateTimeOf(cloud.updatedAt)}）新，要用雲端版本覆蓋嗎？`
            : `要用雲端的「${cloud.name}」（${dateTimeOf(cloud.updatedAt)}）更新這台裝置的版本（${dateTimeOf(local.updatedAt)}）嗎？`;
        const choice = await chooseDialog('選擇要保留的版本', message, [
          { label: '保留這台的', value: 'local' },
          { label: '改用雲端的', value: 'cloud', class: order === 'local-newer' ? 'danger' : 'primary' },
        ]);
        if (choice !== 'cloud') return;
        session.importDesign(cloud);
      } else {
        const conflict = findConflict(cloud, existing);
        let decision = null;
        if (conflict) {
          decision = await chooseDialog('方案名稱重複', `這台裝置已經有名為「${cloud.name}」的方案。`, [
            { label: '覆蓋這台的', value: 'overwrite', class: 'danger' },
            { label: '另存成新方案', value: 'copy', class: 'primary' },
          ]);
          if (!decision) return;
        }
        session.importDesign(resolveImport(cloud, decision, existing, { newId: () => crypto.randomUUID() }));
      }
      toast(`已下載「${cloud.name}」`);
    });

  const render = (busyLabel = '') => {
    const hasToken = Boolean(readToken());
    const tokenInput = el('input', { type: 'password', placeholder: 'github_pat_…', autocomplete: 'off', spellcheck: 'false' });
    const localIds = new Set(session.list().map((d) => d.id));
    // replaceChildren 會把 null 印成文字，條件式內容要先濾掉
    const parts = [
      el('p', { class: 'note' }, '把方案存到你自己 GitHub 帳號下的「私密 Gist」，換電腦或手機也能下載。Token 的建立方式見專案 README。'),
      el('h2', { class: 'panel-title' }, 'GitHub Token'),
      hasToken
        ? el('div', { class: 'stack' },
            el('p', { class: 'note' }, '✓ 已設定 Token（只存在這個瀏覽器）'),
            el('button', { class: 'btn danger', onclick: async () => {
              if (await confirmDialog('清除 Token', '清除後要重新貼上 Token 才能同步。雲端與本機的方案都不會被刪除。', { okLabel: '清除', danger: true })) {
                writeToken('');
                client = null;
                remote = null;
                render();
              }
            } }, '清除 Token'))
        : el('div', { class: 'stack' },
            tokenInput,
            el('button', { class: 'btn primary', onclick: () => {
              const value = tokenInput.value.trim();
              if (!value) return;
              if (!writeToken(value)) {
                toast('瀏覽器不允許儲存 Token', { error: true });
                return;
              }
              refresh();
            } }, '儲存 Token'),
            el('p', { class: 'note' }, 'Token 只會存在這個瀏覽器的 localStorage，不會上傳到任何地方（除了直接送給 GitHub API）。')),
      el('h2', { class: 'panel-title' }, '同步'),
      el('div', { class: 'stack' },
        el('button', { class: 'btn primary', disabled: !hasToken || busy, onclick: uploadCurrent }, '上傳目前方案'),
        el('button', { class: 'btn', disabled: !hasToken || busy, onclick: uploadAll }, '上傳全部方案'),
        el('button', { class: 'btn', disabled: !hasToken || busy, onclick: refresh }, '重新整理雲端清單'),
      ),
      busyLabel ? el('p', { class: 'note' }, busyLabel) : null,
      remote
        ? el('ul', { class: 'cloud-list' },
            remote.designs.length === 0 ? el('li', {}, '雲端還沒有方案') : null,
            remote.designs.map((d) =>
              el('li', {},
                el('span', {}, d.name, el('div', { class: 'note' }, `雲端修改於 ${dateTimeOf(d.updatedAt)}${localIds.has(d.id) ? '' : '・這台沒有'}`)),
                el('button', { class: 'btn small', disabled: busy, onclick: () => download(d.id) }, '下載'),
              )))
        : null,
    ];
    panel.replaceChildren(...parts.filter(Boolean));
  };

  session.onChange(() => render());
  render();
}
