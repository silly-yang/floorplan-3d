// 本機對照：JS 版 DXF 轉換器與 Python 版產出的 data/floorplan.json 逐欄比對
// 用法：node scripts/dxf-parity.mjs [DXF 路徑]（預設取 source/ 底下唯一的 .dxf）
// 原始圖檔是私人住家，不進版控；檔名含樓層，也不寫進程式碼。只印座標差異，不印任何圖面文字
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { convertDxf } from '../js/import/convert.js';
import { parseDxf } from '../js/import/dxf.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = resolve(ROOT, 'source');
const TOLERANCE = 1e-6;
const SECTIONS = ['walls', 'openings', 'rooms', 'beams'];
const MAX_LINES_PER_SECTION = 20;

function defaultDxf() {
  if (!existsSync(SOURCE)) return null;
  const found = readdirSync(SOURCE).filter((name) => name.toLowerCase().endsWith('.dxf'));
  if (found.length > 1) {
    console.log(`source/ 底下有 ${found.length} 個 DXF，請把要對照的路徑當第一個參數傳入。`);
    process.exit(0);
  }
  return found.length ? resolve(SOURCE, found[0]) : null;
}

const dxfPath = process.argv[2] ? resolve(process.argv[2]) : defaultDxf();
if (!dxfPath || !existsSync(dxfPath)) {
  console.log(`找不到 DXF（${dxfPath ?? 'source/*.dxf'}），略過對照。`);
  console.log('原始 DXF 不進版控；要對照時把圖檔放到 source/，或把路徑當第一個參數傳入。');
  process.exit(0);
}

// 逐欄比較，數字容許 TOLERANCE；回傳 [路徑, Python 值, JS 值]
function diff(expected, actual, path, out) {
  if (typeof expected === 'number' && typeof actual === 'number') {
    if (Math.abs(expected - actual) > TOLERANCE) out.push([path, expected, actual]);
    return out;
  }
  if (Array.isArray(expected) && Array.isArray(actual)) {
    if (expected.length !== actual.length) out.push([`${path}.length`, expected.length, actual.length]);
    for (let i = 0; i < Math.min(expected.length, actual.length); i += 1) diff(expected[i], actual[i], `${path}[${i}]`, out);
    return out;
  }
  if (expected && actual && typeof expected === 'object' && typeof actual === 'object') {
    for (const key of new Set([...Object.keys(expected), ...Object.keys(actual)])) diff(expected[key], actual[key], `${path}.${key}`, out);
    return out;
  }
  if (expected !== actual) out.push([path, expected, actual]);
  return out;
}

const config = JSON.parse(readFileSync(resolve(ROOT, 'tools/overrides.json'), 'utf8'));
const expected = JSON.parse(readFileSync(resolve(ROOT, 'data/floorplan.json'), 'utf8'));
const started = performance.now();
const { floorplan: actual, warnings } = convertDxf(parseDxf(readFileSync(dxfPath, 'utf8')), config);
const elapsed = Math.round(performance.now() - started);

let total = 0;
for (const section of SECTIONS) {
  const diffs = diff(expected[section], actual[section], section, []);
  total += diffs.length;
  console.log(`${section}：Python ${expected[section].length} 筆、JS ${actual[section].length} 筆，差異 ${diffs.length} 處`);
  for (const [path, py, js] of diffs.slice(0, MAX_LINES_PER_SECTION)) {
    console.log(`  ${path}: Python=${JSON.stringify(py)} JS=${JSON.stringify(js)}`);
  }
  if (diffs.length > MAX_LINES_PER_SECTION) console.log(`  …其餘 ${diffs.length - MAX_LINES_PER_SECTION} 處略`);
}
for (const w of warnings) console.log(`警告：${w}`);
console.log(`轉換耗時 ${elapsed} ms；${total === 0 ? '零差異' : `共 ${total} 處差異`}（容差 ${TOLERANCE}）`);
process.exit(total === 0 ? 0 : 1);
