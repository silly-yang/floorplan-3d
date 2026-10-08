// 門板：依設計裡的門型建出 3D 門片，開關時逐格轉動或滑動
import * as THREE from 'three';
import { doorPanels, doorStateOf, doorStopPoint, swingSide } from '../core/doors.js';
import { planToWorld } from '../core/floorplan.js';
import { disposeObject } from './house.js';

const OPEN_SPEED = 1.6; // 每秒開關的比例；約 0.6 秒開完
const SELECT_COLOR = new THREE.Color('#2f6f62');
const HANDLE_HEIGHT = 1.0; // 門把離地
const BACKSET = 0.065; // 門把中心離門片邊緣
const STOP = { radius: 0.02, height: 0.035 };

// 霧面鎳色金屬，環境反射下才看得出是金屬
const nickel = () => new THREE.MeshStandardMaterial({ color: '#b7babd', roughness: 0.3, metalness: 0.85 });

// 一般門的水平把手：兩面各一組圓座＋把手桿，桿子朝門軸方向伸出；原點在門片中心
function leverHandle(panel) {
  const group = new THREE.Group();
  const material = nickel();
  const x = panel.width / 2 - BACKSET;
  const y = -panel.height / 2 + HANDLE_HEIGHT;
  for (const side of [-1, 1]) {
    const face = side * (panel.thickness / 2);
    const rose = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.01, 24), material);
    rose.rotation.x = Math.PI / 2;
    rose.position.set(x, y, face + side * 0.005);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.045, 12), material);
    neck.rotation.x = Math.PI / 2;
    neck.position.set(x, y, face + side * 0.03);
    const lever = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.018, 0.016), material);
    lever.position.set(x - 0.055, y, face + side * 0.05);
    group.add(rose, neck, lever);
  }
  group.traverse((c) => (c.castShadow = true));
  return group;
}

// 地上的門檔：金屬座＋深色橡膠頭
function doorStop([x, y]) {
  const group = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(STOP.radius, STOP.radius * 1.15, STOP.height * 0.6, 20), nickel());
  base.position.y = STOP.height * 0.3;
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(STOP.radius * 0.9, STOP.radius, STOP.height * 0.4, 20), new THREE.MeshStandardMaterial({ color: '#3a3b3d', roughness: 0.9 }));
  cap.position.y = STOP.height * 0.8;
  group.add(base, cap);
  const p = planToWorld([x, y]);
  group.position.set(p.x, 0, p.z);
  group.traverse((c) => (c.castShadow = true));
  return group;
}

function panelMesh(panel, type) {
  const group = new THREE.Group();
  const geometry = new THREE.BoxGeometry(panel.width, panel.height, panel.thickness);
  if (panel.glass) {
    const glass = new THREE.Mesh(
      geometry,
      new THREE.MeshPhysicalMaterial({ color: '#cfe3ee', transparent: true, opacity: 0.32, roughness: 0.05, depthWrite: false }),
    );
    const frame = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({ color: '#5d6166' }));
    group.add(glass, frame);
  } else {
    const leaf = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: type === 'sliding' ? '#ddd6ca' : '#cdb79a', roughness: 0.7 }));
    leaf.castShadow = true;
    leaf.receiveShadow = true;
    group.add(leaf);
    if (type === 'hinged') {
      group.add(leverHandle(panel));
    } else {
      // 拉門：中央偏一邊的直把手
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.14, panel.thickness + 0.05), new THREE.MeshStandardMaterial({ color: '#4a4d52', roughness: 0.3 }));
      handle.position.set(-panel.width / 2 + 0.06, -panel.height / 2 + HANDLE_HEIGHT, 0);
      group.add(handle);
    }
  }
  return group;
}

export class DoorLayer {
  constructor(scene, floorplan) {
    this.root = new THREE.Group();
    this.root.name = 'doors';
    scene.add(this.root);
    this.openings = floorplan.openings;
    // 每個開口預設往哪側開（朝房間內）只跟格局有關，算一次就好
    this.sides = new Map(floorplan.openings.map((o) => [o.id, swingSide(o, floorplan.rooms)]));
    this.entries = new Map(); // openingId → { group, state, progress, key }
    this.selectedId = null;
  }

  sync(doors) {
    for (const opening of this.openings) {
      const state = doorStateOf(doors, opening);
      let entry = this.entries.get(opening.id);
      if (!entry) {
        entry = { group: new THREE.Group(), state, progress: state.open ? 1 : 0, key: '' };
        entry.group.userData.openingId = opening.id;
        this.root.add(entry.group);
        this.entries.set(opening.id, entry);
      }
      entry.state = state;
      // 門型或方向變了就重建門板；開關只改 progress，交給 update 逐格動
      const key = `${state.type}|${state.flip}|${state.out}`;
      if (key !== entry.key) {
        entry.key = key;
        disposeObject(entry.group);
        entry.group.clear();
        for (const panel of doorPanels(opening, state, 0, this.sides.get(opening.id))) {
          const mesh = panelMesh(panel, state.type);
          mesh.traverse((c) => (c.userData.openingId = opening.id));
          entry.group.add(mesh);
        }
        // 門檔不跟著門片動；排在門片之後，#place 依序對門片時會略過它
        const stop = doorStopPoint(opening, state, this.sides.get(opening.id));
        if (stop) {
          const mesh = doorStop(stop);
          mesh.traverse((c) => (c.userData.openingId = opening.id));
          entry.group.add(mesh);
        }
        this.#place(opening, entry);
        this.#paintSelection(entry, opening.id === this.selectedId);
      }
    }
  }

  #place(opening, entry) {
    const panels = doorPanels(opening, entry.state, entry.progress, this.sides.get(opening.id));
    entry.group.children.forEach((mesh, i) => {
      const panel = panels[i];
      if (!panel) return;
      const { x, z } = planToWorld(panel.center);
      mesh.position.set(x, panel.bottom + panel.height / 2, z);
      mesh.rotation.y = (panel.rotation * Math.PI) / 180;
    });
  }

  // 每幀呼叫：往目標開度靠近
  update(dt) {
    for (const opening of this.openings) {
      const entry = this.entries.get(opening.id);
      if (!entry) continue;
      const target = entry.state.open ? 1 : 0;
      if (entry.progress === target) continue;
      const step = OPEN_SPEED * dt;
      entry.progress = target > entry.progress ? Math.min(target, entry.progress + step) : Math.max(target, entry.progress - step);
      // 緩出緩入，比等速自然
      const eased = entry.progress * entry.progress * (3 - 2 * entry.progress);
      this.#place(opening, { ...entry, progress: eased });
    }
  }

  #paintSelection(entry, on) {
    entry.group.traverse((c) => {
      if (c.isMesh && c.material.emissive) c.material.emissive.copy(on ? SELECT_COLOR : new THREE.Color(0)).multiplyScalar(on ? 0.35 : 0);
    });
  }

  setSelected(openingId) {
    this.selectedId = openingId;
    for (const [id, entry] of this.entries) this.#paintSelection(entry, id === openingId);
  }

  pick(raycaster) {
    const hit = raycaster.intersectObjects([...this.entries.values()].map((e) => e.group), true)[0];
    return hit ? { openingId: hit.object.userData.openingId, distance: hit.distance } : null;
  }
}
