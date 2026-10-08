import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getCatalogItem } from '../../js/furniture/catalog.js';
import { initialElevation } from '../../js/core/mounting.js';

const close = (a, b) => Math.abs(a - b) < 1e-9;

test('吸頂 AP 貼著樓板：離地高度為樓高減去本身厚度', () => {
  // Arrange
  const ap = getCatalogItem('ceiling-ap');

  // Act
  const elevation = initialElevation(ap, 3.05);

  // Assert
  assert.ok(close(elevation, 3.05 - ap.size.h / 100), `got ${elevation}`);
  assert.ok(close(elevation, 3.0), `got ${elevation}`);
});

test('掛牆的弱電箱用目錄的固定高度 1.5 公尺', () => {
  // Act & Assert
  assert.ok(close(initialElevation(getCatalogItem('network-panel'), 3.05), 1.5));
});

for (const type of ['wifi-router', 'sofa']) {
  test(`${type} 不在放置時設定高度（落地或放到檯面上自動算）`, () => {
    // Act & Assert
    assert.equal(initialElevation(getCatalogItem(type), 3.05), undefined);
  });
}
