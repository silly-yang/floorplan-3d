// 方案相關畫面：頂部方案切換與儲存狀態、「檔案」分頁、匯入流程（含拖放檔案）
import { StorageFullError, StorageUnavailableError } from '../storage/localStore.js';
import { buildExport, exportFileName, findConflict, ImportError, parseImportText, resolveImport } from '../storage/transfer.js';
import { $, alertDialog, chooseDialog, confirmDialog, downloadBlob, el, promptDialog, toast } from './dom.js';

const timeOf = (iso) => new Date(iso).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false });
const dateTimeOf = (iso) => new Date(iso).toLocaleString('zh-TW', { dateStyle: 'short', timeStyle: 'short', hour12: false });

const jsonBlob = (data) => new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });

// 存檔狀態顯示；容量不足時跳出對話框請使用者匯出備份（同一次錯誤只提醒一次）
export function makeStatusHandler(getExportAll) {
  const label = $('#save-status');
  let warned = false;
  return (status) => {
    label.classList.toggle('error', status.state === 'error');
    if (status.state === 'pending' || status.state === 'saving') label.textContent = '儲存中…';
    if (status.state === 'saved') {
      label.textContent = `已儲存 ${timeOf(status.at)}`;
      warned = false;
    }
    if (status.state !== 'error') return;
    label.textContent = '⚠ 儲存失敗';
    if (warned) return;
    warned = true;
    const full = status.error instanceof StorageFullError;
    const unavailable = status.error instanceof StorageUnavailableError;
    chooseDialog(
      full ? '儲存空間不足' : '無法自動儲存',
      full || unavailable ? status.error.message : `自動儲存失敗：${status.error.message}`,
      [{ label: '立刻匯出全部方案', value: 'export', class: 'primary' }],
    ).then((choice) => {
      if (choice === 'export') getExportAll()();
    });
  };
}

