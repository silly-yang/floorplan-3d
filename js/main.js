// 進入點：載入平面圖、建立 3D 場景、串起各面板
import { createSession } from './app/session.js';
import { createStore } from './app/store.js';
import { buildSolids, validateFloorplan } from './core/floorplan.js';
import { pointInPolygon, pointSegmentDistance } from './core/geometry2d.js';
import { Editor } from './interact/editor.js';
import { exportGlb, exportPng } from './scene/exporters.js';
import { FurnitureLayer } from './scene/furnitureLayer.js';
import { buildHouse, disposeObject, floorColorOf } from './scene/house.js';
import { Viewer } from './scene/viewer.js';
import { DesignStore, StorageUnavailableError } from './storage/localStore.js';
import { fingerprint } from './storage/schema.js';
import { renderCatalog } from './ui/catalogPanel.js';
import { setupCloudPanel } from './ui/cloudPanel.js';
import { $, alertDialog, el, toast } from './ui/dom.js';
import { setupInspector } from './ui/inspector.js';
import { makeStatusHandler, setupSessionUi } from './ui/sessionUi.js';

const WALKER_RADIUS = 0.2;
const BODY_HEIGHT = 1.2; // 低於這個高度的量體（牆、窗台）會擋住漫遊
const CUTAWAY_HEIGHT = 1.1; // 剖面模式的牆高，方便從上方看家具

async function loadFloorplan() {
  const response = await fetch('data/floorplan.json', { cache: 'no-cache' });
  if (!response.ok) throw new Error(`讀取 data/floorplan.json 失敗（HTTP ${response.status}）`);
  const text = await response.text();
  let floorplan;
  try {
    floorplan = JSON.parse(text);
  } catch {
    throw new Error('data/floorplan.json 不是有效的 JSON');
  }
  const errors = validateFloorplan(floorplan);
  if (errors.length) throw new Error(`平面圖格式錯誤：\n${errors.join('\n')}`);
  return { floorplan, ref: fingerprint(text) };
}

// 瀏覽器不給用 localStorage 時（部分無痕模式）改存在記憶體，關掉分頁就沒了
class MemoryStorage {
  constructor() {
    this.map = new Map();
  }
  get length() {
    return this.map.size;
  }
  key(i) {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k) {
    return this.map.get(k) ?? null;
  }
  setItem(k, v) {
    this.map.set(k, String(v));
  }
  removeItem(k) {
    this.map.delete(k);
  }
}

function openSession(store, floorplanRef, onStatus) {
  const make = (storage) =>
    createSession({
      designStore: new DesignStore(storage),
      store,
      now: () => new Date().toISOString(),
      newId: () => crypto.randomUUID(),
      floorplanRef,
      onStatus,
    });
  try {
    const session = make(window.localStorage);
    return { session, ...session.init(), persistent: true };
  } catch (error) {
    if (!(error instanceof StorageUnavailableError) && error?.name !== 'SecurityError') throw error;
    const session = make(new MemoryStorage());
    return { session, ...session.init(), persistent: false };
  }
}

function setupTabs() {
  const tabs = document.querySelectorAll('.tabs [data-tab]');
  tabs.forEach((tab) =>
    tab.addEventListener('click', () => {
      tabs.forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
      document.querySelectorAll('.tab-panel').forEach((p) => (p.hidden = p.dataset.panel !== tab.dataset.tab));
    }),
  );
  $('#menu-toggle').addEventListener('click', () => document.body.classList.toggle('sidebar-open'));
}

function setupViewSwitch(viewer) {
  const buttons = document.querySelectorAll('.view-switch [data-view]');
  const overlay = $('#walk-overlay');
  buttons.forEach((b) => b.addEventListener('click', () => viewer.setMode(b.dataset.view)));
  overlay.addEventListener('click', () => viewer.lockWalk());
  viewer.onChange((mode) => {
    buttons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === mode)));
    overlay.hidden = mode !== 'walk' || viewer.isWalkLocked;
  });
}

// 量體只跟樓高有關，樓高沒變就沿用上次的結果
function makeSolidsGetter(floorplan, store) {
  let cache = { height: null, solids: [] };
  return () => {
    const height = store.getState().ceilingHeight;
    if (cache.height !== height) cache = { height, solids: buildSolids(floorplan, height) };
    return cache.solids;
  };
}

function makeWalkCollision(getSolids) {
  return ([x, y]) =>
    getSolids()
      .filter((s) => s.bottom < BODY_HEIGHT)
      .every(({ polygon }) => {
        if (pointInPolygon([x, y], polygon)) return false;
        return polygon.every((a, i) => pointSegmentDistance([x, y], a, polygon[(i + 1) % polygon.length]) > WALKER_RADIUS);
      });
}

