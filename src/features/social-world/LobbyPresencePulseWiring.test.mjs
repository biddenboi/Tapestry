import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const [lobby, pulses, requirements] = await Promise.all([
  read('../lobby/components/Lobby/Lobby.jsx'),
  read('./components/PresencePulseStack/PresencePulseStack.jsx'),
  read('../../app/data-source/panelDomainRequirements.js'),
]);

test('Lobby prepares one social scene for both Match and Dojo pulse stacks', () => {
  assert.match(lobby, /new SocialWorldSceneController/);
  assert.doesNotMatch(lobby, /useSocialOccupancy|socialOccupancy|occupancy:/);
  assert.equal((lobby.match(/socialSceneController\.load\s*\(/g) || []).length, 1);
  assert.doesNotMatch(lobby, /socialSceneRefreshRevision|socialScene\.occupancy\.refreshAfter/);
  assert.match(lobby, /activityPulses\.match/);
  assert.match(lobby, /activityPulses\.dojo/);
  const pulseSelection = lobby.slice(
    lobby.indexOf('const activityPulses'),
    lobby.indexOf('const selectedMember'),
  );
  assert.doesNotMatch(pulseSelection, /activeMatch/);
  assert.match(requirements, /lobby: Object\.freeze\(\[D\.leaderboards, D\.socialWorld, D\.social\]\)/);
});

test('PresencePulseStack is query-free and opens inspection through a callback', () => {
  assert.doesNotMatch(pulses, /databaseConnection|getSocialWorldScene|getSocialWorldPresence|recordEncounter/);
  assert.match(pulses, /members = \[\]/);
  assert.match(pulses, /onInspectProfile\?\.\(/);
  assert.match(pulses, /createOccupantFocusReturn/);
  assert.match(pulses, /ProfileIdentity/);
  assert.match(pulses, /avatarOnly/);
  assert.match(pulses, /avatarSize=\{24\}/);
  assert.doesNotMatch(pulses, /PresenceContextFrame|resident/i);
  assert.doesNotMatch(pulses, /presence-pulse-stack__label/);
});

test('only the shared visible drawer records a meaningful Lobby encounter', () => {
  assert.match(lobby, /<ProfilePresenceDrawer/);
  assert.match(lobby, /onEncounterVisible=\{recordVisibleEncounter\}/);
  assert.match(lobby, /profileCardController\.recordEncounter/);
  assert.doesNotMatch(pulses, /onEncounterVisible|recordVisibleEncounter/);
});
