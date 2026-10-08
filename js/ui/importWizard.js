// 「匯入平面圖（DXF）」全螢幕精靈；計算都在 js/import/wizard.js，這裡只管畫面與事件
// 檔案只在瀏覽器內讀取與轉換，不送出任何網路請求
import { validateFloorplan } from '../core/floorplan.js';
import { convertDxf } from '../import/convert.js';
import { parseDxf } from '../import/dxf.js';
import { summarizeLayers } from '../import/layers.js';
import { suggestUnitScale } from '../import/units.js';
import {
  QUICK_ROOM_NAMES,
  ROLES,
  STEPS,
  UNITS,
  applyRoomEdits,
  applyWindowEdits,
  buildConfig,
  checkFile,
  clipFromCorners,
  defaultClip,
  explainError,
  fitView,
  focusBox,
  formatSize,
  goBack,
  goNext,
  initialRoles,
  panBy,
  previewShapes,
  rolesToLayers,
  roomAt,
  stepError,
  summarizeFloorplan,
  toDrawing,
  toScreen,
  unitHint,
  unitLabel,
  wallExtent,
  windowAt,
  windowHeightError,
  windowLabels,
  zoomAt,
} from '../import/wizard.js';
import { el } from './dom.js';
import { iconSvg } from './icons.js';

const ODA_URL = 'https://www.opendesign.com/guestfiles/oda_file_converter';
const ROLE_COLORS = {
  rcWall: '#2d2a26',
  partition: '#7a5c3e',
  column: '#5b4a8a',
  window: '#2f7fc1',
  door: '#d07a1e',
  beam: '#b4423a',
  barrier: '#2f6f62',
  none: '#c9c3b9',
};
const ROOM_COLORS = ['#f3d9a4', '#bfdcc9', '#c9d6ef', '#efc9c9', '#dccbe8', '#f0e1b8', '#c4e3e0', '#e6d2bf'];
const OPENING_COLORS = { door: '#d07a1e', window: '#2f7fc1', doorway: '#9a948b' };
const CLICK_SLOP = 4; // 像素；拖曳距離在此以內算點一下
const WINDOW_PICK = 0.15; // 公尺；窗只有牆厚那麼窄，點在旁邊也算點到

// ---------- 可縮放、平移、框選的 2D 畫布 ----------

