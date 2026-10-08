// 天花板：形式、分區（房間扣掉建商已做好的區域）、各區設定；單位公尺，不依賴 Three.js
export const CEILING_TYPES = [
  { id: 'exposed', name: '不包（原始樓板）', icon: 'ceiling-exposed' },
  { id: 'beam-wrap', name: '包樑', icon: 'ceiling-beam' },
  { id: 'flat', name: '平釘天花板', icon: 'ceiling-flat' },
  { id: 'cove', name: '造型＋間接照明', icon: 'ceiling-cove' },
];

export const DEFAULT_FLAT_HEIGHT = 2.6; // 廚房上方 J15 樑底就在 2.6 m，平釘齊樑底最自然
const MIN_SIZE = 1e-6;

const valid = ([x0, y0, x1, y1]) => x1 - x0 > MIN_SIZE && y1 - y0 > MIN_SIZE;

export function clipRect(a, b) {
  const r = [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])];
  return valid(r) ? r : null;
}

// 矩形 [x0, y0, x1, y1]；a 扣掉 cut 後剩下的矩形（最多 4 塊：下、上、左、右）
export function subtractRect(a, cut) {
  const c = clipRect(a, cut);
  if (!c) return [a];
  return [
    [a[0], a[1], a[2], c[1]],
    [a[0], c[3], a[2], a[3]],
    [a[0], c[1], c[0], c[3]],
    [c[2], c[1], a[2], c[3]],
  ].filter(valid);
}

// 天花板分區：每個房間扣掉 floorplan.ceilingZones 的範圍，再加上這些區域本身
export function ceilingZones(floorplan) {
  const special = floorplan.ceilingZones ?? [];
  const rooms = floorplan.rooms.map((room) => ({
    id: room.id,
    name: room.name,
    rects: special.reduce((rects, zone) => rects.flatMap((r) => subtractRect(r, zone.rect)), room.rects),
  }));
  return [...rooms, ...special.map((z) => ({ id: z.id, name: z.name, rects: [z.rect], builtIn: true }))];
}

// 沒設定時：建商做好的區域（例如廚房）是平釘、離地 2.6 m；其他是不包
export function ceilingStateOf(ceilings, zoneId, floorplan) {
  const builtIn = (floorplan.ceilingZones ?? []).some((z) => z.id === zoneId);
  const fallback = { type: builtIn ? 'flat' : 'exposed', height: DEFAULT_FLAT_HEIGHT };
  return { ...fallback, ...(ceilings?.[zoneId] ?? {}) };
}
