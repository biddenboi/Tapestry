import { COSMETIC_PROFILE_BLOCKS, THEME_ACCENT_COLORS } from '@domain/constants.js';

export const PROFILE_THEME_SKINS = [
  {
    id: 'arena',
    label: 'Default Layout',
    requiredTheme: 'minimalist',
    free: true,
    layout: 'arena',
    accent: '#f472b6',
    description: 'A balanced profile layout for rank progress, highlights, achievements, and recent activity.',
  },
  {
    id: 'nocturne',
    label: 'Nocturne',
    requiredTheme: 'obsidian',
    layout: 'poster',
    accent: THEME_ACCENT_COLORS.obsidian,
    description: 'A darker poster-style profile with bigger identity, quieter stats, and dramatic negative space.',
  },
  {
    id: 'terminal',
    label: 'Terminal Log',
    requiredTheme: 'pixelated',
    layout: 'terminal',
    accent: THEME_ACCENT_COLORS.pixelated,
    description: 'A mono-forward activity log skin that makes the profile read like a live operations console.',
  },
  {
    id: 'zine',
    label: 'Zine',
    requiredTheme: 'old_windows',
    layout: 'zine',
    accent: THEME_ACCENT_COLORS.old_windows,
    description: 'A more expressive blog-like layout with stronger typography, quote treatment, and stacked posts.',
  },
  {
    id: 'paper',
    label: 'Notebook',
    requiredTheme: 'old_windows',
    layout: 'notebook',
    accent: THEME_ACCENT_COLORS.old_windows,
    description: 'A journal-first skin for users who want the page to feel written, archived, and personal.',
  },
  {
    id: 'gallery',
    label: 'Gallery',
    requiredTheme: 'minimalist_light',
    layout: 'gallery',
    accent: THEME_ACCENT_COLORS.minimalist_light,
    description: 'A clean portfolio skin with image/banner emphasis and balanced trophy/history panels.',
  },
  {
    id: 'imperial',
    label: 'Imperial',
    requiredTheme: 'gamification',
    layout: 'collector',
    accent: THEME_ACCENT_COLORS.gamification,
    description: 'A trophy-room skin for collectors: achievements, milestones, and top receipts feel ceremonial.',
  },
  {
    id: 'crimson',
    label: 'Dream Dossier',
    requiredTheme: 'dreamcore',
    layout: 'dossier',
    accent: THEME_ACCENT_COLORS.dreamcore,
    description: 'A sharp dossier skin built around match history, rank pressure, and severe red accents.',
  },
];

export const DEFAULT_PROFILE_PERSONALIZATION = {
  skin: 'arena',
  tagline: '',
  about: '',
  quote: '',
  links: [
    { label: '', url: '' },
    { label: '', url: '' },
    { label: '', url: '' },
  ],
  showStats: true,
  showAchievements: true,
  showHighlights: true,
  showActivity: true,
  blocks: [
    { id: 'life-context', type: 'lifeContext', columns: 12, height: 360 },
  ],
};

export const PROFILE_BLOCK_MIN_COLUMNS = 3;
export const PROFILE_BLOCK_MAX_COLUMNS = 12;
export const PROFILE_BLOCK_MIN_HEIGHT = 200;
export const PROFILE_BLOCK_MAX_HEIGHT = 720;

const PROFILE_BLOCK_DEFAULTS = {
  lifeContext: { columns: 12, height: 360 },
  text: { columns: 12, height: 240 },
  stats: { columns: 6, height: 240 },
  achievements: { columns: 6, height: 240 },
  rankGraph: { columns: 12, height: 360 },
  highlights: { columns: 6, height: 280 },
  activity: { columns: 12, height: 380 },
  goalContribution: { columns: 6, height: 320 },
};

export const PROFILE_BLOCK_DEFINITIONS = [
  {
    type: 'lifeContext',
    label: 'Life Context',
    description: 'Share a current chapter, near horizon, and how others can show up.',
    free: true,
    unique: true,
    defaultColumns: PROFILE_BLOCK_DEFAULTS.lifeContext.columns,
    defaultHeight: PROFILE_BLOCK_DEFAULTS.lifeContext.height,
  },
  {
    type: 'text',
    label: 'Text Block',
    description: 'A reusable markdown text block.',
    free: true,
    unique: false,
    defaultColumns: PROFILE_BLOCK_DEFAULTS.text.columns,
    defaultHeight: PROFILE_BLOCK_DEFAULTS.text.height,
  },
  ...COSMETIC_PROFILE_BLOCKS.map((block) => ({
    type: block.blockType,
    label: block.label.replace(/ Block$/, ''),
    description: block.desc,
    cosmeticId: block.id,
    unique: true,
    defaultColumns: PROFILE_BLOCK_DEFAULTS[block.blockType]?.columns || 6,
    defaultHeight: PROFILE_BLOCK_DEFAULTS[block.blockType]?.height || 260,
  })),
];

const PROFILE_BLOCK_TYPE_SET = new Set(PROFILE_BLOCK_DEFINITIONS.map((block) => block.type));
const UNIQUE_PROFILE_BLOCK_TYPES = new Set(PROFILE_BLOCK_DEFINITIONS.filter((block) => block.unique === true).map((block) => block.type));

