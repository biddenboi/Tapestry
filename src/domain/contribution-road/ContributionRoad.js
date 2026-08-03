import { STORES } from '@domain/constants.js';
import {
  CONTRIBUTION_ROAD_CATALOG_VERSION,
  CONTRIBUTION_ROAD_NODES,
  ACHIEVEMENT_PACKS,
  OPENING_TRAIL_STEPS,
  ROAD_CHAPTERS,
  getRoadChapter,
  getRoadNode,
  getAchievementPack,
} from './ContributionRoadCatalog.js';

const chapterCommitQueues = new WeakMap();
const ROAD_STATS_PROJECTION_VERSION = 2;
const DOJO_ADVANCE_REASONS = new Set([
  'dojo-scroll-skip',
  'dojo-fast-scroll-skip',
  'dojo-next-request',
]);

function sameProfile(record, profileId) {
  const owner = record?.parent ?? record?.playerUUID ?? record?.playerId ?? record?.profileId ?? record?.authorUUID ?? record?.ownerUUID;
  return String(owner || '') === String(profileId || '');
}

function uniqueCount(records, keyFor) {
  const values = new Set();
  for (const record of records || []) {
    const key = keyFor(record);
    if (key != null && key !== '') values.add(String(key));
  }
  return values.size;
}

function isComplete(record) {
  return Boolean(
    record?.completedAt
    || ['complete', 'completed', 'done', 'settled'].includes(String(record?.status || record?.outcome || '').toLowerCase()),
  );
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function textLength(record) {
  return String(record?.entry ?? record?.body ?? record?.content ?? record?.text ?? '').trim().length;
}

function dojoAdvanceCount(events, profileId) {
  const decisions = new Map();
  for (const event of events || []) {
    if (!sameProfile(event, profileId) || !event?.decisionUUID) continue;
    const id = String(event.decisionUUID);
    if (!decisions.has(id)) decisions.set(id, { presented: false, visible: false, left: false });
    const decision = decisions.get(id);
    const type = String(event.type || '');
    if (type === 'recommendation_presented') {
      decision.presented = true;
      decision.visible ||= positiveNumber(event.payload?.visibleMs) > 0;
    }
    if (type === 'recommendation_visibility_accumulated') {
      decision.visible ||= positiveNumber(event.payload?.visibleMs) > 0;
    }
    if (type === 'recommendation_skipped') {
      decision.left ||= DOJO_ADVANCE_REASONS.has(String(event.payload?.reason || event.reason || ''));
    }
  }
  return [...decisions.values()].filter((decision) => (
    decision.presented && decision.visible && decision.left
  )).length;
}

function matchIncludesProfile(match, profileId) {
  if (sameProfile(match, profileId)) return true;
  const ids = [
    ...(match?.players || []),
    ...(match?.participants || []),
    ...(match?.teams || []).flatMap((team) => team?.players || team?.participants || []),
  ].map((value) => String(value?.UUID || value?.playerUUID || value || ''));
  return ids.includes(String(profileId));
}

function isPairMatch(match) {
  return Boolean(
    match?.pairMatch
    || match?.mode === 'pair'
    || match?.matchType === 'pair'
    || (Array.isArray(match?.teams) && match.teams.some((team) => (team?.players || team?.participants || []).length >= 2)),
  );
}

export function deriveRoadStats(records = {}, profileId) {
  const tasks = (records.tasks || []).filter((record) => sameProfile(record, profileId));
  const actionSessions = (records.actionSessions || []).filter((record) => sameProfile(record, profileId));
  const rhythmOpportunities = (records.rhythmOpportunities || []).filter((record) => sameProfile(record, profileId));
  const goals = (records.projects || []).filter((record) => sameProfile(record, profileId));
  const milestones = (records.goalMilestones || []).filter((record) => sameProfile(record, profileId));
  const goalUpdates = (records.goalUpdates || []).filter((record) => sameProfile(record, profileId));
  const journals = (records.journals || []).filter((record) => sameProfile(record, profileId));
  const storyEntries = (records.chronicleStoryEntries || []).filter((record) => sameProfile(record, profileId));
  const reactions = (records.chronicleReactions || []).filter((record) => sameProfile(record, profileId));
  const matches = (records.matches || []).filter((record) => matchIncludesProfile(record, profileId));

  const focusFromTasks = tasks.reduce((total, task) => (
    total + (isComplete(task) ? positiveNumber(task.sessionDuration) / 60_000 : 0)
  ), 0);
  const focusFromSessions = actionSessions.reduce((total, session) => {
    if (!isComplete(session) && !session?.settledAt && !session?.finishedAt) return total;
    const milliseconds = positiveNumber(session.productiveMs || session.elapsedMs || session.durationMs);
    const minutes = milliseconds ? milliseconds / 60_000 : positiveNumber(session.productiveMinutes || session.durationMinutes);
    return total + minutes;
  }, 0);
  const substantiveJournals = journals.filter((journal) => (
    !journal.deletedAt
    && !['draft', 'archived'].includes(String(journal.lifecycleState || journal.visibility || '').toLowerCase())
    && (textLength(journal) >= 80 || ['entry', 'essay'].includes(String(journal.entryKind || journal.kind || '').toLowerCase()))
  ));
  const sharedResponses = reactions.filter((reaction) => (
    reaction.journalUUID
    && String(reaction.entryOwnerUUID || reaction.targetProfileUUID || '') !== String(profileId)
    && (textLength(reaction) >= 12 || reaction.meaningful === true || reaction.kind === 'response')
  ));

  return Object.freeze({
    'goal-reviews': goalUpdates.filter((update) => (
      ['review', 'check-in', 'check_in'].includes(String(update.kind || update.type || '').toLowerCase())
      || update.reviewedAt
    )).length,
    'milestones-completed': milestones.filter(isComplete).length,
    'goals-completed': goals.filter((goal) => isComplete(goal) && goal.goalType !== 'area').length,
    'tasks-completed': uniqueCount(tasks.filter(isComplete), (task) => task.sourceTaskUUID || task.todoUUID || task.UUID),
    'focus-minutes': Math.floor(Math.max(focusFromTasks, focusFromSessions)),
    'rhythm-completions': uniqueCount(rhythmOpportunities.filter(isComplete), (record) => record.sourceOpportunityUUID || record.UUID),
    'dojo-advances': dojoAdvanceCount(records.taskRecommendations || [], profileId),
    'substantive-entries': uniqueCount(substantiveJournals, (journal) => journal.UUID),
    'story-additions': uniqueCount(storyEntries, (entry) => `${entry.storyUUID || entry.parent}:${entry.journalUUID || entry.entryUUID || entry.UUID}`),
    'retrospective-actions': uniqueCount([
      ...(records.retrospectiveDialogue || []),
      ...journals.filter((journal) => journal.retrospectiveOf || journal.sourceJournalUUID || journal.kind === 'retrospective'),
    ].filter((record) => sameProfile(record, profileId)), (record) => record.UUID || record.sourceJournalUUID),
    'matches-completed': uniqueCount(matches.filter(isComplete), (match) => match.UUID),
    'pair-matches': uniqueCount(matches.filter((match) => isComplete(match) && isPairMatch(match)), (match) => match.UUID),
    'shared-work-responses': uniqueCount(sharedResponses, (response) => response.UUID),
  });
}

export function getContributionBalances(contributions = [], unlockReceipts = [], profileId = null) {
  const lifetimeContribution = Math.floor((contributions || []).reduce((total, record) => {
    if (profileId != null && !sameProfile(record, profileId)) return total;
    return total + positiveNumber(record?.value);
  }, 0));
  const roadSpending = Math.floor((unlockReceipts || []).reduce((total, receipt) => {
    if (profileId != null && !sameProfile(receipt, profileId)) return total;
    return total + positiveNumber(receipt?.contributionSpent);
  }, 0));
  return Object.freeze({
    lifetimeContribution,
    roadSpending,
    spendableContribution: Math.max(0, lifetimeContribution - roadSpending),
  });
}

function achievementStage(context, achievementId) {
  const direct = Number(context?.achievementStages?.[achievementId]);
  if (Number.isFinite(direct)) return direct;
  const progress = context?.achievementProgress?.find?.((entry) => entry.achievementId === achievementId)?.progress || {};
  return Number(progress.stage || progress.currentStage || progress.value || 0);
}

export function evaluateRoadGate(gate, context = {}) {
  if (!gate) return { passed: true, kind: 'none', current: 1, target: 1 };
  const nested = (gate.gates || []).map((entry) => evaluateRoadGate(entry, context));
  let passed = false;
  let current = 0;
  let target = Number(gate.value ?? gate.count ?? 1);
  switch (gate.kind) {
    case 'achievement':
      current = context.achievements?.has?.(gate.achievementId) ? 1 : 0;
      passed = current === 1;
      break;
    case 'achievement-stage':
      current = achievementStage(context, gate.achievementId);
      passed = current >= target;
      break;
    case 'stat':
      current = Number(context.stats?.[gate.stat] || 0);
      passed = current >= target;
      break;
    case 'contribution':
      current = Number(context.balances?.lifetimeContribution || 0);
      passed = current >= target;
      break;
    case 'node':
      current = context.unlockedNodes?.has?.(gate.nodeId) ? 1 : 0;
      passed = current === 1;
      break;
    case 'chapter':
      current = context.chapterChoices?.has?.(gate.chapterId) ? 1 : 0;
      passed = current === 1;
      break;
    case 'interface-reveal':
      current = context.interfaceReveals?.has?.(Number(gate.step)) ? 1 : 0;
      passed = current === 1;
      break;
    case 'all':
      current = nested.filter((result) => result.passed).length;
      target = nested.length;
      passed = nested.every((result) => result.passed);
      break;
    case 'any':
      current = nested.filter((result) => result.passed).length;
      target = nested.length ? 1 : 0;
      passed = nested.length === 0 || nested.some((result) => result.passed);
      break;
    case 'min':
      current = nested.filter((result) => result.passed).length;
      target = Math.max(0, Number(gate.count) || 0);
      passed = current >= target;
      break;
    default:
      passed = false;
  }
  return Object.freeze({ passed, kind: gate.kind, current, target, gate, alternatives: nested });
}

export function getRoadNodeState(node, context = {}) {
  const gate = evaluateRoadGate(node.gate, context);
  const evidenceKind = ['achievement', 'stat', 'interface-reveal', 'capability', 'secret'].includes(node.kind);
  const classicOwned = node.kind === 'classic-reward' && (node.rewards || []).every((reward) => (
    reward.id === 'minimalist' || context.ownedInventoryIds?.has?.(reward.id)
  ));
  const unlocked = classicOwned || context.unlockedNodes?.has?.(node.id) || node.id === 'trailhead' || (evidenceKind && gate.passed);
  const chapterChoice = context.chapterChoices?.get?.(node.chapterId);
  const selected = chapterChoice?.nodeIds?.includes?.(node.id) || unlocked;
  const excluded = Boolean(node.exclusiveGroup && chapterChoice && !selected);
  const affordable = Number(context.balances?.spendableContribution || 0) >= Number(node.cost || 0);
  let state = 'progressing';
  if (node.visibility === 'hidden' && !gate.passed) state = 'hidden';
  else if (excluded) state = 'excluded';
  else if (unlocked) state = 'claimed';
  else if (gate.passed && affordable) state = 'eligible';
  else if (gate.passed) state = 'affordable';
  else if (context.visibleChapterIds?.has?.(node.chapterId)) state = 'progressing';
  else state = 'silhouetted';
  return Object.freeze({ ...node, state, gateResult: gate, affordable, selected, excluded });
}

function profileRecords(records, profileId) {
  return (records || []).filter((record) => sameProfile(record, profileId));
}

async function readRoadContext(databaseConnection, profileId, { rebuildStats = false } = {}) {
  const [contributions, unlocks, choices, inventories, revealReceipts] = await Promise.all([
    databaseConnection.getPlayerStore(STORES.contribution, profileId),
    databaseConnection.getPlayerStore(STORES.contributionRoadUnlock, profileId),
    databaseConnection.getPlayerStore(STORES.contributionRoadChoice, profileId),
    databaseConnection.getPlayerStore(STORES.inventory, profileId),
    databaseConnection.getPlayerStore(STORES.interfaceRevealReceipt, profileId),
  ]);
  let statsReceipt = await databaseConnection.get(STORES.contributionRoadStat, `road-stats:${profileId}`);
  if (rebuildStats) statsReceipt = await rebuildRoadStats(databaseConnection, profileId);
  if (!statsReceipt) {
    statsReceipt = {
      UUID: `road-stats:${profileId}`,
      parent: profileId,
      catalogVersion: CONTRIBUTION_ROAD_CATALOG_VERSION,
      projectionVersion: ROAD_STATS_PROJECTION_VERSION,
      stats: {},
      status: 'missing',
      sourceCounts: {},
      verifiedAt: null,
    };
  }
  const achievementRepository = databaseConnection.achievementV2;
  const safeAchievementRead = async (method) => {
    if (typeof achievementRepository?.[method] !== 'function') return [];
    try {
      return await achievementRepository[method](profileId);
    } catch {
      return [];
    }
  };
  const [achievementEvidence, achievementProgress, achievementStageReceipts] = await Promise.all([
    safeAchievementRead('getEvidence'),
    safeAchievementRead('getAllProgress'),
    safeAchievementRead('getStageReceipts'),
  ]);
  const balances = getContributionBalances(contributions, unlocks, profileId);
  const chapterChoices = new Map(choices.map((choice) => [choice.chapterId, choice]));
  const unlockedNodes = new Set(unlocks.flatMap((receipt) => receipt.nodeIds || [receipt.nodeId]).filter(Boolean));
  const excludedNodeIds = new Set(unlocks.flatMap((receipt) => receipt.excludedNodeIds || []).filter(Boolean));
  const achievements = new Set(achievementEvidence.map((entry) => entry.achievementId));
  const interfaceReveals = new Set(revealReceipts.filter((receipt) => receipt.revealed).map((receipt) => Number(receipt.step)));
  const ownedInventoryIds = new Set(inventories.flatMap((item) => [item.itemId, item.id, item.name].filter(Boolean).map(String)));
  const achievementStages = Object.fromEntries(achievementStageReceipts.reduce((entries, receipt) => {
    entries.set(receipt.achievementId, Math.max(entries.get(receipt.achievementId) || 0, Number(receipt.stage) || 0));
    return entries;
  }, new Map()));
  const visibleChapterIds = new Set(['trailhead']);
  for (const chapter of ROAD_CHAPTERS) {
    if (balances.lifetimeContribution >= chapter.min || chapterChoices.has(chapter.id)) visibleChapterIds.add(chapter.id);
  }
  return {
    profileId,
    balances,
    stats: statsReceipt?.stats || {},
    statsReceipt,
    achievements,
    interfaceReveals,
    achievementProgress,
    achievementStages,
    unlockedNodes,
    excludedNodeIds,
    chapterChoices,
    visibleChapterIds,
    inventory: inventories,
    ownedInventoryIds,
  };
}

function packParentPassed(node, context) {
  const parents = node.parentIds || [];
  if (!parents.length) return true;
  const claimed = (id) => context.unlockedNodes.has(id) || getRoadNode(id)?.automatic === true;
  return node.parentMode === 'all'
    ? parents.every(claimed)
    : parents.some(claimed);
}

export function getAchievementPackNodeState(node, context = {}) {
  const claimed = node.automatic === true || context.unlockedNodes?.has?.(node.id);
  const conflictClaimed = (node.conflictIds || []).some((id) => context.unlockedNodes?.has?.(id));
  const excluded = !claimed && (context.excludedNodeIds?.has?.(node.id) || conflictClaimed);
  const gateResult = evaluateRoadGate(node.activityGate, context);
  const affordable = Number(context.balances?.spendableContribution || 0) >= Number(node.cost || 0);
  const parentPassed = packParentPassed(node, context);
  let unlockSatisfied = false;
  switch (node.unlockMode) {
    case 'free': unlockSatisfied = true; break;
    case 'earned-only': unlockSatisfied = gateResult.passed; break;
    case 'contribution-only': unlockSatisfied = affordable; break;
    case 'earned-and-contribution': unlockSatisfied = gateResult.passed && affordable; break;
    case 'earned-or-contribution': unlockSatisfied = gateResult.passed || affordable; break;
    default: unlockSatisfied = false;
  }
  const state = claimed
    ? 'claimed'
    : excluded
      ? 'excluded'
      : parentPassed && unlockSatisfied
        ? 'eligible'
        : 'unavailable';
  return Object.freeze({
    ...node,
    state,
    claimed,
    excluded,
    affordable,
    parentPassed,
    gateResult,
  });
}

export function resolveAchievementPackExclusions(packNodes = [], nodeId, claimedNodeIds = new Set()) {
  const byId = new Map(packNodes.map((node) => [node.id, node]));
  const selected = byId.get(nodeId);
  const excluded = new Set((selected?.conflictIds || []).filter((id) => !claimedNodeIds.has(id)));
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of packNodes) {
      if (node.automatic || node.id === nodeId || claimedNodeIds.has(node.id) || excluded.has(node.id)) continue;
      const parents = node.parentIds || [];
      if (!parents.length) continue;
      const unreachable = node.parentMode === 'all'
        ? parents.some((id) => excluded.has(id))
        : parents.every((id) => excluded.has(id));
      if (unreachable) {
        excluded.add(node.id);
        changed = true;
      }
    }
  }
  return Object.freeze([...excluded]);
}

