// 沙發座墊分塊；不依賴 Three.js
const TARGET_WIDTH = 0.65; // 一般一人座墊約 65 cm
const GAP = 0.01; // 座墊之間的縫

// 座面寬 width（公尺）切成幾塊座墊；回傳每塊的中心（以座面中心為原點）與寬度
export function cushionSpans(width) {
  const count = Math.max(1, Math.round(width / TARGET_WIDTH));
  const each = (width - GAP * (count - 1)) / count;
  return Array.from({ length: count }, (_, i) => ({ center: -width / 2 + each / 2 + i * (each + GAP), width: each }));
}
