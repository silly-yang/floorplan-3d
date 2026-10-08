// DXF 解析結果 → floorplan 物件（座標單位公尺、原點在牆體外框左下角、y 軸朝上）
// 設定欄位與 tools/overrides.json 相同：距離類（clip、gap、seed）用圖面單位，高度類（sill、head）用公尺
import { findBeams } from './beams.js';
import { ConfigError, FloorplanError } from './errors.js';
import { centroid, comparePoints, dist, pySum, roundHalfEven } from './geometry.js';
import { findOpenings } from './openings.js';
import { enclosedRegions, traceRoom } from './rooms.js';
import { extractWalls, inClip } from './walls.js';

const FLOORPLAN_VERSION = 1;
// 距離皆為公尺；使用時除以 unitScale 換成圖面單位
const CELL = 0.05; // 房間填色的格子大小
const ROOM_MARGIN = 0.5; // 種子填色範圍比牆體外框再大一圈，漏出牆外才碰得到邊界
// 欄杆等邊界線要加粗到至少一格，否則填色會從格子中心之間漏過去
const BARRIER_HALF_WIDTH = CELL;
const DECIMALS = 3; // 公尺到小數第三位＝公釐
const MIN_ROOM_AREA = 1; // 平方公尺；自動偵測時比這小的區域是管道間、牆縫，不算房間
const LAYER_KEYS = ['rcWall', 'partition', 'column', 'window', 'door', 'barrier', 'beam'];

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isStringList = (v) => Array.isArray(v) && v.every((s) => typeof s === 'string');

function positive(raw, key, problems) {
  if (raw[key] === undefined) problems.push(`${key}：缺少此欄位`);
  else if (!isNum(raw[key]) || raw[key] <= 0) problems.push(`${key}：必須是正數，收到 ${JSON.stringify(raw[key])}`);
}

// 驗證並補上預設值；一次收集所有錯誤再丟出
function resolveConfig(raw) {
  if (!raw || typeof raw !== 'object') throw new ConfigError(['設定必須是物件']);
  const problems = [];
  for (const key of ['unitScale', 'doorHead', 'doorwayHead', 'gapMin', 'gapMax']) positive(raw, key, problems);
  // 樑標註的單位（每單位幾公尺）；選填，沒給就與圖面相同
  if (raw.beamLabelScale !== undefined) positive(raw, 'beamLabelScale', problems);
  if (isNum(raw.gapMin) && isNum(raw.gapMax) && raw.gapMax <= raw.gapMin) problems.push(`gapMax：必須大於 gapMin（${raw.gapMin}），收到 ${raw.gapMax}`);

  const clip = raw.clip;
  if (!clip || !['xMin', 'yMin', 'xMax', 'yMax'].every((k) => isNum(clip[k]))) problems.push('clip：必須是含 xMin, yMin, xMax, yMax 四個數字的物件');
  else if (clip.xMin >= clip.xMax || clip.yMin >= clip.yMax) problems.push('clip：最小值必須小於最大值');

  const layers = {};
  if (!raw.layers || typeof raw.layers !== 'object') problems.push('layers：必須是物件');
  for (const key of LAYER_KEYS) {
    const names = raw.layers?.[key] ?? [];
    if (!isStringList(names)) problems.push(`layers.${key}：必須是圖層名稱字串陣列`);
    layers[key] = names;
  }

  const isWindowSpec = (spec) => isNum(spec?.sill) && isNum(spec?.head) && spec.sill >= 0 && spec.sill < spec.head;
  const windowTypes = raw.windowTypes ?? {};
  for (const [label, spec] of Object.entries(windowTypes)) {
    if (!isWindowSpec(spec)) problems.push(`windowTypes.${label}：需要 0 ≤ sill < head（公尺）`);
  }
  // 選填：沒有編號的窗用的高度；沒給就照舊視為錯誤
  if (raw.unlabeledWindow !== undefined && !isWindowSpec(raw.unlabeledWindow)) problems.push('unlabeledWindow：需要 0 ≤ sill < head（公尺）');

  const rooms = raw.rooms ?? [];
  if (!Array.isArray(rooms)) problems.push('rooms：必須是陣列');
  else {
    rooms.forEach((room, i) => {
      const seedOk = Array.isArray(room?.seed) && room.seed.length === 2 && room.seed.every(isNum);
      if (!seedOk || typeof room.id !== 'string' || typeof room.name !== 'string') {
        problems.push(`rooms[${i}]：需要字串 id、name 與 seed [x, y]`);
      }
    });
  }

  const ignoreOpenings = raw.ignoreOpenings ?? [];
  if (!isStringList(ignoreOpenings)) problems.push('ignoreOpenings：必須是字串陣列');

  if (problems.length) throw new ConfigError(problems);
  return { ...raw, layers, windowTypes, rooms, ignoreOpenings };
}

function thicken(a, b, halfWidth) {
  const length = dist(a, b);
  const [nx, ny] = [-(b[1] - a[1]) / length, (b[0] - a[0]) / length];
  const w = halfWidth;
  return [
    [a[0] + nx * w, a[1] + ny * w],
    [b[0] + nx * w, b[1] + ny * w],
    [b[0] - nx * w, b[1] - ny * w],
    [a[0] - nx * w, a[1] - ny * w],
  ];
}

