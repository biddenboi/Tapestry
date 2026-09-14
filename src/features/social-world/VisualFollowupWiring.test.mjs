import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const [
  pulses,
  pulseStyles,
  tavern,
  profileView,
  shopStyles,
  inventoryPopupStyles,
  panelRegistry,
  gameHub,
] = await Promise.all([
  read('./components/PresencePulseStack/PresencePulseStack.jsx'),
  read('./components/PresencePulseStack/PresencePulseStack.css'),
  read('./components/TavernDrawer/TavernDrawer.jsx'),
  read('../profile/pages/Profile/ProfileView.jsx'),
  read('../shop/pages/Shop/Shop.css'),
  read('../inventory/modals/InventoryItemPopup/InventoryItemPopup.css'),
  read('../../app/shell/GameHub/panelRegistry.js'),
  read('../../app/shell/GameHub/GameHub.jsx'),
]);

test('Match uses one compact Fellow identity stack', () => {
  assert.match(pulses, /ProfileIdentity/);
  assert.match(pulses, /avatarOnly/);
  assert.match(pulses, /avatarSize=\{24\}/);
  assert.doesNotMatch(pulses, /PresenceContextFrame|resident/i);
  assert.doesNotMatch(pulses, /presence-pulse-stack__label/);
  assert.match(pulseStyles, /\.presence-pulse \{[\s\S]*?width: fit-content;[\s\S]*?height: fit-content;/);
  assert.match(pulseStyles, /button\.presence-pulse:hover:not\(:disabled\)[\s\S]*?background: transparent;[\s\S]*?box-shadow: none;/);
  assert.doesNotMatch(pulseStyles, /margin-left:\s*-/);
  assert.doesNotMatch(pulseStyles, /presence-pulse > i|presence-pulse-beat/);
});

test('shop cards and active inventory modals use modest, even corner radii', () => {
  assert.match(shopStyles, /\.shop-card \{[\s\S]*?grid-template-rows: 190px auto auto;[\s\S]*?border-radius: 12px;/);
  assert.doesNotMatch(shopStyles, /border-radius: 1[12]0px 1[12]0px/);
  assert.match(inventoryPopupStyles, /\.inv-popup\.ui-modal \{[\s\S]*?border-radius: 14px;/);
  assert.doesNotMatch(inventoryPopupStyles, /border-radius: 180px/);
});

test('Tavern omits projected badges and replay imports its formatter', () => {
  assert.match(tavern, /presenceState !== PRESENCE_STATE\.projected/);
  assert.match(profileView, /formatInGameTime,/);
  assert.match(profileView, /formatInGameTime\(replayIGT\)/);
});

test('the primary world layer always uses the semantic world', () => {
  assert.match(panelRegistry, /loadSocialWorldShell/);
  assert.match(panelRegistry, /map: '@features\/social-world\/components\/SocialWorldShell\/SocialWorldShell\.jsx'/);
  assert.doesNotMatch(panelRegistry, /world-map|WorldMap|leaflet/i);
  assert.match(gameHub, /<SocialWorldShell deferHeavyWork=\{deferWorldLayer\} \/>/);
});