// draw(ctx, view) 畫內容；selectable 時拖曳＝框選（onSelect 收到圖面座標的範圍），否則拖曳＝平移
function planCanvas({ draw, selectable = false, onSelect, onClick }) {
  const canvas = el('canvas', { class: 'wizard-canvas' });
  const wrap = el('div', { class: 'wizard-canvas-wrap' }, canvas);
  let view = { k: 1, tx: 0, ty: 0 };
  let fitBox = null;
  let mode = selectable ? 'select' : 'pan';
  let drag = null; // { start, last, moved }
  const pointers = new Map();
  let pinch = null;

  const size = () => [wrap.clientWidth, wrap.clientHeight];
  let fitted = false;
  const redraw = () => {
    const [w, h] = size();
    // 建立時畫布還沒掛上去量不到尺寸；第一次量得到時才置中
    if (!fitted && fitBox && w && h) {
      view = fitView(fitBox, w, h, 24);
      fitted = true;
    }
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    draw(ctx, view);
    if (drag?.moved && mode === 'select') {
      const [x0, y0] = drag.start;
      const [x1, y1] = drag.last;
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = '#2f6f62';
      ctx.lineWidth = 1.5;
      ctx.fillStyle = 'rgba(47, 111, 98, 0.12)';
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
      ctx.setLineDash([]);
    }
  };
  const fit = (box) => {
    fitBox = box;
    fitted = false;
    redraw();
  };
  // 尺寸變了（出現錯誤訊息、轉手機）只重畫不重新置中，使用者縮放過的畫面才不會跳掉
  new ResizeObserver(() => redraw()).observe(wrap);

  const local = (e) => {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, local(e));
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { distance: Math.hypot(a[0] - b[0], a[1] - b[1]) };
      drag = null;
      redraw();
      return;
    }
    drag = { start: local(e), last: local(e), moved: false, pan: mode === 'pan' || e.button === 1 || e.button === 2 || e.shiftKey };
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, local(e));
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const distance = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (pinch.distance > 0) view = zoomAt(view, distance / pinch.distance, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
      pinch.distance = distance;
      redraw();
      return;
    }
    if (!drag) return;
    const p = local(e);
    if (Math.hypot(p[0] - drag.start[0], p[1] - drag.start[1]) > CLICK_SLOP) drag.moved = true;
    if (drag.pan) view = panBy(view, p[0] - drag.last[0], p[1] - drag.last[1]);
    drag.last = p;
    redraw();
  });
  const finish = (e) => {
    pointers.delete(e.pointerId);
    if (pinch) {
      if (pointers.size < 2) pinch = null;
      return;
    }
    if (!drag) return;
    const { start, last, moved, pan } = drag;
    drag = null;
    if (!moved) onClick?.(toDrawing(view, start));
    else if (!pan && mode === 'select') onSelect?.(clipFromCorners(toDrawing(view, start), toDrawing(view, last)));
    redraw();
  };
  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', finish);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    view = zoomAt(view, Math.exp(-e.deltaY * 0.0015), local(e));
    redraw();
  }, { passive: false });

  const zoomCenter = (factor) => {
    const [w, h] = size();
    view = zoomAt(view, factor, [w / 2, h / 2]);
    redraw();
  };
  const modeButtons = selectable
    ? ['select', 'pan'].map((m) =>
        el('button', { type: 'button', class: 'btn small', 'aria-pressed': String(m === mode), onclick: () => setMode(m) }, m === 'select' ? '框選' : '平移'))
    : [];
  const setMode = (m) => {
    mode = m;
    modeButtons.forEach((b, i) => {
      const on = ['select', 'pan'][i] === m;
      b.setAttribute('aria-pressed', String(on));
      b.classList.toggle('primary', on);
    });
    canvas.classList.toggle('panning', m === 'pan');
  };
  setMode(mode);
  const tools = el('div', { class: 'wizard-canvas-tools row' },
    ...modeButtons,
    el('button', { type: 'button', class: 'btn small', title: '放大', 'aria-label': '放大', onclick: () => zoomCenter(1.5) }, '＋'),
    el('button', { type: 'button', class: 'btn small', title: '縮小', 'aria-label': '縮小', onclick: () => zoomCenter(1 / 1.5) }, '－'),
    el('button', { type: 'button', class: 'btn small', onclick: () => fit(fitBox) }, '看全部'),
  );
  return { node: el('div', { class: 'wizard-canvas-box' }, tools, wrap), fit, redraw };
}

