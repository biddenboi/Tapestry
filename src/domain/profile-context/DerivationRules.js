import { DAY, HOUR } from '../constants.js';
import { containsProhibitedAutomaticInference } from './Validation.js';

function inWindow(value, start, end) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= start && numeric <= end;
}

function isCompleted(record) {
  return Boolean(record?.completedAt || record?.completedInGameTimestamp != null);
}

export function deriveProfileContextFacts({
  tasks = [],
  todos = [],
  actionSessions = [],
  projects = [],
  viewerIGT = 0,
  now = new Date(),
} = {}) {
  const cursor = Math.max(0, Number(viewerIGT) || 0);
  const nearEnd = cursor + (72 * HOUR);
  const recentStart = Math.max(0, cursor - (7 * DAY));
  const priorStart = Math.max(0, cursor - (28 * DAY));
  const nowMs = (now instanceof Date ? now : new Date(now)).getTime();
  const dueSoon = todos.filter((todo) => !todo.completedAt && (
    inWindow(todo.dueInGameTimestamp, cursor, nearEnd)
    || (() => {
      const due = new Date(todo.dueDate || todo.dueAt || '').getTime();
      return Number.isFinite(due) && due >= nowMs && due <= nowMs + (72 * HOUR);
    })()
  ));
  const recentCompleted = tasks.filter((task) => isCompleted(task)
    && inWindow(task.completedInGameTimestamp ?? task.inGameTimestamp, recentStart, cursor));
  const lastActivityIGT = Math.max(0, ...tasks
    .map((task) => Number(task.completedInGameTimestamp ?? task.inGameTimestamp))
    .filter(Number.isFinite));
  const blockers = actionSessions.filter((session) => session.outcome === 'blocked').filter((session) => {
    const updated = new Date(session.updatedAt || session.endedAt || session.createdAt || '').getTime();
    return Number.isFinite(updated) && updated <= nowMs - (48 * HOUR);
  });
  const projectCounts = (start, end) => tasks.reduce((counts, task) => {
    const igt = Number(task.completedInGameTimestamp ?? task.inGameTimestamp);
    if (!task.projectId || !isCompleted(task) || !inWindow(igt, start, end)) return counts;
    counts.set(String(task.projectId), (counts.get(String(task.projectId)) || 0) + 1);
    return counts;
  }, new Map());
  const recentFocus = projectCounts(recentStart, cursor);
  const priorFocus = projectCounts(priorStart, recentStart);
  const strongest = (counts) => [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] || null;
  const recentStrongest = strongest(recentFocus);
  const priorStrongest = strongest(priorFocus);
  const projectById = new Map(projects.map((project) => [String(project.UUID), project]));
  return Object.freeze({
    deadlineCount72h: dueSoon.length,
    meaningfulCompletionCount7d: recentCompleted.length,
    returnAfterQuiet: lastActivityIGT > 0 && cursor - lastActivityIGT >= (3 * DAY),
    persistentBlockerCount: blockers.length,
    focusShift: recentStrongest && priorStrongest && recentStrongest[0] !== priorStrongest[0]
      ? {
          from: String(projectById.get(priorStrongest[0])?.name || 'an earlier area'),
          to: String(projectById.get(recentStrongest[0])?.name || 'another area'),
          tentative: true,
        }
      : null,
    evidence: Object.freeze({
      dueSoonIds: Object.freeze(dueSoon.map((item) => String(item.UUID || '')).filter(Boolean)),
      completionIds: Object.freeze(recentCompleted.map((item) => String(item.UUID || '')).filter(Boolean)),
      blockerIds: Object.freeze(blockers.map((item) => String(item.UUID || '')).filter(Boolean)),
    }),
  });
}

export function buildContextSuggestions(facts, { existingKeys = new Set(), now = new Date() } = {}) {
  const rows = [];
  const add = (key, type, text, reason, evidence = [], tentative = false) => {
    if (existingKeys.has(key) || containsProhibitedAutomaticInference(text)) return;
    rows.push({ key, type, text, reason, evidence, tentative, createdAt: now.toISOString() });
  };
  if (facts.deadlineCount72h > 0) {
    add(
      `deadline-count:${facts.deadlineCount72h}`,
      'near',
      `${facts.deadlineCount72h} commitment${facts.deadlineCount72h === 1 ? '' : 's'} in the next 72 hours`,
      'Counted from explicit due dates; task titles stay private.',
      facts.evidence.dueSoonIds,
    );
  }
  if (facts.meaningfulCompletionCount7d > 0) {
    add(
      `meaningful-completion:${facts.meaningfulCompletionCount7d}`,
      'recent',
      `Completed ${facts.meaningfulCompletionCount7d} meaningful action${facts.meaningfulCompletionCount7d === 1 ? '' : 's'} this week`,
      'A bounded count of recorded completions.',
      facts.evidence.completionIds,
    );
  }
  if (facts.returnAfterQuiet) {
    add('return-after-quiet', 'recent', 'Returning after a few quiet days', 'At least three IGT days since recorded activity.');
  }
  if (facts.persistentBlockerCount > 0) {
    add(
      `persistent-blocker:${facts.persistentBlockerCount}`,
      'show-up',
      'A practical offer of help could be useful',
      'An explicit blocker has remained recorded for more than 48 hours.',
      facts.evidence.blockerIds,
      true,
    );
  }
  if (facts.focusShift) {
    add(
      `focus-shift:${facts.focusShift.from}:${facts.focusShift.to}`,
      'chapter',
      `Focus may be shifting from ${facts.focusShift.from} toward ${facts.focusShift.to}`,
      'Compared the last 7 days with the preceding 21; phrased tentatively.',
      [],
      true,
    );
  }
  return Object.freeze(rows.slice(0, 3));
}

