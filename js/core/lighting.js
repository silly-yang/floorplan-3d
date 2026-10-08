// 照明：燈具選項、所在天花板高度、安裝高度、提醒、色溫顏色、光源強度；單位公尺，不依賴 Three.js
import { getCatalogItem } from '../furniture/catalog.js';
import { ceilingStateOf, ceilingZones } from './ceilings.js';

export const COLOR_TEMPS = [2700, 3000, 4000];
export const LIGHT_DEFAULTS = { on: true, colorTemp: 3000 };
export const MAX_LIGHT_SOURCES = 16; // 手機 GPU 每多一盞即時光源就重算一次所有材質，太多會卡死

const PENDANT_DROP = 0.8; // 吊燈燈罩底在天花板下 80 cm
const PENDANT_MIN_BOTTOM = 2.1; // 但至少離地 2.1 m，走過去才不會撞頭
const PENDANT_COMFORT = 2.8; // 天花板低於這個高度掛吊燈會有壓迫感
const NO_CEILING_TYPES = new Set(['exposed', 'beam-wrap']); // 沒有封板，嵌燈沒地方嵌

// 色溫對應的燈光顏色（黑體輻射近似值）
const TEMP_HEX = { 2700: '#ffa757', 3000: '#ffb46b', 4000: '#ffd1a3' };

const mm = (v) => Math.round(v * 1000) / 1000;

export function isLight(item) {
  return getCatalogItem(item?.type)?.category === 'light';
}

export function lightOptionsOf(item) {
  const options = item?.options ?? {};
  return {
    on: typeof options.on === 'boolean' ? options.on : LIGHT_DEFAULTS.on,
    colorTemp: COLOR_TEMPS.includes(options.colorTemp) ? options.colorTemp : LIGHT_DEFAULTS.colorTemp,
  };
}

const inRect = ([x, y], [x0, y0, x1, y1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1;

// 點所在的天花板分區設定；不在任何分區時當作原始樓板
function ceilingAt(point, floorplan, ceilings) {
  const zone = ceilingZones(floorplan).find((z) => z.rects.some((r) => inRect(point, r)));
  return zone ? ceilingStateOf(ceilings, zone.id, floorplan) : { type: 'exposed' };
}

// 平釘、造型用該區設定高度（不會高過樓板）；不包、包樑看到的是樓板底
export function ceilingHeightAt(point, floorplan, ceilings, slabHeight) {
  const state = ceilingAt(point, floorplan, ceilings);
  if (state.type === 'flat' || state.type === 'cove') return Math.min(state.height, slabHeight);
  return slabHeight;
}

// 吸頂燈具的離地高度（燈具底面）；吊燈往下吊，但不能高過天花板
export function lightElevation(item, floorplan, ceilings, slabHeight) {
  const ceiling = ceilingHeightAt([item.x, item.y], floorplan, ceilings, slabHeight);
  const h = item.size.h / 100;
  if (item.type === 'pendant-light') {
    return mm(Math.min(ceiling - h, Math.max(PENDANT_MIN_BOTTOM, ceiling - PENDANT_DROP)));
  }
  return mm(ceiling - h);
}

export function lightingIssues(item, floorplan, ceilings, slabHeight) {
  if (!isLight(item)) return [];
  const point = [item.x, item.y];
  const issues = [];
  if (item.type === 'downlight' && NO_CEILING_TYPES.has(ceilingAt(point, floorplan, ceilings).type)) {
    issues.push({ kind: 'no-ceiling', message: '這一區沒有封天花板（不包／包樑），嵌燈沒有地方嵌；改用吸頂燈、軌道燈，或把這區改成平釘' });
  }
  if (item.type === 'pendant-light') {
    const height = ceilingHeightAt(point, floorplan, ceilings, slabHeight);
    if (height < PENDANT_COMFORT - 1e-9) {
      issues.push({ kind: 'low-ceiling', message: `天花板只有 ${height.toFixed(2)} m，掛吊燈會有壓迫感；建議 2.8 m 以上再用吊燈` });
    }
  }
  return issues;
}

// 不在選項裡的色溫取最接近的
export function colorTempToHex(kelvin) {
  const nearest = COLOR_TEMPS.reduce((best, t) => (Math.abs(t - kelvin) < Math.abs(best - kelvin) ? t : best));
  return TEMP_HEX[nearest];
}

// Three.js 的光源強度單位是燭光（cd）：點光源光通量平均到 4π 球面，聚光燈集中在光束圓錐內
export function lightIntensity(item) {
  const spec = getCatalogItem(item?.type)?.light;
  if (!spec) return 0;
  if (spec.kind === 'spot') {
    const half = ((spec.beam / 2) * Math.PI) / 180;
    return spec.lumens / (2 * Math.PI * (1 - Math.cos(half)));
  }
  return spec.lumens / (4 * Math.PI);
}

// 要配真正光源的燈：只算開著的，超過上限的只剩發光面
export function activeLightSources(furniture, limit = MAX_LIGHT_SOURCES) {
  return furniture.filter((f) => isLight(f) && lightOptionsOf(f).on).slice(0, limit);
}

// 天花板形式或高度改了，存好的燈具高度就過期；跟天花板變更放在同一次 commit，復原才會一起回去
export function relevelLights(design, floorplan) {
  let changed = false;
  const furniture = design.furniture.map((f) => {
    if (!isLight(f)) return f;
    const elevation = lightElevation(f, floorplan, design.ceilings, design.ceilingHeight);
    if (f.elevation === elevation) return f;
    changed = true;
    return { ...f, elevation };
  });
  return changed ? { ...design, furniture } : design;
}
