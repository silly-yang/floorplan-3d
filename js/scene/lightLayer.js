// 照明：燈具發光面、吊燈吊線、白天／夜晚切換、夜晚時的即時光源
// 燈具外觀由 furnitureLayer 建好（models.js），這裡只換發光面的材質，不另外建燈具模型
import * as THREE from 'three';
import { ceilingStateOf, ceilingZones } from '../core/ceilings.js';
import { planToWorld } from '../core/floorplan.js';
import { getCatalogItem } from '../furniture/catalog.js';
import {
  activeLightSources,
  ceilingHeightAt,
  colorTempToHex,
  isLight,
  lightIntensity,
  lightOptionsOf,
  MAX_LIGHT_SOURCES,
} from '../core/lighting.js';

// 場景的太陽是 2.4 而不是真實的十萬 lux；燭光直接用會整片過曝，等比例縮小到同一個尺度
const INTENSITY_SCALE = 0.006;
// 沒有牆面、天花板的反射光，四散型燈具照起來會比實際暗很多，補回來
const POINT_BOUNCE = 5;
const NIGHT = { hemi: 0.05, environment: 0.03, background: '#10151d' };
const FACE_GLOW = { day: 0.6, night: 3 };
const FACE_OFF = '#d9d9d5';
const COVE_LED = '#ffe2b0'; // 與 house.js 的燈帶顏色相同，白天要還原成它
const COVE_NIGHT_BOOST = 2.5;
const COVE_LUMENS = 900;
const COVE_MIN_AREA = 0.5; // 房間扣掉廚房後會切出細長的碎塊，碎塊不配光源，免得吃掉燈具的名額
const CORD_RADIUS = 0.004;
// 吸頂的四散型燈具：光源放在燈下方，貼著天花板的點光源會把燈正上方照成一片過曝
const CEILING_POINT_DROP = 0.5;
const LAMP_FACE_OFFSET = 0.03; // 聚光燈、吊燈的光源在發光面下方一點

export class LightLayer {
  constructor(scene, furnitureLayer, floorplan) {
    this.scene = scene;
    this.furnitureLayer = furnitureLayer;
    this.floorplan = floorplan;
    this.zones = ceilingZones(floorplan);
    this.root = new THREE.Group();
    this.root.name = 'lights';
    scene.add(this.root);
    this.night = false;
    this.design = null;
    this.sources = new Map();
    this.cords = new Map();
    this.faceMaterials = new Map();
    this.cordMaterial = new THREE.MeshStandardMaterial({ color: '#2b2d31', roughness: 0.6 });
    this.cordGeometry = new THREE.CylinderGeometry(CORD_RADIUS, CORD_RADIUS, 1, 6);
    this.house = null;
    // viewer 建好的半球光與太陽光；夜晚要調暗、關掉，白天還原
    this.hemi = scene.children.find((c) => c.isHemisphereLight) ?? null;
    this.sun = scene.children.find((c) => c.isDirectionalLight) ?? null;
    this.day = {
      hemi: this.hemi?.intensity ?? 0,
      environment: scene.environmentIntensity,
      background: scene.background?.clone() ?? null,
    };
  }

  // furnitureLayer 同步完之後再呼叫：模型重建後發光面會變回預設材質
  sync(design) {
    this.design = design;
    this.#syncFaces();
    this.#syncCords();
    this.#syncSources();
  }

  setNight(on) {
    this.night = on;
    if (this.hemi) this.hemi.intensity = on ? NIGHT.hemi : this.day.hemi;
    if (this.sun) this.sun.visible = !on;
    this.scene.environmentIntensity = on ? NIGHT.environment : this.day.environment;
    this.scene.background = on ? new THREE.Color(NIGHT.background) : this.day.background;
    this.house = null; // 強制重套燈帶亮度
    this.update();
    if (this.design) this.sync(this.design);
  }

  // 每幀：房子會因為改天花板、剖面而整個重建，新的燈帶材質要重套夜晚亮度
  update() {
    const house = this.scene.children.find((c) => c.name === 'house') ?? null;
    if (house === this.house) return;
    this.house = house;
    const color = new THREE.Color(COVE_LED);
    if (this.night) color.multiplyScalar(COVE_NIGHT_BOOST);
    house?.traverse((o) => {
      if (o.name === 'cove-led') o.traverse((m) => m.material?.color.copy(color));
    });
  }

