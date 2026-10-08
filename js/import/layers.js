// 圖層統計與用途猜測：給匯入精靈「指定圖層」那一步用

// 每個圖層的圖元數、座標外框與各類型數量；只算 ENTITIES，圖塊定義不計
export function summarizeLayers(doc) {
  const byName = new Map();
  for (const entity of doc.entities) {
    let layer = byName.get(entity.layer);
    if (!layer) {
      layer = { name: entity.layer, count: 0, bbox: null, types: {} };
      byName.set(entity.layer, layer);
    }
    layer.count += 1;
    layer.types[entity.type] = (layer.types[entity.type] ?? 0) + 1;
    const xs = [...entity.all(10), ...entity.all(11)].map(Number);
    const ys = [...entity.all(20), ...entity.all(21)].map(Number);
    for (let i = 0; i < Math.min(xs.length, ys.length); i += 1) {
      const [x, y] = [xs[i], ys[i]];
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      const b = layer.bbox;
      layer.bbox = b ? [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)] : [x, y, x, y];
    }
  }
  return [...byName.values()].sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

// 常見的圖層命名；WIN 要獨立成詞，避免 WINDSOR 這類字誤判
const ROLE_PATTERNS = {
  wall: /wall|牆|墙/i,
  window: /window|(?<![a-z])win(?![a-z])|窗/i,
  door: /door|門|门/i,
  beam: /beam|梁|樑/i,
};

export function guessLayerRoles(summary) {
  const roles = {};
  for (const [role, pattern] of Object.entries(ROLE_PATTERNS)) {
    roles[role] = summary.filter((layer) => pattern.test(layer.name)).map((layer) => layer.name);
  }
  return roles;
}
