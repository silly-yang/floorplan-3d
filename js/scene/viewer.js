// 渲染器與三種視角：3D 環繞（orbit）、正上方俯視（top）、第一人稱漫遊（walk）
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { focusOn, zoomToward } from '../core/cameraMath.js';

const EYE_HEIGHT = 1.6;
const CEILING_PITCH = 0.55; // 看天花板時抬頭約 30°
const ANIMATION_SECONDS = 0.55;
const MAX_TOP_ZOOM = 8;
const WALK_SPEED = 1.6; // 公尺／秒
const MOVE_KEYS = { KeyW: 'f', ArrowUp: 'f', KeyS: 'b', ArrowDown: 'b', KeyA: 'l', ArrowLeft: 'l', KeyD: 'r', ArrowRight: 'r' };

export class Viewer {
  constructor(container, bounds) {
    this.container = container;
    this.bounds = bounds;
    this.mode = 'orbit';
    this.listeners = new Set();
    this.frameListeners = new Set();
    this.canWalkTo = () => true;
    this.pressed = new Set();
    this.timer = new THREE.Timer();

    // preserveDrawingBuffer 讓截圖時讀得到畫面
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // 電影常用的色調曲線：亮部不會一片死白，暗部保留細節
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.9;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#eef1f4');
    // 室內環境光反射：磁磚、金屬、玻璃才會有自然的反光
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.35;
    pmrem.dispose();
    this.#addLights();
    // 手機 GPU 較弱，環境光遮蔽預設關閉
    this.highQuality = !window.matchMedia('(max-width: 760px)').matches;
    this.animation = null;

    const center = new THREE.Vector3(bounds.width / 2, 0, -bounds.depth / 2);
    this.center = center;

    this.perspective = new THREE.PerspectiveCamera(50, 1, 0.05, 200);
    this.orbit = new OrbitControls(this.perspective, this.renderer.domElement);
    this.orbit.target.copy(center);
    this.orbit.maxPolarAngle = Math.PI * 0.48;
    this.orbit.enableDamping = true;
    // 使用者自己動鏡頭時，取消進行中的鏡頭動畫
    this.orbit.addEventListener('start', () => (this.animation = null));

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
    this.topControls.addEventListener('start', () => (this.animation = null));

    this.walkCamera = new THREE.PerspectiveCamera(70, 1, 0.05, 200);
    this.walk = new PointerLockControls(this.walkCamera, this.renderer.domElement);
    this.walk.addEventListener('unlock', () => this.#emit());
    this.walk.addEventListener('lock', () => this.#emit());

    // 換平面圖重建場景時，一次拿掉掛在 window 上的監聽
    this.abort = new AbortController();
    this.#bindKeys();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.fitOrbit();
    this.#rebuildComposer();
    this.renderer.setAnimationLoop(() => this.#tick());
  }

  #addLights() {
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#b8b0a4', 0.75));
    const sun = new THREE.DirectionalLight('#fff3e0', 2.4);
    const { width, depth } = this.bounds;
    // 太陽接近正上方，牆影才不會蓋掉大半地板
    sun.position.set(width / 2 - 2.5, 22, -depth / 2 + 3.5);
    sun.target.position.set(width / 2, 0, -depth / 2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const span = Math.max(width, depth);
    Object.assign(sun.shadow.camera, { left: -span, right: span, top: span, bottom: -span, near: 1, far: 60 });
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.02;
    sun.shadow.radius = 3;
    this.scene.add(sun, sun.target);
  }

  #bindKeys() {
    const isTyping = (e) => ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target?.tagName);
    const { signal } = this.abort;
    window.addEventListener('keydown', (e) => {
      if (this.mode === 'walk' && MOVE_KEYS[e.code] && !isTyping(e)) this.pressed.add(MOVE_KEYS[e.code]);
    }, { signal });
    window.addEventListener('keyup', (e) => this.pressed.delete(MOVE_KEYS[e.code]), { signal });
    window.addEventListener('blur', () => this.pressed.clear(), { signal });
  }

  // 停掉繪製迴圈、拿掉監聽並釋放 WebGL 資源；之後這個 viewer 不能再用
  dispose() {
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    this.abort.abort();
    if (this.walk.isLocked) this.walk.unlock();
    this.orbit.dispose();
    this.topControls.dispose();
    this.walk.dispose();
    this.composer?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
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

  // 每幀回呼（門的開關動畫用）
  onFrame(listener) {
    this.frameListeners.add(listener);
    return () => this.frameListeners.delete(listener);
  }

  // 漫遊時畫面正中央的射線（準星）
  centerRay(raycaster) {
    raycaster.setFromCamera(new THREE.Vector2(0, 0), this.walkCamera);
    return raycaster;
  }

  #emit() {
    this.listeners.forEach((l) => l(this.mode));
  }

  setMode(mode) {
    if (mode === this.mode) return;
    if (this.walk.isLocked) this.walk.unlock();
    this.savedView = null;
    this.mode = mode;
    this.orbit.enabled = mode === 'orbit';
    this.topControls.enabled = mode === 'top';
    if (mode === 'walk') {
      // 從最大房間的一端看向另一端（walkStart 由外部設定）；沒有就從房子中央朝北
      const start = this.walkStart ?? { x: this.center.x, z: this.center.z, yaw: 0 };
      this.walkCamera.position.set(start.x, EYE_HEIGHT, start.z);
      this.walkCamera.rotation.set(0, start.yaw, 0, 'YXZ');
    }
    this.resize();
    this.#rebuildComposer();
    this.#emit();
  }

  // ---------- 畫質 ----------

  setHighQuality(enabled) {
    this.highQuality = enabled;
    this.#rebuildComposer();
  }

  // 環境光遮蔽（牆角、家具底下的柔和陰影）；GTAO 綁定相機，換視角要重建
  #rebuildComposer() {
    this.composer?.dispose();
    this.composer = null;
    if (!this.highQuality) return;
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.composer = new EffectComposer(this.renderer);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    const ao = new GTAOPass(this.scene, this.camera, w, h);
    ao.updateGtaoMaterial({ radius: 0.45, distanceExponent: 1.4, thickness: 1.2, scale: 1.1 });
    ao.blendIntensity = 0.85;
    this.composer.addPass(ao);
    this.composer.addPass(new OutputPass());
  }

