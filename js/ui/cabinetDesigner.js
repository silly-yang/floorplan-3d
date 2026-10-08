// 系統櫃設計器（全螢幕）：正面立面圖選格子、分割、設定類型與插座、試放家電，即時檢查；按儲存才寫進方案
import {
  CELL_KINDS,
  OUTLETS,
  PLINTH,
  addItem,
  cabinetIssues,
  cellBox,
  removeCell,
  removeColumn,
  removeItem,
  resizeCabinet,
  setCellHeight,
  setColumnWidth,
  splitCell,
  splitColumn,
  updateCell,
} from '../core/cabinet.js';
import { CATALOG, getCatalogItem, normalizeSizeValue } from '../furniture/catalog.js';
import { $, el, toast } from './dom.js';
import { iconSvg } from './icons.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const APPLIANCE_MIME = 'application/x-cabinet-appliance';
const KIND_FILL = { door: '#efe9df', drawer: '#ece4d6', open: '#faf8f4', appliance: '#f3f6f8' };

const svg = (tag, attrs = {}, ...children) => {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.append(...children.filter(Boolean));
  return node;
};

function iconButton(icon, label, attrs) {
  const button = el('button', { type: 'button', ...attrs });
  button.innerHTML = iconSvg(icon);
  if (label) button.append(el('span', {}, label));
  return button;
}

// 櫃子的正面縮圖；清單與設計器共用。onCell(col, cell) 有給時格子可點、可拖放家電
export function cabinetElevation(cab, { selected = null, issues = [], onCell = null, onDropItem = null } = {}) {
  const { w, h } = cab.size;
  const root = svg('svg', { viewBox: `-2 -2 ${w + 4} ${h + 4}`, class: 'cabinet-svg', preserveAspectRatio: 'xMidYMid meet' });
  const flipY = (y, height) => h - y - height; // SVG y 朝下
  root.append(svg('rect', { x: 0, y: h - PLINTH, width: w, height: PLINTH, fill: '#5a5a5a' }));
  cab.columns.forEach((column, col) => {
    column.cells.forEach((cell, index) => {
      const b = cellBox(cab, col, index);
      const cellIssues = issues.filter((i) => i.col === col && i.cell === index);
      const isSelected = selected && selected.col === col && selected.cell === index;
      const rect = svg('rect', {
        x: b.x, y: flipY(b.y, b.h), width: b.w, height: b.h,
        fill: KIND_FILL[cell.kind] ?? '#fff',
        stroke: isSelected ? '#2f6f62' : cellIssues.length ? '#d64545' : '#8a7f70',
        'stroke-width': isSelected ? 3 : cellIssues.length ? 2 : 1,
        class: onCell ? 'cabinet-cell' : '',
      });
      const g = svg('g', {}, rect);
      if (cell.kind === 'door') g.append(svg('circle', { cx: b.x + b.w - 5, cy: flipY(b.y, b.h) + b.h / 2, r: 1.6, fill: '#555' }));
      if (cell.kind === 'drawer') {
        const count = Math.max(1, Math.round(b.h / 22));
        for (let k = 1; k < count; k++) g.append(svg('line', { x1: b.x, x2: b.x + b.w, y1: flipY(b.y, b.h) + (b.h / count) * k, y2: flipY(b.y, b.h) + (b.h / count) * k, stroke: '#8a7f70' }));
      }
      if (cell.outlet !== 'none') {
        const ox = b.x + b.w / 2 - 6;
        const oy = flipY(b.y, b.h) + 3;
        g.append(svg('rect', { x: ox, y: oy, width: 12, height: 7, rx: 1, fill: cell.outlet === '220v' ? '#d9534f' : '#ffffff', stroke: '#555', 'stroke-width': 0.6 }));
        g.append(svg('text', { x: ox + 6, y: oy + 5.4, 'font-size': 4.2, 'text-anchor': 'middle', fill: cell.outlet === '220v' ? '#fff' : '#333' }, document.createTextNode(cell.outlet === '220v' ? '220' : '110')));
      }
      // 家電：由左往右排，貼著格子底板
      let cursor = b.x + 2;
      cell.items.forEach((it, i) => {
        const spec = getCatalogItem(it.type);
        if (!spec) return;
        const bad = cellIssues.some((issue) => issue.item === i || issue.item === undefined);
        g.append(svg('rect', { x: cursor, y: flipY(b.y, spec.size.h), width: spec.size.w, height: spec.size.h, fill: bad ? '#f6d4d4' : '#dfe7ec', stroke: bad ? '#d64545' : '#566', 'stroke-width': 0.8 }));
        g.append(svg('text', { x: cursor + spec.size.w / 2, y: flipY(b.y, spec.size.h) + spec.size.h / 2 + 1.5, 'font-size': Math.min(5, spec.size.w / 4), 'text-anchor': 'middle', fill: '#233' }, document.createTextNode(spec.name)));
        cursor += spec.size.w + 2;
      });
      if (onCell) {
        g.addEventListener('click', () => onCell(col, index));
        g.addEventListener('dragover', (e) => {
          if (e.dataTransfer.types.includes(APPLIANCE_MIME)) e.preventDefault();
        });
        g.addEventListener('drop', (e) => {
          const type = e.dataTransfer.getData(APPLIANCE_MIME);
          if (!type) return;
          e.preventDefault();
          onDropItem?.(col, index, type);
        });
      }
      root.append(g);
    });
  });
  root.append(svg('rect', { x: 0, y: 0, width: w, height: h - PLINTH, fill: 'none', stroke: '#5f564b', 'stroke-width': 1.5 }));
  return root;
}

