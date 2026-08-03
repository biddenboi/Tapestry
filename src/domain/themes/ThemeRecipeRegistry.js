export const THEME_RECIPE_VERSION = 1;

const recipe = (id, definition) => Object.freeze({
  id,
  recipeVersion: THEME_RECIPE_VERSION,
  supportsReducedMotion: true,
  contrastProfile: 'standard',
  ...definition,
});

export const THEME_RECIPE_REGISTRY = Object.freeze([
  recipe('minimalist', {
    iconPack: 'line',
    illustrationPack: 'none',
    navigationRecipe: 'precision-rail',
    surfaceRecipe: 'flat-rule',
    typographyRecipe: 'system-compact',
    worldRecipe: 'coordinate-grid',
    achievementRecipe: 'monochrome-seal',
    microcopyTone: 'direct',
  }),
  recipe('obsidian', {
    iconPack: 'linked-nodes',
    illustrationPack: 'graph',
    navigationRecipe: 'docked-tabs',
    surfaceRecipe: 'linked-panes',
    typographyRecipe: 'knowledge-workspace',
    worldRecipe: 'knowledge-graph',
    achievementRecipe: 'linked-sigil',
    microcopyTone: 'notational',
  }),
  recipe('old_windows', {
    iconPack: 'retro-bitmap',
    illustrationPack: 'desktop-dialogs',
    navigationRecipe: 'menu-bar',
    surfaceRecipe: 'beveled-window',
    typographyRecipe: 'system-retro',
    worldRecipe: 'desktop-map',
    achievementRecipe: 'system-certificate',
    microcopyTone: 'system',
    contrastProfile: 'high',
  }),
  recipe('kawaii', {
    iconPack: 'sticker',
    illustrationPack: 'companions',
    navigationRecipe: 'soft-pills',
    surfaceRecipe: 'sticker-stack',
    typographyRecipe: 'rounded-friendly',
    worldRecipe: 'companion-garden',
    achievementRecipe: 'sticker-badge',
    microcopyTone: 'warm',
  }),
  recipe('gamification', {
    iconPack: 'rpg',
    illustrationPack: 'campaign',
    navigationRecipe: 'quest-ribbon',
    surfaceRecipe: 'carved-parchment',
    typographyRecipe: 'heroic',
    worldRecipe: 'campaign-map',
    achievementRecipe: 'ornate-crest',
    microcopyTone: 'heroic-clear',
    contrastProfile: 'high',
  }),
  recipe('pixelated', {
    iconPack: 'sprites',
    illustrationPack: 'pixel-map',
    navigationRecipe: 'pixel-menu',
    surfaceRecipe: 'bitmap-frame',
    typographyRecipe: 'pixel-ui-readable-body',
    worldRecipe: 'tile-map',
    achievementRecipe: 'achievement-sprite',
    microcopyTone: 'compact-game',
    contrastProfile: 'high',
  }),
  recipe('dreamcore', {
    iconPack: 'liminal',
    illustrationPack: 'surreal-landmarks',
    navigationRecipe: 'floating-capsules',
    surfaceRecipe: 'translucent-depth',
    typographyRecipe: 'liminal-editorial',
    worldRecipe: 'memory-landscape',
    achievementRecipe: 'memory-token',
    microcopyTone: 'gentle-direct',
  }),
  recipe('minimalist_light', {
    iconPack: 'line',
    illustrationPack: 'none',
    navigationRecipe: 'daylight-rail',
    surfaceRecipe: 'white-rule',
    typographyRecipe: 'system-airy',
    worldRecipe: 'daylight-grid',
    achievementRecipe: 'quiet-seal',
    microcopyTone: 'direct',
  }),
  recipe('mature_beige', {
    iconPack: 'editorial',
    illustrationPack: 'folio',
    navigationRecipe: 'folio-index',
    surfaceRecipe: 'paper-column',
    typographyRecipe: 'editorial-serif',
    worldRecipe: 'archival-atlas',
    achievementRecipe: 'medallion',
    microcopyTone: 'editorial',
  }),
  recipe('solarpunk', {
    iconPack: 'botanical',
    illustrationPack: 'living-systems',
    navigationRecipe: 'growth-ring',
    surfaceRecipe: 'paper-glass-organic',
    typographyRecipe: 'humanist',
    worldRecipe: 'living-landscape',
    achievementRecipe: 'seed-medallion',
    microcopyTone: 'hopeful-direct',
  }),
  recipe('frutiger_aero', {
    iconPack: 'bubble',
    illustrationPack: 'sky-water',
    navigationRecipe: 'glossy-dock',
    surfaceRecipe: 'aero-glass',
    typographyRecipe: 'consumer-ui',
    worldRecipe: 'eco-aero',
    achievementRecipe: 'glass-orb',
    microcopyTone: 'optimistic',
  }),
  recipe('blueprint', {
    iconPack: 'schematic',
    illustrationPack: 'technical-drawing',
    navigationRecipe: 'drawing-index',
    surfaceRecipe: 'measured-sheet',
    typographyRecipe: 'technical',
    worldRecipe: 'architectural-plan',
    achievementRecipe: 'inspection-stamp',
    microcopyTone: 'precise',
    contrastProfile: 'high',
  }),
  recipe('editorial_noir', {
    iconPack: 'editorial-noir',
    illustrationPack: 'cinematic-frames',
    navigationRecipe: 'asymmetric-index',
    surfaceRecipe: 'ink-spread',
    typographyRecipe: 'magazine-noir',
    worldRecipe: 'cinematic-map',
    achievementRecipe: 'foil-mark',
    microcopyTone: 'concise-editorial',
    contrastProfile: 'high',
  }),
  recipe('northstar', {
    iconPack: 'celestial-line', illustrationPack: 'constellations', navigationRecipe: 'bearing-rail',
    surfaceRecipe: 'starlit-glass', typographyRecipe: 'navigational', worldRecipe: 'celestial-chart',
    achievementRecipe: 'star-seal', microcopyTone: 'assured', contrastProfile: 'high',
  }),
  recipe('atelier', {
    iconPack: 'maker-tools', illustrationPack: 'workbench', navigationRecipe: 'material-index',
    surfaceRecipe: 'canvas-card', typographyRecipe: 'crafted-editorial', worldRecipe: 'studio-table',
    achievementRecipe: 'maker-stamp', microcopyTone: 'practical-warm',
  }),
  recipe('memory_palace', {
    iconPack: 'architectural-memory', illustrationPack: 'archive-rooms', navigationRecipe: 'room-sequence',
    surfaceRecipe: 'archival-glass', typographyRecipe: 'literary-layered', worldRecipe: 'memory-rooms',
    achievementRecipe: 'recollection-gem', microcopyTone: 'reflective-clear',
  }),
  recipe('commons', {
    iconPack: 'civic-rounded', illustrationPack: 'shared-garden', navigationRecipe: 'gathering-ring',
    surfaceRecipe: 'civic-paper', typographyRecipe: 'open-humanist', worldRecipe: 'shared-square',
    achievementRecipe: 'woven-medallion', microcopyTone: 'welcoming-direct',
  }),
]);

