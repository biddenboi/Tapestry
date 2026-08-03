import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [packageJson, viteConfig, html] = await Promise.all([
  readFile(new URL('../package.json', import.meta.url), 'utf8').then(JSON.parse),
  readFile(new URL('../vite.config.js', import.meta.url), 'utf8'),
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
]);

test('the source bundle is independently buildable with its architecture aliases', () => {
  assert.equal(packageJson.scripts.build, 'vite build');
  assert.equal(packageJson.scripts.test, 'node --test --test-concurrency=1');
  for (const dependency of ['react', 'react-dom', 'react-router-dom', 'jszip']) {
    assert.ok(packageJson.dependencies[dependency], `${dependency} must be declared`);
  }
  assert.equal(packageJson.dependencies.leaflet, undefined);
  for (const alias of ['@app', '@data', '@domain', '@features', '@shared']) {
    assert.match(viteConfig, new RegExp(`'${alias}'`));
  }
  assert.match(html, /<script type="module" src="\/main\.jsx"><\/script>/);
});