const USABLE_DEPTH_GAP = 2; // 背板與留縫；與 cabinetIssues 的可用深度一致

// 側面剖面圖：選取那一欄從側面看，左邊是櫃子正面；顯示櫃深、每格高度與格內家電的深度
export function cabinetSideView(cab, col, { selectedCell = null } = {}) {
  const { d, h } = cab.size;
  const usable = d - USABLE_DEPTH_GAP;
  const root = svg('svg', { viewBox: `-14 -8 ${d + 40} ${h + 22}`, class: 'cabinet-side-svg', preserveAspectRatio: 'xMidYMid meet' });
  const flipY = (y, height) => h - y - height;
  root.append(svg('rect', { x: 0, y: h - PLINTH, width: d - 4, height: PLINTH, fill: '#5a5a5a' }));
  root.append(svg('rect', { x: usable, y: 0, width: USABLE_DEPTH_GAP, height: h - PLINTH, fill: '#b9ae9f' }));
  cab.columns[col].cells.forEach((cell, index) => {
    const b = cellBox(cab, col, index);
    root.append(svg('rect', {
      x: 0, y: flipY(b.y, b.h), width: usable, height: b.h,
      fill: KIND_FILL[cell.kind] ?? '#fff', stroke: index === selectedCell ? '#2f6f62' : '#8a7f70', 'stroke-width': index === selectedCell ? 2.5 : 1,
    }));
    // 同一格多台家電在側面會重疊，取最深的一台畫
    const deepest = cell.items.map((it) => getCatalogItem(it.type)).filter(Boolean).sort((a, b2) => b2.size.d - a.size.d)[0];
    if (deepest) {
      const tooDeep = deepest.size.d > usable;
      root.append(svg('rect', { x: 0, y: flipY(b.y, deepest.size.h), width: deepest.size.d, height: Math.min(deepest.size.h, b.h), fill: tooDeep ? '#f6d4d4' : '#dfe7ec', stroke: tooDeep ? '#d64545' : '#566', 'stroke-width': 0.8 }));
      const note = tooDeep ? `超出 ${deepest.size.d - usable} cm` : `後方剩 ${usable - deepest.size.d} cm`;
      root.append(svg('text', { x: 2, y: flipY(b.y, deepest.size.h) - 2, 'font-size': 5, fill: tooDeep ? '#b4423a' : '#335' }, document.createTextNode(`${deepest.name} 深 ${deepest.size.d}・${note}`)));
    }
  });
  root.append(svg('rect', { x: 0, y: 0, width: d, height: h - PLINTH, fill: 'none', stroke: '#5f564b', 'stroke-width': 1.5 }));
  // 深度尺寸線
  root.append(svg('line', { x1: 0, x2: d, y1: h + 6, y2: h + 6, stroke: '#333', 'stroke-width': 0.6 }));
  root.append(svg('text', { x: d / 2, y: h + 13, 'font-size': 6, 'text-anchor': 'middle', fill: '#333' }, document.createTextNode(`深 ${d} cm（可用 ${usable}）`)));
  root.append(svg('text', { x: -3, y: (h - PLINTH) / 2, 'font-size': 5, 'text-anchor': 'end', fill: '#777' }, document.createTextNode('正面')));
  return root;
}

