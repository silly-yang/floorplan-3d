// 進入點：載入平面圖、建立 3D 場景、串起各面板
import { createSession } from './app/session.js';
import { createStore } from './app/store.js';
import { blocksPassage, doorStateOf } from './core/doors.js';
import { buildSolids, fixturesToFurniture, missingFixtures, validateFloorplan } from './core/floorplan.js';
import { pointInPolygon, pointSegmentDistance } from './core/geometry2d.js';
import { Editor } from './interact/editor.js';
import { DoorLayer } from './scene/doorLayer.js';
import { exportGlb, exportPng } from './scene/exporters.js';
import { FurnitureLayer } from './scene/furnitureLayer.js';
import { LightLayer } from './scene/lightLayer.js';
import { relevelLights } from './core/lighting.js';
import { CEILING_TYPES, ceilingStateOf, ceilingZones } from './core/ceilings.js';
import { FLOOR_MATERIALS, floorMaterialOf } from './core/materials.js';
import { buildHouse, disposeObject, floorColorOf } from './scene/house.js';
import { textureThumbnail } from './scene/textures.js';
import { Viewer } from './scene/viewer.js';
import { DesignStore, StorageUnavailableError } from './storage/localStore.js';
import { fingerprint } from './storage/schema.js';
import { renderCatalog } from './ui/catalogPanel.js';
import { $, alertDialog, el, toast } from './ui/dom.js';
import { setupCabinetPanel } from './ui/cabinetPanel.js';
import { setupPegboardPanel } from './ui/pegboardPanel.js';
import { setupDoorPanel } from './ui/doorPanel.js';
import { iconSvg } from './ui/icons.js';
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
  // 指紋只看格局（牆、門窗、房間），新增預設廚衛這類變動不算換了平面圖
  return { floorplan, ref: fingerprint(JSON.stringify([floorplan.bounds, floorplan.walls, floorplan.openings, floorplan.rooms])) };
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

