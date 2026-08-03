import { DAY } from '../constants.js';

export const TRAJECTORY_THREAD_STATE = Object.freeze({
  completed: 'completed',
  continuing: 'continuing',
  paused: 'paused',
  changed: 'changed',
  inactive: 'inactive',
});

function normalizeProjectMap(projectsById) {
  if (projectsById instanceof Map) return projectsById;
  return new Map(Object.entries(projectsById || {}));
}

function explicitState(project, entries, recentStart) {
  const status = String(project?.status || '').toLowerCase();
  if (project?.completedAt || ['complete', 'completed', 'closed', 'archived'].includes(status)) {
    return TRAJECTORY_THREAD_STATE.completed;
  }
  if (status === 'paused') return TRAJECTORY_THREAD_STATE.paused;
  if (entries.some((entry) => entry.kind === 'goal' && entry.changeState === 'updated')) {
    return TRAJECTORY_THREAD_STATE.changed;
  }
  if (entries.filter((entry) => entry.kind !== 'goal').length >= 2) {
    return TRAJECTORY_THREAD_STATE.continuing;
  }
  if (entries.some((entry) => Number(entry.occurredIGT) >= recentStart)) {
    return TRAJECTORY_THREAD_STATE.continuing;
  }
  return TRAJECTORY_THREAD_STATE.inactive;
}

function explicitCommitments(openTodos = []) {
  return openTodos
    .filter((entry) => entry?.id && entry?.label && entry?.dueAt && entry?.explicitCommitment !== false)
    .map((entry) => ({
      type: String(entry.type || 'todo'),
      id: String(entry.id),
      label: String(entry.label),
      dueAt: String(entry.dueAt),
      projectId: entry.projectId ? String(entry.projectId) : null,
      projectLabel: entry.projectLabel ? String(entry.projectLabel) : null,
      explicitCommitment: true,
    }))
    .sort((left, right) => left.dueAt.localeCompare(right.dueAt) || left.id.localeCompare(right.id));
}

function compareThread(left, right) {
  const weight = { continuing: 0, changed: 1, paused: 2, completed: 3, inactive: 4 };
  return (weight[left.state] - weight[right.state])
    || (right.encounterCount - left.encounterCount)
    || (right.evidenceCount - left.evidenceCount)
    || (right.latestIGT - left.latestIGT)
    || left.projectId.localeCompare(right.projectId);
}

export function buildTrajectory({
  facts = [],
  projectsById = new Map(),
  openTodos = [],
  rankChanges = [],
  viewerIGT = 0,
  recentWindow = 7 * DAY,
} = {}) {
  const projects = normalizeProjectMap(projectsById);
  const cursor = Math.max(0, Number(viewerIGT) || 0);
  const recentStart = Math.max(0, cursor - Math.max(0, Number(recentWindow) || 0));
  const byProject = new Map();
  for (const fact of facts) {
    if (!fact?.projectId || Number(fact.occurredIGT) > cursor) continue;
    const projectId = String(fact.projectId);
    if (!byProject.has(projectId)) byProject.set(projectId, []);
    byProject.get(projectId).push(fact);
  }
  const threads = [...byProject.entries()].map(([projectId, sourceEntries]) => {
    const entries = [...sourceEntries].sort((left, right) => (
      Number(right.occurredIGT) - Number(left.occurredIGT)
      || String(left.kind).localeCompare(String(right.kind))
      || String(left.id).localeCompare(String(right.id))
    ));
    const project = projects.get(projectId) || {};
    return Object.freeze({
      projectId,
      label: String(project.name || entries[0]?.projectName || 'Recorded project'),
      state: explicitState(project, entries, recentStart),
      evidenceCount: entries.length,
      encounterCount: new Set(entries.map((entry) => entry.encounterId).filter(Boolean)).size,
      latestIGT: Math.max(...entries.map((entry) => Math.max(0, Number(entry.occurredIGT) || 0))),
      entries: Object.freeze(entries.slice(0, 3)),
    });
  }).sort(compareThread).slice(0, 5);

  return Object.freeze({
    threads: Object.freeze(threads),
    strongestThread: threads.find((thread) => thread.state !== TRAJECTORY_THREAD_STATE.completed) || threads[0] || null,
    next: Object.freeze(explicitCommitments(openTodos).slice(0, 3)),
    rankChanges: Object.freeze([...rankChanges]
      .filter((entry) => Number(entry?.occurredIGT) <= cursor)
      .sort((left, right) => Number(right.occurredIGT) - Number(left.occurredIGT))
      .slice(0, 3)),
  });
}

export default buildTrajectory;
