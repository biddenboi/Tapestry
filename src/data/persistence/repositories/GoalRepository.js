import { v4 as uuid } from 'uuid';
import { STORES } from '@domain/constants.js';
import { getCurrentIGT } from '@domain/time/Time.js';
import { saveTaskCommand } from '@domain/tasks/TaskCommands.js';
import { getGoalTierProgress } from '@domain/goals/GoalTiers.js';
import { recordGoalUpdateCommand } from '@domain/goals/GoalUpdateCommands.js';
import {
  isVisibleAtIGT,
  normalizeGoal,
  normalizeGoalArea,
  normalizeGoalMilestone,
} from '@domain/goals/GoalModel.js';
import { buildGoalProgress } from '@domain/goals/GoalProgress.js';
import { buildGoalAttention } from '@domain/goals/GoalAttention.js';
import { buildGoalTimeline } from '@domain/goals/GoalTimeline.js';
import { buildGoalTransition } from '@domain/goals/GoalTransitions.js';
import { recordActionContribution } from '@domain/contribution/Contribution.js';
import {
  DEFAULT_WORKSPACE_ID,
  isPlanningRecordInWorkspace,
  withWorkspacePlanningScope,
} from '@domain/planning/WorkspacePlanningScope.js';
import {
  ACHIEVEMENT_EVENT_TYPE,
  createAchievementEvent,
  queueAchievementEvent,
} from '@domain/achievements/AchievementProcessing.js';
import DomainRepository from './DomainRepository.js';

const dateValue = (record) => (
  record?.createdAt
  || record?.completedAt
  || record?.updatedAt
  || ''
);

const currentFocusKey = (playerUUID) => `goals.currentFocus:${playerUUID}`;

function goalIdOf(record) {
  return String(record?.goalUUID || record?.projectId || '');
}

function visibleMilestone(milestone, viewerIGT) {
  if (!isVisibleAtIGT(milestone, viewerIGT)) return null;
  const completionIGT = Number(milestone.completedInGameTimestamp);
  if (milestone.status === 'completed'
      && Number.isFinite(Number(viewerIGT))
      && Number.isFinite(completionIGT)
      && completionIGT > Number(viewerIGT)) {
    return {
      ...milestone,
      status: milestone.previousStatus || 'active',
      completedAt: null,
      completedInGameTimestamp: null,
    };
  }
  return milestone;
}

function makeOwnerParticipant(goal, now, inGameTimestamp) {
  return {
    UUID: `goal-participant:${goal.UUID}:${goal.parent}`,
    goalUUID: goal.UUID,
    playerUUID: goal.parent,
    parent: goal.parent,
    role: 'owner',
    joinedAt: goal.createdAt || now,
    createdAt: goal.createdAt || now,
    inGameTimestamp,
  };
}

function contributionTotals(contributions, goalUUID, playerUUID, nowMs) {
  let total = 0;
  let mine = 0;
  let recent = 0;
  let lastAt = null;
  for (const entry of contributions) {
    if (goalIdOf(entry) !== String(goalUUID)) continue;
    const value = Number(entry.value) || 0;
    total += value;
    if (String(entry.parent) === String(playerUUID)) mine += value;
    const at = new Date(dateValue(entry)).getTime();
    if (Number.isFinite(at)) {
      if (nowMs - at <= 7 * 24 * 60 * 60 * 1000) recent += value;
      if (!lastAt || at > new Date(lastAt).getTime()) lastAt = dateValue(entry);
    }
  }
  return { total, mine, recent, lastAt };
}

export class GoalRepository extends DomainRepository {
  constructor(connection) {
    super(connection, {
      domain: 'goals',
      domains: ['goals', 'competitiveArenas'],
      stores: [
        STORES.project,
        STORES.goalArea,
        STORES.goalMilestone,
        STORES.goalUpdate,
        STORES.goalLink,
        STORES.goalParticipant,
        STORES.contribution,
        STORES.appSetting,
      ],
    });
  }

