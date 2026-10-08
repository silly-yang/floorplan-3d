// 鏡頭計算：雙擊放大、聚焦家具、雙擊判斷；座標為世界座標 { x, y, z }，不依賴 Three.js

export const ZOOM_FACTOR = 0.5;
export const MIN_DISTANCE = 1.2;
const FOCUS_SCALE = 2.2; // 聚焦時鏡頭距離＝家具最大邊長 × 這個倍數
const FOCUS_MARGIN = 0.8;

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const len = (a) => Math.hypot(a.x, a.y, a.z);

// 從 target 沿 (camera - target) 方向退 distance
function backOff(camera, target, newTarget, distance) {
  const offset = sub(camera, target);
  const scale = distance / (len(offset) || 1);
  return { x: newTarget.x + offset.x * scale, y: newTarget.y + offset.y * scale, z: newTarget.z + offset.z * scale };
}

// 放大到 point：視線方向不變，目標移到 point，距離縮為 factor 倍（不小於 minDistance）
export function zoomToward(camera, target, point, { factor = ZOOM_FACTOR, minDistance = MIN_DISTANCE } = {}) {
  const distance = Math.max(minDistance, len(sub(camera, target)) * factor);
  return { target: { ...point }, position: backOff(camera, target, point, distance) };
}

// 聚焦一件家具：鏡頭從目前方向看向家具中心，距離依家具大小決定
export function focusOn(camera, target, item) {
  const { w, d, h } = item.size;
  const center = { x: item.x, y: (item.elevation ?? 0) + h / 200, z: -item.y };
  const distance = Math.max(MIN_DISTANCE, (Math.max(w, d, h) / 100) * FOCUS_SCALE + FOCUS_MARGIN);
  return { target: center, position: backOff(camera, target, center, distance) };
}

// 雙擊（雙點）判斷：兩次點擊間隔與位移都夠小才算
export function createDoubleTapDetector({ maxDelay = 320, maxDistance = 24 } = {}) {
  let last = null;
  return {
    tap(x, y, time) {
      const isDouble = last !== null && time - last.time <= maxDelay && Math.hypot(x - last.x, y - last.y) <= maxDistance;
      // 雙擊成立後清掉，第三下要重新算
      last = isDouble ? null : { x, y, time };
      return isDouble;
    },
  };
}

const WALK_START_RATIO = 0.2; // 站在長邊這個比例處，看向另一端，視野裡的天花板最多

const rectArea = ([x0, y0, x1, y1]) => (x1 - x0) * (y1 - y0);

// 漫遊起點：面積最大的房間裡最大的一塊矩形；回傳世界座標 { x, z, yaw }，沒有房間回 null
export function walkStart(rooms) {
  const areaOf = (room) => room.rects.reduce((s, r) => s + rectArea(r), 0);
  const biggest = rooms.reduce((best, room) => (best === null || areaOf(room) > areaOf(best) ? room : best), null);
  if (!biggest) return null;
  const [x0, y0, x1, y1] = biggest.rects.reduce((best, r) => (rectArea(r) > rectArea(best) ? r : best));
  // yaw 0 看向平面的 +y（世界 -z）；-π/2 看向 +x
  if (x1 - x0 >= y1 - y0) return { x: x0 + (x1 - x0) * WALK_START_RATIO, z: -(y0 + y1) / 2, yaw: -Math.PI / 2 };
  return { x: (x0 + x1) / 2, z: -(y0 + (y1 - y0) * WALK_START_RATIO), yaw: 0 };
}
