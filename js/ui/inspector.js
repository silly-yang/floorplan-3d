// 右側屬性面板：選取家具的尺寸、顏色、旋轉、重疊警示、到最近牆面的距離
import { elevationOf, nearestWallDistance, supportOf } from '../core/layout.js';
import { getCatalogItem, normalizeSizeValue } from '../furniture/catalog.js';
import { $, el } from './dom.js';
import { iconSvg } from './icons.js';

// 帶 icon 的小按鈕
function iconButton(icon, label, title, onclick, extra = '') {
  const button = el('button', { class: `btn small ${extra}`, title, onclick });
  button.innerHTML = iconSvg(icon);
  if (label) button.append(el('span', {}, label));
  else button.setAttribute('aria-label', title);
  return button;
}

const DIMENSIONS = [
  ['w', '寬'],
  ['d', '深'],
  ['h', '高'],
];

// editCabinet：選到自己設計的系統櫃時，「編輯櫃子設計」要開設計器
export function setupInspector(editor, getSolids, { editCabinet } = {}) {
  const panel = $('#inspector');
  let colorBase = null;
  let renderedId = null;

  const render = (item) => {
    panel.hidden = !item;
    if (!item) {
      renderedId = null;
      panel.replaceChildren();
      return;
    }
    // 正在輸入時不重建，否則游標會跳掉；只更新數值
    const active = document.activeElement;
    if (renderedId === item.id && panel.contains(active) && active.tagName === 'INPUT') {
      updateMetrics(item);
      return;
    }
    renderedId = item.id;

    const sizeInputs = DIMENSIONS.map(([key, label]) => {
      const input = el('input', { type: 'number', min: '1', max: '600', step: '1', value: String(item.size[key]) });
      input.addEventListener('change', () => {
        const value = normalizeSizeValue(input.value);
        const current = editor.selected;
        if (value == null || !current) {
          input.value = current?.size[key] ?? '';
          return;
        }
        if (!editor.update({ size: { ...current.size, [key]: value } })) input.value = current.size[key];
      });
      return el('label', { class: 'field' }, el('span', {}, `${label}（公分）`), input);
    });

    const color = el('input', { type: 'color', value: item.color });
    color.addEventListener('input', () => {
      colorBase ??= editor.store.getState();
      editor.update({ color: color.value }, { commit: false });
    });
    color.addEventListener('change', () => {
      editor.update({ color: color.value }, { base: colorBase ?? undefined });
      colorBase = null;
    });

    const title = el('h2', { class: 'with-icon' });
    title.innerHTML = iconSvg(item.type);
    title.append(el('span', {}, getCatalogItem(item.type)?.name ?? item.type));
    // 系統櫃的尺寸、格子都在設計器裡改，這裡只給入口
    const cabinet = item.type === 'custom-cabinet' ? editor.store.getState().cabinets.find((c) => c.id === item.cabinetId) : null;
    if (cabinet) title.querySelector('span').textContent = cabinet.name;
    const body = cabinet
      ? [iconButton('rename', '編輯櫃子設計', '尺寸、隔板、插座、格內家電', () => editCabinet?.(cabinet), 'primary block')]
      : [...sizeInputs, el('label', { class: 'field' }, el('span', {}, '顏色'), color)];
    panel.replaceChildren(
      title,
      ...body,
      el(
        'div',
        { class: 'field' },
        el('span', { class: 'rotation' }, ''),
        el(
          'span',
          { class: 'row' },
          iconButton('rotate-ccw', '', '逆時針 15°（Shift+R）', () => editor.rotate(-1)),
          iconButton('rotate-cw', '', '順時針 15°（R）', () => editor.rotate(1)),
        ),
      ),
      el('p', { class: 'metric dims' }),
      el('p', { class: 'metric wall' }),
      el('p', { class: 'metric support' }),
      el('p', { class: 'warn' }),
      el(
        'div',
        { class: 'row' },
        iconButton('focus', '聚焦', '鏡頭移到這件家具前面', () => {
          const current = editor.selected;
          if (current) editor.viewer.focus({ ...current, elevation: elevationOf(current, editor.store.getState().furniture) });
        }),
        iconButton('duplicate', '複製', 'Ctrl+D', () => editor.duplicate()),
        iconButton('delete', '刪除', 'Delete', () => editor.remove(), 'danger'),
        iconButton('close', '取消選取', 'Esc', () => editor.select(null)),
      ),
    );
    updateMetrics(item);
  };

  const updateMetrics = (item) => {
    // 旋轉在畫面上以順時針顯示比較直覺；資料內部是逆時針
    const shown = (360 - item.rotation) % 360;
    panel.querySelector('.rotation').textContent = `旋轉 ${shown}°`;
    panel.querySelector('.dims').textContent = `尺寸 ${item.size.w} × ${item.size.d} × ${item.size.h} cm`;
    const distance = nearestWallDistance(item, getSolids());
    panel.querySelector('.wall').textContent = Number.isFinite(distance)
      ? `離最近牆面 ${Math.round(distance * 100)} cm`
      : '附近沒有牆面';
    const support = supportOf(item, editor.store.getState().furniture);
    const placement = getCatalogItem(item.type)?.placement;
    panel.querySelector('.support').textContent = support
      ? `放在「${getCatalogItem(support.type)?.name}」上（離地 ${support.size.h} cm）`
      : placement === 'surface'
        ? '放在地上；拖到桌面或櫃面上會自動放上去'
        : '';
    panel.querySelector('.warn').textContent = editor.conflicts.has(item.id) ? '⚠ 與其他家具重疊' : '';
    DIMENSIONS.forEach(([key], i) => {
      const input = panel.querySelectorAll('input[type=number]')[i];
      if (input && document.activeElement !== input) input.value = item.size[key];
    });
    const color = panel.querySelector('input[type=color]');
    if (color && document.activeElement !== color) color.value = item.color;
  };

  editor.onChange(render);
  render(editor.selected);
}
