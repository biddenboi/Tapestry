import assert from 'node:assert/strict';
import test from 'node:test';
import JSZip from 'jszip';
import { parseLegacyJournal, parseLegacyPortablePackage } from './LegacyPortablePackage.js';

const root = 'Legacy Tapestry/.tapestry/';

async function legacyZip() {
  const zip = new JSZip();
  const manifest = {
    format: 'tapestry-obsidian-save',
    version: 1,
    dataSchemaVersion: 28,
    stores: { player: 'players', todo: 'todos', journal: 'journals', resource: 'resources' },
    dataFiles: {
      players: '.player-data/players.json',
      todos: '.system-data/todos.json',
    },
    appStateFile: '.system-data/appState.json',
    economyFile: '.system-data/economy.json',
    journalMetadataFile: '.system-data/journalMetadata.json',
    resourceMetadataFile: '.system-data/resources.json',
    journalFiles: [{ uuid: 'journal-1', path: 'journals/2026/07/28/28 - 1.md' }],
    modelArtifactFiles: { recommenderSettings: '.model-data/recommenderSettings.json' },
  };
  zip.file(`${root}.system-data/manifest.json`, JSON.stringify(manifest));
  zip.file(`${root}schema.json`, JSON.stringify({ schemaVersion: 29 }));
  zip.file(`${root}.player-data/players.json`, JSON.stringify([
    { UUID: 'player-1', username: 'Legacy' },
    { UUID: 'player-2', username: 'Honor' },
  ]));
  zip.file(`${root}.system-data/todos.json`, JSON.stringify([{ UUID: 'todo-1', parent: 'player-1', name: 'Old task' }]));
  zip.file(`${root}.system-data/appState.json`, JSON.stringify({ activePlayerUUID: 'player-1' }));
  zip.file(`${root}.system-data/economy.json`, JSON.stringify({ globalMoney: 12 }));
  zip.file(`${root}.system-data/journalMetadata.json`, JSON.stringify([{ UUID: 'journal-1' }]));
  zip.file(`${root}.system-data/resources.json`, JSON.stringify([{
    UUID: 'resource-1', path: '.resources/managed/resource-1.jpg', mimeType: 'image/jpeg',
  }]));
  zip.file(`${root}.resources/managed/resource-1.jpg`, Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]));
  zip.file(
    `${root}.resources/profile-images/player-2.jpg`,
    Uint8Array.from([0xff, 0xd8, 0x01, 0xff, 0xd9]),
  );
  zip.file(`${root}.model-data/recommenderSettings.json`, JSON.stringify([{ UUID: 'settings-1' }]));
  zip.file(
    `${root}journals/2026/07/28/28 - 1.md`,
    '> uuid: journal-1\n> player: player-1\n> createdAt: 2026-07-28T12:00:00.000Z\n> editedAt:\n> inGameTimestamp: 42\n\n# Legacy note\n\nPreserved body\n',
  );
  zip.file('__MACOSX/Legacy Tapestry/.tapestry/.system-data/manifest.json', 'ignored');
  return zip;
}

test('legacy nested archives become complete current store snapshots', async () => {
  const parsed = await parseLegacyPortablePackage(await legacyZip());
  assert.equal(parsed.schemaVersion, 29);
  assert.equal(parsed.appState.activePlayerUUID, 'player-1');
  assert.equal(parsed.economyState.globalMoney, 12);
  assert.equal(parsed.stores.players.length, 2);
  assert.equal(parsed.stores.todos[0].name, 'Old task');
  assert.equal(parsed.stores.journals[0].entry, 'Preserved body');
  assert.equal(parsed.stores.journals[0].parent, 'player-1');
  assert.deepEqual([...parsed.stores.resources[0].bytes], [0xff, 0xd8, 0xff, 0xd9]);
  assert.deepEqual(parsed.stores.players[1].profilePicture, {
    type: 'resource',
    resourceUUID: 'legacy-profile-picture-player-2',
  });
  assert.equal(parsed.stores.resources[1].parent, 'player-2');
  assert.equal(parsed.stores.resources[1].kind, 'profilePicture');
  assert.deepEqual([...parsed.stores.resources[1].bytes], [0xff, 0xd8, 0x01, 0xff, 0xd9]);
  assert.equal(parsed.modelSettings.length, 1);
});

test('untitled legacy journals stay importable without losing their body', () => {
  const parsed = parseLegacyJournal(
    '> uuid: journal-2\n> player: player-1\n> createdAt: 2026-07-28T12:00:00.000Z\n> editedAt:\n> inGameTimestamp: 0\n\n# \n\nStill important',
    { manifestEntry: { uuid: 'journal-2', path: 'journals/untitled.md' } },
  );
  assert.equal(parsed.title, 'Untitled journal');
  assert.equal(parsed.entry, 'Still important');
});

test('newer legacy schemas fail closed before any restore work', async () => {
  const zip = await legacyZip();
  zip.file(`${root}schema.json`, JSON.stringify({ schemaVersion: 99 }));
  await assert.rejects(
    parseLegacyPortablePackage(zip, { currentSchemaVersion: 39 }),
    /newer than this app supports/,
  );
});
