// 門的面板：選取門時顯示在右側；「空間」分頁也列出所有可裝門的開口
import { DOOR_TYPES, doorOptions, doorStateOf } from '../core/doors.js';
import { $, el } from './dom.js';
import { iconSvg } from './icons.js';

const LABELS = { door: '門口', doorway: '門洞', window: '落地窗' };

function iconButton(icon, label, attrs) {
  const button = el('button', attrs);
  button.innerHTML = iconSvg(icon);
  button.append(el('span', {}, label));
  return button;
}

export function openingTitle(opening) {
  return `${LABELS[opening.kind] ?? '開口'}${opening.label ? ` ${opening.label}` : ''}`;
}

// 一組門的控制：門型按鈕、開／關、反向
function doorControls(editor, opening, state) {
  const types = DOOR_TYPES.filter((t) => doorOptions(opening).includes(t.id));
  return el(
    'div',
    { class: 'stack' },
    el(
      'div',
      { class: 'row door-types', role: 'group', 'aria-label': '門型' },
      types.map((t) =>
        iconButton(t.icon, t.name, {
          class: `btn small ${state.type === t.id ? 'primary' : ''}`,
          'aria-pressed': String(state.type === t.id),
          onclick: () => editor.setDoorType(opening.id, t.id),
        }),
      ),
    ),
    state.type === 'none'
      ? null
      : el(
          'div',
          { class: 'row' },
          iconButton(state.open ? 'door-close' : 'door-open', state.open ? '關門' : '開門', {
            class: 'btn small primary',
            onclick: () => editor.toggleDoor(opening.id),
          }),
          iconButton('flip', '換邊', { class: 'btn small', title: state.type === 'hinged' ? '門軸換到另一邊' : '往另一邊滑開', onclick: () => editor.flipDoor(opening.id) }),
          state.type === 'hinged'
            ? iconButton('swing', '內外', { class: 'btn small', title: '改成往另一側開', onclick: () => editor.swingDoor(opening.id) })
            : null,
        ),
  );
}

export function setupDoorPanel(editor, floorplan) {
  const panel = $('#door-panel');
  const list = $('#door-list');
  const doorable = floorplan.openings.filter((o) => doorOptions(o).length > 0);

  const render = () => {
    const doors = editor.store.getState().doors;
    const opening = editor.selectedDoor;
    panel.hidden = !opening;
    if (opening) {
      const title = el('h2', { class: 'with-icon' });
      title.innerHTML = iconSvg('door-hinged');
      title.append(el('span', {}, openingTitle(opening)));
      panel.replaceChildren(
        title,
        doorControls(editor, opening, doorStateOf(doors, opening)),
        el('p', { class: 'note' }, '漫遊時對準門點一下也能開關。'),
        iconButton('close', '取消選取', { class: 'btn small', onclick: () => editor.selectDoor(null) }),
      );
    }
    list.replaceChildren(
      ...doorable.map((o) =>
        el('li', { class: 'door-item' }, el('strong', {}, openingTitle(o)), doorControls(editor, o, doorStateOf(doors, o))),
      ),
    );
  };

  editor.onChange(render);
  editor.store.subscribe((_, { source }) => {
    if (source !== 'preview') render();
  });
  render();
}