export const THEME_RECIPE_BY_ID = new Map(
  THEME_RECIPE_REGISTRY.map((entry) => [entry.id, entry]),
);

export function getThemeRecipe(themeId) {
  return THEME_RECIPE_BY_ID.get(String(themeId))
    || THEME_RECIPE_BY_ID.get('minimalist');
}

export function serializeThemeRecipeManifest(theme) {
  const recipeDefinition = getThemeRecipe(theme.id);
  return {
    themeId: theme.id,
    recipeVersion: recipeDefinition.recipeVersion,
    mode: theme.mode,
    ...recipeDefinition,
  };
}

export async function synchronizeThemeRecipeManifests(adapter, themes) {
  if (!adapter?.executeAtomic) return { synchronized: false, reason: 'sqlite-unavailable' };
  const updatedAt = new Date().toISOString();
  const manifests = themes.map(serializeThemeRecipeManifest);
  await adapter.executeAtomic({
    commandId: `theme-recipes:${THEME_RECIPE_VERSION}:${manifests.map((entry) => entry.themeId).join(',')}`,
    label: 'theme-recipe-manifest-sync',
    statements: manifests.map((manifest) => ({
      sql: `INSERT INTO theme_recipe_manifests(
              theme_id,recipe_version,mode,icon_pack,illustration_pack,navigation_recipe,
              surface_recipe,typography_recipe,world_recipe,achievement_recipe,
              contrast_profile,supports_reduced_motion,manifest_json,updated_at
            ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(theme_id) DO UPDATE SET
              recipe_version=excluded.recipe_version,mode=excluded.mode,
              icon_pack=excluded.icon_pack,illustration_pack=excluded.illustration_pack,
              navigation_recipe=excluded.navigation_recipe,surface_recipe=excluded.surface_recipe,
              typography_recipe=excluded.typography_recipe,world_recipe=excluded.world_recipe,
              achievement_recipe=excluded.achievement_recipe,contrast_profile=excluded.contrast_profile,
              supports_reduced_motion=1,manifest_json=excluded.manifest_json,updated_at=excluded.updated_at`,
      bind: [
        manifest.themeId,
        manifest.recipeVersion,
        manifest.mode,
        manifest.iconPack,
        manifest.illustrationPack,
        manifest.navigationRecipe,
        manifest.surfaceRecipe,
        manifest.typographyRecipe,
        manifest.worldRecipe,
        manifest.achievementRecipe,
        manifest.contrastProfile,
        1,
        JSON.stringify(manifest),
        updatedAt,
      ],
      result: 'changes',
    })),
  });
  return { synchronized: true, count: manifests.length, updatedAt };
}
