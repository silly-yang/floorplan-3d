// 家具、家電、廚衛清單：桌機拖曳到畫面放置，手機點一下放到畫面中央
import { CATALOG, CATEGORIES } from '../furniture/catalog.js';
import { $, el } from './dom.js';
import { iconSvg } from './icons.js';

export const FURNITURE_MIME = 'application/x-furniture-type';

function tile(item, onAdd) {
  const icon = el('span', { class: 'tile-icon' });
  icon.innerHTML = iconSvg(item.type);
  icon.append(el('span', { class: 'tile-color', style: `background:${item.color}`, title: '預設顏色' }));
  return el(
    'li',
    {
      draggable: 'true',
      title: item.placement === 'surface' ? `拖到桌面、櫃面或地上放置${item.name}` : `拖曳到畫面放置${item.name}`,
      ondragstart: (e) => {
        e.dataTransfer.setData(FURNITURE_MIME, item.type);
        e.dataTransfer.effectAllowed = 'copy';
      },
      onclick: () => onAdd(item.type, null),
    },
    icon,
    el('strong', {}, item.name),
    el('div', { class: 'dims' }, `${item.size.w}×${item.size.d}×${item.size.h} cm`),
  );
}

export function renderCatalog({ onAdd }) {
  for (const { id } of CATEGORIES) {
    // 分類沒有對應的清單（例如還在開發的分頁）就略過
    const list = $(`#catalog-${id}`);
    if (!list) continue;
    list.replaceChildren(...CATALOG.filter((c) => c.category === id).map((c) => tile(c, onAdd)));
  }
}
