import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mergeProfilePlayer,
  mergeProfilePlayerLists,
} from './profilePlayerReadModel.js';

test('a canonical-only familiar profile remains resolvable', () => {
  assert.deepEqual(
    mergeProfilePlayer(
      { UUID: 'fellow-1', username: 'Canonical Fellow', elo: 42 },
      null,
    ),
    { UUID: 'fellow-1', username: 'Canonical Fellow', elo: 42 },
  );
});

test('a document-only profile remains resolvable', () => {
  assert.deepEqual(
    mergeProfilePlayer(
      null,
      { UUID: 'document-1', username: 'Document Player', profilePicture: 'data:image/png;base64,live' },
    ),
    { UUID: 'document-1', username: 'Document Player', profilePicture: 'data:image/png;base64,live' },
  );
});

test('document fields overlay the typed base for live UI hydration', () => {
  assert.deepEqual(
    mergeProfilePlayer(
      {
        UUID: 'player-1',
        username: 'Canonical Name',
        elo: 75,
        profilePicture: 'canonical-image',
        activeCosmetics: { theme: 'steel-blue' },
      },
      {
        UUID: 'player-1',
        username: 'Live Name',
        profilePicture: 'live-image',
      },
    ),
    {
      UUID: 'player-1',
      username: 'Live Name',
      elo: 75,
      profilePicture: 'live-image',
      activeCosmetics: { theme: 'steel-blue' },
    },
  );
});

test('combined profile lists keep canonical-only rows and deduplicate overlays', () => {
  assert.deepEqual(
    mergeProfilePlayerLists(
      [
        { UUID: 'fellow-1', username: 'Fellow', elo: 40 },
        { UUID: 'player-1', username: 'Canonical', elo: 75 },
      ],
      [
        { UUID: 'player-1', username: 'Live' },
        { UUID: 'document-1', username: 'Document' },
      ],
    ),
    [
      { UUID: 'fellow-1', username: 'Fellow', elo: 40 },
      { UUID: 'player-1', username: 'Live', elo: 75 },
      { UUID: 'document-1', username: 'Document' },
    ],
  );
});

test('records with different IDs cannot be accidentally merged', () => {
  assert.throws(
    () => mergeProfilePlayer({ UUID: 'one' }, { UUID: 'two' }),
    /different IDs/,
  );
});
