// 方案相關畫面：頂部方案切換與儲存狀態、「檔案」分頁、匯入流程（含拖放檔案）
import { StorageFullError, StorageUnavailableError } from '../storage/localStore.js';
import { assignFloorplans, buildExport, exportFileName, findConflict, ImportError, parseImportText, resolveImport } from '../storage/transfer.js';
import { $, alertDialog, chooseDialog, confirmDialog, downloadBlob, el, promptDialog, toast } from './dom.js';
import { iconSvg } from './icons.js';

function iconButton(icon, label, attrs) {
  const button = el('button', attrs);
  button.innerHTML = iconSvg(icon);
  if (label) button.append(el('span', {}, label));
  return button;
}

const timeOf = (iso) => new Date(iso).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false });
const dateTimeOf = (iso) => new Date(iso).toLocaleString('zh-TW', { dateStyle: 'short', timeStyle: 'short', hour12: false });
const dateOf = (iso) => new Date(iso).toLocaleDateString('zh-TW');

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

// floorplans：平面圖清單與操作（見 main.js），current 是目前使用中的平面圖
export function setupSessionUi({ session, onFloorplanMismatch, exportPng, exportGlb, floorplans }) {
  // 用到匯入平面圖的方案，平面圖一起帶走
  const exportDesigns = (designs) => {
    const now = new Date().toISOString();
    downloadBlob(jsonBlob(buildExport(designs, now, floorplans.exportBundle(designs))), exportFileName(designs, now));
  };

  const exportCurrent = () => {
    session.flush();
    exportDesigns([session.current]);
  };

  // 全部平面圖的方案都匯出，換電腦時一次帶走
  const exportAll = () => {
    session.flush();
    const designs = [];
    for (const { id } of floorplans.allDesigns()) {
      try {
        designs.push(id === session.current.id ? session.current : session.load(id));
      } catch (error) {
        toast(`有方案讀取失敗，未包含在匯出中：${error.message}`, { error: true });
      }
    }
    exportDesigns(designs);
    toast(`已匯出 ${designs.length} 個方案`);
  };

  // 先還原平面圖，再匯入方案；名稱衝突（同一張平面圖內）逐一詢問：覆蓋、另存或略過
  const importText = async (text) => {
    let parsed;
    try {
      parsed = parseImportText(text);
    } catch (error) {
      if (!(error instanceof ImportError)) throw error;
      await alertDialog('無法匯入', error.message);
      return;
    }
    try {
      floorplans.restore(parsed.floorplans);
    } catch (error) {
      await alertDialog('無法匯入平面圖', error.message);
      return;
    }
    const assigned = assignFloorplans(parsed, { hasFloorplan: floorplans.hasFloorplan, defaultRef: floorplans.defaultRef });
    const designs = assigned.designs;
    const errors = [...parsed.errors, ...assigned.errors];
    if (errors.length) {
      const detail = errors.map((e) => `${e.label}\n${e.problems.map((p) => `  ・${p}`).join('\n')}`).join('\n\n');
      await alertDialog(designs.length ? '部分方案格式錯誤，已略過' : '設計檔格式錯誤', detail);
    }
    let imported = 0;
    let elsewhere = 0;
    for (const design of designs) {
      const key = floorplans.keyOf(design.floorplanRef);
      const existing = floorplans.designsOf(key);
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
        if (key !== floorplans.current.key) elsewhere++;
      } catch (error) {
        toast(`匯入「${design.name}」失敗：${error.message}`, { error: true });
      }
    }
    if (imported) toast(`已匯入 ${imported} 個方案${elsewhere ? `（其中 ${elsewhere} 個在其他平面圖，到「檔案」→「平面圖」切換）` : ''}`, { duration: 6000 });
    refresh();
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
    ['add', '新增方案', () => session.createNew()],
    ['rename', '重新命名', async () => {
      const name = await promptDialog('重新命名', '新的方案名稱', session.current.name);
      if (name) session.rename(name);
    }],
    ['duplicate', '複製方案', () => session.duplicate()],
    ['reset', '重置方案', async () => {
      const ok = await confirmDialog(
        '重置方案',
        `把「${session.current.name}」恢復成剛建立時的樣子：清空家具、櫃子、洞洞板，天花板、地板、門回到預設，只留建商附的廚衛與插座。按「復原」可以救回來。`,
        { okLabel: '重置', danger: true },
      );
      if (ok) session.reset();
    }],
    ['delete', '刪除方案', async () => {
      const ok = await confirmDialog('刪除方案', `確定要刪除「${session.current.name}」嗎？刪除後無法復原，建議先匯出備份。`, { okLabel: '刪除', danger: true });
      if (ok) session.remove(session.current.id);
    }],
  ];
  $('#scheme-bar').replaceChildren(
    select,
    ...actions.map(([icon, title, run]) => iconButton(icon, '', { class: 'btn small icon-only', title, 'aria-label': title, onclick: () => guard(run) })),
  );

  // 操作失敗（例如容量不足、名稱重複）只提示，不讓頁面壞掉
  // 換平面圖後舊畫面已拆掉，殘留在佇列裡的點擊不再動作
  async function guard(run) {
    if (disposed) return;
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
          d.id === session.current?.id ? null : iconButton('open', '開啟', { class: 'btn small', onclick: () => guard(() => session.switchTo(d.id)) }),
        ))),
      el('div', { class: 'row' },
        iconButton('add', '新增方案', { class: 'btn small', onclick: () => guard(() => session.createNew()) }),
        iconButton('duplicate', '複製目前方案', { class: 'btn small', onclick: () => guard(() => session.duplicate()) }),
      ),
      ...floorplanSection(),
      el('h2', { class: 'panel-title' }, '匯出／匯入設計檔'),
      el('div', { class: 'stack' },
        iconButton('export', '匯出目前方案（.design.json）', { class: 'btn', onclick: exportCurrent }),
        iconButton('export', '匯出全部方案（.design.json）', { class: 'btn', onclick: exportAll }),
        iconButton('import', '匯入 .design.json', { class: 'btn primary', onclick: () => fileInput.click() }),
        fileInput,
        el('p', { class: 'note' }, '也可以直接把 .design.json 檔案拖放到頁面上匯入。'),
      ),
      el('h2', { class: 'panel-title' }, '匯出畫面與模型'),
      el('div', { class: 'stack' },
        iconButton('camera', '目前畫面截圖（PNG）', { class: 'btn', onclick: () => guard(async () => downloadBlob(await exportPng(), `${session.current.name}.png`)) }),
        iconButton('cube', '整個場景（GLB，可用 Blender／SketchUp 開啟）', { class: 'btn', onclick: () => guard(async () => {
          toast('正在產生 GLB…');
          downloadBlob(await exportGlb(), `${session.current.name}.glb`);
        }) }),
      ),
      el('p', { class: 'note' }, '設計會自動存在這個瀏覽器裡。清除瀏覽器資料或換電腦前，請先匯出備份。'),
    );
  };

  // ---------- 平面圖 ----------
  const currentKey = floorplans.current.key;
  const resetButton = (attrs = {}) =>
    iconButton('reset', '重置回預設版本', { class: 'btn small', title: '切回預設平面圖；匯入的平面圖會留著，之後還能切回來', onclick: () => guard(() => floorplans.switchTo(null)), ...attrs });
  const floorplanSection = () => {
    const entries = floorplans.entries();
    return [
      el('h2', { class: 'panel-title' }, '平面圖'),
      el('ul', { class: 'cloud-list floorplan-list' }, entries.map((f) => {
        const current = f.key === currentKey;
        const detail = `${f.isDefault ? '內建' : `建立於 ${dateOf(f.createdAt)}`}・${f.designCount} 個方案`;
        return el('li', { 'data-floorplan': f.key ?? 'default' },
          el('span', {}, current ? el('strong', {}, `▸ ${f.name}（使用中）`) : f.name, el('div', { class: 'note' }, detail)),
          el('span', { class: 'row' },
            current ? null : iconButton('open', '切換', { class: 'btn small', onclick: () => guard(() => floorplans.switchTo(f.key)) }),
            f.isDefault ? null : iconButton('rename', '', { class: 'btn small icon-only', title: '重新命名', 'aria-label': `重新命名「${f.name}」`, onclick: () => guard(async () => {
              const name = await promptDialog('重新命名平面圖', '新的平面圖名稱', f.name);
              if (name) floorplans.rename(f.key, name);
            }) }),
            f.isDefault ? null : iconButton('delete', '', { class: 'btn small icon-only', title: '刪除平面圖與它的方案', 'aria-label': `刪除「${f.name}」`, onclick: () => guard(() => floorplans.remove(f.key)) }),
          ),
        );
      })),
      el('div', { class: 'row' },
        iconButton('tab-floor', '匯入平面圖（DXF）', { class: 'btn small', onclick: floorplans.importDxf }),
        currentKey === null ? null : resetButton(),
      ),
      el('p', { class: 'note' }, '從建商或設計師給的 CAD 圖建立自己的平面圖；檔案只在這台裝置的瀏覽器裡處理，不會上傳。預設平面圖不會被覆蓋。'),
    ];
  };

  // 使用匯入的平面圖時，頂部顯示名稱與回預設的入口
  let banner = null;
  const renderBanner = () => {
    banner?.remove();
    banner = null;
    document.body.classList.toggle('on-imported-floorplan', currentKey !== null);
    if (currentKey === null) return;
    const name = floorplans.entries().find((f) => f.key === currentKey)?.name ?? floorplans.current.name;
    banner = el('div', { class: 'floorplan-banner', role: 'status' },
      el('span', {}, '目前使用匯入的平面圖：', el('strong', {}, name)),
      resetButton({ 'data-banner-reset': '' }),
    );
    $('.topbar').after(banner);
  };

  // ---------- 拖放檔案匯入 ----------
  const dropZone = $('#drop-zone');
  const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');
  let depth = 0;
  // 換平面圖重建場景時，一次拿掉掛在 window、document 上的監聽
  const abort = new AbortController();
  const { signal } = abort;
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    depth++;
    dropZone.hidden = false;
  }, { signal });
  window.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    depth = Math.max(0, depth - 1);
    if (depth === 0) dropZone.hidden = true;
  }, { signal });
  window.addEventListener('dragover', (e) => {
    if (hasFiles(e)) e.preventDefault();
  }, { signal });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    dropZone.hidden = true;
    importFile(e.dataTransfer.files[0]);
  }, { signal });

  // ---------- 同步畫面 ----------
  let lastId = null;
  const refresh = () => {
    renderSelect();
    renderFilesPanel();
    renderBanner();
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
  window.addEventListener('pagehide', () => session.flush(), { signal });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') session.flush();
  }, { signal });

  let disposed = false;
  const dispose = () => {
    disposed = true;
    abort.abort();
    banner?.remove();
    document.body.classList.remove('on-imported-floorplan');
  };
  return { exportAll, importText, refresh, dispose };
}
