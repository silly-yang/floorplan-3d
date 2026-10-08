// WiFi 熱圖：把 coverageGrid 的取樣畫到 canvas，貼成地板上方的一張半透明平面
import * as THREE from 'three';
import { coverageGrid, obstaclesOf, wirelessDevices } from '../core/wifi.js';

const STEP = 0.25; // 取樣間距（公尺），也是 canvas 一格的大小
const LIFT = 0.02; // 浮在地板上方，避免與地板 z-fighting
const OPACITY = 0.55;

// 訊號強弱的色階：綠（強）→ 黃 → 橘 → 紅（弱）
const STOPS = [
  [-50, [46, 204, 113]],
  [-65, [241, 196, 15]],
  [-75, [230, 126, 34]],
  [-85, [231, 76, 60]],
];

export function heatColor(rssi) {
  if (rssi >= STOPS[0][0]) return STOPS[0][1];
  for (let i = 1; i < STOPS.length; i++) {
    const [v1, c1] = STOPS[i];
    if (rssi >= v1) {
      const [v0, c0] = STOPS[i - 1];
      const t = (v0 - rssi) / (v0 - v1);
      return c0.map((c, k) => Math.round(c + (c1[k] - c) * t));
    }
  }
  return STOPS.at(-1)[1];
}

export class WifiLayer {
  constructor(scene, floorplan) {
    this.floorplan = floorplan;
    this.obstacles = obstaclesOf(floorplan);
    const { width, depth } = floorplan.bounds;
    this.cols = Math.ceil(width / STEP);
    this.rows = Math.ceil(depth / STEP);
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.cols;
    this.canvas.height = this.rows;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.magFilter = THREE.LinearFilter;
    const geometry = new THREE.PlaneGeometry(this.cols * STEP, this.rows * STEP);
    geometry.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, opacity: OPACITY, depthWrite: false }),
    );
    // canvas 第 0 列是平面座標 y 最大的那一排，對到世界座標 -z 那一側
    this.mesh.position.set((this.cols * STEP) / 2, LIFT, -(this.rows * STEP) / 2);
    this.mesh.renderOrder = 8;
    this.mesh.visible = false;
    this.mesh.name = 'wifi-heatmap';
    scene.add(this.mesh);
  }

  setVisible(visible) {
    this.mesh.visible = visible;
  }

  // 回傳這次有幾台無線設備；沒有設備時清空畫面
  update(furniture) {
    const devices = wirelessDevices(furniture);
    const ctx = this.canvas.getContext('2d');
    const image = ctx.createImageData(this.cols, this.rows);
    for (const { x, y, rssi } of coverageGrid(this.floorplan.rooms, devices, this.obstacles, STEP)) {
      const col = Math.floor(x / STEP);
      const row = this.rows - 1 - Math.floor(y / STEP);
      if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) continue;
      const [r, g, b] = heatColor(rssi);
      image.data.set([r, g, b, 255], (row * this.cols + col) * 4);
    }
    ctx.putImageData(image, 0, 0);
    this.texture.needsUpdate = true;
    return devices.length;
  }
}