export async function getContributionRoadProgress(databaseConnection, profileId, options = {}) {
  const context = await readRoadContext(databaseConnection, profileId, options);
  const packNodes = CONTRIBUTION_ROAD_NODES
    .filter((node) => node.packId)
    .map((node) => getAchievementPackNodeState(node, context));
  return Object.freeze({
    catalogVersion: CONTRIBUTION_ROAD_CATALOG_VERSION,
    ...context,
    nodes: CONTRIBUTION_ROAD_NODES.map((node) => getRoadNodeState(node, context)),
    packs: ACHIEVEMENT_PACKS.map((pack) => Object.freeze({
      ...pack,
      nodes: packNodes.filter((node) => node.packId === pack.packId),
    })),
  });
}

export async function verifyRoadEvidence(databaseConnection, profileId) {
  const startedAt = performance.now?.() || Date.now();
  const receipt = await databaseConnection.get(STORES.contributionRoadStat, `road-stats:${profileId}`).catch(() => null);
  const projectionCurrent = Number(receipt?.projectionVersion || 0) >= ROAD_STATS_PROJECTION_VERSION;
  const catalogCurrent = Number(receipt?.catalogVersion || 0) >= CONTRIBUTION_ROAD_CATALOG_VERSION;
  const healthy = Boolean(receipt && projectionCurrent && catalogCurrent && receipt.status !== 'inconsistent');
  return Object.freeze({
    healthy,
    status: !receipt ? 'missing' : healthy ? 'healthy' : receipt.status || 'stale',
    projectionVersion: Number(receipt?.projectionVersion || 0),
    expectedProjectionVersion: ROAD_STATS_PROJECTION_VERSION,
    catalogVersion: Number(receipt?.catalogVersion || 0),
    lastVerification: receipt?.verifiedAt || receipt?.rebuiltAt || null,
    sourceCounts: receipt?.sourceCounts || {},
    elapsedMs: Math.max(0, Math.round((performance.now?.() || Date.now()) - startedAt)),
  });
}

