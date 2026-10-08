// 從指定圖層取出牆體多邊形
import { toNumber } from './dxf.js';
import { DxfFormatError } from './errors.js';
import { buildLoops } from './geometry.js';

// 公尺；使用時除以 unitScale 換成圖面單位
const SNAP_TOLERANCE = 0.005; // 端點距離在此以內視為同一點
const CLOSE_GAP = 0.25; // 開放鏈兩端距離在此以內直接補線封閉

export const inClip = (clip, [x, y]) => x >= clip.xMin && x <= clip.xMax && y >= clip.yMin && y <= clip.yMax;

function segments(entity) {
  if (entity.type === 'LINE') {
    return [[[entity.num(10), entity.num(20)], [entity.num(11), entity.num(21)]]];
  }
  if (entity.type !== 'LWPOLYLINE') return [];
  const xs = entity.all(10);
  const ys = entity.all(20);
  if (xs.length !== ys.length) throw new DxfFormatError(`LWPOLYLINE 的 x、y 座標數不一致（圖層 ${entity.layer}）`);
  const points = xs.map((x, i) => [toNumber(x), toNumber(ys[i])]);
  if (points.length && Number(entity.first(70) ?? '0') & 1) points.push(points[0]);
  return points.slice(1).map((p, i) => [points[i], p]);
}

// 回傳 { walls: [{ kind, polygon }], openChains }；openChains > 0 代表圖面有缺口要人工確認
export function extractWalls(doc, config) {
  // 同一圖層列在多個牆種時，後面的覆蓋前面的
  const kinds = new Map([
    ...config.layers.rcWall.map((name) => [name, 'rc']),
    ...config.layers.partition.map((name) => [name, 'partition']),
    ...config.layers.column.map((name) => [name, 'column']),
  ]);
  const byKind = new Map();
  for (const entity of doc.entities) {
    const kind = kinds.get(entity.layer);
    if (kind === undefined) continue;
    const segs = segments(entity);
    // 圖面上同一戶畫了好幾份，只取 clip 範圍內那份
    if (segs.length && inClip(config.clip, segs[0][0])) {
      if (!byKind.has(kind)) byKind.set(kind, []);
      byKind.get(kind).push(...segs);
    }
  }

  const walls = [];
  let openChains = 0;
  for (const [kind, segs] of byKind) {
    const [loops, chains] = buildLoops(segs, SNAP_TOLERANCE / config.unitScale, CLOSE_GAP / config.unitScale);
    for (const loop of loops) if (loop.length >= 3) walls.push({ kind, polygon: loop });
    openChains += chains.length;
  }
  return { walls, openChains };
}