  #faceMaterial({ on, colorTemp }) {
    const key = `${on}|${colorTemp}|${this.night}`;
    if (!this.faceMaterials.has(key)) {
      const hex = colorTempToHex(colorTemp);
      this.faceMaterials.set(
        key,
        on
          ? new THREE.MeshStandardMaterial({ color: hex, emissive: hex, emissiveIntensity: this.night ? FACE_GLOW.night : FACE_GLOW.day, roughness: 0.4 })
          : new THREE.MeshStandardMaterial({ color: FACE_OFF, roughness: 0.4 }),
      );
    }
    return this.faceMaterials.get(key);
  }

  #syncFaces() {
    for (const item of this.design.furniture) {
      if (!isLight(item)) continue;
      const model = this.furnitureLayer.entries.get(item.id)?.model;
      const material = this.#faceMaterial(lightOptionsOf(item));
      model?.traverse((o) => {
        if (o.userData.lightFace) o.material = material;
      });
    }
  }

  // 吊燈的吊線：從燈罩頂拉到所在位置的天花板
  #syncCords() {
    const { furniture, ceilings, ceilingHeight } = this.design;
    const alive = new Set();
    for (const item of furniture) {
      if (item.type !== 'pendant-light' || typeof item.elevation !== 'number') continue;
      const top = item.elevation + item.size.h / 100;
      const ceiling = ceilingHeightAt([item.x, item.y], this.floorplan, ceilings, ceilingHeight);
      const length = ceiling - top;
      if (length <= 0.01) continue;
      alive.add(item.id);
      let cord = this.cords.get(item.id);
      if (!cord) {
        cord = new THREE.Mesh(this.cordGeometry, this.cordMaterial);
        this.root.add(cord);
        this.cords.set(item.id, cord);
      }
      const p = planToWorld([item.x, item.y], top + length / 2);
      cord.position.set(p.x, p.y, p.z);
      cord.scale.y = length;
    }
    for (const [id, cord] of this.cords) {
      if (alive.has(id)) continue;
      this.root.remove(cord);
      this.cords.delete(id);
    }
  }

  // 造型天花板燈帶在夜晚的照明：每塊分區中央一顆暖色點光源
  #coveSpots() {
    const { ceilings, ceilingHeight } = this.design;
    return this.zones.flatMap((zone) => {
      const state = ceilingStateOf(ceilings, zone.id, this.floorplan);
      if (state.type !== 'cove') return [];
      const y = Math.min(state.height, ceilingHeight) + 0.06;
      return zone.rects.filter(([x0, y0, x1, y1]) => (x1 - x0) * (y1 - y0) >= COVE_MIN_AREA).map(([x0, y0, x1, y1], i) => ({
        key: `cove:${zone.id}:${i}`,
        kind: 'point',
        color: COVE_LED,
        intensity: (COVE_LUMENS / (4 * Math.PI)) * INTENSITY_SCALE * POINT_BOUNCE,
        position: planToWorld([(x0 + x1) / 2, (y0 + y1) / 2], y),
      }));
    });
  }

  // 白天不放光源（每多一盞即時光源，所有材質都要多算一次）；夜晚燈具優先，剩下的名額給燈帶
  #plan() {
    if (!this.night) return [];
    const lamps = activeLightSources(this.design.furniture, MAX_LIGHT_SOURCES).map((item) => {
      const spec = getCatalogItem(item.type).light;
      const spot = spec.kind === 'spot';
      const drop = spot || item.type === 'pendant-light' ? LAMP_FACE_OFFSET : CEILING_POINT_DROP;
      return {
        key: `lamp:${item.id}`,
        kind: spot ? 'spot' : 'point',
        beam: spec.beam,
        color: colorTempToHex(lightOptionsOf(item).colorTemp),
        intensity: lightIntensity(item) * INTENSITY_SCALE * (spot ? 1 : POINT_BOUNCE),
        position: planToWorld([item.x, item.y], (item.elevation ?? 0) - drop),
      };
    });
    return [...lamps, ...this.#coveSpots().slice(0, MAX_LIGHT_SOURCES - lamps.length)];
  }

  #syncSources() {
    const plan = this.#plan();
    const alive = new Set(plan.map((s) => s.key));
    for (const [key, light] of this.sources) {
      if (alive.has(key) && light.userData.kind === plan.find((s) => s.key === key).kind) continue;
      this.root.remove(light);
      if (light.target) this.root.remove(light.target);
      light.dispose();
      this.sources.delete(key);
    }
    for (const s of plan) {
      let light = this.sources.get(s.key);
      if (!light) {
        light = s.kind === 'spot' ? new THREE.SpotLight() : new THREE.PointLight();
        light.userData.kind = s.kind;
        light.decay = 2;
        light.castShadow = false;
        if (light.isSpotLight) {
          light.penumbra = 0.5;
          this.root.add(light.target);
        }
        this.root.add(light);
        this.sources.set(s.key, light);
      }
      light.color.set(s.color);
      light.intensity = s.intensity;
      light.position.set(s.position.x, s.position.y, s.position.z);
      if (light.isSpotLight) {
        light.angle = ((s.beam ?? 60) / 2) * (Math.PI / 180);
        light.target.position.set(s.position.x, 0, s.position.z);
      }
    }
  }
}
