import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const text = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

test('one canonical identity contract and renderer own cosmetics and contextual rank', async () => {
  const [contract, renderer] = await Promise.all([
    text('domain/profile/ProfileIdentity.js'),
    text('shared/profile-identity/ProfileIdentity.jsx'),
  ]);
  for (const field of ['profileId', 'username', 'profilePicture', 'title', 'frame', 'theme', 'elo', 'rankGroup', 'rankLabel', 'snapshotAt']) {
    assert.match(contract, new RegExp(`\\b${field}\\b`));
  }
  assert.match(renderer, /buildProfileIdentity/);
  assert.match(renderer, /PlayerTitle/);
  assert.match(renderer, /rank === 'full'/);
  assert.match(renderer, /data-profile-frame/);
});

test('identity rendering is shared across ambient and competitive surfaces', async () => {
  const paths = [
    'features/social-world/components/SocialWorldShell/SocialWorldScene.jsx',
    'features/social-world/components/TavernDrawer/TavernDrawer.jsx',
    'features/social-world/components/InactiveCastRail/InactiveCastRail.jsx',
    'features/social-world/components/ProfilePresenceDrawer/ProfilePresenceDrawer.jsx',
    'features/lobby/components/Lobby/Lobby.jsx',
    'features/matches/components/MatchArena/MatchArena.jsx',
    'features/matches/modals/MatchDetailsModal/MatchDetailsModal.jsx',
    'features/matches/components/PracticeDojo/DojoRoom.jsx',
    'features/matches/components/PracticeDojo/DojoStandings.jsx',
    'features/profile/pages/Profile/Profile.jsx',
  ];
  for (const path of paths) {
    assert.match(await text(path), /ProfileIdentity/, `${path} must use the shared identity renderer`);
  }
});

test('Match snapshots own historical identity without a live cosmetic overlay', async () => {
  const [contracts, arena, matchDomain] = await Promise.all([
    text('domain/matches/MatchContracts.js'),
    text('features/matches/components/MatchArena/MatchArena.jsx'),
    text('domain/matches/Match.js'),
  ]);
  assert.match(contracts, /MATCH_PARTICIPANT_SNAPSHOT_VERSION = 3/);
  for (const field of ['title', 'frame', 'theme', 'rankLabel', 'snapshotAt']) {
    assert.match(contracts, new RegExp(`\\b${field}\\b`));
  }
  assert.doesNotMatch(arena, /currentPlayer\?\.activeCosmetics/);
  assert.match(matchDomain, /participantSnapshot\?\.participants\?\.length/);
  assert.match(matchDomain, /teams: getMatchTeams\(match\)/);
});

test('role selection remains independent from identity cosmetics', async () => {
  const [cast, residency] = await Promise.all([
    text('data/persistence/services/SocialWorldCastService.js'),
    text('data/persistence/services/SocialWorldResidencyService.js'),
  ]);
  assert.doesNotMatch(cast, /player_cosmetics|title_id|profileFrame/);
  assert.match(residency, /player_cosmetics/);
  assert.match(residency, /playersById/);
});