function setupFloorPanel(floorplan, store) {
  const ceiling = $('#ceiling-input');
  const list = $('#room-list');
  let colorBase = null;
  const render = (design) => {
    ceiling.value = design.ceilingHeight;
    list.replaceChildren(
      ...floorplan.rooms.map((room) => {
        const input = el('input', { type: 'color', value: floorColorOf(room.id, design.rooms) });
        const next = () => {
          const current = store.getState();
          return { ...current, rooms: { ...current.rooms, [room.id]: { floorColor: input.value } } };
        };
        input.addEventListener('input', () => {
          colorBase ??= store.getState();
          store.preview(next());
        });
        input.addEventListener('change', () => {
          store.commit(next(), colorBase ? { base: colorBase } : {});
          colorBase = null;
        });
        return el('li', {}, el('label', { class: 'field' }, el('span', {}, room.name), input));
      }),
    );
  };
  ceiling.addEventListener('change', () => {
    const value = Number(ceiling.value);
    if (!(value >= 2 && value <= 5)) {
      ceiling.value = store.getState().ceilingHeight;
      return;
    }
    store.commit({ ...store.getState(), ceilingHeight: value });
  });
  store.subscribe((design, { source }) => {
    // 拖拉顏色時不要重建清單，否則會把正在用的取色器關掉
    if (source !== 'preview') render(design);
  });
  render(store.getState());
}

// 回傳 setCutaway(boolean)：剖面模式只改顯示，不改設計裡的樓高
function setupHouse(floorplan, viewer, store) {
  let house = null;
  let lastKey = '';
  let cutaway = false;
  const sync = () => {
    const design = store.getState();
    const height = cutaway ? Math.min(CUTAWAY_HEIGHT, design.ceilingHeight) : design.ceilingHeight;
    const key = JSON.stringify([height, design.rooms]);
    if (key === lastKey) return;
    lastKey = key;
    if (house) {
      viewer.scene.remove(house.group);
      disposeObject(house.group);
    }
    house = buildHouse(floorplan, { ceilingHeight: height, rooms: design.rooms });
    viewer.scene.add(house.group);
  };
  store.subscribe(sync);
  sync();
  return (enabled) => {
    cutaway = enabled;
    sync();
  };
}

function toggleButton(label, initial, onToggle, title) {
  const button = el('button', { class: 'btn', 'aria-pressed': String(initial), title }, label);
  const paint = (on) => {
    button.classList.toggle('primary', on);
    button.setAttribute('aria-pressed', String(on));
  };
  paint(initial);
  button.addEventListener('click', () => {
    const on = button.getAttribute('aria-pressed') !== 'true';
    paint(on);
    onToggle(on);
  });
  return button;
}

function setupStageTools(editor, setCutaway) {
  $('#stage-tools').replaceChildren(
    toggleButton('對齊網格 5 cm', true, (on) => editor.setSnap(on), '移動家具時對齊 5 公分網格'),
    toggleButton('剖面', false, setCutaway, '把牆降到 1.1 公尺，方便看家具配置'),
  );
}

function setupHistoryButtons(store, editor) {
  const undo = $('#undo-btn');
  const redo = $('#redo-btn');
  undo.addEventListener('click', () => editor.undo());
  redo.addEventListener('click', () => editor.redo());
  const refresh = () => {
    undo.disabled = !store.canUndo();
    redo.disabled = !store.canRedo();
  };
  store.subscribe(refresh);
  refresh();
}

async function main() {
  setupTabs();
  let floorplan;
  let floorplanRef;
  try {
    ({ floorplan, ref: floorplanRef } = await loadFloorplan());
  } catch (error) {
    await alertDialog('無法載入平面圖', error.message);
    return;
  }
  const store = createStore({ ceilingHeight: 2.8, rooms: {}, furniture: [] });
  let exportAll = () => {};
  const { session, warnings, persistent } = openSession(store, floorplanRef, makeStatusHandler(() => exportAll));
  const getSolids = makeSolidsGetter(floorplan, store);
  const viewer = new Viewer($('#stage'), floorplan.bounds);
  viewer.canWalkTo = makeWalkCollision(getSolids);
  setupViewSwitch(viewer);
  const setCutaway = setupHouse(floorplan, viewer, store);
  setupFloorPanel(floorplan, store);

  // 圖層要比編輯器先訂閱：編輯器更新選取與衝突外框時，物件必須已經同步好
  const furnitureLayer = new FurnitureLayer(viewer.scene);
  store.subscribe((design) => furnitureLayer.sync(design.furniture));
  furnitureLayer.sync(store.getState().furniture);
  const editor = new Editor({ viewer, store, furnitureLayer, getSolids });
  renderCatalog({
    onAdd: (type) => {
      editor.add(type);
      document.body.classList.remove('sidebar-open');
    },
  });
  setupInspector(editor, getSolids);
  setupStageTools(editor, setCutaway);
  setupHistoryButtons(store, editor);
  ({ exportAll } = setupSessionUi({
    session,
    exportPng: () => exportPng(viewer, furnitureLayer),
    exportGlb: () => exportGlb(viewer, furnitureLayer),
    onFloorplanMismatch: (design) => {
      if (design.floorplanRef && design.floorplanRef !== floorplanRef) {
        toast(`「${design.name}」是在舊版平面圖上做的，家具位置可能需要調整`, { duration: 6000 });
      }
    },
  }));
  setupCloudPanel({ session });
  // 開發驗證用：網址加 ?debug 才暴露內部物件
  if (new URLSearchParams(location.search).has('debug')) window.__app = { store, viewer, floorplan, furnitureLayer, editor, session };
  if (!persistent) {
    await alertDialog('無法自動儲存', '瀏覽器不允許這個網頁使用儲存空間（可能是無痕模式或隱私設定）。這次的設計只會留在這個分頁，關閉前請到「檔案」匯出。');
  }
  if (warnings.length) await alertDialog('部分方案無法讀取', warnings.join('\n'));
}

main();
