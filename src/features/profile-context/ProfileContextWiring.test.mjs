import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const [profile, view, drawer, runtime, personalization] = await Promise.all([
  read('../profile/pages/Profile/Profile.jsx'),
  read('./components/LifeContextBlock.jsx'),
  read('../social-world/components/ProfilePresenceDrawer/ProfilePresenceDrawer.jsx'),
  read('../social-world/components/SocialWorldShell/SocialWorldRuntime.jsx'),
  read('../../domain/profile/ProfilePersonalization.js'),
]);

test('Profile owns authoring, policy preview, suggestions, and the unique free Life Context block', () => {
  assert.match(profile, /useProfileContextController/);
  assert.match(profile, /<LifeContextBlock/);
  assert.match(view, /Edit context/);
  assert.match(view, /ContextStudio/);
  assert.match(personalization, /type: 'lifeContext'/);
  assert.match(personalization, /free: true/);
  assert.match(personalization, /unique: true/);
  assert.match(personalization, /columns: 12, height: 360/);
});

test('Social World consumes batched projections and renders only meaningful profile-moment context', () => {
  assert.match(runtime, /getProfileContextProjections/);
  assert.match(runtime, /contextProjections=\{contextProjections\}/);
  assert.match(drawer, /card\.context/);
  assert.match(drawer, /hasMeaningfulContext/);
  assert.match(drawer, /Working privately/);
  assert.match(drawer, /Current chapter/);
  assert.match(drawer, /Next 72 hours/);
  assert.match(drawer, /How to show up/);
  assert.doesNotMatch(drawer, /Nothing additional was shared for this horizon/);
  assert.doesNotMatch(drawer, /PROFILE_CONTEXT_ACTIONS|Respond without pressure|Recognition feedback/);
  assert.doesNotMatch(drawer, /card\.past\.map|card\.next\.map|card\.thread\.label/);
});
