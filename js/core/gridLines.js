// 地板網格線：平面座標（公尺），每 10 cm 一條，整公尺為粗線；不依賴 Three.js
const STEP_CM = 10;

export function gridLines({ width, depth }) {
  const lines = [];
  // 以公分整數計數，避免 0.1 累加的浮點誤差
  const axis = (name, span, other) => {
    for (let cm = 0; cm <= Math.round(span * 100) + 1e-9; cm += STEP_CM) {
      const at = cm / 100;
      const [from, to] = name === 'x' ? [[at, 0], [at, other]] : [[0, at], [other, at]];
      lines.push({ axis: name, at, from, to, major: cm % 100 === 0 });
    }
  };
  axis('x', width, depth);
  axis('y', depth, width);
  return lines;
}