// onSave(cab) 由呼叫端寫進方案
export function openCabinetDesigner(initial, { onSave }) {
  let cab = structuredClone(initial);
  let selected = { col: 0, cell: 0 };
  const overlay = $('#cabinet-designer');

  const commitSize = (key, input) => {
    const value = normalizeSizeValue(input.value);
    if (value == null || value < 30) {
      input.value = cab.size[key];
      return;
    }
    cab = resizeCabinet(cab, { ...cab.size, [key]: value });
    render();
  };

  const close = () => {
    overlay.hidden = true;
    overlay.replaceChildren();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };

  const render = () => {
    const issues = cabinetIssues(cab);
    const column = cab.columns[selected.col];
    const cell = column.cells[selected.cell];
    const name = el('input', { type: 'text', value: cab.name, maxlength: '30', 'aria-label': '櫃子名稱' });
    name.addEventListener('change', () => (cab.name = name.value.trim() || '系統櫃'));
    const sizeInput = (key, label) => {
      const input = el('input', { type: 'number', min: '30', max: '600', value: String(cab.size[key]) });
      input.addEventListener('change', () => commitSize(key, input));
      return el('label', { class: 'field' }, el('span', {}, label), input);
    };
    const spanInput = (label, value, apply) => {
      const input = el('input', { type: 'number', min: '20', max: '600', value: String(value) });
      input.addEventListener('change', () => {
        cab = apply(Number(input.value));
        render();
      });
      return el('label', { class: 'field' }, el('span', {}, label), input);
    };
    const choice = (options, current, onPick) =>
      el('div', { class: 'row' }, options.map((o) => el('button', { type: 'button', class: `btn small ${o.id === current ? 'primary' : ''}`, onclick: () => onPick(o.id) }, o.name)));
    const mutate = (fn) => () => {
      cab = fn(cab);
      selected = {
        col: Math.min(selected.col, cab.columns.length - 1),
        cell: Math.min(selected.cell, cab.columns[Math.min(selected.col, cab.columns.length - 1)].cells.length - 1),
      };
      render();
    };

    const appliances = CATALOG.filter((c) => c.category === 'appliance' && c.placement === 'surface').map((spec) => {
      const tile = el('button', {
        type: 'button',
        class: 'appliance-chip',
        draggable: 'true',
        title: `${spec.size.w}×${spec.size.d}×${spec.size.h} cm・${spec.power.voltage}V ${spec.power.watts}W`,
        ondragstart: (e) => e.dataTransfer.setData(APPLIANCE_MIME, spec.type),
        onclick: () => {
          cab = addItem(cab, selected.col, selected.cell, spec.type);
          render();
        },
      });
      tile.innerHTML = iconSvg(spec.type);
      tile.append(el('span', {}, spec.name));
      return tile;
    });

    overlay.replaceChildren(
      el('div', { class: 'designer-head' },
        el('h2', {}, '設計系統櫃'),
        name,
        sizeInput('w', '寬'),
        sizeInput('d', '深'),
        sizeInput('h', '高'),
        el('span', { class: 'spacer' }),
        iconButton('close', '取消', { class: 'btn', onclick: close }),
        iconButton('export', '儲存', { class: 'btn primary', onclick: () => {
          onSave(cab);
          close();
        } }),
      ),
      el('div', { class: 'designer-body' },
        el('div', { class: 'designer-canvas' },
          cabinetElevation(cab, {
            selected,
            issues,
            onCell: (col, index) => {
              selected = { col, cell: index };
              render();
            },
            onDropItem: (col, index, type) => {
              selected = { col, cell: index };
              cab = addItem(cab, col, index, type);
              render();
            },
          }),
          el('p', { class: 'note' }, '點格子選取；把右邊的家電拖進格子，或選好格子後點家電。單位：公分。'),
        ),
        el('div', { class: 'designer-section' },
          el('h3', {}, `側面剖面（第 ${selected.col + 1} 欄）`),
          cabinetSideView(cab, selected.col, { selectedCell: selected.cell }),
        ),
        el('aside', { class: 'designer-side' },
          el('h3', {}, `第 ${selected.col + 1} 欄、由下往上第 ${selected.cell + 1} 格`),
          spanInput('這一欄的寬度', column.width, (v) => setColumnWidth(cab, selected.col, v)),
          spanInput('這一格的高度', cell.height, (v) => setCellHeight(cab, selected.col, selected.cell, v)),
          el('div', { class: 'row' },
            iconButton('split-v', '左右分割', { class: 'btn small', onclick: mutate((c) => splitColumn(c, selected.col)) }),
            iconButton('split-h', '上下分割', { class: 'btn small', onclick: mutate((c) => splitCell(c, selected.col, selected.cell)) }),
          ),
          el('div', { class: 'row' },
            iconButton('delete', '刪這一格', { class: 'btn small', onclick: mutate((c) => removeCell(c, selected.col, selected.cell)) }),
            iconButton('delete', '刪這一欄', { class: 'btn small', onclick: mutate((c) => removeColumn(c, selected.col)) }),
          ),
          el('h3', {}, '這一格的類型'),
          choice(CELL_KINDS, cell.kind, (kind) => {
            cab = updateCell(cab, selected.col, selected.cell, { kind });
            render();
          }),
          el('h3', {}, '插座（拉線）'),
          choice(OUTLETS, cell.outlet, (outlet) => {
            cab = updateCell(cab, selected.col, selected.cell, { outlet });
            render();
          }),
          el('h3', {}, '格內家電'),
          cell.items.length
            ? el('ul', { class: 'cloud-list' }, cell.items.map((it, i) =>
                el('li', {},
                  el('span', {}, getCatalogItem(it.type)?.name ?? it.type),
                  iconButton('close', '', { class: 'btn small icon-only', title: '拿出來', 'aria-label': '拿出來', onclick: () => {
                    cab = removeItem(cab, selected.col, selected.cell, i);
                    render();
                  } }))))
            : el('p', { class: 'note' }, '還沒有放家電'),
          el('h3', {}, '放家電進去'),
          el('div', { class: 'appliance-chips' }, appliances),
          el('h3', {}, issues.length ? `檢查結果（${issues.length} 個提醒）` : '檢查結果'),
          issues.length
            ? el('ul', { class: 'issue-list' }, issues.map((i) => el('li', {}, `第 ${i.col + 1} 欄第 ${i.cell + 1} 格：${i.message}`)))
            : el('p', { class: 'note ok' }, '✓ 尺寸、插座、散熱都沒問題'),
        ),
      ),
    );
  };

  overlay.hidden = false;
  document.addEventListener('keydown', onKey);
  render();
  return { close };
}

export { APPLIANCE_MIME };

// 給清單用：一句話的檢查摘要
export function issueSummary(cab) {
  const n = cabinetIssues(cab).length;
  return n ? `${n} 個提醒` : '檢查通過';
}

export function warnIfIssues(cab) {
  const n = cabinetIssues(cab).length;
  if (n) toast(`「${cab.name}」有 ${n} 個提醒，打開設計看看`, { duration: 4000 });
}
