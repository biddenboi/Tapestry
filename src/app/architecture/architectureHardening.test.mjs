import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { FEATURE_ARCHITECTURE, FEATURE_ARCHITECTURE_FIELDS } from './FeatureArchitecture.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(full));
    else files.push(full);
  }
  return files;
}

test('standardized feature contracts point to concrete architecture boundaries', async () => {
  for (const [feature, contract] of Object.entries(FEATURE_ARCHITECTURE)) {
    assert.deepEqual(Object.keys(contract), FEATURE_ARCHITECTURE_FIELDS, `${feature} contract shape`);
    for (const field of FEATURE_ARCHITECTURE_FIELDS.filter((key) => key !== 'worker' || contract.worker)) {
      await access(path.join(root, contract[field]));
    }
  }
});

test('broad feature and shared UI barrels are absent', async () => {
  const files = (await walk(root)).filter((file) => /\.(?:js|jsx|mjs)$/.test(file));
  const forbiddenFiles = files.filter((file) => (
    /\/features\/[^/]+\/index\.js$/.test(file)
    || /\/shared\/ui\/index\.js$/.test(file)
  ));
  assert.deepEqual(forbiddenFiles, []);
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    assert.doesNotMatch(source, /from ['"]@features\/[^/'"]+['"]/g, file);
    assert.doesNotMatch(source, /from ['"]@shared\/ui(?:\/index\.js)?['"]/g, file);
  }
});

test('heavy panel views remain behind dynamic imports', async () => {
  const registry = await readFile(path.join(root, 'app/shell/GameHub/panelRegistry.js'), 'utf8');
  for (const name of ['Lobby', 'TodoList', 'Events', 'Feed', 'SocialWorldShell']) {
    assert.match(registry, new RegExp(`import\\([^)]*${name}`));
  }
  assert.doesNotMatch(registry, /import\s+[^;]+from ['"]@features\/(?:lobby|feed|social-world)\/.*\.jsx['"]/);
});

test('Profile domain aggregation is owned by its controller rather than its view', async () => {
  const view = await readFile(path.join(root, 'features/profile/pages/Profile/Profile.jsx'), 'utf8');
  const controller = await readFile(path.join(root, 'features/profile/pages/Profile/ProfileDataController.js'), 'utf8');
  assert.doesNotMatch(view, /databaseConnection\.getAll\(/);
  assert.doesNotMatch(view, /getPlayerStoreThroughIGT\(/);
  assert.match(controller, /getPlayerStoreThroughIGT\(/);
  assert.match(controller, /loadMaterializedProfileData/);
});

test('cache contracts include source-domain versions and stale-while-revalidate reads', async () => {
  const cache = await readFile(path.join(root, 'shared/cache/DerivedCache.js'), 'utf8');
  assert.match(cache, /sourceVersions/);
  assert.match(cache, /readStaleWhileRevalidate/);
});
