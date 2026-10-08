// 左側家具清單：桌機拖曳到畫面放置，手機點一下放到畫面中央
import { CATALOG } from '../furniture/catalog.js';
import { $, el } from './dom.js';

export const FURNITURE_MIME = 'application/x-furniture-type';

export function renderCatalog({ onAdd }) {
  $('#catalog').replaceChildren(
    ...CATALOG.map((item) =>
      el(
        'li',
        {
          draggable: 'true',
          title: `拖曳到畫面放置${item.name}`,
          ondragstart: (e) => {
            e.dataTransfer.setData(FURNITURE_MIME, item.type);
            e.dataTransfer.effectAllowed = 'copy';
          },
          onclick: () => onAdd(item.type, null),
        },
        el('span', { class: 'swatch', style: `background:${item.color}` }),
        el('strong', {}, item.name),
        el('div', { class: 'dims' }, `${item.size.w}×${item.size.d}×${item.size.h} cm`),
      ),
    ),
  );
}
