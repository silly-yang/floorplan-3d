// floorplan.json 的驗證與 3D 量體計算；不依賴 Three.js，可在 node 測試

export const FLOORPLAN_VERSION = 1;
export const GLASS_THICKNESS = 0.02;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isPolygon = (p) =>
  Array.isArray(p) && p.length >= 3 && p.every((pt) => Array.isArray(pt) && pt.length === 2 && pt.every(isNum));

export function validateFloorplan(fp) {
  if (!fp || typeof fp !== 'object') return ['平面圖資料不是物件'];
  const errors = [];
  if (fp.version !== FLOORPLAN_VERSION) errors.push(`version 必須是 ${FLOORPLAN_VERSION}，收到 ${fp.version}`);
  if (!isNum(fp.bounds?.width) || !isNum(fp.bounds?.depth)) errors.push('bounds 需要 width 與 depth 數字');
  for (const key of ['walls', 'openings', 'rooms']) {
    if (!Array.isArray(fp[key])) errors.push(`${key} 必須是陣列`);
  }
  (fp.walls ?? []).forEach((w, i) => {
    if (!isPolygon(w?.polygon)) errors.push(`walls[${i}].polygon 至少要 3 個 [x, y] 點`);
  });
  (fp.openings ?? []).forEach((o, i) => {
    if (!isPolygon(o?.polygon)) errors.push(`openings[${i}].polygon 至少要 3 個 [x, y] 點`);
    for (const k of ['sill', 'head']) {
      if (!isNum(o?.[k])) errors.push(`openings[${i}].${k} 必須是數字`);
    }
  });
  (fp.rooms ?? []).forEach((r, i) => {
    const ok = Array.isArray(r?.rects) && r.rects.every((rc) => Array.isArray(rc) && rc.length === 4 && rc.every(isNum));
    if (!ok) errors.push(`rooms[${i}].rects 必須是 [x0, y0, x1, y1] 陣列`);
  });
  return errors;
}

// 回傳要擠出的量體：{ id, kind, polygon, bottom, top }，單位公尺、平面座標 y 朝上
// 牆在開口處本來就斷開；這裡補回窗台以下（sill）與開口頂以上（lintel）的牆
export function buildSolids(fp, ceilingHeight) {
  const solids = fp.walls.map((w) => ({ id: w.id, kind: w.kind, polygon: w.polygon, bottom: 0, top: ceilingHeight }));
  for (const o of fp.openings) {
    if (o.sill > 0) {
      solids.push({ id: `${o.id}-sill`, kind: 'sill', polygon: o.polygon, bottom: 0, top: Math.min(o.sill, ceilingHeight) });
    }
    if (o.head < ceilingHeight) {
      solids.push({ id: `${o.id}-lintel`, kind: 'lintel', polygon: o.polygon, bottom: o.head, top: ceilingHeight });
    }
  }
  return solids;
}

// 開口矩形的長軸方向與中線，用來放玻璃、門片
export function openingAxis(polygon) {
  const [a, b, c] = polygon;
  const ab = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const bc = Math.hypot(c[0] - b[0], c[1] - b[1]);
  // 長邊是開口寬度、短邊是牆厚
  const [p, q, r] = ab >= bc ? [a, b, c] : [b, c, a];
  const width = Math.max(ab, bc);
  const thickness = Math.min(ab, bc);
  const dir = [(q[0] - p[0]) / width, (q[1] - p[1]) / width];
  const across = [(r[0] - q[0]) / thickness, (r[1] - q[1]) / thickness];
  const start = [p[0] + (across[0] * thickness) / 2, p[1] + (across[1] * thickness) / 2];
  return { start, dir, across, width, thickness };
}

// 窗戶玻璃：開口矩形沿長軸置中、厚度 GLASS_THICKNESS 的細長矩形
export function buildGlass(fp) {
  return fp.openings
    .filter((o) => o.kind === 'window')
    .map((o) => {
      const { start, dir, across, width } = openingAxis(o.polygon);
      const h = GLASS_THICKNESS / 2;
      const end = [start[0] + dir[0] * width, start[1] + dir[1] * width];
      const off = (p, s) => [p[0] + across[0] * h * s, p[1] + across[1] * h * s];
      return {
        id: `${o.id}-glass`,
        polygon: [off(start, -1), off(end, -1), off(end, 1), off(start, 1)],
        bottom: o.sill,
        top: o.head,
      };
    });
}

// 平面座標 (x, y) → Three.js 世界座標：x 不變、平面 y 朝上 → 世界 -z
export function planToWorld([x, y], height = 0) {
  return { x, y: height, z: -y };
}
