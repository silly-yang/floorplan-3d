// 窗簾：每扇窗一組軌道與兩片收在兩側的落地簾；只是畫面效果，開關與顏色不存進方案
import * as THREE from 'three';
import { curtainPlan } from '../core/curtains.js';
import { ceilingHeightAt } from '../core/lighting.js';

export const DEFAULT_CURTAIN_COLOR = '#d9d2c5';
const FOLD_DEPTH = 0.035; // 摺子前後起伏
const SEGMENTS_PER_FOLD = 6;
const TRACK = { width: 0.025, height: 0.02, color: '#e8e6e1' };
const HEADER_GAP = 0.03; // 簾頭掛在軌道下方

// 波浪狀的布：沿 x 起伏，原點在左下角，z 為前後
function fabricGeometry(width, height, folds) {
  const geometry = new THREE.PlaneGeometry(width, height, folds * SEGMENTS_PER_FOLD, 1);
  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i) + width / 2;
    position.setXYZ(i, x, position.getY(i) + height / 2, Math.sin((x / width) * folds * Math.PI * 2) * FOLD_DEPTH);
  }
  geometry.computeVertexNormals();
  return geometry;
}

export class CurtainLayer {
  constructor(scene, floorplan) {
    this.floorplan = floorplan;
    this.root = new THREE.Group();
    this.root.name = 'curtains';
    scene.add(this.root);
    this.fabric = new THREE.MeshStandardMaterial({ color: DEFAULT_CURTAIN_COLOR, roughness: 0.95, side: THREE.DoubleSide });
    this.track = new THREE.MeshStandardMaterial({ color: TRACK.color, roughness: 0.45, metalness: 0.2 });
    this.key = '';
  }

  // 天花板高度變了軌道要跟著降，其他設計變動不必重建
  sync(design) {
    const key = JSON.stringify([design.ceilingHeight, design.ceilings]);
    if (key === this.key) return;
    this.key = key;
    // 材質留著重用（顏色設定要保留），只釋放幾何
    this.root.traverse((o) => o.geometry?.dispose());
    this.root.clear();
    const { rooms } = this.floorplan;
    for (const opening of this.floorplan.openings) {
      if (opening.kind !== 'window') continue;
      // 先算出軌道位置，再用軌道中點那裡的天花板高度重算
      const draft = curtainPlan(opening, rooms, { ceiling: Infinity });
      if (!draft) continue;
      const { a, b } = draft.track;
      const ceiling = ceilingHeightAt([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], this.floorplan, design.ceilings, design.ceilingHeight);
      this.root.add(this.#build(curtainPlan(opening, rooms, { ceiling })));
    }
  }

  #build(plan) {
    const group = new THREE.Group();
    const { a, b, height } = plan.track;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const track = new THREE.Mesh(new THREE.BoxGeometry(length, TRACK.height, TRACK.width), this.track);
    track.position.set((a[0] + b[0]) / 2, height, -(a[1] + b[1]) / 2);
    track.rotation.y = angle;
    group.add(track);
    const drop = height - HEADER_GAP - plan.bottom;
    for (const panel of plan.panels) {
      const width = Math.hypot(panel.b[0] - panel.a[0], panel.b[1] - panel.a[1]);
      const mesh = new THREE.Mesh(fabricGeometry(width, drop, panel.folds), this.fabric);
      mesh.position.set(panel.a[0], plan.bottom, -panel.a[1]);
      mesh.rotation.y = angle;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    return group;
  }

  setVisible(on) {
    this.root.visible = on;
  }

  setColor(hex) {
    this.fabric.color.set(hex);
  }

  get color() {
    return `#${this.fabric.color.getHexString()}`;
  }
}
