import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const layoutCss = readFileSync(new URL('./styles/Profile.layout.css', import.meta.url), 'utf8');
const skinsCss = readFileSync(new URL('./styles/Profile.skins.css', import.meta.url), 'utf8');

test('Profile Identity customizer keeps its full height above embedded Settings', () => {
  assert.match(layoutCss, /\.profile-settings-panel\s*>\s*\.profile-customizer\s*\{[^}]*flex:\s*0 0 auto;[^}]*min-height:\s*auto;[^}]*overflow:\s*visible;/s);
  assert.match(layoutCss, /\.profile-settings-panel\s*>\s*\.settings-page--embedded\s*\{[^}]*flex:\s*0 0 auto;[^}]*min-height:\s*auto;/s);
});

test('Profile Identity customizer stacks every section at compact widths', () => {
  assert.match(skinsCss, /@media\s*\(max-width:\s*1100px\)[\s\S]*?\.profile-customizer\s*\{[^}]*grid-template-columns:\s*1fr;[^}]*grid-template-areas:\s*"skins"\s*"identity"\s*"cosmetics";/s);
});
