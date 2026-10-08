// 把 design.furniture 同步成場景物件；選取與衝突用外框表示，不改共用材質
import * as THREE from 'three';
import { planToWorld } from '../core/floorplan.js';
import { elevationOf } from '../core/layout.js';
import { buildFurnitureModel, loadExternalTemplate } from '../furniture/models.js';
import { disposeObject } from './house.js';

const SELECT_COLOR = '#2f6f62';
const CONFLICT_COLOR = '#d64545';

const modelKey = (item) => `${item.type}|${item.size.w}|${item.size.d}|${item.size.h}|${item.color}`;

function outline(item, color) {
  const w = item.size.w / 100;
  const d = item.size.d / 100;
  const h = Math.max(item.size.h / 100, 0.02);
  const lines = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(w + 0.03, h + 0.02, d + 0.03)),
    new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true }),
  );
  lines.position.y = h / 2;
  lines.renderOrder = 10;
  return lines;
}

function conflictBox(item) {
  const w = item.size.w / 100;
  const d = item.size.d / 100;
  const h = Math.max(item.size.h / 100, 0.03);
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w + 0.02, h + 0.02, d + 0.02),
    new THREE.MeshBasicMaterial({ color: CONFLICT_COLOR, transparent: true, opacity: 0.32, depthWrite: false }),
  );
  mesh.position.y = h / 2;
  mesh.renderOrder = 9;
  return mesh;
}

export class FurnitureLayer {
  constructor(scene) {
    this.root = new THREE.Group();
    this.root.name = 'furniture';
    scene.add(this.root);
    this.entries = new Map();
    this.selectedId = null;
    this.conflicts = new Set();
    this.lastFurniture = [];
  }

  sync(furniture) {
    this.lastFurniture = furniture;
    const alive = new Set(furniture.map((f) => f.id));
    for (const [id, entry] of this.entries) {
      if (!alive.has(id)) {
        this.root.remove(entry.container);
        // 家具材質是共用快取，只釋放幾何；外框自己的材質由 disposeObject 處理
        entry.container.traverse((c) => c.geometry?.dispose());
        for (const name of ['selection', 'conflict']) {
          const deco = entry.container.getObjectByName(name);
          if (deco) disposeObject(deco);
        }
        this.entries.delete(id);
      }
    }
    for (const item of furniture) this.#upsert(item, elevationOf(item, furniture));
    this.#refreshDecorations();
  }

  #upsert(item, elevation) {
    let entry = this.entries.get(item.id);
    if (!entry) {
      const container = new THREE.Group();
      container.userData.furnitureId = item.id;
      this.root.add(container);
      entry = { container, key: '', model: null, item };
      this.entries.set(item.id, entry);
    }
    entry.item = item;
    // 桌上型家電放在檯面上時抬到檯面高度
    const { x, y, z } = planToWorld([item.x, item.y], elevation);
    entry.container.position.set(x, y, z);
    entry.container.rotation.y = (item.rotation * Math.PI) / 180;
    const key = modelKey(item);
    if (key !== entry.key) {
      entry.key = key;
      this.#replaceModel(entry, buildFurnitureModel(item));
      // 有註冊外部模型時，載入完成再換上去；期間先顯示程式化模型
      loadExternalTemplate(item.type).then((template) => {
        if (template && entry.key === key && this.entries.get(item.id) === entry) {
          this.#replaceModel(entry, buildFurnitureModel(item, template));
        }
      });
    }
  }

  #replaceModel(entry, model) {
    if (entry.model) {
      entry.container.remove(entry.model);
      entry.model.traverse((c) => c.geometry?.dispose());
    }
    entry.model = model;
    model.traverse((child) => (child.userData.furnitureId = entry.item.id));
    entry.container.add(model);
  }

  #refreshDecorations() {
    for (const [id, entry] of this.entries) {
      for (const name of ['selection', 'conflict']) {
        const old = entry.container.getObjectByName(name);
        if (old) {
          entry.container.remove(old);
          disposeObject(old);
        }
      }
      if (this.conflicts.has(id)) {
        const box = conflictBox(entry.item);
        box.name = 'conflict';
        entry.container.add(box);
      }
      if (this.selectedId === id) {
        const lines = outline(entry.item, this.conflicts.has(id) ? CONFLICT_COLOR : SELECT_COLOR);
        lines.name = 'selection';
        entry.container.add(lines);
      }
    }
  }

  setSelected(id) {
    this.selectedId = id;
    this.#refreshDecorations();
  }

  setConflicts(ids) {
    this.conflicts = new Set(ids);
    this.#refreshDecorations();
  }

  // 回傳射線打到的第一件家具 id
  pick(raycaster) {
    const models = [...this.entries.values()].map((e) => e.model).filter(Boolean);
    const hit = raycaster.intersectObjects(models, true)[0];
    return hit?.object.userData.furnitureId ?? null;
  }
}
