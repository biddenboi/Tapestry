function milliseconds(value) {
  const parsed = value instanceof Date ? value.getTime() : new Date(value || '').getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizedInterval(interval, fallbackEnd = null) {
  const startsAt = milliseconds(interval?.startsAt || interval?.appliedAt);
  const endsAt = milliseconds(interval?.endsAt || interval?.expiresAt || fallbackEnd);
  if (startsAt == null || endsAt == null || endsAt <= startsAt) return null;
  return { startsAt, endsAt };
}

function multiplierAt(effects, point) {
  const active = effects.filter((effect) => point >= effect.startsAt && point < effect.endsAt);
  if (!active.length) return 1;
  const multiplying = active.filter(({ stackingRule }) => stackingRule === 'multiply');
  const additive = active.filter(({ stackingRule }) => stackingRule === 'additive');
  const highest = active.filter(({ stackingRule }) => stackingRule === 'highest');
  const product = multiplying.reduce((value, effect) => value * effect.multiplier, 1);
  const addition = additive.reduce((value, effect) => value + (effect.multiplier - 1), 0);
  const maximum = highest.reduce((value, effect) => Math.max(value, effect.multiplier), 1);
  return Math.max(0, product * (1 + addition) * maximum);
}

export function calculateWeightedEffectDuration({
  activityIntervals = [],
  effectIntervals = [],
  startsAt = null,
  endsAt = null,
  maximumActiveMs = Infinity,
} = {}) {
  const boundaryStart = milliseconds(startsAt) ?? -Infinity;
  const boundaryEnd = milliseconds(endsAt) ?? Infinity;
  const activities = (activityIntervals || [])
    .map((interval) => normalizedInterval(interval, endsAt))
    .filter(Boolean)
    .map((interval) => ({
      startsAt: Math.max(interval.startsAt, boundaryStart),
      endsAt: Math.min(interval.endsAt, boundaryEnd),
    }))
    .filter((interval) => interval.endsAt > interval.startsAt)
    .sort((left, right) => left.startsAt - right.startsAt);
  const effects = (effectIntervals || [])
    .map((effect) => {
      const interval = normalizedInterval(effect, endsAt);
      if (!interval) return null;
      return {
        ...interval,
        multiplier: Math.max(0, Number(effect.multiplier ?? effect.multiplierValue) || 1),
        stackingRule: ['multiply', 'additive', 'highest'].includes(effect.stackingRule)
          ? effect.stackingRule
          : 'multiply',
      };
    })
    .filter(Boolean);

  let remaining = Math.max(0, Number(maximumActiveMs));
  if (!Number.isFinite(remaining)) remaining = Infinity;
  let activeMs = 0;
  let weightedActiveMs = 0;
  const segments = [];
  for (const activity of activities) {
    if (remaining <= 0) break;
    const clippedEnd = Math.min(activity.endsAt, activity.startsAt + remaining);
    const boundaries = new Set([activity.startsAt, clippedEnd]);
    for (const effect of effects) {
      if (effect.endsAt <= activity.startsAt || effect.startsAt >= clippedEnd) continue;
      boundaries.add(Math.max(activity.startsAt, effect.startsAt));
      boundaries.add(Math.min(clippedEnd, effect.endsAt));
    }
    const ordered = [...boundaries].sort((left, right) => left - right);
    for (let index = 0; index < ordered.length - 1; index += 1) {
      const segmentStart = ordered[index];
      const segmentEnd = ordered[index + 1];
      const durationMs = segmentEnd - segmentStart;
      if (durationMs <= 0) continue;
      const multiplier = multiplierAt(effects, segmentStart);
      activeMs += durationMs;
      weightedActiveMs += durationMs * multiplier;
      segments.push(Object.freeze({
        startsAt: new Date(segmentStart).toISOString(),
        endsAt: new Date(segmentEnd).toISOString(),
        durationMs,
        multiplier,
      }));
    }
    remaining -= clippedEnd - activity.startsAt;
  }
  return Object.freeze({
    activeMs,
    weightedActiveMs,
    averageMultiplier: activeMs > 0 ? weightedActiveMs / activeMs : 1,
    segments: Object.freeze(segments),
  });
}