  async ensureLegacyMigration(playerUUID, viewerIGT = Infinity) {
    await this.ensureLoaded();
    const rawGoals = await this.connection.getPlayerStore(STORES.project, playerUUID);
    const participants = await this.connection.getAll(STORES.goalParticipant);
    const existingOwnerKeys = new Set(participants.map((entry) => (
      `${entry.goalUUID}:${entry.playerUUID}`
    )));
    const puts = [];
    const now = new Date().toISOString();
    for (const raw of rawGoals.filter((goal) => isVisibleAtIGT(goal, viewerIGT))) {
      const goal = normalizeGoal(raw, { playerUUID, now });
      if (JSON.stringify(goal) !== JSON.stringify(raw)) {
        puts.push({ store: STORES.project, record: goal });
      }
      const ownerKey = `${goal.UUID}:${goal.parent}`;
      if (!existingOwnerKeys.has(ownerKey)) {
        puts.push({
          store: STORES.goalParticipant,
          record: makeOwnerParticipant(goal, now, goal.inGameTimestamp),
        });
      }
    }
    if (puts.length) {
      await this.connection.commitAtomicMutation({
        label: 'goal-schema-30-legacy-migration',
        puts,
      });
    }
    return rawGoals.length;
  }

  async ensureWorkspaceLegacyMigration(viewerIGT = Infinity, workspaceId = DEFAULT_WORKSPACE_ID) {
    await this.ensureLoaded();
    const [rawGoals, rawAreas, rawMilestones, rawLinks, participants] = await Promise.all([
      this.connection.getAll(STORES.project),
      this.connection.getAll(STORES.goalArea),
      this.connection.getAll(STORES.goalMilestone),
      this.connection.getAll(STORES.goalLink),
      this.connection.getAll(STORES.goalParticipant),
    ]);
    const existingOwnerKeys = new Set(participants.map((entry) => (
      `${entry.goalUUID}:${entry.playerUUID}`
    )));
    const puts = [];
    const now = new Date().toISOString();
    for (const raw of rawGoals.filter((goal) => (
      isPlanningRecordInWorkspace(goal, workspaceId) && isVisibleAtIGT(goal, viewerIGT)
    ))) {
      const goal = withWorkspacePlanningScope(normalizeGoal(raw, {
        playerUUID: raw.parent,
        now,
      }), { workspaceId, createdByPlayerId: raw.parent });
      if (JSON.stringify(goal) !== JSON.stringify(raw)) {
        puts.push({ store: STORES.project, record: goal });
      }
      const ownerKey = `${goal.UUID}:${goal.parent}`;
      if (!existingOwnerKeys.has(ownerKey)) {
        puts.push({
          store: STORES.goalParticipant,
          record: makeOwnerParticipant(goal, now, goal.inGameTimestamp),
        });
      }
    }
    for (const [store, records] of [
      [STORES.goalArea, rawAreas],
      [STORES.goalMilestone, rawMilestones],
      [STORES.goalLink, rawLinks],
    ]) {
      for (const raw of records.filter((record) => isPlanningRecordInWorkspace(record, workspaceId))) {
        const scoped = withWorkspacePlanningScope(raw, {
          workspaceId,
          createdByPlayerId: raw.parent,
        });
        if (JSON.stringify(scoped) !== JSON.stringify(raw)) puts.push({ store, record: scoped });
      }
    }
    if (puts.length) {
      await this.connection.commitAtomicMutation({
        label: 'workspace-goal-scope-compatibility',
        puts,
      });
    }
    return rawGoals.length;
  }

