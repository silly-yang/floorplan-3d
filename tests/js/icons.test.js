import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG } from '../../js/furniture/catalog.js';
import { ICONS, iconSvg } from '../../js/ui/icons.js';

test('目錄裡每一種家具、家電都有對應的 icon', () => {
  // Act
  const missing = CATALOG.map((c) => c.type).filter((type) => !ICONS[type]);

  // Assert
  assert.deepEqual(missing, []);
});

test('介面按鈕用到的 icon 都存在', () => {
  // Arrange
  const ui = ['undo', 'redo', 'add', 'rename', 'duplicate', 'delete', 'grid', 'cutaway', 'ceiling', 'view-3d', 'view-top', 'view-walk',
    'rotate-cw', 'rotate-ccw', 'export', 'import', 'camera', 'cube', 'tab-furniture', 'tab-appliance', 'tab-fixture', 'tab-floor', 'tab-files', 'close', 'open',
    'door-none', 'door-hinged', 'door-sliding', 'door-glass', 'door-open', 'door-close', 'flip', 'swing', 'focus', 'full-view', 'high-quality', 'tab-electrical'];

  // Act
  const missing = ui.filter((name) => !ICONS[name]);

  // Assert
  assert.deepEqual(missing, []);
});

test('iconSvg 產生帶 aria-hidden 的 svg，未知名稱丟錯', () => {
  // Act
  const svg = iconSvg('sofa');

  // Assert
  assert.match(svg, /^<svg[^>]*aria-hidden="true"/);
  assert.throws(() => iconSvg('nope'), /nope/);
});

test('每種門型的 icon 都存在', async () => {
  // Arrange
  const { DOOR_TYPES } = await import('../../js/core/doors.js');

  // Act
  const missing = DOOR_TYPES.map((t) => t.icon).filter((name) => !ICONS[name]);

  // Assert
  assert.deepEqual(missing, []);
});
