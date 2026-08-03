export const SOCIAL_ACTIVITY_FACT_VERSION = 1;

export const SOCIAL_ACTIVITY_KIND = Object.freeze({
  task: 'task',
  goal: 'goal',
  rank: 'rank',
  match: 'match',
  dojo: 'dojo',
  commitment: 'commitment',
  location: 'location',
});

export const SOCIAL_ACTIVITY_CATEGORY = Object.freeze({
  [SOCIAL_ACTIVITY_KIND.task]: 'Tasks',
  [SOCIAL_ACTIVITY_KIND.goal]: 'Goals',
  [SOCIAL_ACTIVITY_KIND.rank]: 'Rank',
  [SOCIAL_ACTIVITY_KIND.match]: 'Matches',
  [SOCIAL_ACTIVITY_KIND.dojo]: 'Dojo',
  [SOCIAL_ACTIVITY_KIND.commitment]: 'Commitments',
  [SOCIAL_ACTIVITY_KIND.location]: 'Location',
});

const VISIBLE_FIELDS = Object.freeze({
  task: ['id', 'label', 'occurredIGT', 'points', 'durationMs', 'projectId', 'projectName', 'state'],
  goal: ['id', 'label', 'occurredIGT', 'projectId', 'projectName', 'state'],
  rank: ['id', 'label', 'occurredIGT', 'oldElo', 'newElo', 'delta', 'matchId'],
  match: ['id', 'label', 'occurredIGT', 'outcome', 'team1Total', 'team2Total'],
  dojo: ['id', 'label', 'occurredIGT', 'startedIGT', 'endedIGT', 'activeMs', 'state'],
  commitment: ['id', 'label', 'occurredIGT', 'dueAt', 'projectId', 'projectName', 'state'],
  location: ['id', 'label', 'occurredIGT', 'location', 'startedIGT', 'endedIGT', 'activeMs', 'state'],
});

function normalizeScalar(value) {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean' || typeof value === 'string') return value;
  return String(value);
}

export function stableSocialJson(value) {
  const normalize = (input) => {
    if (Array.isArray(input)) return input.map(normalize);
    if (!input || typeof input !== 'object') return normalizeScalar(input);
    return Object.fromEntries(Object.keys(input).sort().map((key) => [key, normalize(input[key])]));
  };
  return JSON.stringify(normalize(value));
}

// FNV-1a 64 is deterministic in every supported browser and avoids coupling
// the synchronous projector to Web Crypto. It is an identity token, not a
// security boundary.
export function stableSocialHash(value) {
  const text = typeof value === 'string' ? value : stableSocialJson(value);
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < text.length; index += 1) {
    const point = text.codePointAt(index);
    hash ^= BigInt(point);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
    if (point > 0xffff) index += 1;
  }
  return hash.toString(16).padStart(16, '0');
}

export function activityKey(kind, id) {
  return `${String(kind || '')}:${String(id || '')}`;
}

export function visibleFieldsForKind(kind, record = {}) {
  const fields = VISIBLE_FIELDS[kind] || ['id', 'label', 'occurredIGT', 'state'];
  return Object.fromEntries(fields.map((field) => [field, normalizeScalar(record[field])]));
}

export function versionToken(kind, record = {}) {
  return `v${SOCIAL_ACTIVITY_FACT_VERSION}:${stableSocialHash({
    schemaVersion: SOCIAL_ACTIVITY_FACT_VERSION,
    kind,
    semanticFields: visibleFieldsForKind(kind, record),
  })}`;
}

export function canonicalizeActivityFact(record = {}) {
  const kind = String(record.kind || record.eventKind || '');
  const id = String(record.id || record.eventId || record.UUID || '');
  const subjectId = String(record.subjectId || record.subjectPlayerId || record.playerId || '');
  if (!Object.values(SOCIAL_ACTIVITY_KIND).includes(kind) || !id || !subjectId) return null;
  const occurredIGT = Math.max(0, Math.trunc(Number(record.occurredIGT) || 0));
  const fact = {
    ...record,
    id,
    key: activityKey(kind, id),
    kind,
    category: SOCIAL_ACTIVITY_CATEGORY[kind],
    subjectId,
    occurredIGT,
    label: String(record.label || 'Recorded activity'),
    projectId: record.projectId ? String(record.projectId) : null,
    projectName: record.projectName ? String(record.projectName) : null,
  };
  fact.versionToken = versionToken(kind, fact);
  return Object.freeze(fact);
}

export default canonicalizeActivityFact;
