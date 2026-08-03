import { getRank } from './Rank.js';

export const RANK_FRAME_TREATMENTS = Object.freeze({
  Iron: { id: 'iron', label: 'Restrained inset double rule', motif: 'double-rule' },
  Bronze: { id: 'bronze', label: 'Riveted copper corners', motif: 'rivets' },
  Silver: { id: 'silver', label: 'Clean beveled metallic edge', motif: 'bevel' },
  Gold: { id: 'gold', label: 'Engraved gold corner marks', motif: 'engraving' },
  Platinum: { id: 'platinum', label: 'Cyan glass and restrained glow', motif: 'glass' },
  Diamond: { id: 'diamond', label: 'Faceted blue geometry', motif: 'facets' },
  Ascendant: { id: 'ascendant', label: 'Emerald growth glyph', motif: 'growth' },
  Immortal: { id: 'immortal', label: 'Crimson ember edge', motif: 'embers' },
  Radiant: { id: 'radiant', label: 'Gold-white halo', motif: 'halo' },
});

function notchesForSub(sub = '') {
  return ({ I: 1, II: 2, III: 3 })[String(sub).toUpperCase()] || 0;
}

export function getRankFramePresentation({ elo = null, rankGroup = null, rankSub = null } = {}) {
  const rank = rankGroup
    ? { group: String(rankGroup), sub: rankSub || '' }
    : getRank(elo);
  const treatment = RANK_FRAME_TREATMENTS[rank.group] || RANK_FRAME_TREATMENTS.Iron;
  return Object.freeze({
    ...treatment,
    group: rank.group,
    sub: rank.sub || '',
    notches: notchesForSub(rank.sub),
    className: `rank-frame rank-frame--${treatment.id}`,
  });
}

export function rankFrameAttributes(value = {}) {
  const presentation = getRankFramePresentation(value);
  return Object.freeze({
    'data-rank-frame': presentation.id,
    'data-rank-notches': presentation.notches,
    'data-rank-subtier': presentation.sub || undefined,
  });
}
