// 渲染器與三種視角：3D 環繞（orbit）、正上方俯視（top）、第一人稱漫遊（walk）
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

const EYE_HEIGHT = 1.6;
const WALK_SPEED = 1.6; // 公尺／秒
const MOVE_KEYS = { KeyW: 'f', ArrowUp: 'f', KeyS: 'b', ArrowDown: 'b', KeyA: 'l', ArrowLeft: 'l', KeyD: 'r', ArrowRight: 'r' };

export class Viewer {
  constructor(container, bounds) {
    this.container = container;
    this.bounds = bounds;
    this.mode = 'orbit';
    this.listeners = new Set();
    this.canWalkTo = () => true;
    this.pressed = new Set();
    this.timer = new THREE.Timer();

    // preserveDrawingBuffer 讓截圖時讀得到畫面
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#eef1f4');
    this.#addLights();

    const center = new THREE.Vector3(bounds.width / 2, 0, -bounds.depth / 2);
    this.center = center;

    this.perspective = new THREE.PerspectiveCamera(50, 1, 0.05, 200);
    this.orbit = new OrbitControls(this.perspective, this.renderer.domElement);
    this.orbit.target.copy(center);
    this.orbit.maxPolarAngle = Math.PI * 0.48;
    this.orbit.enableDamping = true;

    // 俯視：鏡頭在正上方、往南偏一點點，視線仍垂直向下，平面圖北方（-z）朝畫面上方
    // 不改 camera.up：OrbitControls 會把 up 當旋轉軸，改了畫面會歪
    this.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    this.ortho.position.set(center.x, 40, center.z + 1e-4);
    this.topControls = new OrbitControls(this.ortho, this.renderer.domElement);
    this.topControls.target.copy(center);
    this.topControls.enableRotate = false;
    this.topControls.screenSpacePanning = true;
    this.topControls.update();
    this.topControls.enabled = false;

    this.walkCamera = new THREE.PerspectiveCamera(70, 1, 0.05, 200);
    this.walk = new PointerLockControls(this.walkCamera, this.renderer.domElement);
    this.walk.addEventListener('unlock', () => this.#emit());
    this.walk.addEventListener('lock', () => this.#emit());

    this.#bindKeys();
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.fitOrbit();
    this.renderer.setAnimationLoop(() => this.#tick());
  }

  #addLights() {
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#b8b0a4', 1.6));
    const sun = new THREE.DirectionalLight('#fff6e8', 1.6);
    const { width, depth } = this.bounds;
    // 太陽接近正上方，牆影才不會蓋掉大半地板
    sun.position.set(width / 2 - 2.5, 22, -depth / 2 + 3.5);
    sun.target.position.set(width / 2, 0, -depth / 2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const span = Math.max(width, depth);
    Object.assign(sun.shadow.camera, { left: -span, right: span, top: span, bottom: -span, near: 1, far: 60 });
    sun.shadow.bias = -0.0005;
    this.scene.add(sun, sun.target);
  }

  #bindKeys() {
    const isTyping = (e) => ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target?.tagName);
    window.addEventListener('keydown', (e) => {
      if (this.mode === 'walk' && MOVE_KEYS[e.code] && !isTyping(e)) this.pressed.add(MOVE_KEYS[e.code]);
    });
    window.addEventListener('keyup', (e) => this.pressed.delete(MOVE_KEYS[e.code]));
    window.addEventListener('blur', () => this.pressed.clear());
  }

  get camera() {
    return { orbit: this.perspective, top: this.ortho, walk: this.walkCamera }[this.mode];
  }

  get domElement() {
    return this.renderer.domElement;
  }

  get isWalkLocked() {
    return this.walk.isLocked;
  }

  onChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  #emit() {
    this.listeners.forEach((l) => l(this.mode));
  }