function yieldToInteraction() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export async function rebuildRoadStats(databaseConnection, profileId, { onProgress } = {}) {
  const startedAt = performance.now?.() || Date.now();
  const stores = {
    tasks: STORES.task,
    actionSessions: STORES.actionSession,
    rhythmOpportunities: STORES.rhythmOpportunity,
    projects: STORES.project,
    goalMilestones: STORES.goalMilestone,
    goalUpdates: STORES.goalUpdate,
    journals: STORES.journal,
    chronicleStoryEntries: STORES.chronicleStoryEntry,
    chronicleReactions: STORES.chronicleReaction,
    matches: STORES.match,
    taskRecommendations: STORES.recommenderEvent,
  };
  const entries = [];
  const storeEntries = Object.entries(stores);
  for (let index = 0; index < storeEntries.length; index += 1) {
    const [key, store] = storeEntries[index];
    // Matches may record participation inside teams rather than on parent, so that
    // one source still needs a global read. Every other source is profile-scoped.
    const records = key === 'matches'
      ? await databaseConnection.getAll(store).catch(() => [])
      : await databaseConnection.getPlayerStore(store, profileId).catch(() => []);
    entries.push([key, records]);
    onProgress?.({ completed: index + 1, total: storeEntries.length, source: key, scanned: records.length });
    await yieldToInteraction();
  }
  let retrospectiveDialogue = [];
  try {
    const adapter = databaseConnection?.persistenceRuntime?.sqliteStorageAdapter;
    if (typeof adapter?.query === 'function') {
      retrospectiveDialogue = await adapter.query({
        sql: `SELECT id AS UUID,player_id AS playerId,source_journal_id AS sourceJournalId,
                     target_journal_id AS targetJournalId,action,body,created_at AS createdAt
              FROM chronicle_retrospective_dialogue WHERE player_id=?`,
        bind: [profileId],
        result: 'all',
      }) || [];
    }
  } catch {
    retrospectiveDialogue = [];
  }
  const stats = deriveRoadStats({ ...Object.fromEntries(entries), retrospectiveDialogue }, profileId);
  const now = new Date().toISOString();
  const sourceCounts = Object.fromEntries(entries.map(([key, records]) => [key, records.length]));
  sourceCounts.retrospectiveDialogue = retrospectiveDialogue.length;
  const receipt = {
    UUID: `road-stats:${profileId}`,
    parent: profileId,
    catalogVersion: CONTRIBUTION_ROAD_CATALOG_VERSION,
    projectionVersion: ROAD_STATS_PROJECTION_VERSION,
    stats,
    status: 'healthy',
    sourceCounts,
    scannedRecords: Object.values(sourceCounts).reduce((total, value) => total + Number(value || 0), 0),
    rejectedDuplicates: 0,
    verifiedAt: now,
    elapsedMs: Math.max(0, Math.round((performance.now?.() || Date.now()) - startedAt)),
    rebuiltAt: now,
    updatedAt: now,
  };
  await databaseConnection.add(STORES.contributionRoadStat, receipt);
  return receipt;
}

