import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Contribution Road reconciliation starts only after compact SQLite is ready', async () => {
  const hostSource = await readFile(new URL('./DatabaseConnectionHost.js', import.meta.url), 'utf8');
  const appSource = await readFile(new URL('../../app/App.jsx', import.meta.url), 'utf8');
  const initializer = hostSource.match(/async initializeCompactSqlite\(\)\s*\{([\s\S]*?)\n\s*\}\n\n\s*async/);

  assert.ok(initializer, 'compact SQLite initializer must remain inspectable');
  assert.doesNotMatch(initializer[1], /contributionRoad\.reconcile\s*\(/, 'initializer cannot await a facade that waits on its own ready promise');
  assert.match(appSource, /contributionRoadReady\s*=\s*databaseConnection\.ready\s*\.then\(\(\)\s*=>\s*databaseConnection\.contributionRoad\.reconcile\(\)\)/);
});
