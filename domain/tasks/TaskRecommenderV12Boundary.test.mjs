import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  TASK_RECOMMENDER_V12_ACTIVE_ENTRY_PATHS,
  TASK_RECOMMENDER_V12_OFFLINE_MIGRATION_PATHS,
  TASK_RECOMMENDER_V12_REMOVED_OBSOLETE_PATHS,
  TASK_RECOMMENDER_V12_REMOVED_RUNTIME_PATHS,
} from './TaskRecommenderV12Boundary.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const normalize = (value) => value.split(path.sep).join('/');
const STATIC_IMPORT = /(?:^|\n)\s*(?:import\s+(?:[^'";]+?\s+from\s+)?|export\s+[^'";]+?\s+from\s+)["']([^"']+)["']/g;
const DYNAMIC_IMPORT = /import\s*\(\s*["']([^"']+)["']\s*\)/g;

const aliases = Object.freeze({
  '@app/': 'app/',
  '@data/': 'data/',
  '@domain/': 'domain/',
  '@features/': 'features/',
  '@shared/': 'shared/',
});

function resolveSpecifier(fromRelative, specifier) {
  if (specifier.startsWith('.')) {
    return normalize(path.normalize(path.join(path.dirname(fromRelative), specifier)));
  }
  for (const [prefix, replacement] of Object.entries(aliases)) {
    if (specifier.startsWith(prefix)) return replacement + specifier.slice(prefix.length);
  }
  return null;
}

async function importsFor(relative, pattern) {
  const source = await readFile(path.join(root, relative), 'utf8');
  return [...source.matchAll(pattern)]
    .map((match) => resolveSpecifier(relative, match[1]))
    .filter(Boolean);
}

async function staticGraph(entries) {
  const queue = [...entries];
  const visited = new Set();
  while (queue.length) {
    const relative = queue.shift();
    if (visited.has(relative)) continue;
    visited.add(relative);
    for (const dependency of await importsFor(relative, STATIC_IMPORT)) {
      if (!visited.has(dependency)) queue.push(dependency);
    }
  }
  return visited;
}

const offlineSet = new Set(TASK_RECOMMENDER_V12_OFFLINE_MIGRATION_PATHS);

test('normal startup and active recommender static bundles exclude offline migration code', async () => {
  const startup = await staticGraph(['main.jsx']);
  const active = await staticGraph(TASK_RECOMMENDER_V12_ACTIVE_ENTRY_PATHS.slice(1));
  for (const forbidden of offlineSet) {
    assert.equal(startup.has(forbidden), false, `${forbidden} leaked into startup`);
    assert.equal(active.has(forbidden), false, `${forbidden} leaked into the active recommender bundle`);
  }
});

test('UI, inference, training, Settings, export, import, and active recovery import no old runtime modules', async () => {
  const paths = [
    'features/settings/pages/Settings/Settings.jsx',
    'domain/tasks/TaskRecommender.js',
    'domain/tasks/TaskRecommendationV12.js',
    'domain/tasks/TaskRecommenderV12Training.js',
    'domain/tasks/TaskRecommenderV12TrainingCore.js',
    'domain/tasks/TaskRecommenderV12Lifecycle.js',
  ];
  for (const relative of paths) {
    const staticImports = await importsFor(relative, STATIC_IMPORT);
    assert.deepEqual(staticImports.filter((dependency) => offlineSet.has(dependency)), [], relative);
    const source = await readFile(path.join(root, relative), 'utf8');
    assert.doesNotMatch(source, /TaskRecommenderV11OfflineReader|TaskRecommenderV12Migration\.js|taskRecommenderWeights|taskRecommenderSettings|tars-v11/);
  }
});

test('the old reader is reachable only through the explicit lazy migration chain', async () => {
  const requestPath = 'domain/tasks/TaskRecommenderV12LegacyMigrationRequest.js';
  const coordinatorPath = 'domain/tasks/TaskRecommenderV12Migration.js';
  const requestDynamic = await importsFor(requestPath, DYNAMIC_IMPORT);
  const coordinatorDynamic = await importsFor(coordinatorPath, DYNAMIC_IMPORT);
  assert.deepEqual(requestDynamic, [coordinatorPath]);
  assert.deepEqual(coordinatorDynamic, ['domain/tasks/TaskRecommenderV11OfflineReader.js']);

  const allRuntimeFiles = [];
  async function walk(directory) {
    const { readdir } = await import('node:fs/promises');
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (/\.(?:js|jsx)$/.test(entry.name)) allRuntimeFiles.push(normalize(path.relative(root, full)));
    }
  }
  await walk(root);
  const directReaders = [];
  for (const relative of allRuntimeFiles) {
    const staticImports = await importsFor(relative, STATIC_IMPORT);
    if (staticImports.includes('domain/tasks/TaskRecommenderV11OfflineReader.js')) directReaders.push(relative);
  }
  assert.deepEqual(directReaders, []);
});

test('removed runtime modules remain physically absent', async () => {
  for (const relative of TASK_RECOMMENDER_V12_REMOVED_RUNTIME_PATHS) {
    await assert.rejects(access(path.join(root, relative)));
  }
});


test('obsolete cutover inventory and transitional documentation remain absent', async () => {
  for (const relative of TASK_RECOMMENDER_V12_REMOVED_OBSOLETE_PATHS) {
    await assert.rejects(access(path.join(root, relative)));
  }
  await access(path.join(root, 'V12_RECOMMENDER.md'));
});