  async getOverview(playerUUID, viewerIGT = Infinity, {
    now = new Date(),
    scope = 'player',
    workspaceId = DEFAULT_WORKSPACE_ID,
  } = {}) {
    const workspaceScoped = scope === 'workspace';
    if (workspaceScoped) await this.ensureWorkspaceLegacyMigration(viewerIGT, workspaceId);
    else await this.ensureLegacyMigration(playerUUID, viewerIGT);
    const scopedRecords = (store) => workspaceScoped
      ? this.connection.getAll(store)
      : this.connection.getPlayerStore(store, playerUUID);
    const [
      rawGoals,
      rawAreas,
      rawMilestones,
      contributions,
      participants,
      focusSetting,
    ] = await Promise.all([
      scopedRecords(STORES.project),
      scopedRecords(STORES.goalArea),
      scopedRecords(STORES.goalMilestone),
      this.connection.getAllThroughIGT(STORES.contribution, viewerIGT),
      this.connection.getAllThroughIGT(STORES.goalParticipant, viewerIGT),
      this.connection.get(STORES.appSetting, currentFocusKey(playerUUID)),
    ]);
    const goals = rawGoals
      .filter((goal) => !workspaceScoped || isPlanningRecordInWorkspace(goal, workspaceId))
      .filter((goal) => isVisibleAtIGT(goal, viewerIGT))
      .map((goal) => normalizeGoal(goal, { playerUUID: goal.parent || playerUUID }));
    const goalIds = new Set(goals.map((goal) => String(goal.UUID)));
    const areas = rawAreas
      .filter((area) => !workspaceScoped || isPlanningRecordInWorkspace(area, workspaceId))
      .filter((area) => isVisibleAtIGT(area, viewerIGT) && !area.archivedAt)
      .map((area) => normalizeGoalArea(area, { playerUUID: area.parent || playerUUID }))
      .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name));
    const milestones = rawMilestones
      .filter((milestone) => goalIds.has(String(milestone.goalUUID)))
      .map((milestone) => visibleMilestone(normalizeGoalMilestone(milestone), viewerIGT))
      .filter(Boolean);
    const areaMap = new Map(areas.map((area) => [String(area.UUID), area]));
    const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
    const cards = goals.map((goal) => {
      const goalMilestones = milestones.filter((entry) => String(entry.goalUUID) === String(goal.UUID));
      const totals = contributionTotals(contributions, goal.UUID, playerUUID, nowMs);
      const goalParticipants = participants.filter((entry) => (
        String(entry.goalUUID) === String(goal.UUID)
        && isVisibleAtIGT(entry, viewerIGT)
      ));
      const attention = buildGoalAttention(goal, {
        milestones: goalMilestones,
        lastLinkedActivityAt: totals.lastAt,
        now,
      });
      return {
        goalUUID: goal.UUID,
        goal,
        name: goal.name,
        finishCondition: goal.finishCondition,
        area: areaMap.get(String(goal.areaUUID)) || null,
        lifecycleStatus: goal.lifecycleStatus,
        healthStatus: goal.healthStatus,
        targetDate: goal.targetDate,
        progress: buildGoalProgress(goal, goalMilestones),
        nextAction: goal.nextAction,
        totalContribution: totals.total,
        currentPlayerContribution: totals.mine,
        recentContribution: totals.recent,
        contributionTier: getGoalTierProgress(totals.total),
        participantCount: goalParticipants.length,
        participants: goalParticipants,
        lastMeaningfulActivityAt: totals.lastAt,
        attention,
      };
    });
    const activeGoals = cards
      .filter((card) => card.lifecycleStatus === 'active')
      .sort((left, right) => left.name.localeCompare(right.name));
    const pausedGoals = cards
      .filter((card) => card.lifecycleStatus === 'paused')
      .sort((left, right) => left.name.localeCompare(right.name));
    const completedGoals = cards
      .filter((card) => ['completed', 'archived'].includes(card.lifecycleStatus))
      .sort((left, right) => String(right.goal.updatedAt).localeCompare(String(left.goal.updatedAt)));
    const focusUUID = focusSetting?.value?.goalUUID || null;
    const currentFocusGoalUUID = activeGoals.some((card) => card.goalUUID === focusUUID)
      ? focusUUID
      : null;
    const recentMilestones = milestones
      .filter((milestone) => milestone.status === 'completed' && milestone.completedAt)
      .sort((left, right) => String(right.completedAt).localeCompare(String(left.completedAt)))
      .slice(0, 8);
    return {
      areas,
      currentFocusGoalUUID,
      activeGoals,
      pausedGoals,
      completedGoals,
      attentionItems: activeGoals.flatMap((card) => card.attention)
        .sort((left, right) => left.priority - right.priority),
      recentMilestones,
      summary: {
        activeCount: activeGoals.length,
        blockedCount: activeGoals.filter((card) => card.healthStatus === 'blocked').length,
        completedThisMonth: recentMilestones.filter((milestone) => {
          const completed = new Date(milestone.completedAt);
          return completed.getMonth() === now.getMonth()
            && completed.getFullYear() === now.getFullYear();
        }).length,
        recentContribution: activeGoals.reduce((sum, card) => sum + card.recentContribution, 0),
      },
    };
  }

  getWorkspaceOverview(playerUUID, viewerIGT = Infinity, options = {}) {
    return this.getOverview(playerUUID, viewerIGT, { ...options, scope: 'workspace' });
  }

  async getGoalDetail(goalUUID, viewerIGT = Infinity) {
    await this.ensureLoaded();
    const rawGoal = await this.connection.get(STORES.project, goalUUID);
    if (!rawGoal || !isVisibleAtIGT(rawGoal, viewerIGT)) return null;
    const goal = normalizeGoal(rawGoal);
    const [
      areas,
      allMilestones,
      allUpdates,
      allLinks,
      allParticipants,
      contributions,
      players,
      todos,
      tasks,
      habits,
      reminders,
      journals,
    ] = await Promise.all([
      this.connection.getAll(STORES.goalArea),
      this.connection.getAll(STORES.goalMilestone),
      this.connection.getAll(STORES.goalUpdate),
      this.connection.getAll(STORES.goalLink),
      this.connection.getAllThroughIGT(STORES.goalParticipant, viewerIGT),
      this.connection.getAllThroughIGT(STORES.contribution, viewerIGT),
      this.connection.getPlayersAtIGT(viewerIGT, { includeArchived: false }),
      this.connection.getAll(STORES.todo),
      this.connection.getAllThroughIGT(STORES.task, viewerIGT),
      this.connection.getAll(STORES.customEvent),
      this.connection.getAll(STORES.reminder),
      this.connection.getAllThroughIGT(STORES.journal, viewerIGT),
    ]);
    const milestones = allMilestones
      .filter((entry) => String(entry.goalUUID) === String(goalUUID))
      .map((entry) => visibleMilestone(normalizeGoalMilestone(entry, {
        progressType: goal.progressType,
      }), viewerIGT))
      .filter(Boolean)
      .sort((left, right) => left.position - right.position || left.title.localeCompare(right.title));
    const updates = allUpdates
      .filter((entry) => String(entry.goalUUID) === String(goalUUID) && isVisibleAtIGT(entry, viewerIGT));
    const links = allLinks
      .filter((entry) => String(entry.goalUUID) === String(goalUUID) && isVisibleAtIGT(entry, viewerIGT));
    const goalContributions = contributions.filter((entry) => goalIdOf(entry) === String(goalUUID));
    const participants = allParticipants.filter((entry) => (
      String(entry.goalUUID) === String(goalUUID) && isVisibleAtIGT(entry, viewerIGT)
    ));
    const linkedIds = new Map(links.map((entry) => [
      `${entry.entityType}:${entry.entityUUID}`,
      entry,
    ]));
    const linkedWork = [
      ...todos.filter((entry) => (
        String(entry.projectId) === String(goalUUID)
        || linkedIds.has(`todo:${entry.UUID}`)
      )).map((entry) => ({ ...entry, entityType: 'todo' })),
      ...tasks.filter((entry) => (
        String(entry.projectId) === String(goalUUID)
        || linkedIds.has(`task:${entry.UUID}`)
      )).map((entry) => ({ ...entry, entityType: 'task' })),
      ...habits.filter((entry) => (
        String(entry.goalUUID || '') === String(goalUUID) || linkedIds.has(`habit:${entry.UUID}`)
      ))
        .map((entry) => ({ ...entry, entityType: 'habit' })),
      ...reminders.filter((entry) => (
        String(entry.goalUUID || '') === String(goalUUID) || linkedIds.has(`reminder:${entry.UUID}`)
      ))
        .map((entry) => ({ ...entry, entityType: 'reminder' })),
      ...journals.filter((entry) => linkedIds.has(`journal:${entry.UUID}`))
        .map((entry) => ({ ...entry, entityType: 'journal' })),
    ];
    return {
      goal,
      area: areas.find((entry) => String(entry.UUID) === String(goal.areaUUID)) || null,
      areas: areas.filter((entry) => !entry.archivedAt),
      milestones,
      updates,
      links,
      participants,
      players,
      contributions: goalContributions,
      linkedWork,
      availableWork: {
        todos: todos.filter((entry) => !entry.completedAt && isPlanningRecordInWorkspace(entry, goal.workspaceId || DEFAULT_WORKSPACE_ID)),
        habits: habits.filter((entry) => !entry.archivedAt && (!entry.ownerUUID || entry.ownerUUID === goal.parent)),
        reminders: reminders.filter((entry) => !entry.completedAt && !entry.dismissedAt && isPlanningRecordInWorkspace(entry, goal.workspaceId || DEFAULT_WORKSPACE_ID)),
        journals: journals.filter((entry) => !entry.parent || entry.parent === goal.parent),
      },
      progress: buildGoalProgress(goal, milestones),
      contributionTier: getGoalTierProgress(
        goalContributions.reduce((sum, entry) => sum + (Number(entry.value) || 0), 0),
      ),
      timeline: buildGoalTimeline({
        goalUUID,
        contributions: goalContributions,
        updates,
        milestones,
        links,
        journals,
        players,
      }),
    };
  }

  async saveArea(area, player, { now = new Date().toISOString() } = {}) {
    const playerUUID = area.parent || player?.UUID;
    if (!playerUUID) throw new Error('An Area requires an owner.');
    const workspaceId = area.workspaceId || DEFAULT_WORKSPACE_ID;
    const existing = (await this.connection.getAll(STORES.goalArea))
      .filter((entry) => isPlanningRecordInWorkspace(entry, workspaceId));
    const normalized = withWorkspacePlanningScope(normalizeGoalArea({
      ...area,
      UUID: area.UUID || uuid(),
      parent: playerUUID,
      updatedAt: now,
    }, {
      now,
      playerUUID,
    }), { workspaceId, createdByPlayerId: area.createdByPlayerId || playerUUID });
    const duplicate = existing.find((entry) => (
      entry.UUID !== normalized.UUID
      && !entry.archivedAt
      && String(entry.name).trim().toLocaleLowerCase() === normalized.name.toLocaleLowerCase()
    ));
    if (duplicate) {
      const error = new Error('An Area with this name already exists.');
      error.code = 'goal-area-name-conflict';
      throw error;
    }
    await this.connection.add(STORES.goalArea, normalized);
    return normalized;
  }

  async saveGoal(goal, player, { now = new Date().toISOString() } = {}) {
    const playerUUID = goal.parent || player?.UUID;
    if (!playerUUID) throw new Error('A Goal requires an owner.');
    const normalized = withWorkspacePlanningScope(normalizeGoal({
      ...goal,
      UUID: goal.UUID || uuid(),
      parent: playerUUID,
      updatedAt: now,
      inGameTimestamp: goal.inGameTimestamp ?? getCurrentIGT(player),
    }, {
      now,
      playerUUID,
    }), {
      workspaceId: goal.workspaceId || DEFAULT_WORKSPACE_ID,
      createdByPlayerId: goal.createdByPlayerId || playerUUID,
    });
    const owner = makeOwnerParticipant(normalized, now, normalized.inGameTimestamp);
    await this.connection.commitAtomicMutation({
      label: 'goal-save',
      puts: [
        { store: STORES.project, record: normalized },
        { store: STORES.goalParticipant, record: owner },
      ],
    });
    return normalized;
  }

  async saveMilestone(goal, milestone, player, { now = new Date().toISOString() } = {}) {
    const existing = milestone.UUID
      ? await this.connection.get(STORES.goalMilestone, milestone.UUID)
      : null;
    const inGameTimestamp = milestone.inGameTimestamp ?? getCurrentIGT(player);
    const normalized = withWorkspacePlanningScope(normalizeGoalMilestone({
      ...milestone,
      UUID: milestone.UUID || uuid(),
      goalUUID: goal.UUID,
      parent: goal.parent,
      updatedAt: now,
      inGameTimestamp,
      previousStatus: existing?.status || milestone.previousStatus || null,
      completedAt: milestone.status === 'completed'
        ? (existing?.completedAt || milestone.completedAt || now)
        : null,
      completedInGameTimestamp: milestone.status === 'completed'
        ? (existing?.completedInGameTimestamp ?? getCurrentIGT(player))
        : null,
    }, {
      now,
      playerUUID: goal.parent,
      progressType: goal.progressType,
    }), {
      workspaceId: goal.workspaceId || DEFAULT_WORKSPACE_ID,
      createdByPlayerId: milestone.createdByPlayerId || player?.UUID || goal.createdByPlayerId || goal.parent,
    });
    const puts = [{ store: STORES.goalMilestone, record: normalized }];
    if (existing && existing.status !== normalized.status) {
      puts.push({
        store: STORES.goalUpdate,
        record: {
          UUID: uuid(),
          parent: player?.UUID || goal.parent,
          goalUUID: goal.UUID,
          kind: 'milestone_change',
          summary: `${normalized.title} moved to ${normalized.status.replaceAll('_', ' ')}.`,
          healthStatusSnapshot: goal.healthStatus,
          lifecycleStatusSnapshot: goal.lifecycleStatus,
          sourceType: 'goal_milestone',
          sourceUUID: `${normalized.UUID}:${normalized.status}:${now}`,
          createdAt: now,
          inGameTimestamp: getCurrentIGT(player),
          workspaceId: goal.workspaceId || DEFAULT_WORKSPACE_ID,
        },
      });
    }
    await this.connection.commitAtomicMutation({ label: 'goal-milestone-save', puts });
    if (normalized.status === 'completed' && existing?.status !== 'completed') {
      await queueAchievementEvent(this.connection, createAchievementEvent({
        type: ACHIEVEMENT_EVENT_TYPE.milestoneCompleted,
        parent: player?.UUID || goal.parent,
        sourceUUID: normalized.UUID,
        occurredAt: normalized.completedAt,
        payload: {
          goalUUID: goal.UUID,
          evidenceSummary: normalized.title,
        },
      }));
    }
    return normalized;
  }

  async reorderMilestone(goalUUID, milestoneUUID, direction) {
    const detail = await this.getGoalDetail(goalUUID);
    if (!detail) return null;
    const index = detail.milestones.findIndex((entry) => entry.UUID === milestoneUUID);
    const otherIndex = direction === 'up' ? index - 1 : index + 1;
    if (index < 0 || otherIndex < 0 || otherIndex >= detail.milestones.length) return null;
    const first = detail.milestones[index];
    const second = detail.milestones[otherIndex];
    const now = new Date().toISOString();
    await this.connection.commitAtomicMutation({
      label: 'goal-milestone-reorder',
      puts: [
        { store: STORES.goalMilestone, record: { ...first, position: second.position, updatedAt: now } },
        { store: STORES.goalMilestone, record: { ...second, position: first.position, updatedAt: now } },
      ],
    });
    return true;
  }

  async postUpdate(goal, player, {
    summary,
    healthStatus = goal.healthStatus,
    blockedReason = goal.blockedReason,
    metricCurrentValue,
    kind = 'manual',
    now = new Date().toISOString(),
    origin = 'desktop',
    enqueueSync = true,
  } = {}) {
    const cleanSummary = String(summary || '').trim().slice(0, 500);
    if (!cleanSummary) throw new Error('A goal update needs a summary.');
    const nextGoal = withWorkspacePlanningScope(normalizeGoal({
      ...goal,
      healthStatus,
      blockedReason: healthStatus === 'blocked' ? blockedReason : null,
      metric: goal.progressType === 'metric' && metricCurrentValue !== undefined
        ? { ...goal.metric, currentValue: Number(metricCurrentValue), updatedAt: now, source: 'manual' }
        : goal.metric,
      updatedAt: now,
    }), {
      workspaceId: goal.workspaceId || DEFAULT_WORKSPACE_ID,
      createdByPlayerId: goal.createdByPlayerId || goal.parent,
    });
    const update = {
      UUID: uuid(),
      parent: player?.UUID || goal.parent,
      goalUUID: goal.UUID,
      kind: goal.progressType === 'metric' && metricCurrentValue !== undefined ? 'metric_change' : kind,
      summary: cleanSummary,
      healthStatusSnapshot: nextGoal.healthStatus,
      lifecycleStatusSnapshot: nextGoal.lifecycleStatus,
      sourceType: 'manual_update',
      sourceUUID: null,
      createdAt: now,
      inGameTimestamp: getCurrentIGT(player),
      workspaceId: nextGoal.workspaceId,
    };
    await recordGoalUpdateCommand(this.connection, { goal: nextGoal, update }, {
      origin,
      enqueueSync,
    });
    return { goal: nextGoal, update };
  }

  async transitionGoal(goal, to, player, { finishConfirmed = false } = {}) {
    const now = new Date().toISOString();
    const inGameTimestamp = getCurrentIGT(player);
    const transition = buildGoalTransition(goal, to, {
      now,
      inGameTimestamp,
      finishConfirmed,
    });
    transition.update.UUID = uuid();
    await this.connection.commitAtomicMutation({
      label: 'goal-lifecycle-transition',
      puts: [
        { store: STORES.project, record: transition.goal },
        { store: STORES.goalUpdate, record: transition.update },
      ],
    });
    if (transition.shouldAwardCompletion && player?.UUID) {
      await recordActionContribution(this.connection, player, {
        source: 'goal-completed',
        sourceUUID: goal.UUID,
        summary: `Completed goal: ${goal.name || 'Goal'}`,
        goalUUID: goal.UUID,
        createdAt: now,
        inGameTimestamp,
      });
      await queueAchievementEvent(this.connection, createAchievementEvent({
        type: ACHIEVEMENT_EVENT_TYPE.goalCompleted,
        parent: player.UUID,
        sourceUUID: goal.UUID,
        occurredAt: now,
        payload: {
          finishCondition: transition.goal.finishCondition,
          evidenceSummary: transition.update.summary,
          worldLandmarkUUID: transition.goal.worldLandmarkUUID || null,
        },
      }));
    }
    if (to !== 'active') await this.clearFocusIfGoal(goal.parent, goal.UUID);
    return transition.goal;
  }

  async saveLink(goal, player, {
    entityType,
    entityUUID,
    relation = 'supports',
    milestoneUUID = null,
    labelSnapshot = null,
  } = {}) {
    if (!entityUUID) throw new Error('Select work to link.');
    const record = {
      UUID: `goal-link:${goal.UUID}:${entityType}:${entityUUID}:${relation}`,
      parent: player?.UUID || goal.parent,
      goalUUID: goal.UUID,
      milestoneUUID,
      entityType,
      entityUUID,
      relation,
      labelSnapshot,
      createdAt: new Date().toISOString(),
      inGameTimestamp: getCurrentIGT(player),
      workspaceId: goal.workspaceId || DEFAULT_WORKSPACE_ID,
      createdByPlayerId: player?.UUID || goal.createdByPlayerId || goal.parent,
    };
    const storeByType = {
      todo: STORES.todo,
      habit: STORES.customEvent,
      reminder: STORES.reminder,
    };
    const entityStore = storeByType[entityType];
    const entity = entityStore ? await this.connection.get(entityStore, entityUUID) : null;
    const existingLinks = await this.connection.getAll(STORES.goalLink);
    const staleLinks = existingLinks.filter((entry) => (
      String(entry.entityType) === String(entityType)
      && String(entry.entityUUID) === String(entityUUID)
      && String(entry.goalUUID) !== String(goal.UUID)
    ));
    const linkedEntity = entity ? {
      ...entity,
      ...(entityType === 'todo' ? { projectId: goal.UUID } : { goalUUID: goal.UUID }),
    } : null;
    if (typeof this.connection.commitAtomicMutation === 'function') {
      await this.connection.commitAtomicMutation({
        label: 'goal-link-save-and-sync',
        puts: [
          { store: STORES.goalLink, record },
          ...(linkedEntity ? [{ store: entityStore, record: linkedEntity }] : []),
        ],
        deletes: staleLinks.map((entry) => ({ store: STORES.goalLink, UUID: entry.UUID })),
      });
    } else {
      await Promise.all(staleLinks.map((entry) => this.connection.remove(STORES.goalLink, entry.UUID)));
      await this.connection.add(STORES.goalLink, record);
      if (linkedEntity) await this.connection.add(entityStore, linkedEntity);
    }
    return record;
  }

  async saveTodoGoalAssociation(todo, player, { origin = 'desktop' } = {}) {
    if (!todo?.UUID) throw new Error('A Todo UUID is required before saving its Goal association.');

    const requestedGoal = todo.projectId
      ? await this.connection.get(STORES.project, todo.projectId)
      : null;
    const todoWorkspaceId = todo.workspaceId || DEFAULT_WORKSPACE_ID;
    const sharesRequestedWorkspace = Boolean(requestedGoal)
      && isPlanningRecordInWorkspace(requestedGoal, todoWorkspaceId);
    const goal = sharesRequestedWorkspace ? requestedGoal : null;
    const normalizedTodo = {
      ...todo,
      projectId: goal?.UUID || null,
      workspaceId: todoWorkspaceId,
      createdByPlayerId: todo.createdByPlayerId || todo.parent || player?.UUID || null,
    };

    const existingLinks = await this.connection.getAll(STORES.goalLink);
    const todoLinks = existingLinks.filter((entry) => (
      String(entry.entityType) === 'todo'
      && String(entry.entityUUID) === String(todo.UUID)
    ));
    const existingTargetLink = goal
      ? todoLinks.find((entry) => (
        String(entry.goalUUID) === String(goal.UUID)
        && String(entry.relation || 'supports') === 'supports'
      ))
      : null;
    const link = goal ? {
      UUID: `goal-link:${goal.UUID}:todo:${todo.UUID}:supports`,
      parent: player?.UUID || goal.parent || todo.parent,
      goalUUID: goal.UUID,
      milestoneUUID: null,
      entityType: 'todo',
      entityUUID: todo.UUID,
      relation: 'supports',
      labelSnapshot: todo.name || existingTargetLink?.labelSnapshot || null,
      createdAt: existingTargetLink?.createdAt || new Date().toISOString(),
      inGameTimestamp: getCurrentIGT(player),
      workspaceId: goal.workspaceId || todoWorkspaceId,
      createdByPlayerId: player?.UUID || goal.createdByPlayerId || goal.parent,
    } : null;
    const staleLinks = todoLinks.filter((entry) => (
      !goal || String(entry.goalUUID) !== String(goal.UUID)
    ));

    if (typeof this.connection.commitAtomicMutation === 'function') {
      await saveTaskCommand(this.connection, normalizedTodo, {
        label: 'todo-goal-association-save',
        origin,
        additionalPuts: link ? [{ store: STORES.goalLink, record: link }] : [],
        additionalDeletes: staleLinks.map((entry) => ({ store: STORES.goalLink, UUID: entry.UUID })),
      });
    } else {
      await Promise.all(staleLinks.map((entry) => this.connection.remove(STORES.goalLink, entry.UUID)));
      await this.connection.add(STORES.todo, normalizedTodo);
      if (link) await this.connection.add(STORES.goalLink, link);
    }

    return normalizedTodo;
  }

  async removeLink(linkUUID) {
    const link = await this.connection.get(STORES.goalLink, linkUUID);
    if (!link) return false;
    const storeByType = {
      todo: STORES.todo,
      habit: STORES.customEvent,
      reminder: STORES.reminder,
    };
    const entityStore = storeByType[link.entityType];
    const entity = entityStore ? await this.connection.get(entityStore, link.entityUUID) : null;
    const linkedToThisGoal = link.entityType === 'todo'
      ? String(entity?.projectId || '') === String(link.goalUUID)
      : String(entity?.goalUUID || '') === String(link.goalUUID);
    const unlinkedEntity = entity && linkedToThisGoal ? {
      ...entity,
      ...(link.entityType === 'todo' ? { projectId: null } : { goalUUID: null }),
    } : null;
    if (typeof this.connection.commitAtomicMutation === 'function') {
      await this.connection.commitAtomicMutation({
        label: 'goal-link-remove-and-sync',
        puts: unlinkedEntity ? [{ store: entityStore, record: unlinkedEntity }] : [],
        deletes: [{ store: STORES.goalLink, UUID: linkUUID }],
      });
      return true;
    }
    if (unlinkedEntity) await this.connection.add(entityStore, unlinkedEntity);
    return this.connection.remove(STORES.goalLink, linkUUID);
  }

  async setCurrentFocus(player, goalUUID) {
    const key = currentFocusKey(player.UUID);
    const record = {
      UUID: key,
      key,
      parent: player.UUID,
      value: goalUUID ? {
        goalUUID,
        setAt: new Date().toISOString(),
        inGameTimestamp: getCurrentIGT(player),
      } : null,
      updatedAt: new Date().toISOString(),
    };
    await this.connection.add(STORES.appSetting, record);
    return record.value;
  }

  async clearFocusIfGoal(playerUUID, goalUUID) {
    const current = await this.connection.get(STORES.appSetting, currentFocusKey(playerUUID));
    if (current?.value?.goalUUID !== goalUUID) return false;
    await this.connection.add(STORES.appSetting, {
      ...current,
      value: null,
      updatedAt: new Date().toISOString(),
    });
    return true;
  }

  async deleteArchivedGoal(goal) {
    if (normalizeGoal(goal).lifecycleStatus !== 'archived') {
      throw new Error('Only archived Goals can be deleted.');
    }
    const [milestones, updates, links, participants, todos] = await Promise.all([
      this.connection.getAll(STORES.goalMilestone),
      this.connection.getAll(STORES.goalUpdate),
      this.connection.getAll(STORES.goalLink),
      this.connection.getAll(STORES.goalParticipant),
      this.connection.getAll(STORES.todo),
    ]);
    const deletes = [
      { store: STORES.project, UUID: goal.UUID },
      ...milestones.filter((entry) => entry.goalUUID === goal.UUID)
        .map((entry) => ({ store: STORES.goalMilestone, UUID: entry.UUID })),
      ...updates.filter((entry) => entry.goalUUID === goal.UUID)
        .map((entry) => ({ store: STORES.goalUpdate, UUID: entry.UUID })),
      ...links.filter((entry) => entry.goalUUID === goal.UUID)
        .map((entry) => ({ store: STORES.goalLink, UUID: entry.UUID })),
      ...participants.filter((entry) => entry.goalUUID === goal.UUID)
        .map((entry) => ({ store: STORES.goalParticipant, UUID: entry.UUID })),
    ];
    const puts = todos.filter((entry) => entry.projectId === goal.UUID)
      .map((entry) => ({ store: STORES.todo, record: { ...entry, projectId: null } }));
    await this.connection.commitAtomicMutation({
      label: 'goal-delete-archived',
      puts,
      deletes,
    });
    await this.clearFocusIfGoal(goal.parent, goal.UUID);
  }
}

export { currentFocusKey };
export default GoalRepository;