export async function previewRoadChapterCommit(databaseConnection, profileId, chapterId, nodeIds = []) {
  const chapter = getRoadChapter(chapterId);
  if (!chapter || chapter.id === 'trailhead') throw Object.assign(new Error('Choose a selectable Road chapter.'), { code: 'road-chapter-invalid' });
  const selected = [...new Set(nodeIds.map(String))];
  if (selected.length !== 2) throw Object.assign(new Error('Choose exactly two signature paths.'), { code: 'road-choice-count' });
  const context = await readRoadContext(databaseConnection, profileId);
  if (context.chapterChoices.has(chapterId)) throw Object.assign(new Error('This chapter is already permanently committed.'), { code: 'road-chapter-committed' });
  const nodes = selected.map(getRoadNode);
  if (nodes.some((node) => !node || node.chapterId !== chapterId || node.kind !== 'capstone')) {
    throw Object.assign(new Error('Every selection must be a signature path in this chapter.'), { code: 'road-choice-invalid' });
  }
  const gateResults = nodes.map((node) => evaluateRoadGate(node.gate, context));
  if (gateResults.some((result) => !result.passed)) {
    throw Object.assign(new Error('One or more selected paths still has an unmet gate.'), { code: 'road-gate-locked', details: gateResults });
  }
  const contributionCost = chapter.cost * selected.length;
  if (context.balances.spendableContribution < contributionCost) {
    throw Object.assign(new Error(`This commitment needs ${contributionCost} spendable Contribution.`), { code: 'road-balance-insufficient' });
  }
  const excludedNodeIds = CONTRIBUTION_ROAD_NODES
    .filter((node) => node.chapterId === chapterId && node.kind === 'capstone' && !selected.includes(node.id))
    .map((node) => node.id);
  return Object.freeze({ chapter, nodes, selectedNodeIds: selected, excludedNodeIds, contributionCost, context });
}