function openSession(store, floorplanRef, onStatus, defaultFurniture) {
  const make = (storage) =>
    createSession({
      designStore: new DesignStore(storage),
      store,
      now: () => new Date().toISOString(),
      newId: () => crypto.randomUUID(),
      floorplanRef,
      onStatus,
      defaultFurniture,
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

// 漫遊時擋路的東西：牆、窗台，加上關著的門
function makeWalkCollision(getSolids, floorplan, store) {
  return ([x, y]) => {
    const doors = store.getState().doors;
    const closedDoors = floorplan.openings
      .filter((o) => blocksPassage(doorStateOf(doors, o)))
      .map((o) => ({ polygon: o.polygon, bottom: 0 }));
    return [...getSolids(), ...closedDoors]
      .filter((s) => s.bottom < BODY_HEIGHT)
      .every(({ polygon }) => {
        if (pointInPolygon([x, y], polygon)) return false;
        return polygon.every((a, i) => pointSegmentDistance([x, y], a, polygon[(i + 1) % polygon.length]) > WALKER_RADIUS);
      });
  };
}

function setupFloorPanel(floorplan, store) {
  const ceiling = $('#ceiling-input');
  const ceilingColor = $('#ceiling-color');
  const list = $('#room-list');
  let colorBase = null;
  ceilingColor.addEventListener('input', () => {
    colorBase ??= store.getState();
    store.preview({ ...store.getState(), ceilingColor: ceilingColor.value });
  });
  ceilingColor.addEventListener('change', () => {
    store.commit({ ...store.getState(), ceilingColor: ceilingColor.value }, colorBase ? { base: colorBase } : {});
    colorBase = null;
  });
  const render = (design) => {
    ceiling.value = design.ceilingHeight;
    ceilingColor.value = design.ceilingColor;
    list.replaceChildren(
      ...floorplan.rooms.map((room) => {
        const input = el('input', { type: 'color', value: floorColorOf(room.id, design.rooms), title: '自訂顏色' });
        const next = () => {
          const current = store.getState();
          return { ...current, rooms: { ...current.rooms, [room.id]: { ...current.rooms[room.id], floorColor: input.value } } };
        };
        // 換材質時清掉自訂顏色，直接用材質本身的顏色
        const pickMaterial = (id) => {
          const current = store.getState();
          store.commit({ ...current, rooms: { ...current.rooms, [room.id]: { floorMaterial: id } } });
        };
        const currentMaterial = floorMaterialOf(room.id, design.rooms).id;
        const swatches = el('div', { class: 'material-grid', role: 'group', 'aria-label': `${room.name}地板材質` },
          FLOOR_MATERIALS.map((m) =>
            el('button', {
              type: 'button',
              class: `material-swatch ${m.id === currentMaterial ? 'active' : ''}`,
              title: m.name,
              'aria-pressed': String(m.id === currentMaterial),
              onclick: () => pickMaterial(m.id),
            },
              el('img', { src: textureThumbnail(m.pattern, m.color, m.options), alt: '' }),
              el('span', {}, m.name),
            )));
        input.addEventListener('input', () => {
          colorBase ??= store.getState();
          store.preview(next());
        });
        input.addEventListener('change', () => {
          store.commit(next(), colorBase ? { base: colorBase } : {});
          colorBase = null;
        });
        return el('li', { class: 'room-floor' }, el('label', { class: 'field' }, el('strong', {}, room.name), input), swatches);
      }),
    );
  };
  ceiling.addEventListener('change', () => {
    const value = Number(ceiling.value);
    if (!(value >= 2 && value <= 5)) {
      ceiling.value = store.getState().ceilingHeight;
      return;
    }
    store.commit(relevelLights({ ...store.getState(), ceilingHeight: value }, floorplan));
  });
  store.subscribe((design, { source }) => {
    // 拖拉顏色時不要重建清單，否則會把正在用的取色器關掉
    if (source !== 'preview') render(design);
  });
  render(store.getState());
}

// 「空間」分頁的天花板：每一區選形式；平釘與造型可調高度
function setupCeilingPanel(floorplan, store, showCeiling) {
  const list = $('#ceiling-list');
  const zones = ceilingZones(floorplan);
  const update = (zoneId, patch) => {
    const design = store.getState();
    const current = ceilingStateOf(design.ceilings, zoneId, floorplan);
    store.commit(relevelLights({ ...design, ceilings: { ...design.ceilings, [zoneId]: { ...current, ...patch } } }, floorplan));
    showCeiling();
  };
  const render = (design) => {
    list.replaceChildren(
      ...zones.map((zone) => {
        const state = ceilingStateOf(design.ceilings, zone.id, floorplan);
        const height = el('input', { type: 'number', min: '2', max: String(design.ceilingHeight), step: '0.05', value: String(state.height) });
        height.addEventListener('change', () => {
          const value = Number(height.value);
          if (value >= 2 && value <= design.ceilingHeight) update(zone.id, { height: value });
          else height.value = state.height;
        });
        const types = el('div', { class: 'row' }, CEILING_TYPES.map((t) => {
          const b = el('button', { type: 'button', class: `btn small ${t.id === state.type ? 'primary' : ''}`, title: t.name, onclick: () => update(zone.id, { type: t.id }) });
          b.innerHTML = iconSvg(t.icon);
          b.append(el('span', {}, t.name.replace(/（.*）/, '')));
          return b;
        }));
        const needsHeight = state.type === 'flat' || state.type === 'cove';
        return el('li', { class: 'room-floor' },
          el('strong', {}, `${zone.name}${zone.builtIn ? '（建商已做）' : ''}`),
          types,
          needsHeight ? el('label', { class: 'field' }, el('span', {}, '天花板高度（公尺）'), height) : null,
        );
      }),
    );
  };
  store.subscribe((design, { source }) => {
    if (source !== 'preview') render(design);
  });
  render(store.getState());
}

// 回傳 { setCutaway, setCeiling }：只改顯示，不改設計內容
// 天花板：漫遊時一定顯示；3D／俯視預設隱藏（會擋住視線），可手動打開；剖面時一律隱藏
function setupHouse(floorplan, viewer, store) {
  let house = null;
  let lastKey = '';
  let cutaway = false;
  let ceilingOn = false;
  const applyCeiling = () => {
    if (house) house.ceiling.visible = !cutaway && (ceilingOn || viewer.mode === 'walk');
  };
  const sync = () => {
    const design = store.getState();
    const height = cutaway ? Math.min(CUTAWAY_HEIGHT, design.ceilingHeight) : design.ceilingHeight;
    const key = JSON.stringify([height, design.rooms, design.ceilingColor, design.ceilings]);
    if (key === lastKey) return;
    lastKey = key;
    if (house) {
      viewer.scene.remove(house.group);
      disposeObject(house.group);
    }
    house = buildHouse(floorplan, {
      ceilingHeight: height,
      slabHeight: design.ceilingHeight,
      rooms: design.rooms,
      ceilingColor: design.ceilingColor,
      ceilings: design.ceilings,
    });
    viewer.scene.add(house.group);
    applyCeiling();
  };
  store.subscribe(sync);
  viewer.onChange(applyCeiling);
  sync();
  return {
    setCutaway: (enabled) => {
      cutaway = enabled;
      sync();
    },
    setCeiling: (enabled) => {
      ceilingOn = enabled;
      applyCeiling();
    },
  };
}

function iconLabel(icon, label) {
  const span = el('span', { class: 'with-icon' });
  span.innerHTML = iconSvg(icon);
  span.append(el('span', {}, label));
  return span;
}

function toggleButton(icon, label, initial, onToggle, title) {
  const button = el('button', { class: 'btn', 'aria-pressed': String(initial), title }, iconLabel(icon, label));
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

function setupStageTools(editor, { setCutaway, setCeiling }) {
  const fullView = el('button', { class: 'btn', title: '回到看得到整間房子的視角（也可以雙擊畫面放大）' }, iconLabel('full-view', '全景'));
  fullView.addEventListener('click', () => editor.viewer.resetView());
  $('#stage-tools').replaceChildren(
    fullView,
    toggleButton('high-quality', '高畫質', editor.viewer.highQuality, (on) => editor.viewer.setHighQuality(on), '牆角、家具底下的柔和陰影；手機較慢可關閉'),
    toggleButton('grid', '網格 5 cm', true, (on) => editor.setSnap(on), '移動家具時對齊 5 公分網格'),
    toggleButton('cutaway', '剖面', false, setCutaway, '把牆降到 1.1 公尺，方便看家具配置'),
    toggleButton('ceiling', '天花板', false, setCeiling, '在 3D／俯視顯示天花板（漫遊時一定會顯示）'),
  );
}

// HTML 裡標了 data-icon 的元素，把 icon 插在最前面
function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((node) => {
    if (!node.querySelector(':scope > svg.icon')) node.insertAdjacentHTML('afterbegin', iconSvg(node.dataset.icon));
  });
}

// 舊方案或刪掉後想找回時，把缺的建商預設廚衛放回原位
function setupFixtureActions(floorplan, store) {
  const button = el('button', { class: 'btn' }, iconLabel('tab-fixture', '放回建商預設廚衛'));
  button.addEventListener('click', () => {
    const design = store.getState();
    const missing = missingFixtures(design.furniture, floorplan.fixtures);
    if (missing.length === 0) {
      toast('建商預設的廚衛都已經在原位');
      return;
    }
    const added = fixturesToFurniture(missing, () => crypto.randomUUID());
    store.commit({ ...design, furniture: [...design.furniture, ...added] });
    toast(`已放回 ${added.length} 件廚衛`);
  });
  $('#fixture-actions').replaceChildren(button);
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
  hydrateIcons();
  setupTabs();
  let floorplan;
  let floorplanRef;
  try {
    ({ floorplan, ref: floorplanRef } = await loadFloorplan());
  } catch (error) {
    await alertDialog('無法載入平面圖', error.message);
    return;
  }
  const store = createStore({ ceilingHeight: 3.05, ceilingColor: '#f4f2ee', rooms: {}, doors: {}, cabinets: [], ceilings: {}, furniture: [], pegboards: [] });
  let exportAll = () => {};
  const defaultFurniture = () => fixturesToFurniture(floorplan.fixtures, () => crypto.randomUUID());
  const { session, warnings, persistent } = openSession(store, floorplanRef, makeStatusHandler(() => exportAll), defaultFurniture);
  const getSolids = makeSolidsGetter(floorplan, store);
  const viewer = new Viewer($('#stage'), floorplan.bounds);
  viewer.canWalkTo = makeWalkCollision(getSolids, floorplan, store);
  setupViewSwitch(viewer);
  const houseView = setupHouse(floorplan, viewer, store);
  setupFloorPanel(floorplan, store);

  // 圖層要比編輯器先訂閱：編輯器更新選取與衝突外框時，物件必須已經同步好
  const furnitureLayer = new FurnitureLayer(viewer.scene);
  store.subscribe((design) => furnitureLayer.sync(design.furniture, design.cabinets, design.pegboards));
  furnitureLayer.sync(store.getState().furniture, store.getState().cabinets, store.getState().pegboards);
  const doorLayer = new DoorLayer(viewer.scene, floorplan);
  store.subscribe((design) => doorLayer.sync(design.doors));
  doorLayer.sync(store.getState().doors);
  // 要在家具圖層之後同步：模型重建後才換得到發光面材質
  const lightLayer = new LightLayer(viewer.scene, furnitureLayer, floorplan);
  store.subscribe((design) => lightLayer.sync(design));
  lightLayer.sync(store.getState());
  viewer.onFrame((dt) => {
    doorLayer.update(dt);
    furnitureLayer.update(dt);
    lightLayer.update();
  });
  const editor = new Editor({ viewer, store, furnitureLayer, doorLayer, floorplan, getSolids });
  renderCatalog({
    onAdd: (type) => {
      editor.add(type);
      document.body.classList.remove('sidebar-open');
    },
  });
  const cabinetPanel = setupCabinetPanel({ store, editor });
  const pegboardPanel = setupPegboardPanel({ store, editor });
  setupInspector(editor, getSolids, { editCabinet: cabinetPanel.edit, editPegboard: pegboardPanel.edit });
  setupDoorPanel(editor, floorplan);
  setupStageTools(editor, houseView);
  $('#stage-tools').append(toggleButton('day-night', '夜晚', false, (on) => lightLayer.setNight(on), '關掉日光，看燈具開起來的效果'));
  // 改了天花板就自動打開天花板顯示，才看得到改了什麼
  setupCeilingPanel(floorplan, store, () => {
    const toggle = [...document.querySelectorAll('#stage-tools button')].find((b) => b.textContent.includes('天花板'));
    if (toggle && toggle.getAttribute('aria-pressed') !== 'true') toggle.click();
  });
  setupFixtureActions(floorplan, store);
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
  // 開發驗證用：網址加 ?debug 才暴露內部物件
  if (new URLSearchParams(location.search).has('debug')) window.__app = { store, viewer, floorplan, furnitureLayer, doorLayer, editor, session };
  if (!persistent) {
    await alertDialog('無法自動儲存', '瀏覽器不允許這個網頁使用儲存空間（可能是無痕模式或隱私設定）。這次的設計只會留在這個分頁，關閉前請到「檔案」匯出。');
  }
  if (warnings.length) await alertDialog('部分方案無法讀取', warnings.join('\n'));
}

main();
