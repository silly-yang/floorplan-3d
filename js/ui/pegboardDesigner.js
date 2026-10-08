// 洞洞板設計器（全螢幕）：正面圖畫孔格與配件、拖曳配件（對齊孔距）、材質與掛牆高度、即時檢查；按儲存才寫進方案
import {
  MAX_MOUNT,
  MIN_BOARD,
  PEGBOARD_ACCESSORIES,
  PEGBOARD_MATERIALS,
  addAccessory,
  getAccessory,
  moveAccessory,
  pegboardIssues,
  removeAccessory,
  resizePegboard,
  updatePegboard,
} from '../core/pegboard.js';
import { $, el } from './dom.js';
import { iconSvg } from './icons.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
export const ACCESSORY_MIME = 'application/x-pegboard-accessory';
const MAX_SIZE = 300;
let patternSeq = 0; // 同一頁有多張縮圖時，孔格 pattern 的 id 不能重複

const svg = (tag, attrs = {}, ...children) => {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.append(...children.filter(Boolean));
  return node;
};
const text = (attrs, content) => svg('text', attrs, document.createTextNode(content));

function iconButton(icon, label, attrs) {
  const button = el('button', { type: 'button', ...attrs });
  button.innerHTML = iconSvg(icon);
  if (label) button.append(el('span', {}, label));
  return button;
}

// 把滑鼠位置換成 SVG（公分）座標
function svgPoint(root, clientX, clientY) {
  const pt = root.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  return pt.matrixTransform(root.getScreenCTM().inverse());
}

// 洞洞板正面圖；清單縮圖與設計器共用。onAccessoryDown 有給時配件可拖曳
export function pegboardElevation(board, { selectedId = null, issues = [], onAccessoryDown = null } = {}) {
  const { w, h } = board.size;
  const root = svg('svg', { viewBox: `-4 -4 ${w + 8} ${h + 8}`, class: 'cabinet-svg pegboard-svg', preserveAspectRatio: 'xMidYMid meet' });
  const pid = `peg-holes-${++patternSeq}`;
  const p = board.pitch;
  // 孔的位置是孔距的整數倍（從左下角算），pattern 往回偏半格讓圓點落在格子中心
  root.append(svg('defs', {}, svg('pattern', { id: pid, width: p, height: p, patternUnits: 'userSpaceOnUse', x: -p / 2, y: h - p / 2 },
    svg('circle', { cx: p / 2, cy: p / 2, r: Math.min(0.5, p * 0.2), fill: '#00000055' }))));
  root.append(svg('rect', { x: 0, y: 0, width: w, height: h, fill: board.color, stroke: '#6b6256', 'stroke-width': 0.8 }));
  // 內縮半格，板邊不畫被切一半的孔
  root.append(svg('rect', { x: p / 2, y: p / 2, width: Math.max(0, w - p), height: Math.max(0, h - p), fill: `url(#${pid})` }));
  const flagged = new Set(issues.flatMap((i) => i.accessoryIds));
  for (const a of board.accessories) {
    const spec = getAccessory(a.type);
    if (!spec) continue;
    const bad = flagged.has(a.id);
    const isSelected = a.id === selectedId;
    const g = svg('g', { transform: `translate(${a.x} ${h - a.y - spec.size.h})`, 'data-id': a.id },
      svg('rect', {
        x: 0, y: 0, width: spec.size.w, height: spec.size.h, rx: 0.6,
        fill: spec.color, 'fill-opacity': 0.92,
        stroke: isSelected ? '#2f6f62' : bad ? '#d64545' : '#3e3a35',
        'stroke-width': isSelected ? 1.4 : bad ? 1.2 : 0.4,
      }),
      text({ x: spec.size.w / 2, y: spec.size.h / 2 + 1.2, 'font-size': Math.max(2, Math.min(4, spec.size.w / 4, spec.size.h * 0.9)), 'text-anchor': 'middle', fill: '#1f1d1a', 'pointer-events': 'none' }, spec.name),
    );
    if (onAccessoryDown) {
      g.style.cursor = 'grab';
      g.addEventListener('pointerdown', (e) => onAccessoryDown(e, a, g, root));
    }
    root.append(g);
  }
  return root;
}