function serializeChapterCommit(databaseConnection, operation) {
  const previous = chapterCommitQueues.get(databaseConnection) || Promise.resolve();
  const next = previous.catch(() => {}).then(operation);
  const queued = next.catch(() => {}).finally(() => {
    if (chapterCommitQueues.get(databaseConnection) === queued) chapterCommitQueues.delete(databaseConnection);
  });
  chapterCommitQueues.set(databaseConnection, queued);
  return next;
}

export function commitRoadChapter(databaseConnection, profileId, chapterId, nodeIds = []) {
  return serializeChapterCommit(databaseConnection, async () => {
    const preview = await previewRoadChapterCommit(databaseConnection, profileId, chapterId, nodeIds);
    const now = new Date().toISOString();
    const choiceUUID = `road-choice:${profileId}:${chapterId}`;
    const choice = {
      UUID: choiceUUID,
      parent: profileId,
      chapterId,
      nodeIds: preview.selectedNodeIds,
      excludedNodeIds: preview.excludedNodeIds,
      contributionSpent: preview.contributionCost,
      catalogVersion: CONTRIBUTION_ROAD_CATALOG_VERSION,
      committedAt: now,
      createdAt: now,
    };
    const unlock = {
      UUID: `road-unlock:${profileId}:${chapterId}`,
      parent: profileId,
      chapterId,
      nodeIds: preview.selectedNodeIds,
      contributionSpent: preview.contributionCost,
      catalogVersion: CONTRIBUTION_ROAD_CATALOG_VERSION,
      choiceUUID,
      unlockedAt: now,
      createdAt: now,
    };
    const capability = {
      UUID: `road-inventory:${profileId}:${chapterId}:capability`,
      parent: profileId,
      itemId: preview.chapter.capability,
      name: preview.chapter.capability,
      type: 'capability',
      quantity: 1,
      roadChapterId: chapterId,
      roadChoiceUUID: choiceUUID,
      createdAt: now,
    };
    const chapterSeal = {
      UUID: `road-inventory:${profileId}:${chapterId}:seal`,
      parent: profileId,
      itemId: `chapter-seal:${chapterId}`,
      name: `${preview.chapter.label} Seal`,
      type: 'cosmetic_chapter_seal',
      quantity: 1,
      roadChapterId: chapterId,
      roadChoiceUUID: choiceUUID,
      createdAt: now,
    };
    const rewardRecords = preview.nodes.flatMap((node) => node.rewards.map((reward) => ({
      UUID: `road-inventory:${profileId}:${node.id}:${reward.id}`,
      parent: profileId,
      itemId: reward.id,
      name: reward.label,
      type: reward.type,
      quantity: 1,
      roadNodeId: node.id,
      roadChapterId: chapterId,
      roadChoiceUUID: choiceUUID,
      createdAt: now,
    })));
    await databaseConnection.commitAtomicMutation({
      label: `road-chapter-commit:${profileId}:${chapterId}`,
      puts: [
        { store: STORES.contributionRoadChoice, record: choice },
        { store: STORES.contributionRoadUnlock, record: unlock },
        ...[capability, chapterSeal, ...rewardRecords].map((record) => ({ store: STORES.inventory, record })),
      ],
      flush: true,
    });
    return Object.freeze({ choice, unlock, inventory: [capability, chapterSeal, ...rewardRecords] });
  });
}

