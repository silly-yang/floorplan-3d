// 場景互動：選取、在地板平面拖曳、從清單拖放新增、旋轉、刪除、複製、快捷鍵
import * as THREE from 'three';
import {
  addFurniture,
  findConflicts,
  findFreeSpot,
  hitsWalls,
  moveToward,
  normalizeRotation,
  removeFurniture,
  ROTATION_STEP,
  snapToGrid,
  updateFurniture,
} from '../core/layout.js';
import { createDoubleTapDetector } from '../core/cameraMath.js';
import { doorStateOf } from '../core/doors.js';
import { createFurniture } from '../furniture/catalog.js';
import { placeCabinet } from '../core/cabinet.js';
import { FURNITURE_MIME } from '../ui/catalogPanel.js';
import { toast } from '../ui/dom.js';

const CLICK_TOLERANCE = 5; // 像素；按下到放開移動小於此值視為點擊
const DUPLICATE_OFFSET = 0.3;
const CABINET_MIME = 'application/x-cabinet-id'; // 與 cabinetPanel 相同；避免互相 import
const WALK_REACH = 2.5;
const NUDGE_RADIUS = 0.8; // 旋轉、改尺寸撞牆時，最多自動挪動幾公尺 // 漫遊時伸手可及、能開關門的距離（公尺）

const newId = () => crypto.randomUUID();

export class Editor {
  constructor({ viewer, store, furnitureLayer, doorLayer, floorplan, getSolids }) {
    this.viewer = viewer;
    this.store = store;
    this.layer = furnitureLayer;
    this.doorLayer = doorLayer;
    this.openings = floorplan.openings;
    this.selectedDoorId = null;
    this.getSolids = getSolids;
    this.selectedId = null;
    this.snap = true;
    this.drag = null;
    this.listeners = new Set();
    this.raycaster = new THREE.Raycaster();
    this.doubleTap = createDoubleTapDetector();
    this.floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.#bindPointer();
    this.#bindDrop();
    this.#bindKeys();
    store.subscribe((design) => this.#afterChange(design));
    this.#afterChange(store.getState());
  }

  onChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  #emit() {
    this.listeners.forEach((l) => l(this.selected));
  }

  get selected() {
    return this.store.getState().furniture.find((f) => f.id === this.selectedId) ?? null;
  }

  get conflicts() {
    return this.layer.conflicts;
  }

