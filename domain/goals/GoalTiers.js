export const GOAL_TIERS = Object.freeze([
  Object.freeze({ tier: 1, threshold: 0, label: 'Foundation', perks: Object.freeze(['Set the goal banner color']) }),
  Object.freeze({ tier: 2, threshold: 100, label: 'Signal', perks: Object.freeze(['Set a goal banner image']) }),
  Object.freeze({ tier: 3, threshold: 250, label: 'Identity', perks: Object.freeze(['Set the goal primary color']) }),
  Object.freeze({ tier: 4, threshold: 500, label: 'Backdrop', perks: Object.freeze(['Set a goal background image']) }),
  Object.freeze({ tier: 5, threshold: 1000, label: 'Crew Tag', perks: Object.freeze(['Set a 3-character contributor title']) }),
  Object.freeze({ tier: 6, threshold: 1600, label: 'Spotlight', perks: Object.freeze(['Highlight contributor rows']) }),
  Object.freeze({ tier: 7, threshold: 2500, label: 'Mosaic', perks: Object.freeze(['Add a subtle goal card pattern']) }),
  Object.freeze({ tier: 8, threshold: 4000, label: 'Archive', perks: Object.freeze(['Upgrade the goal history treatment']) }),
  Object.freeze({ tier: 9, threshold: 6500, label: 'Paragon', perks: Object.freeze(['Show a prestige tier badge']) }),
  Object.freeze({ tier: 10, threshold: 10000, label: 'Mythic', perks: Object.freeze(['Add a glowing goal identity']) }),
]);

export function getGoalTier(totalContribution = 0) {
  const total = Math.max(0, Number(totalContribution) || 0);
  return [...GOAL_TIERS].reverse().find((tier) => total >= tier.threshold) || GOAL_TIERS[0];
}

export function getGoalTierProgress(totalContribution = 0) {
  const total = Math.max(0, Number(totalContribution) || 0);
  const current = getGoalTier(total);
  const next = GOAL_TIERS.find((tier) => tier.threshold > total) || null;
  const span = Math.max(1, (next?.threshold ?? current.threshold) - current.threshold);
  return Object.freeze({
    total,
    current,
    next,
    progress: next ? Math.max(0, Math.min(100, ((total - current.threshold) / span) * 100)) : 100,
    isMaxTier: !next,
  });
}

export function getUnlockedGoalTierPerks(tierNumber = 1) {
  const tier = Math.max(1, Math.min(GOAL_TIERS.length, Number(tierNumber) || 1));
  return GOAL_TIERS
    .filter((entry) => entry.tier <= tier)
    .flatMap((entry) => entry.perks.map((perk) => ({
      tier: entry.tier,
      tierLabel: entry.label,
      perk,
    })));
}
