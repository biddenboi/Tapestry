import { DEFAULT_THEME_ID, THEME_REGISTRY, resolveThemeId } from '../themes/ThemeRegistry.js';

export const COSMETIC_CATALOG_VERSION = 1;

export const COSMETIC_EQUIP_SLOT = Object.freeze({
  appTheme: 'appTheme',
  navigationSkin: 'navigationSkin',
  workspaceBackdrop: 'workspaceBackdrop',
  profileTheme: 'profileTheme',
  profileLayout: 'profileLayout',
  profileBackdrop: 'profileBackdrop',
  avatarFrame: 'avatarFrame',
  lobbyCard: 'lobbyCard',
  matchCard: 'matchCard',
  standingsRow: 'standingsRow',
  motionEffect: 'motionEffect',
  title: 'title',
});

export const VISUAL_COSMETIC_SLOTS = Object.freeze([
  COSMETIC_EQUIP_SLOT.navigationSkin,
  COSMETIC_EQUIP_SLOT.workspaceBackdrop,
  COSMETIC_EQUIP_SLOT.profileBackdrop,
  COSMETIC_EQUIP_SLOT.avatarFrame,
  COSMETIC_EQUIP_SLOT.lobbyCard,
  COSMETIC_EQUIP_SLOT.matchCard,
  COSMETIC_EQUIP_SLOT.standingsRow,
  COSMETIC_EQUIP_SLOT.motionEffect,
]);

export const DEFAULT_COSMETIC_EQUIPMENT = Object.freeze({
  appTheme: DEFAULT_THEME_ID,
  navigationSkin: 'default',
  workspaceBackdrop: 'default',
  profileTheme: DEFAULT_THEME_ID,
  profileLayout: 'arena',
  profileBackdrop: 'default',
  avatarFrame: 'default',
  lobbyCard: 'default',
  matchCard: 'default',
  standingsRow: 'default',
  motionEffect: 'default',
  title: null,
});

export const COSMETIC_SLOT_GROUPS = Object.freeze([
  { id: 'app', label: 'App', slots: ['appTheme', 'navigationSkin', 'workspaceBackdrop'] },
  { id: 'profile', label: 'Profile', slots: ['profileTheme', 'profileLayout', 'profileBackdrop'] },
  { id: 'identity', label: 'Identity', slots: ['avatarFrame', 'title'] },
  { id: 'social', label: 'Social', slots: ['lobbyCard'] },
  { id: 'competition', label: 'Competition', slots: ['matchCard', 'standingsRow'] },
  { id: 'effects', label: 'Effects', slots: ['motionEffect'] },
]);

const SURFACE_SETS = Object.freeze([
  { id: 'default', label: 'Standard', description: 'The neutral Tapestry presentation.', accent: '#6f9cff', background: 'linear-gradient(145deg,#12223d,#0b1425)', free: true },
  { id: 'deep-ocean', label: 'Deep Ocean', description: 'Layered navy depth and quiet currents.', accent: '#51c8ff', background: 'linear-gradient(135deg,#0d1b2a,#1b4965)' },
  { id: 'midnight', label: 'Midnight', description: 'Dark violet atmosphere and restrained light.', accent: '#a78bfa', background: 'linear-gradient(135deg,#09090f,#1a1040)' },
  { id: 'crimson-night', label: 'Crimson Night', description: 'Low crimson light with sharp contrast.', accent: '#fb7185', background: 'linear-gradient(135deg,#1a0507,#4d0a10)' },
  { id: 'forest', label: 'Forest', description: 'Deep green layers and botanical calm.', accent: '#54d68b', background: 'linear-gradient(135deg,#0a1a0d,#0d3320)' },
  { id: 'galaxy', label: 'Galaxy', description: 'Blue-violet depth with a luminous center.', accent: '#8b9cff', background: 'linear-gradient(135deg,#060612,#100840 50%,#1a0530)' },
  { id: 'void-ember', label: 'Void Ember', description: 'Warm ember color against a dark field.', accent: '#ff9f43', background: 'linear-gradient(135deg,#1a0800,#2d0e00 50%,#400020)' },
  { id: 'slate', label: 'Slate', description: 'Structured blue slate and technical depth.', accent: '#7eb6ff', background: 'linear-gradient(135deg,#1a1a2e,#16213e 50%,#0f3460)' },
  { id: 'aurora', label: 'Aurora', description: 'Blue-green light moving through a dark sky.', accent: '#45ddb1', background: 'linear-gradient(135deg,#000a10,#002244 50%,#004422)' },
  { id: 'solarpunk', label: 'Solarpunk', description: 'Living geometry, sunlight, and growth.', accent: '#56b978', background: 'linear-gradient(145deg,#123326,#e8dca6)' },
  { id: 'frutiger-aero', label: 'Frutiger Aero', description: 'Sky, water, glass, and optimistic depth.', accent: '#2ca9e8', background: 'linear-gradient(145deg,#0b7fb5,#b8f0ff)' },
  { id: 'blueprint', label: 'Blueprint', description: 'Measured lines and technical construction.', accent: '#59d5ff', background: 'linear-gradient(145deg,#082a4c,#0d5a83)' },
  { id: 'editorial-noir', label: 'Editorial Noir', description: 'Ink, ivory, and decisive red marks.', accent: '#f04c55', background: 'linear-gradient(145deg,#0d0d0d,#342326)' },
  { id: 'northstar', label: 'Northstar', description: 'Celestial navigation and luminous bearings.', accent: '#7dd3fc', background: 'linear-gradient(145deg,#06152f,#122a52)' },
  { id: 'atelier', label: 'Atelier', description: 'Canvas, maker marks, and crafted warmth.', accent: '#d78957', background: 'linear-gradient(145deg,#332116,#d6b58d)' },
  { id: 'memory-palace', label: 'Memory Palace', description: 'Violet archival rooms and recollection.', accent: '#c4a7ff', background: 'linear-gradient(145deg,#151127,#43315f)' },
  { id: 'commons', label: 'Commons', description: 'Open civic color and woven community forms.', accent: '#42c99a', background: 'linear-gradient(145deg,#0d3028,#bce7d1)' },
]);

