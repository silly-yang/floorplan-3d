// 水電：屬性面板的插座欄位與用電提醒、「水電」分頁的放回建商插座與用電檢查清單
import { HEIGHT_PRESETS, isElectrical, missingOutlets, mountSurfaces, outletSpec, outletsToFurniture, powerIssues } from '../core/electrical.js';
import { getCatalogItem } from '../furniture/catalog.js';
import { $, el, toast } from './dom.js';
import { iconSvg } from './icons.js';

const MAX_HEIGHT_CM = 300;

const hasVoltage = (item) => getCatalogItem(item.type)?.options?.voltage !== undefined;

// 選到插座、開關時的欄位：離地高度（含常用高度）、電壓、專用迴路
export function electricalFields(editor, item) {
  if (!isElectrical(item.type)) return [];
  const height = el('input', { type: 'number', min: '0', max: String(MAX_HEIGHT_CM), step: '1', class: 'elevation-input' });
  height.addEventListener('change', () => {
    const cm = Number(height.value);
    const current = editor.selected;
    if (!current) return;
    if (height.value === '' || !(cm >= 0 && cm <= MAX_HEIGHT_CM)) {
      height.value = Math.round(current.elevation * 100);
      return;
    }
    editor.update({ elevation: Math.round(cm) / 100 });
  });
  const presets = el('div', { class: 'row height-presets' },
    HEIGHT_PRESETS.map((p) =>
      el('button', { type: 'button', class: 'btn small', title: `離地 ${p.cm} cm`, onclick: () => editor.update({ elevation: p.cm / 100 }) }, p.name),
    ));
  const fields = [el('label', { class: 'field' }, el('span', {}, '離地（公分）'), height), presets];
  if (!hasVoltage(item)) return fields;

  const setOption = (patch) => {
    const current = editor.selected;
    if (current) editor.update({ options: { ...outletSpec(current), ...patch } });
  };
  const voltage = el('select', { class: 'voltage-select' },
    el('option', { value: '110' }, '110V'),
    el('option', { value: '220' }, '220V'));
  voltage.addEventListener('change', () => setOption({ voltage: Number(voltage.value) }));
  const dedicated = el('input', { type: 'checkbox', class: 'dedicated-input' });
  dedicated.addEventListener('change', () => setOption({ dedicated: dedicated.checked }));
  return [
    ...fields,
    el('label', { class: 'field' }, el('span', {}, '電壓'), voltage),
    el('label', { class: 'field inline' }, dedicated, el('span', {}, '專用迴路（大功率家電單獨一條線）')),
  ];
}

// 數值會隨復原、快速按鈕改變，每次更新都同步一次；正在輸入的欄位不動
export function updateElectricalFields(panel, item, design) {
  const height = panel.querySelector('.elevation-input');
  if (height && document.activeElement !== height) height.value = Math.round((item.elevation ?? 0) * 100);
  const spec = isElectrical(item.type) ? outletSpec(item) : null;
  const voltage = panel.querySelector('.voltage-select');
  if (voltage && spec?.voltage) voltage.value = String(spec.voltage);
  const dedicated = panel.querySelector('.dedicated-input');
  if (dedicated && spec) dedicated.checked = spec.dedicated;
  const notes = panel.querySelector('.power-notes');
  if (notes) {
    notes.replaceChildren(
      ...powerIssues(design).filter((i) => i.furnitureId === item.id).map((i) => el('li', {}, i.message)),
    );
  }
}

export const powerNotes = () => el('ul', { class: 'issue-list power-notes' });

// 「水電」分頁：放回建商預設插座、用電檢查清單（點一項選取該家具）
export function setupElectricalPanel({ store, editor, floorplan }) {
  const button = el('button', { class: 'btn' });
  button.innerHTML = iconSvg('tab-electrical');
  button.append(el('span', {}, '放回建商預設插座'));
  button.addEventListener('click', () => {
    const design = store.getState();
    const surfaces = mountSurfaces(floorplan);
    const missing = missingOutlets(design.furniture, floorplan.outlets, surfaces);
    if (missing.length === 0) {
      toast('建商預設的插座、開關都已經在原位');
      return;
    }
    const added = outletsToFurniture(missing, surfaces, () => crypto.randomUUID());
    store.commit({ ...design, furniture: [...design.furniture, ...added] });
    toast(`已放回 ${added.length} 個插座、開關`);
  });
  $('#electrical-actions').replaceChildren(button);

  const check = $('#power-check');
  const render = (design) => {
    const issues = powerIssues(design);
    const byId = new Map(design.furniture.map((f) => [f.id, f]));
    check.replaceChildren(
      el('h3', {}, issues.length ? `用電檢查（${issues.length} 個提醒）` : '用電檢查'),
      issues.length
        ? el('ul', { class: 'issue-list power-check-list' },
          issues.map((i) => {
            // 被擋住的提醒本身就以插座名稱開頭
            const name = getCatalogItem(byId.get(i.furnitureId)?.type)?.name ?? '';
            const text = i.kind === 'blocked' ? i.message : `${name}：${i.message}`;
            return el('li', {},
              el('button', { type: 'button', class: 'link-button', title: '選取這件', onclick: () => editor.select(i.furnitureId) }, text));
          }))
        : el('p', { class: 'note ok' }, '目前沒有用電提醒'),
    );
  };
  store.subscribe((design, { source } = {}) => {
    if (source !== 'preview') render(design);
  });
  render(store.getState());
}
