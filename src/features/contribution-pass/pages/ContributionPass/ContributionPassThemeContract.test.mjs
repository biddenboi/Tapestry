import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import { THEME_IDS } from '../../../../domain/themes/ThemeRegistry.js';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('the Road keeps its surface and readable-text contract in every theme', async () => {
  const themeRoot = new URL('../../../../shared/styles/themes/', import.meta.url);
  const themeFolders = await readdir(themeRoot);
  const modularSources = await Promise.all(themeFolders.map(async (folder) => {
    const files = await readdir(new URL(`${folder}/`, themeRoot));
    return Promise.all(files.filter((name) => name.endsWith('.css')).map((name) => (
      readFile(new URL(`${folder}/${name}`, themeRoot), 'utf8')
    )));
  }));
  const themeCss = `${await read('../../../../shared/styles/themes.css')}\n${modularSources.flat().join('\n')}`;
  const roadCss = await read('./ContributionPass.css');

  for (const themeId of THEME_IDS) {
    assert.match(themeCss, new RegExp(`\\[data-theme=["']${themeId}["']\\]`), `${themeId} must have a theme selector`);
  }
  for (const token of ['--road-canvas', '--road-grid', '--road-node-surface', '--road-node-border', '--road-muted']) {
    assert.match(roadCss, new RegExp(`${token.replaceAll('-', '\\-')}\\s*:`), `Road must define ${token}`);
  }
  assert.match(roadCss, /\.road-node\s*\{[^}]*color:\s*var\(--text\)/s);
  assert.match(roadCss, /\.road-node\s*>\s*span\s*\{[^}]*color:\s*var\(--text-bright\)/s);
  assert.match(roadCss, /\.road-node--stat\s*>\s*span\s*\{[^}]*font:[^;]*10px/s);
});

test('theme-specific Road decoration cannot hide or clip Road nodes', async () => {
  const themeRoot = new URL('../../../../shared/styles/themes/', import.meta.url);
  const themeFolders = await readdir(themeRoot);
  for (const folder of themeFolders) {
    const files = await readdir(new URL(`${folder}/`, themeRoot));
    for (const name of files.filter((entry) => entry.endsWith('.css'))) {
      const source = await readFile(new URL(`${folder}/${name}`, themeRoot), 'utf8');
      const roadRules = [...source.matchAll(/[^{}]*\.road-(?:node|board|inspector)[^{}]*\{([^}]*)\}/g)].map((match) => match[1]).join('\n');
      assert.doesNotMatch(roadRules, /\b(?:display\s*:\s*none|visibility\s*:\s*hidden|overflow\s*:\s*hidden|opacity\s*:\s*0(?:\D|$))/i, `${folder}/${name} must not hide or clip the Road`);
    }
  }
});