function strokePath(ctx, view, points, close = false) {
  ctx.beginPath();
  points.forEach((p, i) => {
    const [x, y] = toScreen(view, p);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  if (close) ctx.closePath();
}

// DXF 線稿；colorOf(layer) 回顏色，回 null 不畫
function drawShapes(ctx, view, shapes, colorOf, widthOf = () => 1) {
  for (const shape of shapes) {
    const color = colorOf(shape.layer);
    if (!color) continue;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = widthOf(shape.layer);
    if (shape.points.length === 1) {
      const [x, y] = toScreen(view, shape.points[0]);
      ctx.fillRect(x - 2, y - 2, 4, 4);
      continue;
    }
    strokePath(ctx, view, shape.points);
    ctx.stroke();
  }
}

// 框選範圍以外蓋一層灰
function drawClip(ctx, view, clip) {
  const [x0, y0] = toScreen(view, [clip.xMin, clip.yMax]);
  const [x1, y1] = toScreen(view, [clip.xMax, clip.yMin]);
  const { width, height } = ctx.canvas;
  ctx.save();
  ctx.fillStyle = 'rgba(45, 42, 38, 0.18)';
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.rect(x0, y0, x1 - x0, y1 - y0);
  ctx.fill('evenodd');
  ctx.strokeStyle = '#2f6f62';
  ctx.lineWidth = 2;
  ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
  ctx.restore();
}

const clipBox = (clip) => [clip.xMin, clip.yMin, clip.xMax, clip.yMax];

// 房間名稱標在面積最大的那塊矩形中央
function roomLabelAt(room) {
  const area = ([x0, y0, x1, y1]) => (x1 - x0) * (y1 - y0);
  const [x0, y0, x1, y1] = room.rects.reduce((best, r) => (area(r) > area(best) ? r : best));
  return [(x0 + x1) / 2, (y0 + y1) / 2];
}

// ---------- 精靈 ----------

export function openImportWizard({ onCreate }) {
  let state = {
    step: 0,
    error: null,
    busy: '',
    fileName: '',
    doc: null,
    summary: [],
    shapes: [],
    clip: null,
    roles: {},
    highlight: null,
    suggestion: null,
    unitScale: null,
    beamLabelScale: 0.01,
    result: null,
    names: {},
    removed: [],
    selectedRoom: null,
    windows: {}, // { 窗 id: { sill, head } }：預覽時改過的窗高
    selectedWindow: null,
    name: '匯入的平面圖',
  };

  // 每一步的畫布只在進入那一步時建一次，重畫畫面時沿用，縮放與平移才會留著
  let canvases = {};
  const canvasFor = (id, options, box) => {
    if (!canvases[id]) {
      const canvas = planCanvas(options);
      canvas.fit(box);
      setTimeout(() => canvas.redraw(), 0); // 掛上畫面之後再畫一次，才量得到尺寸
      canvases[id] = canvas;
    } else canvases[id].redraw();
    return canvases[id];
  };

  const steps = el('ol', { class: 'wizard-steps' });
  const body = el('div', { class: 'wizard-body' });
  const errorBox = el('div', { class: 'wizard-error', role: 'alert', hidden: true });
  const backButton = el('button', { type: 'button', class: 'btn', onclick: () => update(goBack(state)) }, '上一步');
  const nextButton = el('button', { type: 'button', class: 'btn primary', onclick: () => next() }, '下一步');
  const closeButton = el('button', { type: 'button', class: 'btn small icon-only', title: '關閉', 'aria-label': '關閉匯入精靈', onclick: () => close() });
  closeButton.innerHTML = iconSvg('close');
  const dialog = el('dialog', { class: 'import-wizard', 'aria-label': '匯入平面圖（DXF）' },
    el('div', { class: 'designer-head' }, el('h2', {}, '匯入平面圖（DXF）'), steps, el('span', { class: 'spacer' }), closeButton),
    body,
    el('div', { class: 'wizard-foot' }, errorBox, el('div', { class: 'row wizard-actions' }, backButton, nextButton)),
  );
  // 只拿掉自己，不影響共用的 #dialog
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();

  function close() {
    dialog.close();
  }

  function update(next) {
    const stepChanged = next.step !== state.step;
    state = next;
    if (stepChanged) enterStep();
    render();
  }

  const patch = (changes) => update({ ...state, ...changes });

  // 進入某一步時才算的東西；回上一步再進來會依最新的選擇重算
  function enterStep() {
    const id = STEPS[state.step].id;
    canvases = {};
    if (id === 'units') {
      const suggestion = suggestUnitScale(state.doc, { layers: rolesToLayers(state.roles), clip: state.clip });
      state = { ...state, suggestion, unitScale: suggestion.scale };
    }
  }

  // 等畫面先顯示「處理中」再做重的計算；不用 requestAnimationFrame，分頁在背景時它不會觸發
  const nextFrame = () => new Promise((resolve) => setTimeout(resolve, 50));

  async function next() {
    const id = STEPS[state.step].id;
    if (id === 'units' && !stepError('units', state)) {
      patch({ busy: '轉換中…', error: null });
      await nextFrame();
      const converted = convert();
      if (converted.error) {
        patch({ busy: '', error: converted.error });
        return;
      }
      state = { ...state, busy: '', result: converted.result, names: {}, removed: [], selectedRoom: null, windows: {}, selectedWindow: null };
    }
    if (id === 'finish') {
      create();
      return;
    }
    update(goNext(state));
  }

  function convert() {
    const layers = rolesToLayers(state.roles);
    const config = buildConfig({
      clip: state.clip,
      roles: state.roles,
      unitScale: state.unitScale,
      beamLabelScale: state.beamLabelScale,
      windowLabels: windowLabels(state.doc, layers.window, state.clip),
    });
    let result;
    try {
      result = convertDxf(state.doc, config);
    } catch (error) {
      return { error: explainError(error) };
    }
    const problems = validateFloorplan(result.floorplan);
    if (problems.length) return { error: `轉出的平面圖不完整：\n${problems.join('\n')}` };
    if (!result.floorplan.rooms.length) return { error: '找不到被牆圍起來的房間，請確認牆、門窗圖層都有指定，以及框選範圍有包住整戶' };
    return { result };
  }

  function create() {
    const error = stepError('finish', state);
    if (error) {
      patch({ error });
      return;
    }
    const floorplan = editedFloorplan();
    close();
    onCreate(floorplan, state.name.trim());
  }

  async function chooseFile(file) {
    if (!file) return;
    const problem = checkFile(file);
    if (problem) {
      patch({ error: problem });
      return;
    }
    patch({ busy: `讀取 ${file.name} 中…`, error: null });
    await nextFrame();
    let doc;
    try {
      doc = parseDxf(await file.text());
    } catch (error) {
      patch({ busy: '', error: explainError(error), doc: null });
      return;
    }
    const summary = summarizeLayers(doc);
    patch({
      busy: '',
      fileName: file.name,
      doc,
      summary,
      shapes: previewShapes(doc),
      clip: defaultClip(summary),
      roles: initialRoles(summary),
      highlight: null,
      result: null,
    });
  }

  // ---------- 每一步的畫面 ----------

  function fileStep() {
    const input = el('input', { type: 'file', accept: '.dxf', onchange: () => chooseFile(input.files[0]) });
    return el('div', { class: 'wizard-page' },
      el('p', {}, '選擇建商或設計師給的平面圖 DXF 檔。檔案只在這台裝置的瀏覽器裡讀取，不會上傳。'),
      el('label', { class: 'btn primary wizard-file' }, '選擇 DXF 檔', input),
      state.doc ? el('p', { class: 'note' }, `已讀取：${state.fileName}（${state.summary.length} 個圖層、${state.doc.entities.length} 個圖元）`) : null,
      el('details', { class: 'wizard-help' },
        el('summary', {}, '只有 DWG 檔？怎麼轉成 DXF'),
        el('ol', {},
          el('li', {}, '下載免費的 ODA File Converter（Windows、Mac 都有）。'),
          el('li', {}, '來源資料夾選 DWG 所在的資料夾，輸出資料夾另外選一個。'),
          el('li', {}, '輸出格式選「DXF」，版本選較新的（例如 ACAD2018），類型選「ASCII」，不要選 Binary。'),
          el('li', {}, '按 Start 轉換，再回到這裡選轉好的 .dxf 檔。'),
        ),
        el('p', {}, el('a', { href: ODA_URL, target: '_blank', rel: 'noopener noreferrer' }, 'ODA File Converter 官方下載頁（外部連結）')),
      ),
    );
  }

  function clipStep() {
    const canvas = canvasFor('clip', {
      selectable: true,
      draw: (ctx, view) => {
        drawShapes(ctx, view, state.shapes, () => '#5f5a52');
        drawClip(ctx, view, state.clip);
      },
      onSelect: (clip) => patch({ clip, error: null }),
    }, focusBox(state.shapes));
    return el('div', { class: 'wizard-page wizard-split' },
      el('div', { class: 'wizard-side' },
        el('p', {}, '一張圖常常畫了好幾戶或好幾層。在線稿上拖一個框，框出要的那一戶；預設是整張圖。'),
        el('p', { class: 'note' }, '滾輪或「＋／－」縮放；切到「平移」或按住 Shift 拖曳可以移動畫面；手機可以兩指縮放。「看全部」回到一開始的畫面。'),
        el('button', { type: 'button', class: 'btn small', onclick: () => patch({ clip: defaultClip(state.summary), error: null }) }, '改回整張圖'),
      ),
      canvas.node,
    );
  }

  function layersStep() {
    const roleOf = (name) => state.roles[name] ?? 'none';
    // 沒有框選（整張圖）時跟上一步一樣看圖面密集的地方
    const whole = JSON.stringify(state.clip) === JSON.stringify(defaultClip(state.summary));
    const canvas = canvasFor('layers', {
      draw: (ctx, view) => {
        drawShapes(ctx, view, state.shapes,
          (layer) => (layer === state.highlight ? '#e0218a' : ROLE_COLORS[roleOf(layer)]),
          (layer) => (layer === state.highlight ? 3 : roleOf(layer) === 'none' ? 0.6 : 1.4));
        drawClip(ctx, view, state.clip);
      },
    }, whole ? focusBox(state.shapes) : clipBox(state.clip));
    const rows = state.summary.map((layer) => {
      const select = el('select', { 'aria-label': `${layer.name} 的用途`, onchange: () => patch({ roles: { ...state.roles, [layer.name]: select.value }, error: null }) },
        ROLES.map((r) => el('option', { value: r.id, selected: r.id === roleOf(layer.name) }, r.label)));
      return el('li', { class: `wizard-layer ${layer.name === state.highlight ? 'active' : ''}` },
        el('button', {
          type: 'button',
          class: 'wizard-layer-name',
          title: '在預覽中標示這個圖層',
          onclick: () => patch({ highlight: state.highlight === layer.name ? null : layer.name }),
        },
          el('span', { class: 'swatch', style: `background:${ROLE_COLORS[roleOf(layer.name)]}` }),
          el('span', {}, layer.name),
          el('span', { class: 'note' }, `${layer.count}`)),
        select);
    });
    return el('div', { class: 'wizard-page wizard-split' },
      el('div', { class: 'wizard-side' },
        el('p', {}, '替每個圖層選用途；已依圖層名稱先猜一次。點圖層名稱會在線稿上用粉紅色標出來；灰框外是沒框到的範圍。'),
        el('p', { class: 'note' }, '至少要有一層牆（RC 牆、輕隔間或柱）。窗要有 W5、DW4 這類編號才算得出窗高。'),
        el('ul', { class: 'wizard-layers' }, rows),
      ),
      canvas.node,
    );
  }

  function unitsStep() {
    const extent = wallExtent(state.doc, rolesToLayers(state.roles), state.clip);
    const hint = unitHint(state.suggestion);
    const radios = (name, value, onPick, suggested) =>
      el('div', { class: 'row', role: 'radiogroup' }, UNITS.map((u) =>
        el('label', { class: `btn small ${u.scale === value ? 'primary' : ''}` },
          el('input', { type: 'radio', name, value: String(u.scale), checked: u.scale === value, onchange: () => onPick(u.scale) }),
          u.label, u.scale === suggested ? '（建議）' : '')));
    return el('div', { class: 'wizard-page' },
      el('h3', {}, '圖面單位'),
      radios('unit', state.unitScale, (unitScale) => patch({ unitScale, error: null }), state.suggestion.scale),
      hint ? el('p', { class: 'wizard-hint' }, hint) : null,
      el('p', {}, extent && state.unitScale
        ? `用${unitLabel(state.unitScale)}換算，這個範圍的牆約 ${formatSize(extent, state.unitScale)}。一般住家約 5～30 m，差很多就是單位選錯了。`
        : '框選範圍內找不到牆，請回上一步確認牆圖層。'),
      el('h3', {}, '樑標註單位'),
      el('p', { class: 'note' }, '樑旁邊「(寬x深)」標註的單位，常見是公分；和圖面單位不一定一樣。沒有樑圖層時不影響。'),
      radios('beam-unit', state.beamLabelScale, (beamLabelScale) => patch({ beamLabelScale }), 0.01),
    );
  }

  const editedFloorplan = () => applyWindowEdits(applyRoomEdits(state.result.floorplan, { names: state.names, removed: state.removed }), state.windows);

  // 房間清單、顏色、名稱都從目前的 state 算，畫布沿用時才不會畫到舊的
  const previewRooms = () => {
    const rooms = state.result.floorplan.rooms;
    return { rooms, kept: rooms.filter((r) => !state.removed.includes(r.id)) };
  };
  const roomColor = (room) => ROOM_COLORS[state.result.floorplan.rooms.indexOf(room) % ROOM_COLORS.length];
  const roomName = (room) => state.names[room.id]?.trim() || room.name;

  function drawPreview(ctx, view) {
    const { floorplan } = state.result;
    const { kept } = previewRooms();
    const fillRect = ([x0, y0, x1, y1], stroke = false) => {
      const [sx0, sy0] = toScreen(view, [x0, y1]);
      const [sx1, sy1] = toScreen(view, [x1, y0]);
      if (stroke) ctx.strokeRect(sx0, sy0, sx1 - sx0, sy1 - sy0);
      else ctx.fillRect(sx0, sy0, sx1 - sx0, sy1 - sy0);
    };
    for (const room of kept) {
      ctx.fillStyle = roomColor(room);
      room.rects.forEach((r) => fillRect(r));
    }
    const selected = kept.find((r) => r.id === state.selectedRoom);
    if (selected) {
      ctx.strokeStyle = '#e0218a';
      ctx.lineWidth = 2;
      selected.rects.forEach((r) => fillRect(r, true));
    }
    for (const wall of floorplan.walls) {
      ctx.fillStyle = wall.kind === 'partition' ? '#7a5c3e' : '#2d2a26';
      strokePath(ctx, view, wall.polygon, true);
      ctx.fill();
    }
    for (const opening of floorplan.openings) {
      ctx.fillStyle = OPENING_COLORS[opening.kind];
      strokePath(ctx, view, opening.polygon, true);
      ctx.fill();
    }
    const pickedWindow = floorplan.openings.find((o) => o.id === state.selectedWindow);
    if (pickedWindow) {
      ctx.strokeStyle = '#e0218a';
      ctx.lineWidth = 3;
      strokePath(ctx, view, pickedWindow.polygon, true);
      ctx.stroke();
    }
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = '#b4423a';
    ctx.lineWidth = 1;
    floorplan.beams.forEach((b) => fillRect(b.rect, true));
    ctx.setLineDash([]);
    ctx.fillStyle = '#2d2a26';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const room of kept) {
      const [x, y] = toScreen(view, roomLabelAt(room));
      ctx.fillText(roomName(room), x, y);
    }
  }

  function previewStep() {
    const { floorplan, warnings } = state.result;
    const { rooms, kept } = previewRooms();
    const canvas = canvasFor('preview', {
      draw: drawPreview,
      // 先看有沒有點到窗，沒有才選房間
      onClick: (p) => {
        const windowId = windowAt(state.result.floorplan.openings, p, WINDOW_PICK);
        if (windowId) {
          patch({ selectedWindow: windowId, error: null });
          return;
        }
        const id = roomAt(previewRooms().kept, p);
        if (id) patch({ selectedRoom: id, selectedWindow: null });
      },
    }, [0, 0, floorplan.bounds.width, floorplan.bounds.depth]);

    const setName = (id, name) => {
      state = { ...state, names: { ...state.names, [id]: name } };
      canvas.redraw();
    };
    const list = rooms.map((room) => {
      const removed = state.removed.includes(room.id);
      const input = el('input', {
        type: 'text',
        value: roomName(room),
        maxlength: '20',
        'aria-label': `${room.name} 的名稱`,
        disabled: removed,
        'data-room': room.id,
        onfocus: () => {
          if (state.selectedRoom === room.id) return;
          patch({ selectedRoom: room.id });
          body.querySelector(`[data-room="${room.id}"]`)?.focus();
        },
        oninput: () => setName(room.id, input.value),
      });
      const toggle = removed
        ? el('button', { type: 'button', class: 'btn small', onclick: () => patch({ removed: state.removed.filter((id) => id !== room.id) }) }, '復原')
        : el('button', { type: 'button', class: 'btn small danger', title: '誤判的小房間可以刪掉', onclick: () => patch({ removed: [...state.removed, room.id], selectedRoom: null, error: null }) }, '刪除');
      return el('li', { class: `wizard-room ${room.id === state.selectedRoom ? 'active' : ''} ${removed ? 'removed' : ''}` },
        el('span', { class: 'swatch', style: `background:${roomColor(room)}` }), input, toggle);
    });
    const selected = kept.find((r) => r.id === state.selectedRoom);
    const quick = selected
      ? el('div', { class: 'row wizard-quick' },
          el('span', { class: 'note' }, `「${roomName(selected)}」改成：`),
          QUICK_ROOM_NAMES.map((name) => el('button', { type: 'button', class: 'btn small', onclick: () => patch({ names: { ...state.names, [selected.id]: name } }) }, name)))
      : el('p', { class: 'note' }, '點平面圖上的房間或下面的名稱欄，可以快速選常用名稱。');
    const summary = summarizeFloorplan(floorplan);
    return el('div', { class: 'wizard-page wizard-split' },
      el('div', { class: 'wizard-side' },
        el('p', { class: 'note' }, `牆 ${summary.walls}、門 ${summary.doors}、窗 ${summary.windows}、門洞 ${summary.doorways}、樑 ${summary.beams}`),
        warnings.length ? el('ul', { class: 'wizard-warnings' }, warnings.map((w) => el('li', {}, w))) : null,
        windowEditor(floorplan),
        quick,
        el('ul', { class: 'wizard-rooms' }, list),
      ),
      canvas.node,
    );
  }

  // 點到的窗：改窗台、窗頂高度；不合理的值不寫入，顯示原因
  function windowEditor(floorplan) {
    const opening = floorplan.openings.find((o) => o.id === state.selectedWindow);
    if (!opening) return summarizeFloorplan(floorplan).windows ? el('p', { class: 'note' }, '點平面圖上的窗（藍色）可以修改窗台與窗頂高度。') : null;
    const current = state.windows[opening.id] ?? { sill: opening.sill, head: opening.head };
    const input = (value, label) => el('input', { type: 'number', min: '0', max: '3', step: '0.05', value: String(value), 'aria-label': label });
    const sill = input(current.sill, '窗台高度（公尺）');
    const head = input(current.head, '窗頂高度（公尺）');
    const apply = () => {
      const next = { sill: Number(sill.value), head: Number(head.value) };
      const error = windowHeightError(next.sill, next.head);
      if (error) patch({ error });
      else patch({ windows: { ...state.windows, [opening.id]: next }, error: null });
    };
    sill.addEventListener('change', apply);
    head.addEventListener('change', apply);
    return el('div', { class: 'wizard-window' },
      el('strong', {}, `窗 ${opening.label || '（沒有編號）'}`),
      el('label', { class: 'field' }, el('span', {}, '窗台（m）'), sill),
      el('label', { class: 'field' }, el('span', {}, '窗頂（m）'), head),
      el('button', { type: 'button', class: 'btn small', onclick: () => patch({ selectedWindow: null, error: null }) }, '完成'),
    );
  }

  function finishStep() {
    const floorplan = editedFloorplan();
    const s = summarizeFloorplan(floorplan);
    const input = el('input', { type: 'text', value: state.name, maxlength: '40', oninput: () => (state = { ...state, name: input.value }) });
    return el('div', { class: 'wizard-page' },
      el('label', { class: 'field wizard-name' }, el('span', {}, '平面圖名稱'), input),
      el('table', { class: 'wizard-summary' },
        el('tbody', {},
          [['牆', s.walls], ['門', s.doors], ['窗', s.windows], ['門洞', s.doorways], ['房間', s.rooms], ['樑', s.beams]].map(([label, n]) =>
            el('tr', {}, el('th', {}, label), el('td', {}, String(n)))))),
      el('p', { class: 'note' }, `房間：${floorplan.rooms.map((r) => r.name).join('、')}`),
      el('p', { class: 'note' }, '按「建立」會把這份平面圖存在這個瀏覽器，切換過去並建立第一個方案。預設平面圖不會被覆蓋，之後可以在「檔案」→「平面圖」切回去。'),
    );
  }

  let renderedStep = null;
  const PAGES = { file: fileStep, clip: clipStep, layers: layersStep, units: unitsStep, preview: previewStep, finish: finishStep };

  function render() {
    const id = STEPS[state.step].id;
    steps.replaceChildren(...STEPS.map((s, i) =>
      el('li', { class: i === state.step ? 'current' : i < state.step ? 'done' : '', 'aria-current': i === state.step ? 'step' : null },
        el('span', { class: 'num' }, String(i + 1)), el('span', { class: 'label' }, s.title))));
    // 圖層、房間清單很長；重畫後捲回原位
    const scroll = id === renderedStep ? body.querySelector('.wizard-side')?.scrollTop ?? 0 : 0;
    renderedStep = id;
    body.replaceChildren(state.busy ? el('div', { class: 'wizard-page' }, el('p', {}, state.busy)) : PAGES[id]());
    const side = body.querySelector('.wizard-side');
    if (side) side.scrollTop = scroll;
    errorBox.hidden = !state.error;
    errorBox.textContent = state.error ?? '';
    backButton.disabled = state.step === 0 || Boolean(state.busy);
    nextButton.disabled = Boolean(state.busy);
    nextButton.textContent = id === 'finish' ? '建立' : '下一步';
  }

  render();
}
