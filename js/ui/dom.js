// 小型 DOM 工具：建元素、提示訊息、對話框

export const $ = (selector, root = document) => root.querySelector(selector);

// el('button', { class: 'btn', onclick }, '文字')；值為 false/null 的屬性略過
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === false || value == null) continue;
    if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key === 'class') node.className = value;
    else if (key in node && typeof value !== 'string') node[key] = value;
    else node.setAttribute(key, value === true ? '' : value);
  }
  node.append(...children.flat().filter((c) => c != null && c !== false));
  return node;
}

let toastTimer;
export function toast(message, { error = false, duration = 3200 } = {}) {
  const node = $('#toast');
  node.textContent = message;
  node.classList.toggle('error', error);
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (node.hidden = true), duration);
}

// 顯示對話框，回傳使用者按下的按鈕值；按 Esc 或點背景回傳 null
function openDialog(title, body, buttons) {
  const dialog = $('#dialog');
  return new Promise((resolve) => {
    const finish = (value) => {
      dialog.close();
      resolve(value);
    };
    dialog.replaceChildren(
      el('h2', {}, title),
      ...[body].flat().filter(Boolean),
      el(
        'div',
        { class: 'actions' },
        buttons.map((b) => el('button', { class: `btn ${b.class ?? ''}`, type: 'button', onclick: () => finish(b.value) }, b.label)),
      ),
    );
    dialog.onclose = () => resolve(null);
    dialog.onclick = (e) => {
      if (e.target === dialog) finish(null);
    };
    dialog.showModal();
  });
}

export function alertDialog(title, message) {
  return openDialog(title, el('pre', {}, message), [{ label: '知道了', value: true, class: 'primary' }]);
}

export async function confirmDialog(title, message, { okLabel = '確定', danger = false } = {}) {
  const value = await openDialog(title, el('p', {}, message), [
    { label: '取消', value: false },
    { label: okLabel, value: true, class: danger ? 'danger' : 'primary' },
  ]);
  return value === true;
}

// choices：[{ label, value, class }]
export function chooseDialog(title, message, choices) {
  return openDialog(title, el('p', {}, message), [...choices, { label: '取消', value: null }]);
}

export async function promptDialog(title, label, initial = '') {
  const input = el('input', { type: 'text', value: initial, maxlength: '60' });
  const dialog = $('#dialog');
  const pending = openDialog(title, [el('p', {}, label), input], [
    { label: '取消', value: null },
    { label: '確定', value: 'ok', class: 'primary' },
  ]);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      dialog.querySelector('.btn.primary').click();
    }
  });
  setTimeout(() => input.select(), 0);
  const value = await pending;
  const text = input.value.trim();
  return value === 'ok' && text ? text : null;
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = el('a', { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
