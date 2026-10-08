// 屬性面板裡的燈具設定：開關、色溫、安裝高度與提醒；不是燈具時回傳空陣列
import { COLOR_TEMPS, isLight, lightingIssues, lightOptionsOf } from '../core/lighting.js';
import { el } from './dom.js';

export function lightControls(editor, item) {
  if (!isLight(item)) return [];
  const design = editor.store.getState();
  const { on, colorTemp } = lightOptionsOf(item);
  const toggle = el(
    'button',
    { type: 'button', class: `btn small ${on ? 'primary' : ''}`, 'aria-pressed': String(on), onclick: () => editor.setLightOptions({ on: !on }) },
    on ? '開燈中' : '已關燈',
  );
  const temps = el(
    'div',
    { class: 'row', role: 'group', 'aria-label': '色溫' },
    COLOR_TEMPS.map((k) =>
      el(
        'button',
        { type: 'button', class: `btn small ${k === colorTemp ? 'primary' : ''}`, 'aria-pressed': String(k === colorTemp), onclick: () => editor.setLightOptions({ colorTemp: k }) },
        `${k}K`,
      ),
    ),
  );
  const issues = lightingIssues(item, editor.floorplan, design.ceilings, design.ceilingHeight);
  return [
    el('div', { class: 'field' }, el('span', {}, '開關'), toggle),
    el('div', { class: 'field' }, el('span', {}, '色溫（2700K 暖黃・3000K 暖白・4000K 自然白）'), temps),
    typeof item.elevation === 'number' ? el('p', { class: 'metric' }, `燈具底部離地 ${Math.round(item.elevation * 100)} cm`) : null,
    // 不用 .warn：屬性面板會用 querySelector('.warn') 寫重疊警示，會把這裡蓋掉
    ...issues.map((issue) => el('p', { class: 'light-issue' }, `⚠ ${issue.message}`)),
  ].filter(Boolean);
}
