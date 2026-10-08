// 「洞洞板」分頁：新增、編輯、複製、刪除自己設計的洞洞板；拖到畫面（手機點一下）擺放
import { createPegboard, deletePegboardDesign, savePegboardDesign } from '../core/pegboard.js';
import { PEGBOARD_PRESETS } from '../core/presets.js';
import { $, confirmDialog, el } from './dom.js';
import { boardSummary, issueSummary, openPegboardDesigner, pegboardElevation } from './pegboardDesigner.js';
import { iconSvg } from './icons.js';
import { pickPreset } from './presetPicker.js';

export const PEGBOARD_MIME = 'application/x-pegboard-id'; // editor.js 有同一個字串

function iconButton(icon, label, attrs) {
  const button = el('button', { type: 'button', ...attrs });
  button.innerHTML = iconSvg(icon);
  if (label) button.append(el('span', {}, label));
  return button;
}

const BLANK = { label: '空白', name: '洞洞板', description: '沒有配件，從頭自己擺', build: (opts) => createPegboard(opts) };

export function setupPegboardPanel({ store, editor }) {
  const panel = $('#pegboard-panel');
  const save = (board) => store.commit(savePegboardDesign(store.getState(), board));
  const edit = (board) => openPegboardDesigner(board, { onSave: save });

  // 先選樣式再開設計器；取消就什麼都不建立
  const startNew = async () => {
    const options = [BLANK, ...PEGBOARD_PRESETS].map((preset) => {
      const preview = preset.build({ id: 'preview', name: preset.name });
      return { preset, name: preset.label ?? preset.name, dims: boardSummary(preview), description: preset.description, thumb: pegboardElevation(preview) };
    });
    const picked = await pickPreset('設計新的洞洞板', options);
    if (!picked) return;
    const n = (store.getState().pegboards ?? []).length + 1;
    edit(picked.preset.build({ id: crypto.randomUUID(), name: `${picked.preset.name} ${n}` }));
  };

  const render = () => {
    // 舊方案沒有 pegboards 欄位
    const boards = store.getState().pegboards ?? [];
    const parts = [
      el('p', { class: 'hint-text' }, '先設計洞洞板的尺寸、材質、掛牆高度與配件（也能做成貓跳台），儲存後拖進右側畫面靠牆擺放（手機點一下）。'),
      iconButton('add', '設計新的洞洞板', {
        class: 'btn primary block',
        onclick: startNew,
      }),
      boards.length === 0 ? el('p', { class: 'note' }, '還沒有洞洞板。可以先做一面「貓跳台牆」試試。') : null,
      el('ul', { class: 'cabinet-list' }, boards.map((board) =>
        el('li', {
          draggable: 'true',
          title: '拖到畫面擺放',
          ondragstart: (e) => {
            e.dataTransfer.setData(PEGBOARD_MIME, board.id);
            e.dataTransfer.effectAllowed = 'copy';
          },
        },
          el('div', { class: 'cabinet-thumb', onclick: () => editor.addPegboard(board.id) }, pegboardElevation(board)),
          el('div', { class: 'cabinet-info' },
            el('strong', {}, board.name),
            el('div', { class: 'dims' }, `${boardSummary(board)}・${issueSummary(board)}`),
            el('div', { class: 'row' },
              iconButton('rename', '編輯', { class: 'btn small', onclick: () => edit(board) }),
              iconButton('duplicate', '複製', { class: 'btn small', onclick: () => save({ ...structuredClone(board), id: crypto.randomUUID(), name: `${board.name} 複本` }) }),
              iconButton('delete', '', {
                class: 'btn small danger icon-only',
                title: '刪除',
                'aria-label': '刪除',
                onclick: async () => {
                  const used = store.getState().furniture.filter((f) => f.pegboardId === board.id).length;
                  const message = used ? `畫面上有 ${used} 個「${board.name}」也會一起移除。` : `確定刪除「${board.name}」？`;
                  if (await confirmDialog('刪除洞洞板設計', message, { okLabel: '刪除', danger: true })) store.commit(deletePegboardDesign(store.getState(), board.id));
                },
              }),
            ),
          ),
        ))),
    ];
    // replaceChildren 會把 null 印成文字，條件式內容要先濾掉
    panel.replaceChildren(...parts.filter(Boolean));
  };

  store.subscribe((_, { source }) => {
    if (source !== 'preview') render();
  });
  render();
  return { edit };
}
