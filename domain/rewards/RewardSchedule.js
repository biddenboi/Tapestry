export const DEFAULT_REWARD_BANDS = Object.freeze([
  { id: 'steady', label: 'Steady', rarity: 'common', probability: 0.52, coins: [1, 3], contribution: 1 },
  { id: 'spark', label: 'Spark', rarity: 'uncommon', probability: 0.30, coins: [4, 7], contribution: 2 },
  { id: 'surge', label: 'Surge', rarity: 'rare', probability: 0.13, coins: [8, 13], contribution: 3 },
  { id: 'breakthrough', label: 'Breakthrough', rarity: 'epic', probability: 0.04, coins: [14, 22], contribution: 5 },
  { id: 'legend', label: 'Legend', rarity: 'legendary', probability: 0.01, coins: [28, 44], contribution: 8 },
]);

export const LIGHT_ACTION_REWARD_BANDS = Object.freeze([
  { id: 'quiet', label: 'Quiet', rarity: 'none', probability: 0.18, coins: [0, 0], contribution: 0 },
  { id: 'steady', label: 'Steady', rarity: 'common', probability: 0.46, coins: [1, 2], contribution: 1 },
  { id: 'spark', label: 'Spark', rarity: 'uncommon', probability: 0.24, coins: [3, 5], contribution: 2 },
  { id: 'surge', label: 'Surge', rarity: 'rare', probability: 0.09, coins: [6, 10], contribution: 3 },
  { id: 'breakthrough', label: 'Breakthrough', rarity: 'epic', probability: 0.03, coins: [12, 18], contribution: 5 },
]);

function hashString(value = '') {
  let hash = 2166136261;
  const text = String(value);
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededUnit(seed) {
  return hashString(seed) / 0xffffffff;
}

function bandsForAction(actionType) {
  return actionType === 'journal' || actionType === 'day-boundary'
    ? LIGHT_ACTION_REWARD_BANDS
    : DEFAULT_REWARD_BANDS;
}

export function expectedRewardCoins(actionType = 'task') {
  const bands = bandsForAction(actionType);
  const totalProbability = bands.reduce((sum, band) => sum + Number(band.probability || 0), 0) || 1;
  return bands.reduce((sum, band) => {
    const min = Math.max(0, Number(band.coins?.[0]) || 0);
    const max = Math.max(min, Number(band.coins?.[1]) || min);
    const average = (min + max) / 2;
    return sum + average * (Number(band.probability || 0) / totalProbability);
  }, 0);
}

function pickBand(seed, bands) {
  const total = bands.reduce((sum, band) => sum + Number(band.probability || 0), 0) || 1;
  let roll = seededUnit(seed + ':band') * total;
  for (const band of bands) {
    roll -= Number(band.probability || 0);
    if (roll <= 0) return band;
  }
  return bands[bands.length - 1];
}

function rollIntegerRange(seed, range) {
  const min = Math.max(0, Math.floor(Number(range?.[0]) || 0));
  const max = Math.max(min, Math.floor(Number(range?.[1]) || min));
  if (min === max) return min;
  return min + Math.floor(seededUnit(seed + ':amount') * (max - min + 1));
}

export function buildActionReward({
  actionType = 'task',
  seed = '',
  baseCoins = 0,
  direction = 'positive',
} = {}) {
  const normalizedDirection = direction === 'negative' ? 'negative' : 'positive';
  const bands = bandsForAction(actionType);
  const sourceSeed = [actionType, seed, Math.round(Number(baseCoins || 0))].join(':');
  const band = pickBand(sourceSeed, bands);
  const rawCoins = rollIntegerRange(sourceSeed, band.coins);
  const baseCoinScale = Math.min(2.2, 1 + Math.max(0, Number(baseCoins || 0)) / 90);
  const scaledCoins = normalizedDirection === 'positive' ? Math.round(rawCoins * baseCoinScale) : 0;
  const coins = scaledCoins;
  const magnitude = Math.max(0, Math.floor(Number(band.contribution || 0)));
  const contribution = normalizedDirection === 'negative' ? -magnitude : magnitude;

  return {
    actionType,
    bandId: band.id,
    label: band.label,
    rarity: band.rarity,
    probability: band.probability,
    coins,
    baseCoins: scaledCoins,
    contribution,
    contributionMagnitude: magnitude,
    direction: normalizedDirection,
    reel: buildRewardReel({ band, coins, seed: sourceSeed }),
  };
}

export function buildRewardReel({ band, coins, seed = '' } = {}) {
  const bands = DEFAULT_REWARD_BANDS;
  const resultIndex = 5;
  return Array.from({ length: 11 }, (_, index) => {
    const reelBand = index === resultIndex
      ? band
      : bands[hashString(seed + ':reel:' + index) % bands.length];
    const amount = index === resultIndex
      ? Math.max(0, Math.round(Number(coins || 0)))
      : rollIntegerRange(seed + ':reel-amount:' + index, reelBand.coins);
    return {
      id: reelBand.id + '-' + index,
      label: reelBand.label,
      rarity: reelBand.rarity,
      amount,
      result: index === resultIndex,
    };
  });
}
