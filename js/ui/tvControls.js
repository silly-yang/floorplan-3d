// 屬性面板裡的電視設定：吋數、放置方式、壁掛中心高度、觀看距離；不是電視時回傳空陣列
import { CENTER_HEIGHT_LIMITS, INCH_LIMITS, TV_INCHES, nearestSeatDistance, tvOptionsOf, tvSize, tvWatts, viewingDistance } from '../core/tv.js';
import { el } from './dom.js';

const MOUNTS = [
  ['stand', '放櫃上'],
  ['wall', '壁掛'],
];

function choices(label, items, current, onPick) {
  return el(
    'div',
    { class: 'field' },
    el('span', {}, label),
    el(
      'div',
      { class: 'row', role: 'group', 'aria-label': label },
      items.map(([id, text]) =>
        el(
          'button',
          { type: 'button', class: `btn small ${id === current ? 'primary' : ''}`, 'aria-pressed': String(id === current), onclick: () => onPick(id) },
          text,
        ),
      ),
    ),
  );
}

function centerHeightField(editor, centerHeight) {
  const [min, max] = CENTER_HEIGHT_LIMITS;
  const input = el('input', { type: 'number', min: String(min), max: String(max), step: '1', value: String(centerHeight), class: 'tv-center-input' });
  input.addEventListener('change', () => {
    const cm = Number(input.value);
    if (input.value === '' || !Number.isFinite(cm)) {
      input.value = String(tvOptionsOf(editor.selected).centerHeight);
      return;
    }
    editor.setTvOptions({ centerHeight: cm });
  });
  return el('label', { class: 'field' }, el('span', {}, `螢幕中心離地（${min}～${max} 公分）`), input);
}

// 吋數：可以直接填（例如 60 吋），旁邊是常見吋數的快選
function inchField(editor, inch) {
  const [min, max] = INCH_LIMITS;
  const input = el('input', { type: 'number', min: String(min), max: String(max), step: '1', value: String(inch), class: 'tv-inch-input' });
  input.addEventListener('change', () => {
    const value = Number(input.value);
    if (input.value === '' || !Number.isFinite(value)) {
      input.value = String(tvOptionsOf(editor.selected).inch);
      return;
    }
    editor.setTvOptions({ inch: value });
  });
  return el('label', { class: 'field' }, el('span', {}, `尺寸（${min}～${max} 吋）`), input);
}

export function tvControls(editor, item) {
  if (item.type !== 'tv') return [];
  const { inch, mount, centerHeight } = tvOptionsOf(item);
  const view = viewingDistance(inch);
  const seat = nearestSeatDistance(item, editor.store.getState().furniture);
  const m = (v) => v.toFixed(1);
  const tooNear = seat !== null && seat < view.min;
  const tooFar = seat !== null && seat > view.max;
  // 超出時往外取整：2.15 m 寫成 2.1 m 會看起來像沒超過
  const seatText = seat === null ? '' : m((tooFar ? Math.ceil : tooNear ? Math.floor : Math.round)(seat * 10) / 10);
  const hint = tooNear
    ? `離沙發太近，${inch} 吋建議至少 ${m(view.min)} m`
    : tooFar
      ? `離沙發太遠，${inch} 吋建議 ${m(view.max)} m 內，或換大一點的吋數`
      : null;
  return [
    inchField(editor, inch),
    choices('常見尺寸', TV_INCHES.map((n) => [n, `${n} 吋`]), inch, (n) => editor.setTvOptions({ inch: n })),
    el('p', { class: 'metric' }, `機身 ${tvSize(inch, 'wall').w} × ${tvSize(inch, 'wall').h} cm（不含腳座）`),
    choices('放置方式', MOUNTS, mount, (id) => editor.setTvOptions({ mount: id })),
    mount === 'wall' ? centerHeightField(editor, centerHeight) : null,
    el('p', { class: 'metric' }, `建議觀看距離 ${m(view.min)}～${m(view.max)} m（4K）`),
    el('p', { class: 'metric' }, seat === null ? '還沒有擺沙發或單椅' : `離沙發 ${seatText} m`),
    // 不用 .warn：屬性面板會用 querySelector('.warn') 寫重疊警示，會把這裡蓋掉
    hint ? el('p', { class: 'light-issue tv-issue' }, `⚠ ${hint}`) : null,
    el('p', { class: 'metric' }, `用電 110V ${tvWatts(inch)} W`),
  ].filter(Boolean);
}
