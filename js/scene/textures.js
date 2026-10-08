// 程式產生的材質紋理（canvas）：木地板、磁磚、水泥、牆面；不用外部圖檔，載入快
import * as THREE from 'three';

const SIZE = 512;
const cache = new Map();

// 固定種子的亂數，同一種材質每次產生的紋理都一樣
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function canvas() {
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  return [c, c.getContext('2d')];
}

const shade = (hex, amount) => `#${new THREE.Color(hex).offsetHSL(0, 0, amount).getHexString()}`;

// 木地板：長條木板、交錯接縫、木紋與每片的色差
function drawWood(ctx, base, { plankRows = 6, grain = 0.06, grout = false } = {}) {
  const rand = seeded(7);
  const rowH = SIZE / plankRows;
  for (let r = 0; r < plankRows; r++) {
    let x = -rand() * SIZE * 0.5;
    while (x < SIZE) {
      const len = SIZE * (0.45 + rand() * 0.4);
      ctx.fillStyle = shade(base, (rand() - 0.5) * 0.08);
      ctx.fillRect(x, r * rowH, len, rowH);
      for (let i = 0; i < 14; i++) {
        ctx.strokeStyle = `rgba(60,35,15,${grain * rand()})`;
        ctx.lineWidth = 1 + rand() * 2;
        const y = r * rowH + rand() * rowH;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.bezierCurveTo(x + len * 0.3, y + (rand() - 0.5) * 6, x + len * 0.7, y + (rand() - 0.5) * 6, x + len, y);
        ctx.stroke();
      }
      // 木紋磚的接縫是較寬的淺色填縫，木地板則是細的深色縫
      ctx.fillStyle = grout ? 'rgba(220,214,204,0.95)' : 'rgba(40,25,12,0.35)';
      ctx.fillRect(x, r * rowH, grout ? 4 : 2, rowH);
      x += len;
    }
    ctx.fillStyle = grout ? 'rgba(220,214,204,0.95)' : 'rgba(40,25,12,0.4)';
    ctx.fillRect(0, r * rowH, SIZE, grout ? 4 : 2);
  }
}

// 磁磚：方格與填縫，每片略有色差與斑點
function drawTile(ctx, base, { tiles = 4, grout = '#bdb8b0', speckle = 0.05 } = {}) {
  const rand = seeded(11);
  const step = SIZE / tiles;
  ctx.fillStyle = grout;
  ctx.fillRect(0, 0, SIZE, SIZE);
  for (let i = 0; i < tiles; i++) {
    for (let j = 0; j < tiles; j++) {
      ctx.fillStyle = shade(base, (rand() - 0.5) * 0.04);
      ctx.fillRect(i * step + 2, j * step + 2, step - 4, step - 4);
    }
  }
  for (let k = 0; k < 2500; k++) {
    ctx.fillStyle = `rgba(0,0,0,${speckle * rand()})`;
    ctx.fillRect(rand() * SIZE, rand() * SIZE, 1.5, 1.5);
  }
}

// 水泥／磐多魔：大面積的雲狀明暗
function drawConcrete(ctx, base) {
  const rand = seeded(23);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, SIZE, SIZE);
  for (let k = 0; k < 220; k++) {
    const r = 20 + rand() * 90;
    const g = ctx.createRadialGradient(rand() * SIZE, rand() * SIZE, 0, rand() * SIZE, rand() * SIZE, r);
    const dark = rand() > 0.5;
    g.addColorStop(0, dark ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.04)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, SIZE, SIZE);
  }
}

// 牆面乳膠漆：很淡的雜訊，避免一片死白
function drawPaint(ctx, base) {
  const rand = seeded(31);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, SIZE, SIZE);
  for (let k = 0; k < 9000; k++) {
    ctx.fillStyle = `rgba(0,0,0,${0.025 * rand()})`;
    ctx.fillRect(rand() * SIZE, rand() * SIZE, 2, 2);
  }
}

const PAINTERS = { wood: drawWood, tile: drawTile, concrete: drawConcrete, paint: drawPaint };

// key 例如 'wood|#c8a97e'；同一組參數只畫一次
export function proceduralTexture(kind, base, options = {}) {
  const key = `${kind}|${base}|${JSON.stringify(options)}`;
  if (!cache.has(key)) {
    const [c, ctx] = canvas();
    PAINTERS[kind](ctx, base, options);
    const texture = new THREE.CanvasTexture(c);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 8;
    cache.set(key, texture);
  }
  return cache.get(key);
}

// 依實際尺寸（公尺）重複貼圖；tileSize＝一張紋理代表幾公尺
// 材質選單的小縮圖
export function textureThumbnail(kind, base, options) {
  return proceduralTexture(kind, base, options).image.toDataURL('image/jpeg', 0.7);
}

export function sizedTexture(kind, base, width, depth, tileSize, options) {
  const texture = proceduralTexture(kind, base, options).clone();
  texture.needsUpdate = true;
  texture.repeat.set(width / tileSize, depth / tileSize);
  return texture;
}