export function setupSessionUi({ session, onFloorplanMismatch, exportPng, exportGlb }) {
  const exportDesigns = (designs) => {
    const now = new Date().toISOString();
    downloadBlob(jsonBlob(buildExport(designs, now)), exportFileName(designs, now));
  };

  const exportCurrent = () => {
    session.flush();
    exportDesigns([session.current]);
  };

  const exportAll = () => {
    session.flush();
    const designs = [];
    for (const { id } of session.list()) {
      try {
        designs.push(id === session.current.id ? session.current : session.load(id));
      } catch (error) {
        toast(`有方案讀取失敗，未包含在匯出中：${error.message}`, { error: true });
      }
    }
    exportDesigns(designs);
    toast(`已匯出 ${designs.length} 個方案`);
  };

  // 名稱衝突逐一詢問：覆蓋、另存或略過
  const importText = async (text) => {
    let parsed;
    try {
      parsed = parseImportText(text);
    } catch (error) {
      if (!(error instanceof ImportError)) throw error;
      await alertDialog('無法匯入', error.message);
      return;
    }
    const { designs, errors } = parsed;
    if (errors.length) {
      const detail = errors.map((e) => `${e.label}\n${e.problems.map((p) => `  ・${p}`).join('\n')}`).join('\n\n');
      await alertDialog(designs.length ? '部分方案格式錯誤，已略過' : '設計檔格式錯誤', detail);
    }
    let imported = 0;
    for (const design of designs) {
      const existing = session.list();
      const conflict = findConflict(design, existing);
      let decision = null;
      if (conflict) {
        decision = await chooseDialog('方案名稱重複', `已經有名為「${design.name}」的方案，要怎麼處理匯入的這一份？`, [
          { label: '覆蓋原本的', value: 'overwrite', class: 'danger' },
          { label: '另存成新方案', value: 'copy', class: 'primary' },
        ]);
        if (!decision) continue;
      }
      try {
        session.importDesign(resolveImport(design, decision, existing, { newId: () => crypto.randomUUID() }));
        imported++;
      } catch (error) {
        toast(`匯入「${design.name}」失敗：${error.message}`, { error: true });
      }
    }
    if (imported) toast(`已匯入 ${imported} 個方案`);
  };

  const importFile = async (file) => {
    if (!file) return;
    try {
      await importText(await file.text());
    } catch (error) {
      await alertDialog('無法讀取檔案', error.message);
    }
  };

  // ---------- 頂部方案列 ----------
  const select = el('select', { 'aria-label': '目前方案', onchange: () => guard(() => session.switchTo(select.value)) });
  const actions = [
    ['＋', '新增方案', () => session.createNew()],
    ['✎', '重新命名', async () => {
      const name = await promptDialog('重新命名', '新的方案名稱', session.current.name);
      if (name) session.rename(name);
    }],
    ['⧉', '複製方案', () => session.duplicate()],
    ['🗑', '刪除方案', async () => {
      const ok = await confirmDialog('刪除方案', `確定要刪除「${session.current.name}」嗎？刪除後無法復原，建議先匯出備份。`, { okLabel: '刪除', danger: true });
      if (ok) session.remove(session.current.id);
    }],
  ];
  $('#scheme-bar').replaceChildren(
    select,
    ...actions.map(([icon, title, run]) => el('button', { class: 'btn small', title, 'aria-label': title, onclick: () => guard(run) }, icon)),
  );

  // 操作失敗（例如容量不足、名稱重複）只提示，不讓頁面壞掉
  async function guard(run) {
    try {
      await run();
    } catch (error) {
      toast(error.message, { error: true, duration: 5000 });
      renderSelect();
    }
  }

  const renderSelect = () => {
    const list = session.list();
    select.replaceChildren(...list.map((d) => el('option', { value: d.id, selected: d.id === session.current?.id }, d.name)));
  };

  // ---------- 檔案分頁 ----------
  const fileInput = el('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: () => {
    importFile(fileInput.files[0]);
    fileInput.value = '';
  } });
  const renderFilesPanel = () => {
    const list = session.list();
    $('#files-panel').replaceChildren(
      el('h2', { class: 'panel-title' }, '我的方案'),
      el('ul', { class: 'cloud-list' }, list.map((d) =>
        el('li', {},
          el('span', {}, d.id === session.current?.id ? el('strong', {}, `▸ ${d.name}`) : d.name, el('div', { class: 'note' }, `修改於 ${dateTimeOf(d.updatedAt)}`)),
          d.id === session.current?.id ? null : el('button', { class: 'btn small', onclick: () => guard(() => session.switchTo(d.id)) }, '開啟'),
        ))),
      el('div', { class: 'row' },
        el('button', { class: 'btn small', onclick: () => guard(() => session.createNew()) }, '新增方案'),
        el('button', { class: 'btn small', onclick: () => guard(() => session.duplicate()) }, '複製目前方案'),
      ),
      el('h2', { class: 'panel-title' }, '匯出／匯入設計檔'),
      el('div', { class: 'stack' },
        el('button', { class: 'btn', onclick: exportCurrent }, '匯出目前方案（.design.json）'),
        el('button', { class: 'btn', onclick: exportAll }, '匯出全部方案（.design.json）'),
        el('button', { class: 'btn primary', onclick: () => fileInput.click() }, '匯入 .design.json'),
        fileInput,
        el('p', { class: 'note' }, '也可以直接把 .design.json 檔案拖放到頁面上匯入。'),
      ),
      el('h2', { class: 'panel-title' }, '匯出畫面與模型'),
      el('div', { class: 'stack' },
        el('button', { class: 'btn', onclick: () => guard(async () => downloadBlob(await exportPng(), `${session.current.name}.png`)) }, '目前畫面截圖（PNG）'),
        el('button', { class: 'btn', onclick: () => guard(async () => {
          toast('正在產生 GLB…');
          downloadBlob(await exportGlb(), `${session.current.name}.glb`);
        }) }, '整個場景（GLB，可用 Blender／SketchUp 開啟）'),
      ),
      el('p', { class: 'note' }, '設計會自動存在這個瀏覽器裡。清除瀏覽器資料或換電腦前，請先匯出備份，或使用「雲端」同步。'),
    );
  };

  // ---------- 拖放檔案匯入 ----------
  const dropZone = $('#drop-zone');
  const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');
  let depth = 0;
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    depth++;
    dropZone.hidden = false;
  });
  window.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    depth = Math.max(0, depth - 1);
    if (depth === 0) dropZone.hidden = true;
  });
  window.addEventListener('dragover', (e) => {
    if (hasFiles(e)) e.preventDefault();
  });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    dropZone.hidden = true;
    importFile(e.dataTransfer.files[0]);
  });

  // ---------- 同步畫面 ----------
  let lastId = null;
  const refresh = () => {
    renderSelect();
    renderFilesPanel();
    const current = session.current;
    if (current && current.id !== lastId) {
      lastId = current.id;
      onFloorplanMismatch?.(current);
    }
  };
  session.onChange(refresh);
  refresh();
  if (!$('#save-status').textContent) $('#save-status').textContent = '已儲存';

  // 關閉或切走頁面前把最後的變更存下來
  window.addEventListener('pagehide', () => session.flush());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') session.flush();
  });

  return { exportAll, importText };
}
