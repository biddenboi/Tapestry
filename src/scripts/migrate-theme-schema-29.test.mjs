import assert from 'node:assert/strict';
import test from 'node:test';
import { migrateThemeData, THEME_ID_MIGRATION } from './migrate-theme-schema-29.mjs';

test('schema-29 migration rewrites every legacy theme ID without touching title IDs', () => {
  const source = {
    activeCosmetics: { theme: 'pure', title: 'gold' },
    playerTheme: 'shadow',
    inventory: [
      { UUID: 'a', parent: 'p1', type: 'cosmetic_theme', itemId: 'violet', name: 'Violet', quantity: 1 },
      { UUID: 'b', parent: 'p1', type: 'cosmetic_theme', itemId: 'paper', name: 'Paper', quantity: 1 },
      { UUID: 'c', parent: 'p1', type: 'cosmetic_title', itemId: 'gold', name: 'Gold', quantity: 1 },
    ],
  };
  const migrated = migrateThemeData(source);
  assert.equal(migrated.activeCosmetics.theme, 'minimalist_light');
  assert.equal(migrated.activeCosmetics.title, 'gold');
  assert.equal(migrated.playerTheme, 'obsidian');
  assert.equal(migrated.inventory.filter((item) => item.type === 'cosmetic_theme').length, 1);
  assert.equal(migrated.inventory.find((item) => item.type === 'cosmetic_theme').itemId, 'old_windows');
  assert.equal(migrated.inventory.find((item) => item.type === 'cosmetic_title').itemId, 'gold');
  assert.equal(Object.keys(THEME_ID_MIGRATION).length, 10);
});