  // ---------- 鏡頭動畫：雙擊放大、全景、聚焦 ----------

  #animateOrbit(view) {
    this.animation = {
      kind: 'orbit',
      t: 0,
      fromPos: this.perspective.position.clone(),
      fromTarget: this.orbit.target.clone(),
      toPos: new THREE.Vector3(view.position.x, view.position.y, view.position.z),
      toTarget: new THREE.Vector3(view.target.x, view.target.y, view.target.z),
    };
  }

  #animateTop(target, zoom) {
    this.animation = {
      kind: 'top',
      t: 0,
      fromTarget: this.topControls.target.clone(),
      fromZoom: this.ortho.zoom,
      toTarget: new THREE.Vector3(target.x, 0, target.z),
      toZoom: zoom,
    };
  }

  // 雙擊切換：沒放大就放大到 point 並記住原視角；已放大就回到原視角
  toggleZoomAt(point) {
    if (this.savedView) {
      const view = this.savedView;
      this.savedView = null;
      if (view.mode === 'top') this.#animateTop(view.target, view.zoom);
      else this.#animateOrbit(view);
      return;
    }
    this.savedView =
      this.mode === 'top'
        ? { mode: 'top', target: this.topControls.target.clone(), zoom: this.ortho.zoom }
        : { mode: 'orbit', position: this.perspective.position.clone(), target: this.orbit.target.clone() };
    this.zoomAt(point);
  }

  // point：世界座標；雙擊的位置
  zoomAt(point) {
    if (this.mode === 'orbit') this.#animateOrbit(zoomToward(this.perspective.position, this.orbit.target, point));
    if (this.mode === 'top') this.#animateTop(point, Math.min(MAX_TOP_ZOOM, this.ortho.zoom * 2));
  }

  // 進漫遊並抬頭，天花板佔滿畫面；已在漫遊時只抬頭，不換位置
  lookAtCeiling() {
    this.setMode('walk');
    this.walkCamera.rotation.set(CEILING_PITCH, this.walkCamera.rotation.y, 0, 'YXZ');
  }

  // 不論目前是俯視或漫遊，都回到一開始的 3D 視角與大小
  resetView() {
    this.savedView = null;
    this.setMode('orbit');
    this.#animateOrbit(this.#fitView());
  }

  // item 需含 x、y、elevation、size；俯視時先切回 3D 才看得到正面
  focus(item) {
    if (this.mode !== 'orbit') this.setMode('orbit');
    this.#animateOrbit(focusOn(this.perspective.position, this.orbit.target, item));
  }

  #stepAnimation(dt) {
    const a = this.animation;
    if (!a) return;
    a.t = Math.min(1, a.t + dt / ANIMATION_SECONDS);
    const k = a.t * a.t * (3 - 2 * a.t);
    if (a.kind === 'orbit') {
      this.perspective.position.lerpVectors(a.fromPos, a.toPos, k);
      this.orbit.target.lerpVectors(a.fromTarget, a.toTarget, k);
    } else {
      this.topControls.target.lerpVectors(a.fromTarget, a.toTarget, k);
      this.ortho.position.set(this.topControls.target.x, 40, this.topControls.target.z + 1e-4);
      this.ortho.zoom = a.fromZoom + (a.toZoom - a.fromZoom) * k;
      this.ortho.updateProjectionMatrix();
    }
    if (a.t >= 1) this.animation = null;
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
    this.composer?.setSize(w, h);
  }

  // 把房子外框的 8 個角投影到畫面上，調整距離直到最外側剛好落在畫面 90% 處；直式、橫式畫面都適用
  #fitView() {
    const { width, depth } = this.bounds;
    const corners = [];
    for (const x of [0, width]) for (const y of [0, 2.8]) for (const z of [0, -depth]) corners.push(new THREE.Vector3(x, y, z));
    const direction = new THREE.Vector3(-0.35, 0.95, 1).normalize();
    const probe = this.perspective.clone();
    let distance = Math.hypot(width, depth) * 2;
    for (let i = 0; i < 12; i++) {
      probe.position.copy(this.center).addScaledVector(direction, distance);
      probe.lookAt(this.center);
      probe.updateMatrixWorld();
      const extent = Math.max(...corners.map((c) => {
        const p = c.clone().project(probe);
        return Math.max(Math.abs(p.x), Math.abs(p.y));
      }));
      distance *= extent / 0.9;
    }
    return { position: this.center.clone().addScaledVector(direction, distance), target: this.center.clone() };
  }

  fitOrbit() {
    const view = this.#fitView();
    this.perspective.position.copy(view.position);
    this.orbit.target.copy(view.target);
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
    this.#stepAnimation(dt);
    if (this.mode === 'orbit') this.orbit.update();
    if (this.mode === 'top') this.topControls.update();
    this.frameListeners.forEach((l) => l(dt));
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }

  screenshot() {
    if (this.composer) this.composer.render(0);
    else this.renderer.render(this.scene, this.camera);
    return new Promise((resolve) => this.renderer.domElement.toBlob(resolve, 'image/png'));
  }
}
