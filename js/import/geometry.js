// 平面幾何工具；單位跟著輸入走，不做換算
// 點 [x, y]、線段 [a, b]、多邊形 [點...]；浮點細節對齊 Python 版，轉出的座標才會一致

const RAY_EPSILON = 1e-6; // 射線起點落在邊上時，避免把自己那條邊算成命中

export const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);

// Python 3.12 起 sum() 對浮點數做 Neumaier 補償加總；直接 reduce 會差在最後一位
export function pySum(values) {
  let total = 0;
  let c = 0;
  for (const x of values) {
    const t = total + x;
    c += Math.abs(total) >= Math.abs(x) ? total - t + x : x - t + total;
    total = t;
  }
  return c && Number.isFinite(c) ? total + c : total;
}

// Python 浮點的 a // b；Math.floor(a / b) 在 1 // 0.1 這類情形會多 1
export function floorDiv(a, b) {
  let mod = a % b;
  let div = (a - mod) / b;
  if (mod && b < 0 !== mod < 0) {
    mod += b;
    div -= 1;
  }
  if (!div) return Math.sign(a / b) < 0 ? -0 : 0;
  let floor = Math.floor(div);
  if (div - floor > 0.5) floor += 1;
  return floor;
}

// Python round(x, n)：依二進位的精確值取最近，剛好一半時取偶數；toFixed 遇到一半一律進位
export function roundHalfEven(x, digits) {
  // 二進位浮點只有 x·2ⁿ⁺¹ 是奇數時，x·10ⁿ 才會剛好落在 .5
  const half = x * 2 ** (digits + 1);
  if (Number.isInteger(half) && Math.abs(half % 2) === 1) {
    const lower = Math.floor(x * 10 ** digits);
    return (lower % 2 === 0 ? lower : lower + 1) / 10 ** digits;
  }
  return Number(x.toFixed(digits));
}

function snap(points, p, tol) {
  const i = points.findIndex((q) => dist(p, q) <= tol);
  if (i >= 0) return i;
  points.push(p);
  return points.length - 1;
}

// 從 start 節點沿未走過的線段一路走，回傳走過的節點序列
function walk(start, adjacency, used) {
  const path = [start];
  let node = start;
  for (;;) {
    const step = adjacency.get(node).find(([, s]) => !used.has(s));
    if (!step) return path;
    const [next, seg] = step;
    node = next;
    used.add(seg);
    path.push(node);
    if (node === start) return path;
  }
}

// 兩塊牆共用頂點時，一次走訪會繞成 8 字形；從重複出現的節點把子輪廓切出來
function splitAtRepeats(cycle) {
  const loops = [];
  const stack = [];
  for (const node of [...cycle, cycle[0]]) {
    const cut = stack.indexOf(node);
    if (cut >= 0) {
      const loop = stack.slice(cut);
      if (loop.length >= 3) loops.push(loop);
      stack.length = cut + 1;
      continue;
    }
    stack.push(node);
  }
  return loops;
}

// 把散落的線段依端點串成封閉輪廓；回傳 [封閉輪廓, 無法封閉的開放鏈]
// 開放鏈兩端距離在 closeGap 以內時直接補一條線封閉（牆接柱子時常見）
export function buildLoops(segments, tol = 0.5, closeGap = 25) {
  const nodes = [];
  const adjacency = new Map(); // 要保留插入順序，不能用一般物件（整數鍵會被重排）
  segments.forEach(([a, b], idx) => {
    const ia = snap(nodes, a, tol);
    const ib = snap(nodes, b, tol);
    if (!adjacency.has(ia)) adjacency.set(ia, []);
    adjacency.get(ia).push([ib, idx]);
    if (!adjacency.has(ib)) adjacency.set(ib, []);
    adjacency.get(ib).push([ia, idx]);
  });

  const used = new Set();
  const loops = [];
  const openChains = [];
  // 先從度數 1 的端點出發，開放鏈才會從頭走到尾（穩定排序，其餘維持原順序）
  const starts = [...adjacency.keys()].sort((m, n) => (adjacency.get(m).length !== 1) - (adjacency.get(n).length !== 1));
  for (const start of starts) {
    while (adjacency.get(start).some(([, s]) => !used.has(s))) {
      const path = walk(start, adjacency, used);
      const points = path.map((i) => nodes[i]);
      if (path[0] === path.at(-1)) {
        for (const sub of splitAtRepeats(path.slice(0, -1))) loops.push(sub.map((i) => nodes[i]));
      } else if (dist(points[0], points.at(-1)) <= closeGap) {
        loops.push(points);
      } else {
        openChains.push(points);
      }
    }
  }
  const [paired, remaining] = pairOpenChains(openChains, closeGap);
  return [[...loops, ...paired], remaining];
}

