// 「櫃子」分頁：新增、編輯、複製、刪除自己設計的系統櫃；拖到畫面（手機點一下）擺放
import { createCabinet, deleteCabinetDesign, saveCabinetDesign } from '../core/cabinet.js';
import { CABINET_PRESETS } from '../core/presets.js';
import { $, confirmDialog, el } from './dom.js';
import { cabinetElevation, issueSummary, openCabinetDesigner } from './cabinetDesigner.js';
import { iconSvg } from './icons.js';
import { pickPreset } from './presetPicker.js';

export const CABINET_MIME = 'application/x-cabinet-id';

function iconButton(icon, label, attrs) {
  const button = el('button', { type: 'button', ...attrs });
  button.innerHTML = iconSvg(icon);
  if (label) button.append(el('span', {}, label));
  return button;
}

const BLANK = { label: '空白', name: '系統櫃', description: '一欄一格，從頭自己分割', build: (opts) => createCabinet(opts) };

export function setupCabinetPanel({ store, editor }) {
  const panel = $('#cabinet-panel');
  const save = (cab) => store.commit(saveCabinetDesign(store.getState(), cab));
  const edit = (cab) => openCabinetDesigner(cab, { onSave: save });

  // 先選樣式再開設計器；取消就什麼都不建立
  const startNew = async () => {
    const options = [BLANK, ...CABINET_PRESETS].map((preset) => {
      const preview = preset.build({ id: 'preview', name: preset.name });
      const { w, d, h } = preview.size;
      return { preset, name: preset.label ?? preset.name, dims: `${w}×${d}×${h} cm`, description: preset.description, thumb: cabinetElevation(preview) };
    });
    const picked = await pickPreset('設計新的櫃子', options);
    if (!picked) return;
    const n = store.getState().cabinets.length + 1;
    edit(picked.preset.build({ id: crypto.randomUUID(), name: `${picked.preset.name} ${n}` }));
  };

  const render = () => {
    const cabinets = store.getState().cabinets;
    // replaceChildren 會把 null 印成文字，條件式內容要先濾掉
    const parts = [
      el('p', { class: 'hint-text' }, '先設計櫃子的尺寸、隔板、插座，試放家電，儲存後拖進右側畫面擺放（手機點一下）。'),
      iconButton('add', '設計新的櫃子', {
        class: 'btn primary block',
        onclick: startNew,
      }),
      cabinets.length === 0 ? el('p', { class: 'note' }, '還沒有櫃子。可以先做一個「家電櫃」試試。') : null,
      el('ul', { class: 'cabinet-list' }, cabinets.map((cab) =>
        el('li', {
          draggable: 'true',
          title: '拖到畫面擺放',
          ondragstart: (e) => {
            e.dataTransfer.setData(CABINET_MIME, cab.id);
            e.dataTransfer.effectAllowed = 'copy';
          },
        },
          el('div', { class: 'cabinet-thumb', onclick: () => editor.addCabinet(cab.id) }, cabinetElevation(cab)),
          el('div', { class: 'cabinet-info' },
            el('strong', {}, cab.name),
            el('div', { class: 'dims' }, `${cab.size.w}×${cab.size.d}×${cab.size.h} cm・${issueSummary(cab)}`),
            el('div', { class: 'row' },
              iconButton('rename', '編輯', { class: 'btn small', onclick: () => edit(cab) }),
              iconButton('duplicate', '複製', { class: 'btn small', onclick: () => save({ ...structuredClone(cab), id: crypto.randomUUID(), name: `${cab.name} 複本` }) }),
              iconButton('delete', '', {
                class: 'btn small danger icon-only',
                title: '刪除',
                'aria-label': '刪除',
                onclick: async () => {
                  const used = store.getState().furniture.filter((f) => f.cabinetId === cab.id).length;
                  const message = used ? `畫面上有 ${used} 個「${cab.name}」也會一起移除。` : `確定刪除「${cab.name}」？`;
                  if (await confirmDialog('刪除櫃子設計', message, { okLabel: '刪除', danger: true })) store.commit(deleteCabinetDesign(store.getState(), cab.id));
                },
              }),
            ),
          ),
        ))),
    ];
    panel.replaceChildren(...parts.filter(Boolean));
  };

  store.subscribe((_, { source }) => {
    if (source !== 'preview') render();
  });
  render();
  return { edit };
}
