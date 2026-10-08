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