// 牆的內外兩條線各是一條開放鏈、兩端都接在別的牆上時，兩兩配對接成一個輪廓
function pairOpenChains(chains, closeGap) {
  const loops = [];
  const remaining = [...chains];
  let i = 0;
  while (i < remaining.length) {
    const a = remaining[i];
    let match = null;
    for (let j = i + 1; j < remaining.length; j += 1) {
      const b = remaining[j];
      if (dist(a.at(-1), b.at(-1)) <= closeGap && dist(a[0], b[0]) <= closeGap) {
        match = [j, [...a, ...[...b].reverse()]];
        break;
      }
      if (dist(a.at(-1), b[0]) <= closeGap && dist(a[0], b.at(-1)) <= closeGap) {
        match = [j, [...a, ...b]];
        break;
      }
    }
    if (match === null) {
      i += 1;
      continue;
    }
    loops.push(match[1]);
    remaining.splice(match[0], 1);
    remaining.splice(i, 1);
  }
  return [loops, remaining];
}

const edges = (poly) => poly.map((p, i) => [p, poly[(i + 1) % poly.length]]);

export function pointInPolygon([x, y], poly) {
  let inside = false;
  for (const [[x1, y1], [x2, y2]] of edges(poly)) {
    if (y1 > y !== y2 > y) {
      const crossX = x1 + ((y - y1) * (x2 - x1)) / (y2 - y1);
      if (x < crossX) inside = !inside;
    }
  }
  return inside;
}

// 從 origin 沿 direction（單位向量）射出，回傳第一個碰到多邊形邊的距離；超過 maxDist 或沒碰到回 null
export function rayHit([ox, oy], [dx, dy], polygons, maxDist) {
  let best = null;
  for (const poly of polygons) {
    for (const [[ax, ay], [bx, by]] of edges(poly)) {
      const ex = bx - ax;
      const ey = by - ay;
      const denom = dx * ey - dy * ex;
      if (Math.abs(denom) < 1e-12) continue;
      const t = ((ax - ox) * ey - (ay - oy) * ex) / denom;
      const u = ((ax - ox) * dy - (ay - oy) * dx) / denom;
      if (t > RAY_EPSILON && u >= -1e-9 && u <= 1 + 1e-9 && (best === null || t < best)) best = t;
    }
  }
  if (best === null || best > maxDist) return null;
  return best;
}

// 有號面積：逆時針為正
export function polygonArea(poly) {
  let total = 0;
  for (const [[x1, y1], [x2, y2]] of edges(poly)) total += x1 * y2 - x2 * y1;
  return total / 2;
}

// 頂點平均；矩形與一般牆體輪廓用來排序、去重已足夠
export function centroid(poly) {
  return [pySum(poly.map(([x]) => x)) / poly.length, pySum(poly.map(([, y]) => y)) / poly.length];
}

// Python 的 tuple 比較：先比 x 再比 y
export function comparePoints(p, q) {
  return p[0] - q[0] || p[1] - q[1];
}
