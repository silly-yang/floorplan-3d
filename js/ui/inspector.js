// 右側屬性面板：選取家具的尺寸、顏色、旋轉、重疊警示、到最近牆面的距離
import { nearestWallDistance } from '../core/layout.js';
import { getCatalogItem, normalizeSizeValue } from '../furniture/catalog.js';
import { $, el } from './dom.js';

const DIMENSIONS = [
  ['w', '寬'],
  ['d', '深'],
  ['h', '高'],
];

export function setupInspector(editor, getSolids) {
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

    panel.replaceChildren(
      el('h2', {}, getCatalogItem(item.type)?.name ?? item.type),
      ...sizeInputs,
      el('label', { class: 'field' }, el('span', {}, '顏色'), color),
      el(
        'div',
        { class: 'field' },
        el('span', { class: 'rotation' }, ''),
        el(
          'span',
          { class: 'row' },
          el('button', { class: 'btn small', title: '逆時針 15°（Shift+R）', onclick: () => editor.rotate(-1) }, '⟲'),
          el('button', { class: 'btn small', title: '順時針 15°（R）', onclick: () => editor.rotate(1) }, '⟳'),
        ),
      ),
      el('p', { class: 'metric dims' }),
      el('p', { class: 'metric wall' }),
      el('p', { class: 'warn' }),
      el(
        'div',
        { class: 'row' },
        el('button', { class: 'btn small', title: 'Ctrl+D', onclick: () => editor.duplicate() }, '複製'),
        el('button', { class: 'btn small danger', title: 'Delete', onclick: () => editor.remove() }, '刪除'),
        el('button', { class: 'btn small', title: 'Esc', onclick: () => editor.select(null) }, '取消選取'),
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
    panel.querySelector('.warn').textContent = editor.conflicts.has(item.id) ? '⚠ 與其他家具重疊' : '';
    DIMENSIONS.forEach(([key], i) => {
      const input = panel.querySelectorAll('input[type=number]')[i];
      if (document.activeElement !== input) input.value = item.size[key];
    });
    const color = panel.querySelector('input[type=color]');
    if (document.activeElement !== color) color.value = item.color;
  };

  editor.onChange(render);
  render(editor.selected);
}