export async function previewAchievementPackClaim(databaseConnection, profileId, nodeId) {
  const node = getRoadNode(nodeId);
  const pack = node?.packId ? getAchievementPack(node.packId) : null;
  if (!node || !pack) {
    throw Object.assign(new Error('Choose a valid Achievement Pack reward.'), { code: 'achievement-pack-node-invalid' });
  }
  const context = await readRoadContext(databaseConnection, profileId);
  const state = getAchievementPackNodeState(node, context);
  if (state.claimed) throw Object.assign(new Error('This reward is already claimed.'), { code: 'achievement-pack-already-claimed' });
  if (state.excluded) throw Object.assign(new Error('This route was permanently closed by an earlier choice.'), { code: 'achievement-pack-route-closed' });
  if (!state.parentPassed) throw Object.assign(new Error('Claim a connected parent reward first.'), { code: 'achievement-pack-parent-locked' });

  let contributionSpent = 0;
  let unlockMethod = 'free';
  if (node.unlockMode === 'earned-only') {
    if (!state.gateResult.passed) throw Object.assign(new Error('The activity requirement is not complete yet.'), { code: 'achievement-pack-gate-locked' });
    unlockMethod = 'earned';
  } else if (node.unlockMode === 'contribution-only') {
    if (!state.affordable) throw Object.assign(new Error(`This reward needs ${node.cost} spendable Contribution.`), { code: 'achievement-pack-balance-insufficient' });
    contributionSpent = Number(node.cost || 0);
    unlockMethod = 'contribution';
  } else if (node.unlockMode === 'earned-and-contribution') {
    if (!state.gateResult.passed) throw Object.assign(new Error('Complete the activity requirement before claiming this reward.'), { code: 'achievement-pack-gate-locked' });
    if (!state.affordable) throw Object.assign(new Error(`This reward also needs ${node.cost} spendable Contribution.`), { code: 'achievement-pack-balance-insufficient' });
    contributionSpent = Number(node.cost || 0);
    unlockMethod = 'earned-and-contribution';
  } else if (node.unlockMode === 'earned-or-contribution') {
    if (state.gateResult.passed) {
      unlockMethod = 'earned';
    } else {
      if (!state.affordable) throw Object.assign(new Error(`Meet the activity gate or use ${node.cost} Contribution.`), { code: 'achievement-pack-balance-insufficient' });
      contributionSpent = Number(node.cost || 0);
      unlockMethod = 'contribution-bypass';
    }
  }

  const packNodes = pack.nodeIds.map(getRoadNode).filter(Boolean);
  const excludedNodeIds = resolveAchievementPackExclusions(packNodes, node.id, context.unlockedNodes);
  return Object.freeze({
    pack,
    node,
    state,
    context,
    contributionSpent,
    unlockMethod,
    excludedNodeIds,
  });
}