  setMode(mode) {
    if (mode === this.mode) return;
    if (this.walk.isLocked) this.walk.unlock();
    this.mode = mode;
    this.orbit.enabled = mode === 'orbit';
    this.topControls.enabled = mode === 'top';
    if (mode === 'walk') {
      // 從房子中央、視線朝北開始
      this.walkCamera.position.set(this.center.x, EYE_HEIGHT, this.center.z);
      this.walkCamera.rotation.set(0, 0, 0);
    }
    this.resize();
    this.#emit();
  }

  lockWalk() {
    if (this.mode === 'walk') this.walk.lock();
  }

  // 拖曳家具時暫停視角操作，避免同一個手勢同時轉動畫面
  setControlsEnabled(enabled) {
    this.orbit.enabled = enabled && this.mode === 'orbit';
    this.topControls.enabled = enabled && this.mode === 'top';
  }

  resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    this.perspective.aspect = aspect;
    this.perspective.updateProjectionMatrix();
    this.walkCamera.aspect = aspect;
    this.walkCamera.updateProjectionMatrix();
    // 俯視時讓整個平面圖剛好塞進畫面並留邊
    const margin = 1.15;
    const halfH = Math.max(this.bounds.depth, this.bounds.width / aspect) * margin * 0.5;
    Object.assign(this.ortho, { left: -halfH * aspect, right: halfH * aspect, top: halfH, bottom: -halfH });
    this.ortho.updateProjectionMatrix();
  }

  // 把房子外框的 8 個角投影到畫面上，調整距離直到最外側剛好落在畫面 90% 處；直式、橫式畫面都適用
  fitOrbit() {
    const { width, depth } = this.bounds;
    const corners = [];
    for (const x of [0, width]) for (const y of [0, 2.8]) for (const z of [0, -depth]) corners.push(new THREE.Vector3(x, y, z));
    const direction = new THREE.Vector3(-0.35, 0.95, 1).normalize();
    let distance = Math.hypot(width, depth) * 2;
    for (let i = 0; i < 12; i++) {
      this.perspective.position.copy(this.center).addScaledVector(direction, distance);
      this.perspective.lookAt(this.center);
      this.perspective.updateMatrixWorld();
      const extent = Math.max(...corners.map((c) => {
        const p = c.clone().project(this.perspective);
        return Math.max(Math.abs(p.x), Math.abs(p.y));
      }));
      distance *= extent / 0.9;
    }
    this.perspective.position.copy(this.center).addScaledVector(direction, distance);
    this.orbit.target.copy(this.center);
    this.orbit.update();
  }

  #moveWalker(dt) {
    if (!this.walk.isLocked || this.pressed.size === 0) return;
    const forward = (this.pressed.has('f') ? 1 : 0) - (this.pressed.has('b') ? 1 : 0);
    const right = (this.pressed.has('r') ? 1 : 0) - (this.pressed.has('l') ? 1 : 0);
    const step = WALK_SPEED * dt;
    const before = this.walkCamera.position.clone();
    this.walk.moveForward(forward * step);
    this.walk.moveRight(right * step);
    const after = this.walkCamera.position;
    // 撞牆時分軸嘗試，才能沿著牆滑動而不是整個卡住
    if (this.canWalkTo([after.x, -after.z])) return;
    if (this.canWalkTo([after.x, -before.z])) {
      after.z = before.z;
      return;
    }
    if (this.canWalkTo([before.x, -after.z])) {
      after.x = before.x;
      return;
    }
    after.copy(before);
  }

  #tick() {
    this.timer.update();
    const dt = Math.min(this.timer.getDelta(), 0.1);
    if (this.mode === 'walk') this.#moveWalker(dt);
    if (this.mode === 'orbit') this.orbit.update();
    this.renderer.render(this.scene, this.camera);
  }

  screenshot() {
    this.renderer.render(this.scene, this.camera);
    return new Promise((resolve) => this.renderer.domElement.toBlob(resolve, 'image/png'));
  }
}
