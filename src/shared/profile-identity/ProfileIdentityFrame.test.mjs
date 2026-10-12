import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const identityComponent = readFileSync(new URL('./ProfileIdentity.jsx', import.meta.url), 'utf8');
const identityCss = readFileSync(new URL('./ProfileIdentity.css', import.meta.url), 'utf8');
const pictureComponent = readFileSync(new URL('../profile-picture/ProfilePicture.jsx', import.meta.url), 'utf8');

test('profile picture and profile frames share one avatar radius', () => {
  assert.match(identityComponent, /'--profile-avatar-radius': `\$\{size \* 0\.12\}px`/);
  assert.match(pictureComponent, /borderRadius: `var\(--profile-avatar-radius, \$\{size \* 0\.12\}px\)`/);
  assert.match(identityCss, /\.profile-identity__cosmetic-frame\s*\{[^}]*border-radius:\s*var\(--profile-avatar-radius/s);
  assert.match(identityCss, /\.profile-identity__portrait::before\s*\{[^}]*border-radius:\s*calc\(var\(--profile-avatar-radius[^;]*\+ var\(--profile-frame-outset\)\);/s);
});

test('rank treatments keep their decoration without overriding the shared corner shape', () => {
  const treatmentCss = identityCss.slice(0, identityCss.indexOf('@keyframes rank-ember'));
  const treatmentBlocks = treatmentCss.match(/\.profile-identity\[data-rank-frame="[^"]+"\] \.profile-identity__portrait::before\s*\{[^}]*\}/g) || [];
  assert.equal(treatmentBlocks.length, 9);
  for (const block of treatmentBlocks) {
    assert.doesNotMatch(block, /border-radius|clip-path/);
  }
});