export function claimAchievementPackNode(databaseConnection, profileId, nodeId) {
  return serializeChapterCommit(databaseConnection, async () => {
    const preview = await previewAchievementPackClaim(databaseConnection, profileId, nodeId);
    const now = new Date().toISOString();
    const receipt = {
      UUID: `achievement-pack-claim:${profileId}:${preview.node.id}`,
      parent: profileId,
      packId: preview.pack.packId,
      nodeId: preview.node.id,
      nodeIds: [preview.node.id],
      unlockMethod: preview.unlockMethod,
      contributionSpent: preview.contributionSpent,
      excludedNodeIds: preview.excludedNodeIds,
      catalogVersion: CONTRIBUTION_ROAD_CATALOG_VERSION,
      createdAt: now,
      updatedAt: now,
    };
    const inventory = (preview.node.rewards || []).map((reward) => ({
      UUID: `road-inventory:${profileId}:${preview.node.id}:${reward.id}`,
      parent: profileId,
      itemId: reward.id,
      name: reward.label,
      type: reward.type,
      quantity: 1,
      packId: preview.pack.packId,
      roadNodeId: preview.node.id,
      roadUnlockUUID: receipt.UUID,
      createdAt: now,
    }));
    await databaseConnection.commitAtomicMutation({
      label: `achievement-pack-claim:${profileId}:${preview.node.id}`,
      puts: [
        { store: STORES.contributionRoadUnlock, record: receipt },
        ...inventory.map((record) => ({ store: STORES.inventory, record })),
      ],
      flush: true,
    });
    return Object.freeze({ receipt, inventory });
  });
}

function openingMilestones(records, stats, profileId) {
  const todos = profileRecords(records.todos, profileId);
  const tasks = profileRecords(records.tasks, profileId);
  const sessions = profileRecords(records.actionSessions, profileId);
  const reminders = profileRecords(records.reminders, profileId);
  const rhythms = profileRecords(records.rhythmOpportunities, profileId);
  const goals = profileRecords(records.projects, profileId);
  const milestones = profileRecords(records.goalMilestones, profileId);
  const journals = profileRecords(records.journals, profileId);
  const players = records.players || [];
  const feedViews = profileRecords(records.chronicleFeedViewStates, profileId);
  const localShares = profileRecords(records.chronicleEntryAccess, profileId).filter((record) => (
    record.visibility === 'global' || record.editPolicy === 'any_profile' || record.recipientUUID
  ));
  return [
    todos.length + tasks.length > 0,
    sessions.some((session) => session.outcome || session.settledAt || session.finishedAt) || tasks.some(isComplete),
    stats['tasks-completed'] >= 2 || sessions.some((session) => session.continuitySource || session.resumedAt),
    reminders.length > 0 || todos.filter((todo) => !isComplete(todo)).length >= 3,
    rhythms.some(isComplete),
    goals.some((goal) => goal.finishCondition && (goal.nextAction || goal.currentMilestoneUUID)) || milestones.some(isComplete),
    stats['substantive-entries'] >= 1 || journals.some((journal) => textLength(journal) >= 80),
    uniqueCount(feedViews, (view) => view.journalUUID || view.entryUUID || view.UUID) >= 5 || stats['retrospective-actions'] >= 1,
    players.filter((player) => !player.bannedAt).length >= 2 || localShares.length > 0,
    stats['matches-completed'] >= 1 || stats['dojo-advances'] >= 3,
  ];
}