const PROFILE_LAYOUTS = Object.freeze([
  ['arena', 'Arena', 'Balanced identity and activity layout.'],
  ['nocturne', 'Nocturne Poster', 'Large identity with cinematic negative space.'],
  ['terminal', 'Terminal Log', 'Operational, mono-forward profile layout.'],
  ['zine', 'Zine', 'Expressive editorial stacks and typography.'],
  ['paper', 'Notebook', 'A journal-first written layout.'],
  ['gallery', 'Gallery', 'Portfolio emphasis with balanced highlights.'],
  ['imperial', 'Collector', 'A ceremonial recognition-room layout.'],
  ['crimson', 'Dossier', 'Compact competitive and historical detail.'],
].map(([id, label, description]) => Object.freeze({
  id, version: 1, setId: id, label, description,
  equipSlot: 'profileLayout', supportedSurfaces: ['profile'], assets: {},
  tokens: {}, motion: 'none', reducedMotion: 'none', fallbackId: 'arena', rewardSource: null,
})));

const surfaceDefinitions = SURFACE_SETS.flatMap((set) => (
  VISUAL_COSMETIC_SLOTS.map((equipSlot) => Object.freeze({
    id: set.id,
    version: 1,
    setId: set.id,
    label: set.label,
    description: set.description,
    equipSlot,
    supportedSurfaces: [equipSlot],
    assets: { default: `${set.id}/surface.svg`, compact: `${set.id}/surface.svg`, preview: `${set.id}/surface.svg` },
    tokens: { accent: set.accent, background: set.background },
    motion: equipSlot === 'motionEffect' && set.id !== 'default' ? 'ambient' : 'none',
    reducedMotion: 'static',
    fallbackId: 'default',
    rewardSource: set.free ? 'default' : 'contribution-road',
  }))
));

const appThemes = THEME_REGISTRY.map((theme) => Object.freeze({
  id: theme.id, version: 1, setId: theme.id, label: theme.label,
  description: theme.description, equipSlot: 'appTheme', supportedSurfaces: ['app'], assets: {},
  tokens: { accent: theme.accent }, motion: theme.motionPack, reducedMotion: 'static',
  fallbackId: DEFAULT_THEME_ID, rewardSource: theme.free ? 'default' : 'contribution-road',
}));

const profileThemes = THEME_REGISTRY.map((theme) => Object.freeze({
  id: theme.id, version: 1, setId: theme.id, label: `${theme.label} Profile`,
  description: `${theme.description} Applied only to the profile surface.`, equipSlot: 'profileTheme',
  supportedSurfaces: ['profile'], assets: {}, tokens: { accent: theme.accent }, motion: theme.motionPack,
  reducedMotion: 'static', fallbackId: DEFAULT_THEME_ID, rewardSource: theme.free ? 'default' : 'contribution-road',
}));

export const COSMETIC_DEFINITIONS = Object.freeze([
  ...appThemes,
  ...profileThemes,
  ...PROFILE_LAYOUTS,
  ...surfaceDefinitions,
]);

const definitionsBySlot = new Map();
for (const definition of COSMETIC_DEFINITIONS) {
  if (!definitionsBySlot.has(definition.equipSlot)) definitionsBySlot.set(definition.equipSlot, new Map());
  definitionsBySlot.get(definition.equipSlot).set(definition.id, definition);
}

export function getCosmeticDefinitionsForSlot(slot) {
  return [...(definitionsBySlot.get(String(slot))?.values() || [])];
}

