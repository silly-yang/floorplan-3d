// 設計新的櫃子／洞洞板前的樣式選單：卡片列出空白與各預設，點一張就回傳它；取消、Esc、點背景回傳 null
import { $, el } from './dom.js';

// options：[{ name, dims, description, thumb（SVG 節點） }]
export function pickPreset(title, options) {
  const dialog = $('#dialog');
  return new Promise((resolve) => {
    const finish = (value) => {
      dialog.close();
      resolve(value);
    };
    dialog.replaceChildren(
      el('h2', {}, title),
      el('p', { class: 'note' }, '先選一個常見樣式，打開後還可以再改尺寸、格子與配件。'),
      el('ul', { class: 'preset-grid' }, options.map((option) =>
        el('li', {},
          el('button', { type: 'button', class: 'preset-card', onclick: () => finish(option) },
            el('div', { class: 'preset-thumb' }, option.thumb),
            el('strong', {}, option.name),
            el('span', { class: 'dims' }, option.dims),
            el('span', { class: 'note' }, option.description),
          )))),
      el('div', { class: 'actions' }, el('button', { type: 'button', class: 'btn', onclick: () => finish(null) }, '取消')),
    );
    dialog.onclose = () => resolve(null);
    dialog.onclick = (e) => {
      if (e.target === dialog) finish(null);
    };
    dialog.showModal();
    // showModal 聚焦第一張卡片時會把清單捲到中間，標題被捲掉
    dialog.scrollTop = 0;
  });
}