export async function reconcileOpeningTrail(databaseConnection, profileId, { revealAll = false, imported = false, refreshStats = false } = {}) {
  const previous = await databaseConnection.getPlayerStore(STORES.interfaceRevealReceipt, profileId);
  if (!revealAll && !imported && !refreshStats && previous.length >= OPENING_TRAIL_STEPS.length) {
    const priorByStep = new Map(previous.map((receipt) => [receipt.step, receipt]));
    const completeSteps = OPENING_TRAIL_STEPS.map((step) => priorByStep.get(step.step)).filter(Boolean);
    if (completeSteps.length === OPENING_TRAIL_STEPS.length && completeSteps.every((step) => step.revealed)) {
      return Object.freeze({
        steps: completeSteps,
        revealedCapabilities: new Set(completeSteps.flatMap((step) => step.reveals || [])),
        complete: true,
        revealAll: completeSteps.some((step) => step.revealSource === 'manual-reveal-all'),
      });
    }
  }
  const storeMap = {
    todos: STORES.todo,
    tasks: STORES.task,
    actionSessions: STORES.actionSession,
    reminders: STORES.reminder,
    rhythmOpportunities: STORES.rhythmOpportunity,
    projects: STORES.project,
    goalMilestones: STORES.goalMilestone,
    journals: STORES.journal,
    players: STORES.player,
    chronicleFeedViewStates: STORES.chronicleFeedViewState,
    chronicleEntryAccess: STORES.chronicleEntryAccess,
  };
  const entries = await Promise.all(Object.entries(storeMap).map(async ([key, store]) => [
    key,
    key === 'players'
      ? await databaseConnection.getAll(store).catch(() => [])
      : await databaseConnection.getPlayerStore(store, profileId).catch(() => []),
  ]));
  const records = Object.fromEntries(entries);
  const existingStats = await databaseConnection.get(STORES.contributionRoadStat, `road-stats:${profileId}`).catch(() => null);
  // Ordinary interface reconciliation must stay incremental. A missing
  // projection is represented as empty until migration or the explicit Road
  // repair flow builds it; opening the panel must never trigger a history scan.
  const statsReceipt = refreshStats
    ? await rebuildRoadStats(databaseConnection, profileId)
    : existingStats || {
      UUID: `road-stats:${profileId}`,
      parent: profileId,
      catalogVersion: CONTRIBUTION_ROAD_CATALOG_VERSION,
      projectionVersion: ROAD_STATS_PROJECTION_VERSION,
      stats: {},
      status: 'missing',
      sourceCounts: {},
      verifiedAt: null,
    };
  const milestones = openingMilestones(records, statsReceipt.stats, profileId);
  const substantialImport = imported && (
    statsReceipt.stats['tasks-completed'] >= 25
    || statsReceipt.stats['substantive-entries'] >= 10
    || statsReceipt.stats['matches-completed'] >= 10
    || Object.values(statsReceipt.stats).reduce((sum, value) => sum + Number(value || 0), 0) >= 50
  );
  const all = revealAll || substantialImport;
  const byStep = new Map(previous.map((receipt) => [receipt.step, receipt]));
  let priorRevealed = true;
  const now = new Date().toISOString();
  const puts = [];
  const results = OPENING_TRAIL_STEPS.map((step, index) => {
    const prior = byStep.get(step.step);
    const milestoneSatisfied = all || milestones[index] || prior?.milestoneSatisfied;
    const revealed = all || Boolean(priorRevealed && milestoneSatisfied);
    priorRevealed = revealed;
    const record = {
      UUID: `interface-reveal:${profileId}:${step.step}`,
      parent: profileId,
      step: step.step,
      milestoneId: step.id,
      milestoneSatisfied: Boolean(milestoneSatisfied),
      revealed,
      reveals: step.reveals,
      revealSource: revealAll ? 'manual-reveal-all' : substantialImport ? 'import-inference' : prior?.revealSource || 'authoritative-records',
      catalogVersion: CONTRIBUTION_ROAD_CATALOG_VERSION,
      satisfiedAt: milestoneSatisfied ? prior?.satisfiedAt || now : null,
      revealedAt: revealed ? prior?.revealedAt || now : null,
      updatedAt: now,
    };
    if (JSON.stringify(prior || null) !== JSON.stringify(record)) puts.push({ store: STORES.interfaceRevealReceipt, record });
    return record;
  });
  if (puts.length) await databaseConnection.commitAtomicMutation({ label: `opening-trail:${profileId}`, puts });
  return Object.freeze({
    steps: results,
    revealedCapabilities: new Set(results.filter((step) => step.revealed).flatMap((step) => step.reveals)),
    complete: results.every((step) => step.revealed),
    revealAll: all,
  });
}
