import { getThemeRecipe } from './ThemeRecipeRegistry.js';

export const DEFAULT_THEME_ID = 'minimalist';

export const THEME_IDS = Object.freeze([
  'minimalist',
  'obsidian',
  'old_windows',
  'kawaii',
  'gamification',
  'pixelated',
  'dreamcore',
  'minimalist_light',
  'mature_beige',
  'solarpunk',
  'frutiger_aero',
  'blueprint',
  'editorial_noir',
  'northstar',
  'atelier',
  'memory_palace',
  'commons',
]);

const theme = (definition) => Object.freeze({
  free: false,
  dark: true,
  mode: definition.dark === false ? 'light' : 'dark',
  ...getThemeRecipe(definition.id),
  ...definition,
});

export const THEME_REGISTRY = Object.freeze([
  theme({
    id: 'minimalist', label: 'Minimalist', shortLabel: 'MIN', cost: 0, unlockThreshold: 0, free: true,
    accent: '#4f8cff', dark: true, density: 'compact', material: 'flat', motionPack: 'precise',
    soundPack: 'minimalist', motif: 'grid',
    description: 'Dense charcoal surfaces, crisp rules, and restrained motion.',
  }),
  theme({
    id: 'minimalist_light', label: 'Minimalist Light', shortLabel: 'LGT', cost: 5, unlockThreshold: 5,
    accent: '#2563eb', dark: false, density: 'airy', material: 'flat', motionPack: 'crisp',
    soundPack: 'minimalist_light', motif: 'rule',
    description: 'Clear white space, fine rules, and quiet tactile feedback.',
  }),
  theme({
    id: 'kawaii', label: 'Kawaii', shortLabel: 'KAW', cost: 10, unlockThreshold: 10,
    accent: '#d76adf', dark: false, density: 'comfortable', material: 'glossy', motionPack: 'spring',
    soundPack: 'kawaii', motif: 'bunny',
    description: 'Pastel gloss, friendly mascots, sparkle, and buoyant movement.',
  }),
  theme({
    id: 'dreamcore', label: 'Dreamcore', shortLabel: 'DRM', cost: 10, unlockThreshold: 10,
    accent: '#b79cff', dark: true, density: 'floating', material: 'haze', motionPack: 'drift',
    soundPack: 'dreamcore', motif: 'cloud',
    description: 'Hazy floating panes, surreal gradients, and slow dreamlike motion.',
  }),
  theme({
    id: 'pixelated', label: 'Pixelated', shortLabel: 'PXL', cost: 30, unlockThreshold: 30,
    accent: '#d7ef68', dark: true, density: 'compact', material: 'pixel', motionPack: 'stepped',
    soundPack: 'pixelated', motif: 'dither',
    description: 'Hard pixels, clipped corners, dithered shadows, and chiptune cues.',
  }),
  theme({
    id: 'mature_beige', label: 'Mature Beige', shortLabel: 'MBG', cost: 30, unlockThreshold: 30,
    accent: '#72785a', dark: false, density: 'editorial', material: 'paper', motionPack: 'composed',
    soundPack: 'mature_beige', motif: 'linen',
    description: 'Warm paper, olive details, editorial type, and composed transitions.',
  }),
  theme({
    id: 'old_windows', label: 'Old Windows', shortLabel: 'WIN', cost: 150, unlockThreshold: 150,
    accent: '#0c7f7a', dark: false, density: 'desktop', material: 'bevel', motionPack: 'snap',
    soundPack: 'old_windows', motif: 'checker',
    description: 'Retro desktop chrome, beveled controls, title bars, and mechanical beeps.',
  }),
  theme({
    id: 'obsidian', label: 'Obsidian', shortLabel: 'OBS', cost: 750, unlockThreshold: 750,
    accent: '#8b9cff', dark: true, density: 'workspace', material: 'pane', motionPack: 'dock',
    soundPack: 'obsidian', motif: 'links',
    description: 'Deep graphite panes, tabs, docked borders, and resonant glass tones.',
  }),
  theme({
    id: 'gamification', label: 'Gamification', shortLabel: 'LVL', cost: 1000, unlockThreshold: 1000,
    accent: '#ffc648', dark: true, density: 'heroic', material: 'ornate', motionPack: 'reward',
    soundPack: 'gamification', motif: 'stars',
    description: 'Parchment, gold frames, trophy details, reward bursts, and fanfares.',
  }),
  theme({
    id: 'solarpunk', label: 'Solarpunk', shortLabel: 'SOL', cost: 120, unlockThreshold: 120,
    accent: '#2f8f5b', dark: false, density: 'organic', material: 'paper-glass', motionPack: 'growth',
    soundPack: 'solarpunk', motif: 'growth-ring',
    description: 'Warm daylight, botanical routes, organic panels, and living landmarks.',
  }),
  theme({
    id: 'frutiger_aero', label: 'Frutiger Aero', shortLabel: 'AER', cost: 220, unlockThreshold: 220,
    accent: '#168dcc', dark: false, density: 'spacious', material: 'aero-glass', motionPack: 'bubble',
    soundPack: 'frutiger_aero', motif: 'water',
    description: 'Sky, water, glossy glass, vivid nature, and optimistic dimensional controls.',
  }),
  theme({
    id: 'blueprint', label: 'Blueprint', shortLabel: 'BLU', cost: 360, unlockThreshold: 360,
    accent: '#59d5ff', dark: true, density: 'technical', material: 'drawing', motionPack: 'draft',
    soundPack: 'blueprint', motif: 'measurement',
    description: 'Technical grids, measurement marks, schematic routes, and stamped evidence.',
  }),
  theme({
    id: 'editorial_noir', label: 'Editorial Noir', shortLabel: 'NOIR', cost: 520, unlockThreshold: 520,
    accent: '#f04c55', dark: true, density: 'editorial-dense', material: 'ink', motionPack: 'cinematic',
    soundPack: 'editorial_noir', motif: 'frame',
    description: 'Black, ivory, bold magazine type, asymmetric rhythm, and cinematic recaps.',
  }),
  theme({
    id: 'northstar', label: 'Northstar', shortLabel: 'NTH', cost: 0, unlockThreshold: 2500,
    accent: '#7dd3fc', dark: true, density: 'navigational', material: 'starlit-glass', motionPack: 'orbit',
    soundPack: 'northstar', motif: 'constellation',
    description: 'Deep celestial navigation, luminous bearings, and measured orbital motion.',
  }),
  theme({
    id: 'atelier', label: 'Atelier', shortLabel: 'ATL', cost: 0, unlockThreshold: 2500,
    accent: '#d78957', dark: false, density: 'crafted', material: 'canvas-wood', motionPack: 'handmade',
    soundPack: 'atelier', motif: 'maker-marks',
    description: 'Warm canvas, workbench structure, maker marks, and tactile crafted motion.',
  }),
  theme({
    id: 'memory_palace', label: 'Memory Palace', shortLabel: 'MEM', cost: 0, unlockThreshold: 2500,
    accent: '#c4a7ff', dark: true, density: 'layered', material: 'archival-glass', motionPack: 'recollection',
    soundPack: 'memory_palace', motif: 'rooms',
    description: 'Layered archival rooms, violet glass, and transitions shaped like recollection.',
  }),
  theme({
    id: 'commons', label: 'Commons', shortLabel: 'COM', cost: 0, unlockThreshold: 2500,
    accent: '#42c99a', dark: false, density: 'communal', material: 'civic-paper', motionPack: 'gather',
    soundPack: 'commons', motif: 'woven-circle',
    description: 'Open civic color, shared surfaces, woven circles, and welcoming group motion.',
  }),
]);

