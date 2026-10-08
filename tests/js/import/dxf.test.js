import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectUnitScale, parseDxf } from '../../../js/import/dxf.js';
import { DxfFormatError } from '../../../js/import/errors.js';
import { dxf } from './dxfFactory.js';

test('parseDxf LINE 保留圖層與座標', () => {
  // Arrange
  const text = dxf.document([dxf.line('L3', [1.5, 2.0], [10.0, 2.0])]);

  // Act
  const doc = parseDxf(text);

  // Assert
  assert.equal(doc.entities.length, 1);
  const entity = doc.entities[0];
  assert.equal(entity.type, 'LINE');
  assert.equal(entity.layer, 'L3');
  assert.deepEqual([entity.num(10), entity.num(20), entity.num(11), entity.num(21)], [1.5, 2, 10, 2]);
});

test('parseDxf LWPOLYLINE 保留每個頂點', () => {
  // Arrange
  const points = [[0, 0], [10, 0], [10, 5]];
  const text = dxf.document([dxf.lwpolyline('WALL2', points, true)]);

  // Act
  const { entities } = parseDxf(text);

  // Assert
  assert.equal(entities.length, 1);
  const entity = entities[0];
  assert.deepEqual(entity.all(10).map(Number), [0, 10, 10]);
  assert.deepEqual(entity.all(20).map(Number), [0, 0, 5]);
  assert.equal(entity.first(70), '1');
});

test('parseDxf 圖塊內的圖元另外存放，不混進 ENTITIES', () => {
  // Arrange
  const text = dxf.document(
    [dxf.insert('OPEN-Door', 'DOOR1', [5, 5])],
    { DOOR1: [dxf.arc('OPEN-Door', [0, 0], 90, 0, 90)] },
  );

  // Act
  const doc = parseDxf(text);

  // Assert
  assert.deepEqual(doc.entities.map((e) => e.type), ['INSERT']);
  assert.deepEqual(doc.blocks.get('DOOR1').map((e) => e.type), ['ARC']);
});

test('entity.num 群組碼不存在時回傳預設值', () => {
  // Arrange
  const { entities } = parseDxf(dxf.document([dxf.line('L3', [0, 0], [1, 1])]));

  // Act
  const values = entities.map((e) => e.num(50, 7));

  // Assert
  assert.deepEqual(values, [7]);
});

for (const [name, text] of [
  ['空字串', ''],
  ['沒有 ENTITIES 區段', '0\nSECTION\n2\nHEADER\n0\nENDSEC\n0\nEOF\n'],
  ['隨便的文字', '這不是 DXF'],
]) {
  test(`parseDxf 沒有 ENTITIES 區段時丟出格式錯誤：${name}`, () => {
    // Act & Assert
    assert.throws(() => parseDxf(text), (err) => err instanceof DxfFormatError && /ENTITIES/.test(err.message));
  });
}

test('parseDxf 群組碼不是數字時丟出錯誤並指出行號', () => {
  // Arrange
  const text = '0\nSECTION\n2\nENTITIES\nX\nLINE\n0\nENDSEC\n';

  // Act & Assert
  assert.throws(() => parseDxf(text), (err) => err instanceof DxfFormatError && /第 5 行/.test(err.message));
});

test('parseDxf CRLF 換行與 LF 解析結果相同', () => {
  // Arrange
  const entities = [dxf.line('L3', [1.5, 2], [10, 2]), dxf.lwpolyline('WALL2', [[0, 0], [10, 0], [10, 5]], true)];
  const blocks = { DOOR1: [dxf.arc('OPEN-Door', [0, 0], 90, 0, 90)] };

  // Act
  const lf = parseDxf(dxf.document(entities, blocks));
  const crlf = parseDxf(dxf.document(entities, blocks, { eol: '\r\n' }));

  // Assert
  assert.equal(crlf.entities.length, 2);
  assert.deepEqual(crlf.entities, lf.entities);
  assert.deepEqual(crlf.blocks, lf.blocks);
  assert.equal(detectUnitScale(crlf), 0.001);
});

test('parseDxf 檔頭的 999 註解行不影響解析', () => {
  // Arrange：LibreDWG 轉出的 DXF 第一組是 999 註解
  const text = `999\nLibreDWG 0.14\n${dxf.document([dxf.line('L3', [0, 0], [1, 1])])}`;

  // Act
  const doc = parseDxf(text);

  // Assert
  assert.deepEqual(doc.entities.map((e) => e.layer), ['L3']);
});

for (const [name, insunits, expected] of [
  ['公釐', 4, 0.001],
  ['公分', 5, 0.01],
  ['公尺', 6, 1],
  ['未指定單位', 0, null],
  ['英吋不支援', 1, null],
  ['HEADER 沒有 $INSUNITS', null, null],
]) {
  test(`detectUnitScale 依 $INSUNITS 換算成公尺倍率：${name}`, () => {
    // Arrange
    const doc = parseDxf(dxf.document([dxf.line('L3', [0, 0], [1, 1])], {}, { insunits }));

    // Act
    const scale = detectUnitScale(doc);

    // Assert
    assert.equal(scale, expected);
  });
}
