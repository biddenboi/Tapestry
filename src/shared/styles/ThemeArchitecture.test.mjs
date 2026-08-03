import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { THEME_IDS } from '../../domain/themes/ThemeRegistry.js';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('all canonical themes own structural CSS, motion, and responsive treatment', async () => {
  const folderById = {
    old_windows: 'old-windows', minimalist_light: 'minimalist-light', mature_beige: 'mature-beige',
    frutiger_aero: 'frutiger-aero', editorial_noir: 'editorial-noir', memory_palace: 'memory-palace',
  };
  const modularCss = await Promise.all(THEME_IDS.flatMap((themeId) => {
    const folder = folderById[themeId] || themeId;
    return ['tokens.css', 'components.css', 'features.css', 'motion.css', 'responsive.css']
      .map((file) => read(`./themes/${folder}/${file}`));
  }));
  const css = `${await read('./themes.css')}\n${modularCss.join('\n')}`;
  for (const themeId of THEME_IDS) {
    assert.match(css, new RegExp(`\\[data-theme="${themeId}"\\]`));
  }
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /\.hub-world-nav/);
  assert.match(css, /\.ui-modal/);
  assert.match(css, /\.ui-close-button/);
  assert.match(css, /theme-kawaii-pop/);
  assert.match(css, /theme-pixel-in/);
  assert.match(css, /theme-dream-in/);
});

test('legacy theme selectors and remote font dependencies are absent', async () => {
  const [base, themes, sessionResults] = await Promise.all([
    read('./index.css'),
    read('./themes.css'),
    read('../../features/tasks/modals/SessionResults/SessionResults.css'),
  ]);
  const source = `${base}\n${themes}\n${sessionResults}`;
  for (const removedId of ['default','pure','rose','crimson','emerald','sand','paper','violet','shadow','gold']) {
    assert.doesNotMatch(source, new RegExp(`data-theme="${removedId}"`));
  }
  assert.doesNotMatch(source, /fonts\.googleapis|fonts\.gstatic/);
});

test('Appearance Studio keeps app and profile themes independent with owned-only equip semantics', async () => {
  const [settings, appearanceStudio, profile, app, registry] = await Promise.all([
    read('../../features/settings/pages/Settings/Settings.jsx'),
    read('../../features/settings/components/AppearanceStudio/AppearanceStudio.jsx'),
    read('../../features/profile/pages/Profile/Profile.jsx'),
    read('../../app/App.jsx'),
    read('../../domain/themes/ThemeRegistry.js'),
  ]);
  const cosmeticWriter = settings.slice(
    settings.indexOf('const setCosmetic'),
    settings.indexOf('useEffect(() => {', settings.indexOf('const setCosmetic')),
  );
  assert.match(settings, /<AppearanceStudio/);
  assert.match(settings, /applyPreviewTheme\(persistedThemeRef\.current\)/);
  assert.match(settings, /document\.documentElement\.hasAttribute\('data-theme-preview'\)/);
  assert.match(settings, /data-theme-commit-id/);
  assert.match(app, /getRecentThemeCommitForPlayer\(root, currentPlayer\?\.UUID\)/);
  assert.match(registry, /data-theme-commit-at/);
  assert.match(registry, /committedPlayerUUID/);
  assert.match(profile, /data-profile-theme-scope=\{isSelf \? 'self' : 'owner'\}/);
  assert.match(profile, /data-theme=\{isSelf \? undefined : profileTheme\}/);
  assert.doesNotMatch(cosmeticWriter, /refreshApp/);
  assert.doesNotMatch(cosmeticWriter, /invalidateDomains/);
  assert.match(cosmeticWriter, /commitCurrentProfile\(updated\)/);
  assert.match(appearanceStudio, /disabled=\{!owned\}/);
  assert.match(appearanceStudio, /onEquip\?\.\(slot, definition\.id\)/);
  assert.match(appearanceStudio, /App, profile, identity, social, and competition surfaces equip independently/);
  assert.doesNotMatch(settings, /function ThemeSwatch|function BannerEditor|accept="image\/\*"/);
});

test('composite search fields and sharp feature surfaces follow theme shape tokens', async () => {
  const css = await read('./themes.css');
  assert.match(css, /\[data-theme\] :where\(\s*input:not/);
  assert.match(css, /\.feed-search-wrap\) input/);
  assert.match(css, /\[data-theme="pixelated"\] :where\(/);
  assert.match(css, /\.profile-match-summary-stat/);
  assert.match(css, /\.evt-editor-capsule/);
  assert.match(css, /border-radius: var\(--theme-button-radius\) !important/);
});

test('semantic primitives centralize reusable surface and control contracts', async () => {
  const [components, css] = await Promise.all([
    read('../ui/SemanticPrimitives.jsx'),
    read('../ui/UI.css'),
  ]);
  for (const primitive of ['Surface','Button','IconButton','Progress','Menu','Tooltip']) {
    assert.match(components, new RegExp(`export function ${primitive}`));
  }
  for (const className of ['ui-surface','ui-button','ui-icon-button','ui-close-button','ui-progress','ui-menu','ui-tooltip']) {
    assert.match(css, new RegExp(`\\.${className}`));
  }
});
