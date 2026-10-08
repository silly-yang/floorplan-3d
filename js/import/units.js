// 圖面單位判斷：給匯入精靈「確認單位」那一步用
// 檔頭的 $INSUNITS 常常寫錯（例如寫公釐、實際畫公分），所以拿牆的外框尺寸互相印證
import { detectUnitScale } from './dxf.js';
import { inClip } from './walls.js';

const CANDIDATES = [0.001, 0.01, 1];
const MIN_LONG_SIDE = 3; // 公尺；一戶住家外框長邊的合理範圍
const MAX_LONG_SIDE = 60;

// layers 可給圖層名稱陣列，或設定格式的 layers 物件（取牆、隔間、柱子）
function wallLayers(layers) {
  if (Array.isArray(layers)) return layers;
  if (!layers) return [];
  return [...(layers.rcWall ?? []), ...(layers.partition ?? []), ...(layers.column ?? [])];
}

// 回傳外框長邊（圖面單位）；沒有任何點回 null
function longSide(entities, clip) {
  let box = null;
  for (const e of entities) {
    const xs = [...e.all(10), ...e.all(11)].map(Number);
    const ys = [...e.all(20), ...e.all(21)].map(Number);
    for (let i = 0; i < Math.min(xs.length, ys.length); i += 1) {
      const p = [xs[i], ys[i]];
      if (!Number.isFinite(p[0]) || !Number.isFinite(p[1]) || (clip && !inClip(clip, p))) continue;
      box = box ? [Math.min(box[0], p[0]), Math.min(box[1], p[1]), Math.max(box[2], p[0]), Math.max(box[3], p[1])] : [...p, ...p];
    }
  }
  return box && Math.max(box[2] - box[0], box[3] - box[1]);
}

const plausible = (long, scale) => long * scale >= MIN_LONG_SIDE && long * scale <= MAX_LONG_SIDE;

// 回傳 { scale, source, headerScale }：檔頭合理就用檔頭；不合理但外框只有一個合理倍率就用外框；否則照檔頭
export function suggestUnitScale(doc, { layers, clip } = {}) {
  const headerScale = detectUnitScale(doc);
  const names = wallLayers(layers);
  const onWalls = doc.entities.filter((e) => names.includes(e.layer));
  const long = (onWalls.length ? longSide(onWalls, clip) : null) ?? longSide(doc.entities, clip);
  if (long === null || (headerScale !== null && plausible(long, headerScale))) {
    return { scale: headerScale, source: 'header', headerScale };
  }
  const fits = CANDIDATES.filter((scale) => plausible(long, scale));
  if (fits.length === 1) return { scale: fits[0], source: 'extent', headerScale };
  return { scale: headerScale, source: 'header', headerScale };
}
