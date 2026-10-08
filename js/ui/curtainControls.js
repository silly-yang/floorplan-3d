// 「空間」分頁的窗簾設定：顯示開關與顏色；只是畫面效果，不寫進設計
import { $, el } from './dom.js';

export function setupCurtainControls(curtainLayer) {
  const visible = el('input', { type: 'checkbox', checked: true });
  const color = el('input', { type: 'color', value: curtainLayer.color, title: '窗簾顏色' });
  visible.addEventListener('change', () => {
    curtainLayer.setVisible(visible.checked);
    color.disabled = !visible.checked;
  });
  color.addEventListener('input', () => curtainLayer.setColor(color.value));
  $('#curtain-controls').replaceChildren(
    el('label', { class: 'field' }, el('span', {}, '顯示窗簾'), visible),
    el('label', { class: 'field' }, el('span', {}, '窗簾顏色'), color),
  );
}