function hexToRgb(hex) {
  const clean = String(hex || '').replace('#', '').trim();
  if (!/^[0-9a-f]{6}$/i.test(clean)) return null;
  const int = parseInt(clean, 16);
  return {
    r: (int >> 16) & 255,
    g: (int >> 8) & 255,
    b: int & 255,
  };
}

function normalizeLinks(links = []) {
  const rows = Array.isArray(links) ? links : [];
  return [0, 1, 2].map((i) => ({
    label: String(rows[i]?.label || ''),
    url: String(rows[i]?.url || ''),
  }));
}

export function clampProfileBlockColumns(value) {
  const columns = Number(value);
  if (!Number.isFinite(columns)) return PROFILE_BLOCK_MIN_COLUMNS;
  return Math.min(PROFILE_BLOCK_MAX_COLUMNS, Math.max(PROFILE_BLOCK_MIN_COLUMNS, Math.round(columns)));
}

export function clampProfileBlockHeight(value) {
  const height = Number(value);
  if (!Number.isFinite(height)) return PROFILE_BLOCK_MIN_HEIGHT;
  return Math.min(PROFILE_BLOCK_MAX_HEIGHT, Math.max(PROFILE_BLOCK_MIN_HEIGHT, Math.round(height)));
}

function normalizeProfileBlocks(blocks = []) {
  const rows = Array.isArray(blocks) ? blocks : [];
  const seenUniqueTypes = new Set();

  return rows.reduce((result, block, index) => {
    const type = String(block?.type || '');
    if (!PROFILE_BLOCK_TYPE_SET.has(type)) return result;
    if (UNIQUE_PROFILE_BLOCK_TYPES.has(type) && seenUniqueTypes.has(type)) return result;
    if (UNIQUE_PROFILE_BLOCK_TYPES.has(type)) seenUniqueTypes.add(type);
    const definition = getProfileBlockDefinition(type);

    result.push({
      id: String(block.id || `${type}-${index + 1}`),
      type,
      columns: clampProfileBlockColumns(block.columns ?? definition?.defaultColumns),
      height: clampProfileBlockHeight(block.height ?? definition?.defaultHeight),
      ...(type === 'text' ? {
        // Empty strings are intentional editor values. Only an actually
        // missing field should receive the creation-time default.
        title: String(block.title ?? 'Text Block'),
        content: String(block.content ?? ''),
      } : {}),
    });
    return result;
  }, []);
}

export function getProfileSkin(skinId = 'arena') {
  return PROFILE_THEME_SKINS.find((skin) => skin.id === skinId) || PROFILE_THEME_SKINS[0];
}

export function normalizeProfilePersonalization(raw = {}) {
  const source = raw || {};
  const next = {
    ...DEFAULT_PROFILE_PERSONALIZATION,
    ...source,
  };
  const normalized = {
    skin: getProfileSkin(next.skin).id,
    tagline: String(next.tagline || ''),
    about: String(next.about || ''),
    quote: String(next.quote || ''),
    links: normalizeLinks(next.links),
    showStats: next.showStats !== false,
    showAchievements: next.showAchievements !== false,
    showHighlights: next.showHighlights !== false,
    showActivity: next.showActivity !== false,
  };
  const blocks = normalizeProfileBlocks(
    source.blocks == null ? DEFAULT_PROFILE_PERSONALIZATION.blocks : source.blocks,
  );
  return {
    ...normalized,
    blocks,
  };
}

export function isThemeOwned(themeId, ownedCosmeticIds = new Set()) {
  if (!themeId || themeId === 'minimalist') return true;
  return ownedCosmeticIds.has(themeId);
}

export function isProfileSkinUnlocked(skinId, ownedCosmeticIds = new Set()) {
  const skin = getProfileSkin(skinId);
  return !!skin.free || isThemeOwned(skin.requiredTheme, ownedCosmeticIds);
}

export function getProfileBlockDefinition(type) {
  return PROFILE_BLOCK_DEFINITIONS.find((block) => block.type === type) || null;
}

export function isProfileBlockUnlocked(type, ownedCosmeticIds = new Set()) {
  const block = getProfileBlockDefinition(type);
  return !!block?.free || !!block?.cosmeticId && ownedCosmeticIds.has(block.cosmeticId);
}

export function coerceProfilePersonalizationForInventory(raw = {}, ownedCosmeticIds = new Set()) {
  const prefs = normalizeProfilePersonalization(raw);
  return {
    ...prefs,
    skin: isProfileSkinUnlocked(prefs.skin, ownedCosmeticIds) ? prefs.skin : 'arena',
  };
}

export function buildProfileStyleVars(raw = {}) {
  const prefs = normalizeProfilePersonalization(raw);
  const skin = getProfileSkin(prefs.skin);
  const rgb = hexToRgb(skin.accent) || { r: 77, g: 163, b: 255 };

  return {
    '--profile-accent': skin.accent,
    '--profile-accent-soft': `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.08)`,
    '--profile-accent-wash': `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.16)`,
    '--accent': skin.accent,
    '--accent-bright': skin.accent,
    '--accent-glow': `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.15)`,
    '--accent-border': `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.36)`,
  };
}