export const THEME_BY_ID = new Map(THEME_REGISTRY.map((entry) => [entry.id, entry]));
export const VALID_THEME_IDS = new Set(THEME_IDS);

export function isThemeId(value) {
  return typeof value === 'string' && VALID_THEME_IDS.has(value);
}

export function resolveThemeId(value) {
  return isThemeId(value) ? value : DEFAULT_THEME_ID;
}

export function getTheme(value) {
  return THEME_BY_ID.get(resolveThemeId(value));
}

export function applyThemeToElement(element, value, { preview = false } = {}) {
  if (!element) return DEFAULT_THEME_ID;
  const id = resolveThemeId(value);
  const definition = getTheme(id);
  element.setAttribute('data-theme', id);
  element.setAttribute('data-theme-mode', definition.mode);
  element.setAttribute('data-theme-motion', definition.motionPack);
  element.setAttribute('data-theme-icon-pack', definition.iconPack);
  element.setAttribute('data-theme-navigation', definition.navigationRecipe);
  element.setAttribute('data-theme-surface', definition.surfaceRecipe);
  element.setAttribute('data-theme-world', definition.worldRecipe);
  element.setAttribute('data-theme-achievement', definition.achievementRecipe);
  element.setAttribute('data-theme-contrast', definition.contrastProfile);
  if (preview) element.setAttribute('data-theme-preview', id);
  else element.removeAttribute('data-theme-preview');
  return id;
}

export function getRecentThemeCommitForPlayer(element, playerUUID, {
  now = Date.now(),
  maxAgeMs = 5000,
} = {}) {
  if (!element || !playerUUID) return null;
  const committedAt = Number(element.getAttribute('data-theme-commit-at'));
  const committedPlayerUUID = element.getAttribute('data-theme-commit-player');
  const committedThemeId = element.getAttribute('data-theme-commit-id');
  if (
    !Number.isFinite(committedAt)
    || now - committedAt < 0
    || now - committedAt >= maxAgeMs
    || String(committedPlayerUUID || '') !== String(playerUUID)
    || !isThemeId(committedThemeId)
  ) return null;
  return committedThemeId;
}

export function clearThemePreview(element, persistedThemeId) {
  return applyThemeToElement(element, persistedThemeId, { preview: false });
}

export const THEME_ACCENT_COLORS = Object.freeze(Object.fromEntries(
  THEME_REGISTRY.map((entry) => [entry.id, entry.accent]),
));
