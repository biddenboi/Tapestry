// Compatibility boundary for saves and devices created before these features
// were retired. Completed work keeps its value and timing; only feature data
// and attribution are removed.
const RETIRED_FIELDS = new Set([
  'dojoSessionUUID', 'sourceDojoSessionUUID', 'dojoContribution',
  'dojoMomentum', 'dojoMomentumByPlayer', 'dojoSessions', 'worldLocationId',
  'bestDojoSessionPoints', 'dojoSessionPointsByDay', 'presenceVisibilityPolicy',
  'latitude', 'longitude', 'locationAccuracy', 'locationCapturedAt',
  'location_accuracy', 'location_captured_at',
]);
const RETIRED_AWARDS = new Set(['peace_1', 'peace_2', 'peace_3']);
const RETIRED_EVENT = 'special-dojo-multiplier';

function isRetiredRecord(record) {
  return record?.UUID === RETIRED_EVENT
    || record?.eventUUID === RETIRED_EVENT
    || record?.specialKind === 'dojo_multiplier'
    || record?.type === 'match-dojo-effects'
    || String(record?.UUID || '').startsWith('dojoLeaderboardSnapshot:');
}

function scrub(value) {
  if (Array.isArray(value)) {
    return value.filter((entry) => !RETIRED_AWARDS.has(entry))
      .map(scrub).filter((entry) => entry !== undefined);
  }
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return value;
  if (isRetiredRecord(value)) return undefined;
  const clean = {};
  for (const [key, entry] of Object.entries(value)) {
    if (RETIRED_FIELDS.has(key) || RETIRED_AWARDS.has(key) || RETIRED_AWARDS.has(entry)) continue;
    if (key === 'location' && entry && typeof entry === 'object'
      && ('latitude' in entry || 'longitude' in entry)) continue;
    const next = key === 'source' && entry === 'dojo'
      ? 'manual'
      : key === 'gameState' && entry === 'dojo' ? 'idle'
        : ['audience', 'defaultAudience', 'sourceVisibility'].includes(key) && entry === 'cast' ? 'collaborators'
          : ['audience', 'defaultAudience', 'sourceVisibility'].includes(key) && entry === 'fellows' ? 'private'
            : scrub(entry);
    if (next !== undefined) clean[key] = next;
  }
  return clean;
}

export function sanitizeRetiredFeatureRecord(record) {
  return scrub(record) ?? null;
}

export function sanitizeRetiredFeatureRecords(records = []) {
  return records.map(sanitizeRetiredFeatureRecord).filter(Boolean);
}