function barrierLines(doc, config) {
  const result = [];
  for (const e of doc.entities) {
    if (!config.layers.barrier.includes(e.layer) || e.type !== 'LINE') continue;
    const a = [e.num(10), e.num(20)];
    const b = [e.num(11), e.num(21)];
    if (inClip(config.clip, a) && dist(a, b) > 0) result.push(thicken(a, b, BARRIER_HALF_WIDTH / config.unitScale));
  }
  return result;
}

// 牆、開口與座標換算；轉換與房間偵測共用
function analyse(doc, raw) {
  const config = resolveConfig(raw);
  const wallResult = extractWalls(doc, config);
  const walls = wallResult.walls.sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : comparePoints(centroid(a.polygon), centroid(b.polygon))));
  if (!walls.length) throw new FloorplanError('clip 範圍內找不到牆，請確認牆的圖層與 clip 設定');
  const openings = findOpenings(doc, walls, config);

  const points = walls.flatMap((w) => w.polygon);
  const [x0, y0] = [Math.min(...points.map((p) => p[0])), Math.min(...points.map((p) => p[1]))];
  const [x1, y1] = [Math.max(...points.map((p) => p[0])), Math.max(...points.map((p) => p[1]))];
  const scale = config.unitScale;
  const pt = (p) => [roundHalfEven((p[0] - x0) * scale, DECIMALS), roundHalfEven((p[1] - y0) * scale, DECIMALS)];
  const barriers = [...walls.map((w) => w.polygon), ...openings.map((o) => o.polygon), ...barrierLines(doc, config)];
  return { config, wallResult, walls, openings, box: [x0, y0, x1, y1], scale, pt, barriers };
}

function describeRoom(rects, pt) {
  const out = rects.map(([rx0, ry0, rx1, ry1]) => [...pt([rx0, ry0]), ...pt([rx1, ry1])]);
  const sizes = out.map(([a, b, c, d]) => (c - a) * (d - b));
  const largest = out[sizes.indexOf(Math.max(...sizes))];
  const center = [roundHalfEven((largest[0] + largest[2]) / 2, DECIMALS), roundHalfEven((largest[1] + largest[3]) / 2, DECIMALS)];
  return { rects: out, area: pySum(sizes), center };
}

// 有種子照種子命名；沒有就把 clip 內被牆圍住、沒碰到 clip 邊界、面積 ≥ 1 m² 的區域依面積由大到小編號
function roomsOf({ config, box, pt, barriers }) {
  const cell = CELL / config.unitScale;
  if (config.rooms.length) {
    const [x0, y0, x1, y1] = box;
    const margin = ROOM_MARGIN / config.unitScale;
    const area = { xMin: x0 - margin, yMin: y0 - margin, xMax: x1 + margin, yMax: y1 + margin };
    return config.rooms.map((room) => ({ id: room.id, name: room.name, ...describeRoom(traceRoom(room.seed, barriers, area, cell), pt) }));
  }
  return enclosedRegions(barriers, config.clip, cell)
    .map((rects) => describeRoom(rects, pt))
    .filter((room) => room.area >= MIN_ROOM_AREA)
    .sort((a, b) => b.area - a.area)
    .map((room, i) => ({ id: `room-${i + 1}`, name: `房間 ${i + 1}`, ...room }));
}

// 回傳 [{ id, name, rects, area, center }]：rects、center 為平面圖公尺座標，area 為平方公尺
export function detectRooms(doc, config) {
  return roomsOf(analyse(doc, config));
}

// 回傳 { floorplan, warnings }；warnings 給匯入的人看，不寫進 floorplan
// 不輸出圖面上的任何文字；水電、建商家具、天花板分區不在 DXF 匯入範圍，輸出空陣列
export function convertDxf(doc, config) {
  const analysis = analyse(doc, config);
  const { config: cfg, wallResult, walls, openings, box, scale, pt } = analysis;
  const warnings = [];
  if (wallResult.openChains) warnings.push(`有 ${wallResult.openChains} 段牆線沒有封閉，請對照檢查圖確認是否缺牆`);
  const unlabeled = openings.filter((o) => o.kind === 'window' && !o.label).length;
  if (unlabeled) {
    const { sill, head } = cfg.unlabeledWindow;
    warnings.push(`有 ${unlabeled} 個窗沒有編號，用預設高度（窗台 ${sill} m、窗頂 ${head} m），可以在預覽時點窗修改`);
  }
  const [x0, y0, x1, y1] = box;
  const floorplan = {
    version: FLOORPLAN_VERSION,
    units: 'm',
    bounds: { width: roundHalfEven((x1 - x0) * scale, DECIMALS), depth: roundHalfEven((y1 - y0) * scale, DECIMALS) },
    walls: walls.map((w, i) => ({ id: `wall-${i + 1}`, kind: w.kind, polygon: w.polygon.map(pt) })),
    openings: openings.map((o) => ({ id: o.id, kind: o.kind, label: o.label, polygon: o.polygon.map(pt), sill: o.sill, head: o.head })),
    rooms: roomsOf(analysis).map(({ id, name, rects }) => ({ id, name, rects })),
    // 大樑：平面範圍與樑深（公尺）
    beams: findBeams(doc, cfg).map((b) => ({
      rect: [...pt([b.rect[0], b.rect[1]]), ...pt([b.rect[2], b.rect[3]])],
      depth: roundHalfEven(b.depth * scale, DECIMALS),
    })),
    ceilingZones: [],
    fixtures: [],
    outlets: [],
  };
  return { floorplan, warnings };
}
