import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const identityComponent = readFileSync(new URL('./ProfileIdentity.jsx', import.meta.url), 'utf8');
const identityCss = readFileSync(new URL('./ProfileIdentity.css', import.meta.url), 'utf8');
const pictureComponent = readFileSync(new URL('../profile-picture/ProfilePicture.jsx', import.meta.url), 'utf8');
const socialWorldCss = readFileSync(new URL('../../features/social-world/components/SocialWorldShell/SocialWorldShell.css', import.meta.url), 'utf8');

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

test('social-world identity wrappers do not clip the outer profile frame', () => {
  assert.match(socialWorldCss, /\.social-world-person__copy\s*\{[^}]*overflow:\s*visible;/s);
  assert.match(socialWorldCss, /\.social-world-rail-person__copy\s*\{[^}]*overflow:\s*visible;/s);
});
