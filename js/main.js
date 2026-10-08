// 進入點：載入平面圖、建立 3D 場景、串起各面板
import { createStore } from './app/store.js';
import { buildSolids, validateFloorplan } from './core/floorplan.js';
import { pointInPolygon, pointSegmentDistance } from './core/geometry2d.js';
import { createFurniture } from './furniture/catalog.js';
import { FurnitureLayer } from './scene/furnitureLayer.js';
import { buildHouse, disposeObject, floorColorOf } from './scene/house.js';
import { Viewer } from './scene/viewer.js';
import { renderCatalog } from './ui/catalogPanel.js';
import { $, alertDialog, el } from './ui/dom.js';

const WALKER_RADIUS = 0.2;
const BODY_HEIGHT = 1.2; // 低於這個高度的量體（牆、窗台）會擋住漫遊

async function loadFloorplan() {
  const response = await fetch('data/floorplan.json', { cache: 'no-cache' });
  if (!response.ok) throw new Error(`讀取 data/floorplan.json 失敗（HTTP ${response.status}）`);
  const floorplan = await response.json();
  const errors = validateFloorplan(floorplan);
  if (errors.length) throw new Error(`平面圖格式錯誤：\n${errors.join('\n')}`);
  return floorplan;
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

function makeWalkCollision(floorplan, store) {
  return ([x, y]) => {
    const blockers = buildSolids(floorplan, store.getState().ceilingHeight).filter((s) => s.bottom < BODY_HEIGHT);
    return blockers.every(({ polygon }) => {
      if (pointInPolygon([x, y], polygon)) return false;
      return polygon.every((a, i) => pointSegmentDistance([x, y], a, polygon[(i + 1) % polygon.length]) > WALKER_RADIUS);
    });
  };
}

function setupFloorPanel(floorplan, store) {
  const ceiling = $('#ceiling-input');
  const list = $('#room-list');
  const render = (design) => {
    ceiling.value = design.ceilingHeight;
    list.replaceChildren(
      ...floorplan.rooms.map((room) => {
        const input = el('input', { type: 'color', value: floorColorOf(room.id, design.rooms) });
        const update = (commit) => {
          const current = store.getState();
          const next = { ...current, rooms: { ...current.rooms, [room.id]: { floorColor: input.value } } };
          if (commit) store.commit(next);
          else store.preview(next);
        };
        input.addEventListener('input', () => update(false));
        input.addEventListener('change', () => update(true));
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

function setupHouse(floorplan, viewer, store) {
  let house = null;
  let lastKey = '';
  const sync = (design) => {
    const key = JSON.stringify([design.ceilingHeight, design.rooms]);
    if (key === lastKey) return;
    lastKey = key;
    if (house) {
      viewer.scene.remove(house.group);
      disposeObject(house.group);
    }
    house = buildHouse(floorplan, design);
    viewer.scene.add(house.group);
  };
  store.subscribe(sync);
  sync(store.getState());
}

async function main() {
  setupTabs();
  let floorplan;
  try {
    floorplan = await loadFloorplan();
  } catch (error) {
    await alertDialog('無法載入平面圖', error.message);
    return;
  }
  const store = createStore({ ceilingHeight: 2.8, rooms: {}, furniture: [] });
  const viewer = new Viewer($('#stage'), floorplan.bounds);
  viewer.canWalkTo = makeWalkCollision(floorplan, store);
  setupViewSwitch(viewer);
  setupHouse(floorplan, viewer, store);
  setupFloorPanel(floorplan, store);
  const furnitureLayer = new FurnitureLayer(viewer.scene);
  store.subscribe((design) => furnitureLayer.sync(design.furniture));
  renderCatalog({
    onAdd: (type) => {
      const design = store.getState();
      const item = createFurniture(type, { id: crypto.randomUUID(), x: floorplan.bounds.width / 2, y: floorplan.bounds.depth / 2 });
      store.commit({ ...design, furniture: [...design.furniture, item] });
    },
  });
  window.__app = { store, viewer, floorplan, furnitureLayer };
}

main();
