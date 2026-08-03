import assert from 'node:assert/strict';
import test from 'node:test';
import { THEME_IDS } from '../../domain/themes/ThemeRegistry.js';
import {
  describeThemeSound,
  SOUND_CUES,
  THEME_SOUND_PACKS,
  validateThemeSoundPacks,
} from './ThemeSoundPacks.js';

test('every canonical theme has a safe complete semantic sound pack', () => {
  assert.equal(validateThemeSoundPacks(), true);
  assert.deepEqual(new Set(Object.keys(THEME_SOUND_PACKS)), new Set(THEME_IDS));
  for (const themeId of THEME_IDS) {
    for (const cue of SOUND_CUES) {
      const descriptor = describeThemeSound(themeId, cue);
      assert.equal(descriptor.themeId, themeId);
      assert.equal(descriptor.cue, cue);
      assert.ok(descriptor.fingerprint.includes(themeId));
      assert.ok(descriptor.gain > 0 && descriptor.gain <= 1);
    }
  }
});

test('theme signatures remain genuinely distinct', () => {
  const signatures = THEME_IDS.map((id) => describeThemeSound(id, 'theme-preview').fingerprint);
  assert.equal(new Set(signatures).size, THEME_IDS.length);
});
