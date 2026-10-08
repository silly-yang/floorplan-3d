// 電視：吋數換算尺寸、壁掛高度、觀看距離；單位公尺（尺寸為公分），不依賴 Three.js
export const TV_INCHES = [43, 50, 55, 65, 75, 85];
export const TV_DEFAULTS = { inch: 55, mount: 'stand', centerHeight: 110 };
export const CENTER_HEIGHT_LIMITS = [60, 200];
export const INCH_LIMITS = [32, 100];

const TV_WATTS = { 43: 80, 50: 100, 55: 120, 65: 160, 75: 220, 85: 300 };
const BEZEL = 1; // 邊框合計約 1 cm
const STAND_LIFT = 6; // 腳座把機身墊高的高度
const DEPTH = { wall: 4, stand: 25 }; // 壁掛機身厚；放櫃上連腳座的深度
const SEATS = new Set(['sofa', 'armchair']);
const DIAGONAL = Math.hypot(16, 9);

const round = (v, digits = 6) => Math.round(v * 10 ** digits) / 10 ** digits;

export function tvOptionsOf(item) {
  return { ...TV_DEFAULTS, ...item?.options };
}

export function isWallTv(item) {
  return item?.type === 'tv' && tvOptionsOf(item).mount === 'wall';
}

// 16:9 由對角線換算機身寬高
export function tvSize(inch, mount) {
  const diagonal = inch * 2.54;
  const w = Math.round((diagonal * 16) / DIAGONAL + BEZEL);
  const h = Math.round((diagonal * 9) / DIAGONAL + BEZEL);
  return mount === 'wall' ? { w, d: DEPTH.wall, h } : { w, d: DEPTH.stand, h: h + STAND_LIFT };
}

// 表上的吋數照表；表與表之間線性內插；超出表的範圍依螢幕面積比例推算，取到 5 W
export function tvWatts(inch) {
  if (TV_WATTS[inch]) return TV_WATTS[inch];
  const known = Object.keys(TV_WATTS).map(Number).sort((a, b) => a - b);
  const to5 = (w) => Math.round(w / 5) * 5;
  const lo = known.filter((k) => k < inch).pop();
  const hi = known.find((k) => k > inch);
  if (lo === undefined) return to5(TV_WATTS[hi] * (inch / hi) ** 2);
  if (hi === undefined) return to5(TV_WATTS[lo] * (inch / lo) ** 2);
  return to5(TV_WATTS[lo] + ((TV_WATTS[hi] - TV_WATTS[lo]) * (inch - lo)) / (hi - lo));
}

// 壁掛底部離地（公尺）＝螢幕中心高度 − 機身高的一半
export function tvElevation(inch, centerHeight) {
  return round((centerHeight - tvSize(inch, 'wall').h / 2) / 100);
}

// 4K 建議觀看距離：對角線的 1～1.5 倍（公尺）
export function viewingDistance(inch) {
  const diagonal = inch * 0.0254;
  return { min: round(diagonal, 2), max: round(diagonal * 1.5, 2) };
}

// 到最近的沙發或單椅中心的水平距離（公尺）；沒有座位回 null
export function nearestSeatDistance(tv, furniture) {
  const distances = furniture.filter((f) => SEATS.has(f.type)).map((f) => Math.hypot(f.x - tv.x, f.y - tv.y));
  return distances.length ? round(Math.min(...distances)) : null;
}

// 換吋數、放置方式或中心高度時要一起改的欄位；換放置方式時背面留在原處（深度差的一半往前或往後挪）
// 放櫃上要拿掉 elevation，離地高度才會交給檯面推算
export function tvChange(item, patch) {
  const current = tvOptionsOf(item);
  const options = { ...current, ...patch };
  const [lo, hi] = CENTER_HEIGHT_LIMITS;
  options.centerHeight = Math.min(hi, Math.max(lo, Math.round(options.centerHeight)));
  options.inch = Math.min(INCH_LIMITS[1], Math.max(INCH_LIMITS[0], Math.round(options.inch)));
  const size = tvSize(options.inch, options.mount);
  const forward = (size.d - item.size.d) / 200;
  const rad = (item.rotation * Math.PI) / 180;
  const moved = options.mount === current.mount ? 0 : forward;
  return {
    options,
    size,
    x: round(item.x + Math.sin(rad) * moved),
    y: round(item.y - Math.cos(rad) * moved),
    elevation: options.mount === 'wall' ? tvElevation(options.inch, options.centerHeight) : undefined,
  };
}
