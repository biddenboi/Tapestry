import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  DEFAULT_THEME_ID,
  getRecentThemeCommitForPlayer,
  getTheme,
  isThemeId,
  resolveThemeId,
  THEME_IDS,
  THEME_REGISTRY,
} from './ThemeRegistry.js';

function themeElement() {
  const attributes = new Map();
  return {
    getAttribute(name) { return attributes.get(name) ?? null; },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    removeAttribute(name) { attributes.delete(name); },
  };
}

test('theme registry is canonical, complete, and decision-ready', () => {
  assert.equal(DEFAULT_THEME_ID, 'minimalist');
  assert.equal(THEME_REGISTRY.length, 17);
  assert.deepEqual(new Set(THEME_REGISTRY.map((entry) => entry.id)), new Set(THEME_IDS));
  for (const entry of THEME_REGISTRY) {
    assert.equal(isThemeId(entry.id), true);
    assert.ok(entry.label && entry.description && entry.accent);
    assert.ok(entry.material && entry.motionPack && entry.soundPack && entry.motif);
    assert.ok(entry.iconPack && entry.illustrationPack && entry.navigationRecipe);
    assert.ok(entry.surfaceRecipe && entry.typographyRecipe && entry.worldRecipe && entry.achievementRecipe);
    assert.equal(entry.supportsReducedMotion, true);
    assert.equal(entry.mode, entry.dark === false ? 'light' : 'dark');
    assert.ok(Number.isFinite(entry.unlockThreshold));
  }
  assert.equal(resolveThemeId('removed-theme'), 'minimalist');
  assert.equal(getTheme('removed-theme').id, 'minimalist');
});

test('theme contribution ladder matches the product contract', () => {
  assert.deepEqual(
    Object.fromEntries(THEME_REGISTRY.map((entry) => [entry.id, entry.unlockThreshold])),
    {
      minimalist: 0, minimalist_light: 5, kawaii: 10, dreamcore: 10,
      pixelated: 30, mature_beige: 30, old_windows: 150, obsidian: 750,
      gamification: 1000, solarpunk: 120, frutiger_aero: 220,
      blueprint: 360, editorial_noir: 520,
      northstar: 2500, atelier: 2500, memory_palace: 2500, commons: 2500,
    },
  );
});

test('a recent theme commit can only override the profile that saved it', () => {
  const element = themeElement();
  element.setAttribute('data-theme-commit-player', 'profile-a');
  element.setAttribute('data-theme-commit-id', 'obsidian');
  element.setAttribute('data-theme-commit-at', '1000');
  assert.equal(getRecentThemeCommitForPlayer(element, 'profile-a', { now: 2000 }), 'obsidian');
  assert.equal(getRecentThemeCommitForPlayer(element, 'profile-b', { now: 2000 }), null);
  assert.equal(getRecentThemeCommitForPlayer(element, 'profile-a', { now: 6000 }), null);
});

test('every theme owns a complete modular recipe directory', async () => {
  const folderById = {
    old_windows: 'old-windows',
    minimalist_light: 'minimalist-light',
    mature_beige: 'mature-beige',
    frutiger_aero: 'frutiger-aero',
    editorial_noir: 'editorial-noir',
    memory_palace: 'memory-palace',
  };
  const required = ['tokens.css', 'components.css', 'features.css', 'motion.css', 'responsive.css', 'manifest.js'];
  for (const theme of THEME_REGISTRY) {
    const folder = folderById[theme.id] || theme.id;
    for (const filename of required) {
      const resource = new URL(`../../shared/styles/themes/${folder}/${filename}`, import.meta.url);
      await access(resource);
      const source = await readFile(resource, 'utf8');
      assert.ok(source.trim().length > 0, `${theme.id}/${filename} must not be empty`);
    }
  }
});
