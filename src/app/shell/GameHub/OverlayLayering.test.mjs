import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const styles = await readFile(new URL('./styles/GameHub.base.css', import.meta.url), 'utf8');

test('navigation panels layer above active Match and Dojo focus surfaces', () => {
  assert.match(styles, /\.hub-overlay-backdrop\s*\{[^}]*z-index:\s*40;/);
  assert.match(styles, /\.hub-focus-overlay,\s*\.hub-world-panel,\s*\.hub-lobby-menu\s*\{[^}]*z-index:\s*35;/);
  assert.match(styles, /\.hub-world-nav\s*\{[^}]*z-index:\s*38;/);
  assert.match(styles, /\.hub-world-actions\s*\{[^}]*z-index:\s*30;/);

  const overlay = Number(styles.match(/\.hub-overlay-backdrop\s*\{[^}]*z-index:\s*(\d+);/)?.[1]);
  const navigation = Number(styles.match(/\.hub-world-nav\s*\{[^}]*z-index:\s*(\d+);/)?.[1]);
  const utilities = Number(styles.match(/\.hub-world-actions\s*\{[^}]*z-index:\s*(\d+);/)?.[1]);
  const focus = Number(styles.match(/\.hub-focus-overlay,\s*\.hub-world-panel,\s*\.hub-lobby-menu\s*\{[^}]*z-index:\s*(\d+);/)?.[1]);
  assert.deepEqual([utilities, focus, navigation, overlay], [30, 35, 38, 40]);
});
