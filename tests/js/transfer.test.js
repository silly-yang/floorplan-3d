import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDesign } from '../../js/storage/schema.js';
import {
  EXPORT_FORMAT,
  ImportError,
  assignFloorplans,
  buildExport,
  exportFileName,
  findConflict,
  parseImportText,
  resolveImport,
} from '../../js/storage/transfer.js';

const NOW = '2026-10-08T09:00:00.000Z';
const design = (id, name) => createDesign({ id, name, now: NOW });

test('匯出包帶格式標記、時間與所有方案，再匯入可完整還原', () => {
  // Arrange
  const designs = [design('a', '方案 A'), design('b', '方案 B')];
  designs[1].furniture.push({ id: 'f1', type: 'plant', x: 1, y: 1, rotation: 0, size: { w: 45, d: 45, h: 120 }, color: '#5f8a54' });

  // Act
  const bundle = buildExport(designs, NOW);
  const { designs: restored, errors } = parseImportText(JSON.stringify(bundle));

  // Assert
  assert.equal(bundle.format, EXPORT_FORMAT);
  assert.equal(bundle.exportedAt, NOW);
  assert.deepEqual(restored, designs);
  assert.deepEqual(errors, []);
});

for (const [name, content] of [
  ['單一設計物件', () => design('a', '方案 A')],
  ['設計陣列', () => [design('a', '方案 A')]],
]) {
  test(`parseImportText 也接受${name}`, () => {
    // Act
    const { designs } = parseImportText(JSON.stringify(content()));

    // Assert
    assert.deepEqual(designs.map((d) => d.id), ['a']);
  });
}

test('parseImportText 部分方案損壞時，好的照常匯入、壞的列出名稱與問題', () => {
  // Arrange
  const bad = { ...design('b', '壞掉的方案'), ceilingHeight: 'tall' };
  const text = JSON.stringify(buildExport([design('a', '方案 A'), bad], NOW));

  // Act
  const { designs, errors } = parseImportText(text);

  // Assert
  assert.deepEqual(designs.map((d) => d.id), ['a']);
  assert.equal(errors.length, 1);
  assert.match(errors[0].label, /壞掉的方案/);
  assert.ok(errors[0].problems.some((p) => p.includes('ceilingHeight')));
});

for (const [name, text, fragment] of [
  ['不是 JSON', '{oops', 'JSON'],
  ['不認得的內容', '{"hello":1}', '設計檔'],
  ['空檔案', '', 'JSON'],
]) {
  test(`parseImportText ${name}時丟出 ImportError`, () => {
    // Act & Assert
    assert.throws(() => parseImportText(text), (e) => e instanceof ImportError && e.message.includes(fragment));
  });
}

for (const [name, designs, expected] of [
  ['單一方案用方案名稱', [design('a', '客廳 / 版本:1')], '客廳 _ 版本_1.design.json'],
  ['多個方案用日期', [design('a', 'A'), design('b', 'B')], '全部方案-20261008.design.json'],
]) {
  test(`exportFileName ${name}`, () => {
    // Act & Assert
    assert.equal(exportFileName(designs, NOW), expected);
  });
}

test('findConflict 以方案名稱比對', () => {
  // Arrange
  const existing = [{ id: 'x', name: '方案 A' }];

  // Act & Assert
  assert.deepEqual(findConflict(design('a', '方案 A'), existing), { id: 'x', name: '方案 A' });
  assert.equal(findConflict(design('a', '方案 B'), existing), null);
});

test('resolveImport 覆蓋時沿用既有方案的 id', () => {
  // Arrange
  const existing = [{ id: 'x', name: '方案 A' }];

  // Act
  const result = resolveImport(design('a', '方案 A'), 'overwrite', existing, { newId: () => 'new' });

  // Assert
  assert.equal(result.id, 'x');
  assert.equal(result.name, '方案 A');
});

test('resolveImport 另存時給新 id 與不重複的名稱', () => {
  // Arrange
  const existing = [{ id: 'x', name: '方案 A' }];

  // Act
  const result = resolveImport(design('a', '方案 A'), 'copy', existing, { newId: () => 'new' });

  // Assert
  assert.deepEqual([result.id, result.name], ['new', '方案 A (2)']);
});

