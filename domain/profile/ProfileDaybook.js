import { DAY, HOUR, MINUTE } from '../constants.js';

export const DAYBOOK_PAGE_DEFAULT_DAYS = 5;
export const DAYBOOK_PAGE_MAX_DAYS = 20;

export function daybookDayIndex(inGameTimestamp) {
  return Math.floor(asIGT(inGameTimestamp) / DAY);
}

export function resolveDaybookIGT(entry = {}) {
  const candidates = [
    entry.daybookIGT,
    entry.completedInGameTimestamp,
    entry.result?.inGameTimestamp,
    entry.inGameTimestamp,
  ];
  for (const candidate of candidates) {
    if (candidate == null || candidate === '' || typeof candidate === 'boolean') continue;
    const numeric = Number(candidate);
    if (Number.isFinite(numeric)) return Math.max(0, numeric);
  }
  return null;
}

export function formatDaybookEntryTime(inGameTimestamp) {
  const remainder = asIGT(inGameTimestamp) % DAY;
  const hours = Math.floor(remainder / HOUR);
  const minutes = Math.floor((remainder % HOUR) / MINUTE);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')} IGT`;
}

export function normalizeDaybookEntry(entry = {}) {
  const recordedIGT = resolveDaybookIGT(entry);
  return Object.freeze({
    ...entry,
    // Legacy records without a trustworthy IGT remain accessible at the
    // coordinate origin, but their provenance stays explicit for the UI.
    inGameTimestamp: recordedIGT ?? 0,
    igtProvenance: recordedIGT == null ? 'legacy-origin' : 'recorded',
  });
}

export function buildDaybookChapters(entries, viewerIGT, options = {}) {
  return buildDaybookPage(entries, viewerIGT, options).chapters;
}

export function mergeDaybookPages(current, incoming) {
  if (!current) return incoming || null;
  if (!incoming) return current;
  const byKey = new Map(
    [...current.chapters, ...incoming.chapters].map((chapter) => [chapter.key, chapter]),
  );
  const direction = incoming.sort === 'oldest' ? 1 : -1;
  const chapters = attachDaybookTransitions([...byKey.values()].sort((left, right) => (
    (left.dayIndex - right.dayIndex) * direction
  )));
  return Object.freeze({
    ...incoming,
    chapters: Object.freeze(chapters),
    entries: Object.freeze(chapters.flatMap((chapter) => chapter.entries)),
  });
}

export function buildDaybookPage(entries, viewerIGT, {
  beforeDay = null,
  afterDay = null,
  dayLimit = DAYBOOK_PAGE_DEFAULT_DAYS,
  type = 'all',
  search = '',
  pinnedOnly = false,
  sort = 'newest',
} = {}) {
  const cursor = asIGT(viewerIGT);
  const activeDayIndex = daybookDayIndex(cursor);
  const direction = sort === 'oldest' ? 1 : -1;
  const query = String(search || '').trim().toLowerCase();
  const normalizedBeforeDay = finiteDayCursor(beforeDay);
  const normalizedAfterDay = finiteDayCursor(afterDay);
  const boundedDayLimit = Math.max(
    1,
    Math.min(DAYBOOK_PAGE_MAX_DAYS, Math.floor(Number(dayLimit) || DAYBOOK_PAGE_DEFAULT_DAYS)),
  );
  const byDay = new Map();

  for (const source of Array.isArray(entries) ? entries : []) {
    const entry = normalizeDaybookEntry(source);
    if (entry.inGameTimestamp > cursor) continue;
    if (pinnedOnly && !entry.pinned) continue;
    if (type !== 'all' && daybookEntryKind(entry) !== type) continue;
    if (query && !daybookSearchText(entry).includes(query)) continue;

    const dayIndex = daybookDayIndex(entry.inGameTimestamp);
    if (normalizedBeforeDay != null && dayIndex >= normalizedBeforeDay) continue;
    if (normalizedAfterDay != null && dayIndex <= normalizedAfterDay) continue;
    if (!byDay.has(dayIndex)) byDay.set(dayIndex, []);
    byDay.get(dayIndex).push(entry);
  }

  const orderedDayIndexes = [...byDay.keys()].sort((left, right) => (
    (left - right) * direction
  ));
  const selectedDayIndexes = orderedDayIndexes.slice(0, boundedDayLimit);
  const chapters = attachDaybookTransitions(selectedDayIndexes.map((dayIndex) => {
    const chapterEntries = byDay.get(dayIndex).sort((left, right) => {
      const pinnedDelta = Number(Boolean(right.pinned)) - Number(Boolean(left.pinned));
      if (pinnedDelta) return pinnedDelta;
      const igtDelta = (left.inGameTimestamp - right.inGameTimestamp) * direction;
      if (igtDelta) return igtDelta;
      const wallDelta = String(left.sortAt || left.completedAt || left.createdAt || '')
        .localeCompare(String(right.sortAt || right.completedAt || right.createdAt || '')) * direction;
      return wallDelta || String(left.UUID || '').localeCompare(String(right.UUID || '')) * direction;
    });
    return buildChapter(dayIndex, activeDayIndex, chapterEntries);
  }));
  const hasMore = orderedDayIndexes.length > selectedDayIndexes.length;
  const lastSelectedDay = selectedDayIndexes[selectedDayIndexes.length - 1] ?? null;

  return Object.freeze({
    viewerIGT: cursor,
    activeDayIndex,
    chapters: Object.freeze(chapters),
    entries: Object.freeze(chapters.flatMap((chapter) => chapter.entries)),
    hasMore,
    nextBeforeDay: hasMore && direction === -1 ? lastSelectedDay : null,
    nextAfterDay: hasMore && direction === 1 ? lastSelectedDay : null,
    sort: direction === 1 ? 'oldest' : 'newest',
  });
}

