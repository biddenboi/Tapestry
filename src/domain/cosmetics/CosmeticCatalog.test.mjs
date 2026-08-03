import assert from 'node:assert/strict';
import test from 'node:test';
import { applyCosmeticEquipmentToElement } from './CosmeticCatalog.js';

function fakeElement() {
  const properties = new Map();
  return {
    dataset: {},
    style: {
      setProperty(name, value) {
        properties.set(name, value);
      },
    },
    properties,
  };
}

test('the default workspace backdrop inherits the active app theme', () => {
  const element = fakeElement();
  applyCosmeticEquipmentToElement(element, { theme: 'minimalist_light' });
  assert.equal(element.dataset.workspaceBackdrop, 'default');
  assert.equal(element.properties.get('--workspace-cosmetic-background'), 'var(--bg-void)');
});

test('an explicitly equipped workspace backdrop keeps its cosmetic surface', () => {
  const element = fakeElement();
  applyCosmeticEquipmentToElement(element, {
    theme: 'minimalist_light',
    workspaceBackdrop: 'deep-ocean',
  });
  assert.match(
    element.properties.get('--workspace-cosmetic-background'),
    /#0d1b2a/,
  );
});
