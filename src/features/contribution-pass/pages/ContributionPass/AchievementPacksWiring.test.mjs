import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const [surface, styles, host] = await Promise.all([
  read('./AchievementPacksBoard.jsx'),
  read('./AchievementPacksBoard.css'),
  read('./ContributionPass.jsx'),
]);

test('Contribution is presented through permanent Achievement Packs and a deliberate node popover claim', () => {
  assert.match(host, /<h1>Achievement Packs<\/h1>/);
  assert.match(host, /<AchievementPacksBoard/);
  assert.match(surface, /PERMANENT COLLECTION/);
  assert.match(surface, /Claim \$\{node\.label\}/);
  assert.match(surface, /resolveAchievementPackExclusions/);
  assert.match(surface, /Requirements and permanent route consequences appear here/);
  assert.match(surface, /showsEarnedGate/);
  assert.match(surface, /Not needed — earned gate met/);
});

test('choice previews flash only with motion and remain dim until deselection', () => {
  assert.match(styles, /animation: achievement-pack-consequence \.2s ease-in-out 4 alternate/);
  assert.match(styles, /prefers-reduced-motion: reduce/);
  assert.match(styles, /html\[data-reduced-motion\]/);
  assert.match(styles, /\.achievement-pack-board\.has-preview \.is-preview-closed/);
});

test('pack library and detail views keep responsive breathing room inside the panel', () => {
  assert.match(styles, /\.achievement-pack-library,[\s\S]*\.achievement-pack-detail \{[\s\S]*padding: clamp\(22px, 3vw, 36px\)/);
  assert.match(styles, /@media \(max-width: 620px\)[\s\S]*padding: 18px 16px 28px/);
});