  #afterChange(design) {
    // 復原後選取的家具可能已不存在
    if (this.selectedId && !design.furniture.some((f) => f.id === this.selectedId)) this.selectedId = null;
    this.layer.setConflicts(findConflicts(design.furniture));
    this.layer.setSelected(this.selectedId);
    this.#emit();
  }

  select(id) {
    this.selectedId = id;
    this.layer.setSelected(id);
    if (id) this.#setDoorSelection(null);
    this.#emit();
  }

  // ---------- 門 ----------

  #setDoorSelection(openingId) {
    this.selectedDoorId = openingId;
    this.doorLayer.setSelected(openingId);
  }

  selectDoor(openingId) {
    this.#setDoorSelection(openingId);
    if (openingId) {
      this.selectedId = null;
      this.layer.setSelected(null);
    }
    this.#emit();
  }

  get selectedDoor() {
    return this.openings.find((o) => o.id === this.selectedDoorId) ?? null;
  }

  #patchDoor(openingId, patch) {
    const design = this.store.getState();
    const opening = this.openings.find((o) => o.id === openingId);
    if (!opening) return;
    const current = doorStateOf(design.doors, opening);
    this.store.commit({ ...design, doors: { ...design.doors, [openingId]: { ...current, ...patch } } });
  }

  toggleDoor(openingId) {
    const opening = this.openings.find((o) => o.id === openingId);
    if (!opening) return;
    const state = doorStateOf(this.store.getState().doors, opening);
    if (state.type === 'none') {
      toast('這個開口沒有裝門');
      return;
    }
    this.#patchDoor(openingId, { open: !state.open });
  }

  setDoorType(openingId, type) {
    this.#patchDoor(openingId, { type });
  }

  swingDoor(openingId) {
    const opening = this.openings.find((o) => o.id === openingId);
    if (opening) this.#patchDoor(openingId, { out: !doorStateOf(this.store.getState().doors, opening).out });
  }

  flipDoor(openingId) {
    const opening = this.openings.find((o) => o.id === openingId);
    if (opening) this.#patchDoor(openingId, { flip: !doorStateOf(this.store.getState().doors, opening).flip });
  }

  // ---------- 座標換算 ----------

  #ray(clientX, clientY) {
    // 剛新增、還沒畫過的家具，世界矩陣尚未更新，射線會打不到
    this.viewer.scene.updateMatrixWorld();
    const rect = this.viewer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.viewer.camera);
    return this.raycaster;
  }

  // 雙擊的落點：先找打到的物件（牆、家具、門），都沒打到再用地板平面
  #worldPointAt(clientX, clientY) {
    const ray = this.#ray(clientX, clientY);
    const targets = ['house', 'furniture', 'doors'].map((n) => this.viewer.scene.getObjectByName(n)).filter(Boolean);
    const hit = ray.intersectObjects(targets, true).find((h) => h.object.visible && h.object.name !== 'ground');
    if (hit) return hit.point;
    return ray.ray.intersectPlane(this.floor, new THREE.Vector3());
  }

  // 螢幕座標 → 平面座標 [x, y]；打不到地板（看向天空）回 null
  screenToPlan(clientX, clientY) {
    const hit = this.#ray(clientX, clientY).ray.intersectPlane(this.floor, new THREE.Vector3());
    return hit ? [hit.x, -hit.z] : null;
  }

  #snapped([x, y]) {
    return this.snap ? [snapToGrid(x), snapToGrid(y)] : [x, y];
  }

  // ---------- 拖曳移動 ----------

  #bindPointer() {
    const canvas = this.viewer.domElement;
    // capture：要比 OrbitControls 先拿到事件，按到家具時才來得及關掉視角操作
    canvas.addEventListener('pointerdown', (e) => this.#onDown(e), { capture: true });
    canvas.addEventListener('pointermove', (e) => this.#onMove(e));
    canvas.addEventListener('pointerup', (e) => this.#onUp(e));
    canvas.addEventListener('pointercancel', (e) => this.#onUp(e));
  }

  #onDown(e) {
    if (e.button > 0) return;
    // 漫遊：點擊開關準星前方 2.5 m 內的門
    if (this.viewer.mode === 'walk') {
      if (!this.viewer.isWalkLocked) return;
      this.viewer.scene.updateMatrixWorld();
      const hit = this.doorLayer.pick(this.viewer.centerRay(this.raycaster));
      if (hit && hit.distance < WALK_REACH) this.toggleDoor(hit.openingId);
      return;
    }
    this.down = { x: e.clientX, y: e.clientY };
    const ray = this.#ray(e.clientX, e.clientY);
    const id = this.layer.pick(ray);
    if (!id) {
      const door = this.doorLayer.pick(ray);
      if (door) {
        this.selectDoor(door.openingId);
        this.down = null; // 點到門不算點空白處
      }
      return;
    }
    const point = this.screenToPlan(e.clientX, e.clientY);
    const item = this.store.getState().furniture.find((f) => f.id === id);
    if (!point || !item) return;
    this.select(id);
    this.drag = { id, base: this.store.getState(), offset: [item.x - point[0], item.y - point[1]], moved: false, blocked: false };
    this.viewer.setControlsEnabled(false);
    this.viewer.domElement.setPointerCapture(e.pointerId);
  }

  #onMove(e) {
    if (!this.drag) return;
    const point = this.screenToPlan(e.clientX, e.clientY);
    if (!point) return;
    const design = this.store.getState();
    const item = design.furniture.find((f) => f.id === this.drag.id);
    const [x, y] = this.#snapped([point[0] + this.drag.offset[0], point[1] + this.drag.offset[1]]);
    if (x === item.x && y === item.y) return;
    // 沿路逐步前進，撞牆就停在牆前；只有真的動到才更新
    const reached = moveToward(item, { x, y }, this.getSolids());
    if (reached.x !== x || reached.y !== y) this.drag.blocked = true;
    const [rx, ry] = this.#snapped([reached.x, reached.y]);
    const spot = hitsWalls({ ...item, x: rx, y: ry }, this.getSolids()) ? reached : { x: rx, y: ry };
    if (spot.x === item.x && spot.y === item.y) return;
    this.drag.moved = true;
    this.store.preview(updateFurniture(design, item.id, spot));
  }

  #onUp(e) {
    const wasClick = this.down && Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) < CLICK_TOLERANCE;
    // 雙擊（手機雙點）放大到點擊處；拖曳過的不算
    const moved = this.drag?.moved;
    if (!moved && this.viewer.mode !== 'walk' && this.doubleTap.tap(e.clientX, e.clientY, e.timeStamp)) {
      const point = this.#worldPointAt(e.clientX, e.clientY);
      if (point) this.viewer.zoomAt(point);
    }
    if (this.drag) {
      if (this.drag.moved) this.store.commit(this.store.getState(), { base: this.drag.base });
      if (this.drag.blocked && !this.drag.moved) toast('家具不能穿過牆面');
      this.drag = null;
      this.viewer.setControlsEnabled(true);
    } else if (wasClick && this.viewer.mode !== 'walk') {
      this.select(null);
      this.selectDoor(null);
    }
    this.down = null;
  }

  // ---------- 新增 ----------

  #bindDrop() {
    const canvas = this.viewer.domElement;
    canvas.addEventListener('dragover', (e) => {
      if (e.dataTransfer.types.includes(FURNITURE_MIME) || e.dataTransfer.types.includes(CABINET_MIME)) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }
    });
    canvas.addEventListener('drop', (e) => {
      const cabinetId = e.dataTransfer.getData(CABINET_MIME);
      if (cabinetId) {
        e.preventDefault();
        const point = this.screenToPlan(e.clientX, e.clientY);
        if (point) this.addCabinet(cabinetId, point);
        return;
      }
      const type = e.dataTransfer.getData(FURNITURE_MIME);
      if (!type) return;
      e.preventDefault();
      e.stopPropagation();
      const point = this.screenToPlan(e.clientX, e.clientY);
      if (point) this.add(type, point);
    });
  }

  // 拖放或點清單新增；落點壓到牆時自動往內挪到最近的空位（拖到牆邊想靠牆擺是常態）
  add(type, point = null) {
    if (this.viewer.mode === 'walk') this.viewer.setMode('orbit');
    const rect = this.viewer.domElement.getBoundingClientRect();
    const target = point ?? this.screenToPlan(rect.left + rect.width / 2, rect.top + rect.height / 2);
    if (!target) return;
    const [x, y] = this.#snapped(target);
    const item = createFurniture(type, { id: newId(), x, y });
    const solids = this.getSolids();
    const spot = findFreeSpot(item, solids);
    if (!spot) {
      toast('附近找不到空間放這件家具，請換個位置');
      return;
    }
    if (point && (spot.x !== item.x || spot.y !== item.y)) toast('已自動往內挪一點，避免壓到牆');
    this.store.commit(addFurniture(this.store.getState(), { ...item, ...spot }));
    this.select(item.id);
  }

  // 把自己設計的系統櫃擺進場景；落點壓到牆時一樣自動往內挪
  addCabinet(cabinetId, point = null) {
    if (this.viewer.mode === 'walk') this.viewer.setMode('orbit');
    const rect = this.viewer.domElement.getBoundingClientRect();
    const target = point ?? this.screenToPlan(rect.left + rect.width / 2, rect.top + rect.height / 2);
    if (!target) return;
    const [x, y] = this.#snapped(target);
    const id = newId();
    const placed = placeCabinet(this.store.getState(), cabinetId, { id, x, y });
    const item = placed.furniture.at(-1);
    const spot = findFreeSpot(item, this.getSolids());
    if (!spot) {
      toast('附近找不到空間放這個櫃子');
      return;
    }
    this.store.commit({ ...placed, furniture: placed.furniture.map((f) => (f.id === id ? { ...f, ...spot } : f)) });
    this.select(id);
  }

  // ---------- 編輯選取的家具 ----------

  // 靠牆的家具旋轉或加大時會撞牆：先試著往內挪一點；回傳實際要套用的變更，放不下回 null
  #fit(item, patch) {
    if (!hitsWalls({ ...item, ...patch }, this.getSolids())) return patch;
    const spot = findFreeSpot({ ...item, ...patch }, this.getSolids(), { radius: NUDGE_RADIUS });
    return spot ? { ...patch, ...spot } : null;
  }

  // 套用變更前先檢查撞牆；回傳是否成功
  // base：連續預覽（例如拖動取色器）開始前的狀態，讓復原一次回到原樣
  update(patch, { commit = true, base } = {}) {
    const item = this.selected;
    if (!item) return false;
    const applied = this.#fit(item, patch);
    if (!applied) {
      toast('這裡空間不夠，請先把家具移到比較寬的地方');
      this.#emit();
      return false;
    }
    if (commit && applied !== patch) toast('已自動挪開一點，避免撞牆');
    const next = updateFurniture(this.store.getState(), item.id, applied);
    if (commit) this.store.commit(next, base ? { base } : {});
    else this.store.preview(next);
    return true;
  }

  // direction 1＝順時針（從上往下看）；資料內的 rotation 是逆時針角度，所以要減
  // 窄房間裡家具轉到斜角時會卡牆（例如 2.45 m 寬的臥室放不下斜 45° 的雙人床）；
  // 中間角度放不下就跳到下一個放得下的角度，才轉得到 90°
  rotate(direction = 1) {
    const item = this.selected;
    if (!item) return;
    for (let k = 1; k < 360 / ROTATION_STEP; k++) {
      const rotation = normalizeRotation(item.rotation - direction * ROTATION_STEP * k);
      const applied = this.#fit(item, { rotation });
      if (!applied) continue;
      if (k > 1) toast(`中間角度放不下，已跳到 ${(360 - rotation) % 360}°`);
      this.store.commit(updateFurniture(this.store.getState(), item.id, applied));
      return;
    }
    toast('這裡空間不夠旋轉，請先把家具移到比較寬的地方');
  }

  remove() {
    const item = this.selected;
    if (!item) return;
    this.store.commit(removeFurniture(this.store.getState(), item.id));
    this.select(null);
  }

  duplicate() {
    const item = this.selected;
    if (!item) return;
    const copy = { ...item, id: newId(), size: { ...item.size }, x: item.x + DUPLICATE_OFFSET, y: item.y - DUPLICATE_OFFSET };
    const spot = findFreeSpot(copy, this.getSolids());
    if (!spot) {
      toast('附近找不到空間放複製的家具');
      return;
    }
    this.store.commit(addFurniture(this.store.getState(), { ...copy, ...spot }));
    this.select(copy.id);
  }

  undo() {
    this.store.undo();
  }

  redo() {
    this.store.redo();
  }

  setSnap(enabled) {
    this.snap = enabled;
  }

  // ---------- 鍵盤 ----------

  #bindKeys() {
    window.addEventListener('keydown', (e) => {
      const tag = e.target?.tagName;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || e.target?.isContentEditable) return;
      if (document.querySelector('dialog[open]')) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === 'z' && !e.shiftKey) this.undo();
      else if (mod && (key === 'y' || (key === 'z' && e.shiftKey))) this.redo();
      else if (mod && key === 'd') this.duplicate();
      else if (!mod && key === 'r' && this.viewer.mode !== 'walk') this.rotate(e.shiftKey ? -1 : 1);
      else if (key === 'delete' || key === 'backspace') this.remove();
      else if (key === 'escape' && this.viewer.mode !== 'walk') {
        this.select(null);
        this.selectDoor(null);
      }
      else return;
      e.preventDefault();
    });
  }
}
