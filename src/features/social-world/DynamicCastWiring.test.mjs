import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (relative) => readFile(new URL(relative, import.meta.url), 'utf8');

test('dynamic cast selection is a prepared SQLite service behind the database facade', async () => {
  const [runtime, facade, host, service, repository, migrations] = await Promise.all([
    read('../../data/persistence/PersistenceRuntime.js'),
    read('../../data/db/databaseConnectionFeatureMethods.js'),
    read('../../data/persistence/DatabaseConnectionHost.js'),
    read('../../data/persistence/services/SocialWorldCastService.js'),
    read('../../data/persistence/sqlite/SqliteSocialWorldRepository.js'),
    read('../../data/persistence/sqlite/migrations/index.js'),
  ]);
  assert.match(runtime, /new SocialWorldCastService/);
  assert.match(host, /this\.socialWorldCast = this\.persistenceRuntime\.socialWorldCast/);
  assert.match(facade, /getSocialWorldCast\(query\)/);
  assert.match(service, /buildDynamicCastReview/);
  assert.match(repository, /replaceCastState/);
  assert.match(repository, /social_cast_reviews/);
  assert.match(migrations, /020_dynamic_social_cast/);
});

test('selector inputs exclude prohibited proximity, cosmetic, journal, and engagement signals', async () => {
  const service = await read('../../data/persistence/services/SocialWorldCastService.js');
  const selector = await read('../../domain/social-world/DynamicCastSelection.js');
  for (const prohibited of [
    /latitude|longitude|distance/i,
    /cosmetic|title_id|rarity/i,
    /journal|sentiment/i,
    /engagement|influence/i,
  ]) {
    assert.doesNotMatch(service, prohibited);
    assert.doesNotMatch(selector, prohibited);
  }
  assert.match(selector, /ordered-role-constraints-no-composite-score/);
  assert.match(service, /completed_in_game_timestamp/);
  assert.match(service, /status='accepted'/);
});