function buildChapter(dayIndex, activeDayIndex, entries) {
  const dojoSessions = new Set();
  const totals = entries.reduce((result, entry) => {
    const kind = daybookEntryKind(entry);
    result.points += finiteNonNegative(entry.points);
    result.activeMs += finiteNonNegative(
      entry.durationMs ?? entry.actualDurationMs ?? entry.actual_duration_ms,
    );
    result.tasks += kind === 'task' ? 1 : 0;
    result.matches += kind === 'match' ? 1 : 0;
    result.contribution += kind === 'contribution'
      ? finiteNonNegative(entry.value ?? entry.contribution)
      : 0;
    if (entry.dojoSessionUUID) dojoSessions.add(entry.dojoSessionUUID);
    return result;
  }, { points: 0, activeMs: 0, tasks: 0, matches: 0, contribution: 0 });
  totals.dojoSessions = dojoSessions.size;
  const explicitRankEntries = entries.filter((entry) => daybookEntryKind(entry) === 'rank');
  const rankSources = explicitRankEntries.length ? explicitRankEntries : entries;
  const rankMovement = rankSources.reduce((sum, entry) => {
    const delta = entry.rankDelta ?? entry.eloDelta ?? entry.result?.eloChange;
    const numeric = Number(delta);
    return Number.isFinite(numeric) ? sum + numeric : sum;
  }, 0);

  const wallTimes = entries
    .map((entry) => wallTimestamp(entry))
    .filter(Boolean)
    .sort();
  const isActiveDay = dayIndex === activeDayIndex;
  return Object.freeze({
    key: `igt-day-${dayIndex}`,
    dayIndex,
    dayNumber: dayIndex + 1,
    label: isActiveDay ? 'Today so far' : `Day ${dayIndex + 1}`,
    status: isActiveDay ? 'active' : 'completed',
    entries: Object.freeze(entries),
    totals: Object.freeze(totals),
    rankMovement,
    wallStartedAt: wallTimes[0] || null,
    wallEndedAt: wallTimes[wallTimes.length - 1] || null,
  });
}

function explicitThreadState(entries, continued) {
  const statuses = entries.map((entry) => String(entry.projectState || '').toLowerCase());
  if (statuses.some((status) => ['complete', 'completed', 'closed', 'archived'].includes(status))) return 'completed';
  if (statuses.includes('paused')) return 'paused';
  return continued ? 'continuing' : 'started';
}

function chapterThreadReferences(chapter, priorProjectIds) {
  const byProject = new Map();
  for (const entry of chapter.entries) {
    if (!entry.projectId) continue;
    const projectId = String(entry.projectId);
    if (!byProject.has(projectId)) byProject.set(projectId, []);
    byProject.get(projectId).push(entry);
  }
  return Object.freeze([...byProject.entries()].map(([projectId, entries]) => Object.freeze({
    projectId,
    label: String(entries.find((entry) => entry.projectName)?.projectName || 'Recorded project'),
    state: explicitThreadState(entries, priorProjectIds.has(projectId)),
    evidenceCount: entries.length,
  })).sort((left, right) => (
    right.evidenceCount - left.evidenceCount || left.projectId.localeCompare(right.projectId)
  )).slice(0, 3));
}

function transitionDelta(chapter, prior) {
  const fields = ['points', 'activeMs', 'tasks', 'matches', 'dojoSessions', 'contribution'];
  const result = Object.fromEntries(fields.map((field) => [
    field,
    Number(chapter.totals[field] || 0) - Number(prior?.totals?.[field] || 0),
  ]));
  result.rank = Number(chapter.rankMovement || 0);
  return Object.freeze(result);
}

export function attachDaybookTransitions(chapters = []) {
  const ascending = [...chapters].sort((left, right) => left.dayIndex - right.dayIndex);
  const enhancedByKey = new Map();
  const previouslySeenProjects = new Set();
  let prior = null;
  for (const chapter of ascending) {
    const threadReferences = chapterThreadReferences(chapter, previouslySeenProjects);
    const enhanced = Object.freeze({
      ...chapter,
      threadReferences,
      deltas: transitionDelta(chapter, prior),
    });
    enhancedByKey.set(chapter.key, enhanced);
    for (const thread of threadReferences) previouslySeenProjects.add(thread.projectId);
    prior = enhanced;
  }
  return chapters.map((chapter) => enhancedByKey.get(chapter.key));
}

function daybookEntryKind(entry) {
  if (entry.type === 'item_use') return 'item';
  if (entry.type === 'money_log' || entry.type === 'transaction') return 'economy';
  return entry.type || entry.kind || 'event';
}

function daybookSearchText(entry) {
  return [
    entry.name,
    entry.title,
    entry.description,
    entry.entry,
    entry.type,
    entry.goalName,
    entry.projectName,
    ...(Array.isArray(entry.tags) ? entry.tags : []),
  ].filter(Boolean).join(' ').toLowerCase();
}

function wallTimestamp(entry) {
  const value = entry.completedAt
    || entry.result?.concludedAt
    || entry.sortAt
    || entry.updatedAt
    || entry.createdAt;
  const parsed = new Date(value || '').getTime();
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function asIGT(value) {
  if (value == null || value === '' || typeof value === 'boolean') return 0;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
}

function finiteDayCursor(value) {
  if (value == null || value === '' || typeof value === 'boolean') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : null;
}

function finiteNonNegative(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
}
