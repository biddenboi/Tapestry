import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const verificationConfig = await readFile(new URL('../../../vite.sqlite-runtime.config.js', import.meta.url), 'utf8');
const productionConfig = await readFile(new URL('../../../vite.config.js', import.meta.url), 'utf8');

test('deterministic SQLite crash hooks are enabled only in the verification build', () => {
  assert.match(verificationConfig, /'import\.meta\.env\.DEV': 'true'/);
  assert.doesNotMatch(productionConfig, /import\.meta\.env\.DEV/);
});