test('resolveImport 沒有名稱衝突但 id 撞到別的方案時換新 id', () => {
  // Arrange：另一台裝置剛好產生了相同 id（機率低但要防）
  const existing = [{ id: 'a', name: '別的方案' }];

  // Act
  const result = resolveImport(design('a', '方案 A'), null, existing, { newId: () => 'new' });

  // Assert
  assert.deepEqual([result.id, result.name], ['new', '方案 A']);
});

test('resolveImport 沒有任何衝突時原樣保留', () => {
  // Act
  const result = resolveImport(design('a', '方案 A'), null, [], { newId: () => 'new' });

  // Assert
  assert.equal(result.id, 'a');
});

// ---------- 平面圖跟著設計檔走 ----------

const plan = (width) => ({
  version: 1,
  units: 'm',
  bounds: { width, depth: 2 },
  walls: [{ id: 'wall-1', kind: 'rc', polygon: [[0, 0], [width, 0], [width, 0.15]] }],
  openings: [],
  rooms: [{ id: 'room-1', name: '客廳', rects: [[0, 0, 1, 1]] }],
  fixtures: [],
  outlets: [],
});
const fpRecord = (ref, name = `平面圖 ${ref}`) => ({ ref, name, createdAt: NOW, floorplan: plan(5) });
const designOn = (id, floorplanRef) => createDesign({ id, name: `方案 ${id}`, now: NOW, floorplanRef });

test('匯出包第 2 版帶上匯入的平面圖與預設平面圖的 ref，匯入時原樣讀回', () => {
  // Arrange
  const designs = [designOn('a', 'imp-1'), designOn('b', 'default-ref')];

  // Act
  const bundle = buildExport(designs, NOW, { floorplans: [fpRecord('imp-1')], defaultRefs: ['default-ref'] });
  const parsed = parseImportText(JSON.stringify(bundle));

  // Assert
  assert.equal(bundle.version, 2);
  assert.deepEqual(parsed.floorplans, [fpRecord('imp-1')]);
  assert.deepEqual(parsed.defaultRefs, ['default-ref']);
  assert.deepEqual(parsed.designs, designs);
  assert.equal(parsed.checksFloorplans, true);
});

for (const [name, content] of [
  ['第 1 版匯出包', () => ({ format: EXPORT_FORMAT, version: 1, exportedAt: NOW, designs: [designOn('a', 'whatever')] })],
  ['單一設計物件', () => designOn('a', 'whatever')],
  ['設計陣列', () => [designOn('a', 'whatever')]],
]) {
  test(`parseImportText 舊格式沒有平面圖資訊，照舊全部匯入：${name}`, () => {
    // Arrange
    const parsed = parseImportText(JSON.stringify(content()));

    // Act
    const { designs, errors } = assignFloorplans(parsed, { hasFloorplan: () => false, defaultRef: 'default-ref' });

    // Assert
    assert.deepEqual(parsed.floorplans, []);
    assert.equal(parsed.checksFloorplans, false);
    assert.deepEqual(designs.map((d) => d.id), ['a']);
    assert.deepEqual(errors, []);
  });
}

test('parseImportText 格式錯誤的平面圖列進錯誤，其他照常讀', () => {
  // Arrange
  const bundle = buildExport([], NOW, { floorplans: [{ ...fpRecord('bad', '壞掉的'), floorplan: { version: 1 } }, fpRecord('ok')], defaultRefs: [] });

  // Act
  const { floorplans, errors } = parseImportText(JSON.stringify(bundle));

  // Assert
  assert.deepEqual(floorplans.map((f) => f.ref), ['ok']);
  assert.equal(errors.length, 1);
  assert.match(errors[0].label, /平面圖「壞掉的」/);
  assert.ok(errors[0].problems.length > 0);
});

test('assignFloorplans 方案的平面圖找不到時明確報錯，不放到預設平面圖上', () => {
  // Arrange
  const designs = [designOn('known', 'imp-1'), designOn('default', 'default-ref'), designOn('old-default', 'old-ref'), designOn('legacy', null), designOn('lost', 'imp-9')];
  const parsed = parseImportText(JSON.stringify(buildExport(designs, NOW, { floorplans: [], defaultRefs: ['old-ref'] })));

  // Act
  const result = assignFloorplans(parsed, { hasFloorplan: (ref) => ref === 'imp-1', defaultRef: 'default-ref' });

  // Assert
  assert.deepEqual(result.designs.map((d) => d.id), ['known', 'default', 'old-default', 'legacy']);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].label, /方案 lost/);
  assert.ok(result.errors[0].problems[0].includes('平面圖'));
});
