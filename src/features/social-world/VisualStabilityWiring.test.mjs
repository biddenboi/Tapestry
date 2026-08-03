import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const [dojo, lobby, lobbyStyles, socialWorld, socialRuntime, dojoController, overlayFocus, presetSurface, matchStyles] = await Promise.all([
  read('../matches/components/PracticeDojo/PracticeDojo.css'),
  read('../lobby/components/Lobby/Lobby.jsx'),
  read('../lobby/components/Lobby/Lobby.css'),
  read('./components/SocialWorldShell/SocialWorldShell.css'),
  read('./components/SocialWorldShell/SocialWorldRuntime.jsx'),
  read('../matches/components/PracticeDojo/useDojoRoomController.js'),
  read('../../shared/ui/useOverlayFocus.js'),
  read('../../shared/cosmetics/PresetCosmeticSurface.css'),
  read('../matches/components/MatchArena/MatchArena.css'),
]);

test('Dojo standings use one stable scroll surface and text-only row hover', () => {
  assert.match(dojo, /\.dojo-standings \{[\s\S]*?overflow-x: hidden;[\s\S]*?scrollbar-gutter: stable;[\s\S]*?contain: paint;/);
  assert.match(dojo, /\.dojo-around-standing__list \{[\s\S]*?overflow: visible;/);
  assert.match(dojo, /\.dojo-lb-list \{[\s\S]*?max-height: none;[\s\S]*?overflow: visible;/);
  assert.match(dojo, /\.dojo-standing-row:hover \.profile-identity strong \{ color: var\(--accent-bright\); \}/);
  assert.doesNotMatch(dojo, /\.dojo-standing-row:hover\s*\{[^}]*scale\(/);
  assert.doesNotMatch(dojo, /\.dojo-lb-row:hover\s*\{[^}]*scale\(/);
});

test('profile drawers focus without moving the underlying scene', () => {
  assert.match(overlayFocus, /focus\?\.\(\{ preventScroll: true \}\)/);
});

test('the Lobby player portrait owns one unclipped rank treatment', () => {
  assert.doesNotMatch(lobby, /getRankGlow/);
  assert.match(lobbyStyles, /\.lpc-avatar-ring \{[\s\S]*?width: 90px;[\s\S]*?height: 90px;[\s\S]*?overflow: visible;/);
});

test('semantic-location cards highlight without translating into their scroll container', () => {
  assert.match(socialWorld, /\.social-world-location__people \{[\s\S]*?overflow-x: hidden;[\s\S]*?scrollbar-gutter: stable;/);
  assert.doesNotMatch(socialWorld, /\.social-world-person:hover,[\s\S]*?\.social-world-person:focus-visible\s*\{[^}]*translateY/);
  assert.doesNotMatch(socialWorld, /\.social-world-tavern:hover,[\s\S]*?\.social-world-tavern:focus-visible\s*\{[^}]*translateY/);
  assert.match(socialWorld, /\.social-world-person \{[\s\S]*?border:\s*0;[\s\S]*?background:\s*transparent;/);
});

test('preset cosmetics inherit one radius-aligned surface boundary', () => {
  assert.match(presetSurface, /\.preset-cosmetic-surface \{[^}]*border:\s*0;[^}]*border-radius:\s*var\(--cosmetic-border-radius/s);
  assert.match(presetSurface, /box-shadow:\s*inset 0 0 0 1px/);
  assert.match(matchStyles, /data-cosmetic-match-card[\s\S]*?border-radius:\s*var\(--cosmetic-border-radius, 14px\)/);
  assert.doesNotMatch(matchStyles, /data-cosmetic-standings-row|match-history-card/);
});

test('prepared Fellow scenes stay mounted between factual source refreshes', () => {
  assert.match(socialRuntime, /preparedScene\?\.viewer\?\.profileId === currentPlayer\?\.UUID/);
  assert.match(lobby, /preparedSocialScene\?\.viewer\?\.profileId === currentPlayer\?\.UUID/);
  assert.match(dojoController, /preparedScene\?\.viewer\?\.profileId === currentPlayer\?\.UUID/);
  assert.doesNotMatch(`${socialRuntime}\n${lobby}\n${dojoController}`, /useSocialOccupancy|socialOccupancy|occupancy &&/);
});
