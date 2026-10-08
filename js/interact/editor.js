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
import { createFurniture } from '../furniture/catalog.js';
import { FURNITURE_MIME } from '../ui/catalogPanel.js';
import { toast } from '../ui/dom.js';

const CLICK_TOLERANCE = 5; // 像素；按下到放開移動小於此值視為點擊
const DUPLICATE_OFFSET = 0.3;

const newId = () => crypto.randomUUID();

export class Editor {
  constructor({ viewer, store, furnitureLayer, getSolids }) {
    this.viewer = viewer;
    this.store = store;
    this.layer = furnitureLayer;
    this.getSolids = getSolids;
    this.selectedId = null;
    this.snap = true;
    this.drag = null;
    this.listeners = new Set();
    this.raycaster = new THREE.Raycaster();
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
    this.#emit();
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
    if (this.viewer.mode === 'walk' || e.button > 0) return;
    this.down = { x: e.clientX, y: e.clientY };
    const id = this.layer.pick(this.#ray(e.clientX, e.clientY));
    if (!id) return;
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
    if (this.drag) {
      if (this.drag.moved) this.store.commit(this.store.getState(), { base: this.drag.base });
      if (this.drag.blocked && !this.drag.moved) toast('家具不能穿過牆面');
      this.drag = null;
      this.viewer.setControlsEnabled(true);
    } else if (wasClick && this.viewer.mode !== 'walk') {
      this.select(null);
    }
    this.down = null;
  }

  // ---------- 新增 ----------

  #bindDrop() {
    const canvas = this.viewer.domElement;
    canvas.addEventListener('dragover', (e) => {
      if (e.dataTransfer.types.includes(FURNITURE_MIME)) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }
    });
    canvas.addEventListener('drop', (e) => {
      const type = e.dataTransfer.getData(FURNITURE_MIME);
      if (!type) return;
      e.preventDefault();
      e.stopPropagation();
      const point = this.screenToPlan(e.clientX, e.clientY);
      if (point) this.add(type, point, { exact: true });
    });
  }

  // exact：拖放到指定位置時撞牆就拒絕；點清單新增時則自動找附近空位
  add(type, point = null, { exact = false } = {}) {
    if (this.viewer.mode === 'walk') this.viewer.setMode('orbit');
    const rect = this.viewer.domElement.getBoundingClientRect();
    const target = point ?? this.screenToPlan(rect.left + rect.width / 2, rect.top + rect.height / 2);
    if (!target) return;
    const [x, y] = this.#snapped(target);
    const item = createFurniture(type, { id: newId(), x, y });
    const solids = this.getSolids();
    if (exact && hitsWalls(item, solids)) {
      toast('這個位置會壓到牆，請放在房間內');
      return;
    }
    const spot = findFreeSpot(item, solids);
    if (!spot) {
      toast('附近找不到空間放這件家具');
      return;
    }
    this.store.commit(addFurniture(this.store.getState(), { ...item, ...spot }));
    this.select(item.id);
  }

  // ---------- 編輯選取的家具 ----------

  // 套用變更前先檢查撞牆；回傳是否成功
  // base：連續預覽（例如拖動取色器）開始前的狀態，讓復原一次回到原樣
  update(patch, { commit = true, base } = {}) {
    const item = this.selected;
    if (!item) return false;
    if (hitsWalls({ ...item, ...patch }, this.getSolids())) {
      toast('這樣會撞到牆，請先把家具移開一點');
      this.#emit();
      return false;
    }
    const next = updateFurniture(this.store.getState(), item.id, patch);
    if (commit) this.store.commit(next, base ? { base } : {});
    else this.store.preview(next);
    return true;
  }

  // direction 1＝順時針（從上往下看）；資料內的 rotation 是逆時針角度，所以要減
  rotate(direction = 1) {
    const item = this.selected;
    if (item) this.update({ rotation: normalizeRotation(item.rotation - direction * ROTATION_STEP) });
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
      else if (key === 'escape' && this.viewer.mode !== 'walk') this.select(null);
      else return;
      e.preventDefault();
    });
  }
}
