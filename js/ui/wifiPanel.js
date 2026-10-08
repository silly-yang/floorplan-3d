// 「網路」分頁的各房間訊號評分，以及左下「WiFi 熱圖」的開關
import { obstaclesOf, roomRatings, wirelessDevices } from '../core/wifi.js';
import { WifiLayer } from '../scene/wifiLayer.js';
import { $, el, toast } from './dom.js';

const DEBOUNCE_MS = 150; // 拖曳設備時不要每一幀都重算
const GRADE_COLORS = { excellent: '#2e9e5b', good: '#8fb31d', fair: '#e08a1e', poor: '#d0453a' };

// 只有無線設備的位置會影響訊號；其他家具動了不用重算
const deviceKey = (furniture) => JSON.stringify(wirelessDevices(furniture));

function renderRatings(list, floorplan, obstacles, furniture) {
  const devices = wirelessDevices(furniture);
  if (devices.length === 0) {
    list.replaceChildren(el('li', { class: 'hint-text' }, '還沒有放無線設備。先從上方清單放一台路由器（可以放在電視櫃或桌上），就會估算各房間的訊號。'));
    return;
  }
  list.replaceChildren(
    ...roomRatings(floorplan.rooms, devices, obstacles).map((r) =>
      el('li', { class: 'wifi-rating' },
        el('div', { class: 'wifi-rating-head' },
          el('strong', {}, r.name),
          el('span', { class: 'wifi-grade', style: `background:${GRADE_COLORS[r.grade.id]}` }, r.grade.label),
        ),
        el('div', { class: 'dims' }, `平均 ${Math.round(r.avg)} dBm・最弱 ${Math.round(r.min)} dBm・隔 ${r.walls} 道牆`),
        r.suggestion ? el('p', { class: 'warn' }, r.suggestion) : null,
      )),
  );
}

export function setupWifiPanel({ store, floorplan, viewer }) {
  const obstacles = obstaclesOf(floorplan);
  const layer = new WifiLayer(viewer.scene, floorplan);
  const list = $('#wifi-ratings');
  let heatmapOn = false;
  let lastKey = null;
  let timer = null;

  const refresh = () => {
    timer = null;
    const { furniture } = store.getState();
    const key = deviceKey(furniture);
    if (key === lastKey) return;
    lastKey = key;
    renderRatings(list, floorplan, obstacles, furniture);
    // 熱圖關著時不畫，打開時再補算
    if (heatmapOn) layer.update(furniture);
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(refresh, DEBOUNCE_MS);
  };
  store.subscribe(schedule);
  refresh();

  return {
    setHeatmap(on) {
      heatmapOn = on;
      layer.setVisible(on);
      if (!on) return;
      const count = layer.update(store.getState().furniture);
      if (count === 0) toast('還沒有放無線設備，先到「網路」分頁放一台路由器');
      // 俯視最容易看出哪裡訊號弱
      if (viewer.mode !== 'top') viewer.setMode('top');
    },
  };
}
