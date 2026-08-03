import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./useCurrentPlayerSession.js', import.meta.url), 'utf8');
const database = await readFile(new URL('../../data/DatabaseConnection.js', import.meta.url), 'utf8');

test('current-player hydration reads the profile without creating an app-open IGT session', () => {
  assert.match(source, /databaseConnection\.getCurrentPlayer\(\)/);
  assert.doesNotMatch(source, /beginCurrentPlayerIGTSession|checkpointCurrentPlayerIGTSession/);
  assert.doesNotMatch(database, /beginCurrentPlayerIGTSession|checkpointCurrentPlayerIGTSession/);
});

test('player hydration has no page lifecycle clock infrastructure', () => {
  assert.doesNotMatch(source, /pagehide|pageshow|visibilitychange|setInterval|OPEN_IGT_CURSOR_VERSION/);
});
