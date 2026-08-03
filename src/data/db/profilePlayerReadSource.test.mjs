import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const methods = await readFile(new URL('./databaseConnectionFeatureMethods.js', import.meta.url), 'utf8');

test('feature-facing profile reads combine typed SQLite and complete document records', () => {
  const single = methods.match(
    /export async function getProfilePlayer\(profileId\) \{[\s\S]*?\n\}/,
  )?.[0] || '';
  const list = methods.match(
    /export async function getAllProfilePlayers\(\) \{[\s\S]*?\n\}/,
  )?.[0] || '';

  assert.match(single, /shadowDomains\?\.coreProfiles/);
  assert.match(single, /canonicalProfiles\?\.getPlayer/);
  assert.match(single, /this\.get\(STORES\.player/);
  assert.match(single, /mergeProfilePlayer\(typedPlayer, documentPlayer\)/);

  assert.match(list, /canonicalProfiles\?\.listPlayers/);
  assert.match(list, /this\.getAll\(STORES\.player\)/);
  assert.match(list, /mergeProfilePlayerLists\(typedPlayers, documentPlayers\)/);

  assert.doesNotMatch(`${single}\n${list}`, /\.add\(|\.put\(|synchronize|import\(/);
});

test('profile read methods are installed on the DatabaseConnection facade', () => {
  assert.match(methods, /databaseConnectionFeatureMethods = \{[\s\S]*getProfilePlayer,[\s\S]*getAllProfilePlayers,/);
});