const materialName = (id) => PEGBOARD_MATERIALS.find((m) => m.id === id)?.name ?? id;

// 給清單用：一句話的檢查摘要
export function issueSummary(board) {
  const n = pegboardIssues(board).length;
  return n ? `${n} 個提醒` : '檢查通過';
}

export function boardSummary(board) {
  return `${board.size.w}×${board.size.h} cm・${materialName(board.material)}・下緣離地 ${board.mountHeight} cm`;
}

// onSave(board) 由呼叫端寫進方案
export function openPegboardDesigner(initial, { onSave }) {
  let board = structuredClone(initial);
  let selectedId = null;
  const overlay = $('#pegboard-designer');

  const close = () => {
    overlay.hidden = true;
    overlay.replaceChildren();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
    const typing = ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName);
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId && !typing) {
      board = removeAccessory(board, selectedId);
      selectedId = null;
      render();
    }
  };

  const numberField = (label, value, { min, max, step = '1' }, apply) => {
    const input = el('input', { type: 'number', min: String(min), max: String(max), step, value: String(value) });
    input.addEventListener('change', () => {
      const v = Number(input.value);
      if (input.value === '' || !Number.isFinite(v)) {
        input.value = String(value);
        return;
      }
      board = apply(Math.min(max, Math.max(min, v)));
      render();
    });
    return el('label', { class: 'field' }, el('span', {}, label), input);
  };

  // 拖曳中只移動那一個 <g>，放開才寫回並重畫；中途重畫會丟掉 pointer capture
  const onAccessoryDown = (e, a, g, root) => {
    e.preventDefault();
    const spec = getAccessory(a.type);
    const start = svgPoint(root, e.clientX, e.clientY);
    const origin = { x: a.x, y: a.y };
    let moved = false;
    let next = board;
    g.setPointerCapture(e.pointerId);
    const onMove = (ev) => {
      const pt = svgPoint(root, ev.clientX, ev.clientY);
      const dx = pt.x - start.x;
      const dy = start.y - pt.y; // SVG y 朝下
      if (!moved && Math.hypot(dx, dy) < 1) return;
      moved = true;
      next = moveAccessory(board, a.id, { x: origin.x + dx, y: origin.y + dy });
      const pos = next.accessories.find((x) => x.id === a.id);
      g.setAttribute('transform', `translate(${pos.x} ${board.size.h - pos.y - spec.size.h})`);
    };
    const onUp = () => {
      g.removeEventListener('pointermove', onMove);
      g.removeEventListener('pointerup', onUp);
      g.removeEventListener('pointercancel', onUp);
      if (moved) board = next;
      selectedId = a.id;
      render();
    };
    g.addEventListener('pointermove', onMove);
    g.addEventListener('pointerup', onUp);
    g.addEventListener('pointercancel', onUp);
  };

  const accessoryChips = (category) =>
    PEGBOARD_ACCESSORIES.filter((a) => a.category === category).map((spec) => {
      const chip = el('button', {
        type: 'button',
        class: 'appliance-chip',
        draggable: 'true',
        title: `${spec.size.w}×${spec.size.h} cm、凸出 ${spec.size.d} cm；點一下自動找空位，或拖進板子`,
        ondragstart: (e) => {
          e.dataTransfer.setData(ACCESSORY_MIME, spec.id);
          e.dataTransfer.effectAllowed = 'copy';
        },
        onclick: () => {
          const id = crypto.randomUUID();
          board = addAccessory(board, spec.id, { id });
          selectedId = id;
          render();
        },
      });
      chip.append(el('span', {}, spec.name));
      return chip;
    });

  const selectedPanel = () => {
    const a = board.accessories.find((x) => x.id === selectedId);
    const spec = a && getAccessory(a.type);
    if (!spec) return el('p', { class: 'note' }, '點板子上的配件可以選取；拖曳可以移動（會對齊孔位）。');
    return el('div', {},
      el('p', {}, el('strong', {}, spec.name), ` ${spec.size.w}×${spec.size.h} cm、凸出 ${spec.size.d} cm`),
      el('p', { class: 'note' }, `位置：離板子左緣 ${a.x} cm、下緣 ${a.y} cm；頂面離地 ${board.mountHeight + a.y + spec.size.h} cm`),
      iconButton('delete', '拿掉這個配件', { class: 'btn small danger', onclick: () => {
        board = removeAccessory(board, a.id);
        selectedId = null;
        render();
      } }),
    );
  };

  const render = () => {
    const issues = pegboardIssues(board);
    const name = el('input', { type: 'text', value: board.name, maxlength: '30', 'aria-label': '洞洞板名稱' });
    name.addEventListener('change', () => (board.name = name.value.trim() || '洞洞板'));
    const color = el('input', { type: 'color', value: board.color });
    color.addEventListener('change', () => {
      board = updatePegboard(board, { color: color.value });
      render();
    });

    const elevation = pegboardElevation(board, { selectedId, issues, onAccessoryDown });
    elevation.addEventListener('dragover', (e) => {
      if (e.dataTransfer.types.includes(ACCESSORY_MIME)) e.preventDefault();
    });
    elevation.addEventListener('drop', (e) => {
      const type = e.dataTransfer.getData(ACCESSORY_MIME);
      const spec = getAccessory(type);
      if (!spec) return;
      e.preventDefault();
      const pt = svgPoint(elevation, e.clientX, e.clientY);
      const id = crypto.randomUUID();
      // 放開的位置當配件中心
      board = addAccessory(board, type, { id, x: pt.x - spec.size.w / 2, y: board.size.h - pt.y - spec.size.h / 2 });
      selectedId = id;
      render();
    });

    overlay.replaceChildren(
      el('div', { class: 'designer-head' },
        el('h2', {}, '設計洞洞板'),
        name,
        numberField('寬', board.size.w, { min: MIN_BOARD, max: MAX_SIZE }, (v) => resizePegboard(board, { ...board.size, w: v })),
        numberField('高', board.size.h, { min: MIN_BOARD, max: MAX_SIZE }, (v) => resizePegboard(board, { ...board.size, h: v })),
        el('span', { class: 'spacer' }),
        iconButton('close', '取消', { class: 'btn', onclick: close }),
        iconButton('export', '儲存', { class: 'btn primary', onclick: () => {
          onSave(board);
          close();
        } }),
      ),
      el('div', { class: 'designer-body' },
        el('div', { class: 'designer-canvas' },
          elevation,
          el('p', { class: 'note' }, `正面圖，單位公分。板子下緣離地 ${board.mountHeight} cm、上緣 ${board.mountHeight + board.size.h} cm；配件會對齊 ${board.pitch} cm 孔距。`),
        ),
        el('aside', { class: 'designer-side' },
          el('h3', {}, '材質'),
          el('div', { class: 'row' }, PEGBOARD_MATERIALS.map((m) => el('button', {
            type: 'button',
            class: `btn small ${m.id === board.material ? 'primary' : ''}`,
            onclick: () => {
              board = updatePegboard(board, { material: m.id });
              render();
            },
          }, m.name))),
          el('label', { class: 'field' }, el('span', {}, '顏色'), color),
          numberField('孔距（公分）', board.pitch, { min: 1, max: 10, step: '0.5' }, (v) => updatePegboard(board, { pitch: v })),
          numberField('掛牆高度：板子下緣離地（公分）', board.mountHeight, { min: 0, max: MAX_MOUNT }, (v) => updatePegboard(board, { mountHeight: v })),
          el('h3', {}, '選取的配件'),
          selectedPanel(),
          el('h3', {}, '一般配件'),
          el('div', { class: 'appliance-chips' }, accessoryChips('general')),
          el('h3', {}, '貓爬架配件'),
          el('div', { class: 'appliance-chips' }, accessoryChips('cat')),
          el('h3', {}, issues.length ? `檢查結果（${issues.length} 個提醒）` : '檢查結果'),
          issues.length
            ? el('ul', { class: 'issue-list' }, issues.map((i) => el('li', {}, i.message)))
            : el('p', { class: 'note ok' }, '✓ 配件位置與承重都沒問題'),
        ),
      ),
    );
  };

  overlay.hidden = false;
  document.addEventListener('keydown', onKey);
  render();
  return { close };
}