export function getCosmeticDefinition(slot, id) {
  const fallback = DEFAULT_COSMETIC_EQUIPMENT[slot] ?? 'default';
  return definitionsBySlot.get(String(slot))?.get(String(id))
    || definitionsBySlot.get(String(slot))?.get(String(fallback))
    || null;
}

export function normalizeCosmeticEquipment(activeCosmetics = {}, { profileLayout = null } = {}) {
  const source = activeCosmetics || {};
  const legacyTheme = resolveThemeId(source.appTheme || source.theme || DEFAULT_THEME_ID);
  const normalized = {
    ...DEFAULT_COSMETIC_EQUIPMENT,
    ...source,
    appTheme: legacyTheme,
    profileTheme: resolveThemeId(source.profileTheme || legacyTheme),
    profileLayout: String(source.profileLayout || profileLayout || DEFAULT_COSMETIC_EQUIPMENT.profileLayout),
    avatarFrame: source.avatarFrame || source.profileFrame || source.cardFrame || source.frame || 'default',
    lobbyCard: source.lobbyCard || 'default',
    matchCard: source.matchCard || 'default',
    standingsRow: source.standingsRow || 'default',
    navigationSkin: source.navigationSkin || 'default',
    workspaceBackdrop: source.workspaceBackdrop || 'default',
    profileBackdrop: source.profileBackdrop || 'default',
    motionEffect: source.motionEffect || 'default',
    title: source.title || null,
  };
  delete normalized.theme;
  delete normalized.profileFrame;
  delete normalized.cardFrame;
  delete normalized.frame;
  delete normalized.cardBanner;
  delete normalized.lobbyBanner;
  delete normalized.profileBanner;
  return normalized;
}

export function cosmeticPresentationStyle(slot, id) {
  const definition = getCosmeticDefinition(slot, id);
  if (!definition) return {};
  const hostRadius = {
    avatarFrame: '24%',
    lobbyCard: '14px',
    matchCard: '14px',
    standingsRow: '10px',
    navigationSkin: '10px',
    workspaceBackdrop: '0px',
    profileBackdrop: '18px',
    motionEffect: 'inherit',
  }[slot] || '12px';
  return {
    '--cosmetic-accent': definition.tokens?.accent || 'var(--accent)',
    '--cosmetic-background': definition.tokens?.background || 'transparent',
    '--cosmetic-border-radius': hostRadius,
  };
}

export function applyCosmeticEquipmentToElement(element, activeCosmetics = {}) {
  if (!element) return;
  const equipment = normalizeCosmeticEquipment(activeCosmetics);
  const navigation = getCosmeticDefinition('navigationSkin', equipment.navigationSkin);
  const workspace = getCosmeticDefinition('workspaceBackdrop', equipment.workspaceBackdrop);
  const motion = getCosmeticDefinition('motionEffect', equipment.motionEffect);
  element.dataset.navigationSkin = navigation?.id || 'default';
  element.dataset.workspaceBackdrop = workspace?.id || 'default';
  element.dataset.motionEffect = motion?.id || 'default';
  element.style.setProperty('--navigation-cosmetic-accent', navigation?.tokens?.accent || 'var(--accent-bright)');
  element.style.setProperty('--navigation-cosmetic-background', navigation?.tokens?.background || 'var(--surface-card-glass)');
  element.style.setProperty('--workspace-cosmetic-accent', workspace?.tokens?.accent || 'var(--accent-bright)');
  element.style.setProperty(
    '--workspace-cosmetic-background',
    equipment.workspaceBackdrop === 'default'
      ? 'var(--bg-void)'
      : workspace?.tokens?.background || 'var(--bg-void)',
  );
  element.style.setProperty('--motion-cosmetic-accent', motion?.tokens?.accent || 'var(--accent-bright)');
}

export function cosmeticInventoryId(slot, id) {
  return `cosmetic:${slot}:${id}`;
}

export function validateCosmeticCatalog(definitions = COSMETIC_DEFINITIONS) {
  const errors = [];
  const keys = new Set();
  for (const definition of definitions) {
    const key = `${definition.equipSlot}:${definition.id}`;
    if (keys.has(key)) errors.push(`Duplicate cosmetic definition ${key}.`);
    keys.add(key);
    if (!definition.label || !definition.description) errors.push(`Cosmetic ${key} needs copy.`);
    if (!Array.isArray(definition.supportedSurfaces) || !definition.supportedSurfaces.length) errors.push(`Cosmetic ${key} needs a surface.`);
    if (!definition.fallbackId) errors.push(`Cosmetic ${key} needs a fallback.`);
    if (definition.reducedMotion == null) errors.push(`Cosmetic ${key} needs a reduced-motion equivalent.`);
  }
  return Object.freeze({ valid: errors.length === 0, errors });
}

export default COSMETIC_DEFINITIONS;
