import { COSMETIC_TITLES } from '@domain/constants.js';

export function getCosmeticTitle(titleId = null) {
  if (!titleId || titleId === 'none' || titleId === 'default') return null;
  return COSMETIC_TITLES.find((title) => title.id === titleId) || null;
}

export function getPlayerTitleId(player = null) {
  return player?.activeCosmetics?.title || player?.activeTitle || null;
}

export function getPlayerTitle(player = null) {
  return getCosmeticTitle(getPlayerTitleId(player));
}

export function titleStyleVars(titleOrId = null) {
  const title = typeof titleOrId === 'string' ? getCosmeticTitle(titleOrId) : titleOrId;
  if (!title) return {};
  return {
    '--player-title-color': title.color || '#fbbf24',
    '--player-title-accent': title.accent || title.color || '#fbbf24',
  };
}
