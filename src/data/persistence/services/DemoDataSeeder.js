import { ITEM_TYPE, MINUTE, SPECIAL_EVENT_IDS, STORES, THEME_REGISTRY } from '@domain/constants.js';
import { measureDynamicModule, recordStoreHydration } from '@shared/performance/startupPerf.js';
import { calculateItemCost, DEFAULT_SHOP_ITEMS } from '@domain/shop/Shop.js';
import { buildProfileSummaries } from '@domain/profile/ProfileSummary.js';
import { normalizePendingCustomization } from '@data/db/databaseConnectionUtils.js';
import { HYDRATION_DOMAINS } from '@data/db/domainHydration.js';
import { SEMANTIC_LOCATION } from '@domain/social-world/SocialWorldContracts.js';
import { getCurrentIGT } from '@domain/time/Time.js';
import { ACHIEVEMENT_V2_BY_ID } from '@domain/achievements-v2/AchievementCatalogV2.js';
import { synchronizeThemeRecipeManifests } from '@domain/themes/ThemeRecipeRegistry.js';

const loadMaterializedLeaderboardJobs = () => measureDynamicModule(
  'materialized-leaderboard-jobs',
  () => import('@domain/leaderboards/MaterializedLeaderboards.js'),
);

function facadeBackedService(target, facade) {
  return new Proxy(target, {
    get(service, property, receiver) {
      if (Reflect.has(service, property)) return Reflect.get(service, property, receiver);
      const value = Reflect.get(facade, property, facade);
      return typeof value === 'function' ? value.bind(facade) : value;
    },
    set(service, property, value, receiver) {
      if (Reflect.has(service, property)) return Reflect.set(service, property, value, receiver);
      return Reflect.set(facade, property, value, facade);
    },
  });
}

export class DemoDataSeeder {
  constructor(facade) {
    if (!facade) throw new Error('DemoDataSeeder requires a database facade.');
    this.facade = facade;
    return facadeBackedService(this, facade);
  }

  async _resetTypedDemoStore() {
    const adapter = this.persistenceRuntime?.sqliteStorageAdapter;
    if (!adapter) return false;
    this.persistenceRuntime.resetSqliteShadowReadiness();
    await adapter.open({ mode: 'memory' });
    return true;
  }

  async _seedTypedDemoProjections({ baseIGT, now }) {
    const runtime = this.persistenceRuntime;
    const shadow = runtime?.sqliteStorageAdapter?.shadowDomains;
    if (!shadow) return { status: 'unavailable' };

    const records = (store) => this._recordValues(store);
    const players = records(STORES.player);
    const projects = records(STORES.project);
    const todos = records(STORES.todo);
    const tasks = records(STORES.task);
    const reminders = records(STORES.reminder);
    const lateSocialTask = tasks.find((task) => task.UUID === 'demo-rhea-social-update');
    const viewerIGT = baseIGT + (42 * MINUTE);
    const at = (offsetMs = 0) => new Date(now + offsetMs).toISOString();

    await shadow.importers.coreProfiles.import({
      players,
      appState: this._serializeAppState(),
      economyState: this.economyState,
      settings: records(STORES.appSetting),
    });
    await synchronizeThemeRecipeManifests(
      runtime.sqliteStorageAdapter,
      THEME_REGISTRY,
    );
    await this.achievementV2.synchronizeDefinitions();
    const demoAchievementIds = [
      'first_movement',
      'first_record',
      'first_rated_match',
      'wayfinder',
      'looking_back',
      'evidence_trail',
      'balanced_pair',
    ];
    for (const [index, achievementId] of demoAchievementIds.entries()) {
      const definition = ACHIEVEMENT_V2_BY_ID.get(achievementId);
      await this.achievementV2.award({
        profileId: 'demo-player',
        definition,
        sourceEventIds: [`demo-achievement-evidence:${achievementId}`],
        evidenceSnapshot: {
          eventType: `demo-${definition.evidenceRuleId}`,
          sourceUUID: `demo-achievement-evidence:${achievementId}`,
          occurredAt: at((-7 + index) * 60 * 60 * 1000),
          demoCoverage: true,
        },
        earnedAt: at((-7 + index) * 60 * 60 * 1000),
        processorVersion: 2,
        migrationSource: 'demo-seed',
      });
    }
    await this.achievementV2.saveProgress(
      'demo-player',
      ACHIEVEMENT_V2_BY_ID.get('evidence_trail'),
      {
        domains: ['tasks', 'chronicle', 'competition', 'goals'],
        appliedEventIds: demoAchievementIds.map((id) => `demo-achievement-evidence:${id}`),
      },
      at(-20 * 60 * 1000),
    );
    await this.achievementV2.setRecord({
      profileId: 'demo-player',
      recordId: 'longest_focus_session',
      value: { value: 78, taskUUID: 'demo-task-completed-1' },
      achievedAt: at(-26 * 60 * 60 * 1000),
      sourceEventId: 'demo-achievement-evidence:first_movement',
    });
    await this.achievementV2.setRecord({
      profileId: 'demo-player',
      recordId: 'best_rating',
      value: { value: 940, matchUUID: 'demo-match-completed' },
      achievedAt: at(-5 * 60 * 60 * 1000),
      sourceEventId: 'demo-achievement-evidence:first_rated_match',
    });
    for (const [index, legacyKey] of ['grinder_1', 'scorer_1', 'basket_1', 'signature_1'].entries()) {
      await this.persistenceRuntime.sqliteStorageAdapter.query({
        sql: `INSERT INTO achievement_legacy_awards(
                profile_id,legacy_key,title_snapshot,earned_at,evidence_json,
                migration_source,preserved_selected
              ) VALUES(?,?,?,?,?,?,?)
              ON CONFLICT(profile_id,legacy_key) DO NOTHING`,
        bind: [
          'demo-player',
          legacyKey,
          legacyKey.replaceAll('_', ' '),
          at((-4 + index) * 24 * 60 * 60 * 1000),
          JSON.stringify({ demoCoverage: true }),
          'demo-seed',
          index < 3 ? 1 : 0,
        ],
        result: 'changes',
      });
    }
    await shadow.importers.planning.import({
      projects,
      todos,
      tasks: tasks.filter((task) => task.UUID !== lateSocialTask?.UUID),
      reminders,
    });
    await shadow.importers.matches.import({
      matches: records(STORES.match),
      backgroundJobs: records(STORES.backgroundJob),
      backgroundJobReceipts: records(STORES.backgroundJobReceipt),
    });
    await shadow.importers.events.import({
      events: records(STORES.event),
      customEvents: records(STORES.customEvent),
      eventLogs: records(STORES.eventLog),
      eventBuffs: records(STORES.eventBuff),
      contributions: records(STORES.contribution),
    });
    await shadow.importers.social.import({
      friendships: records(STORES.friendship),
      notifications: records(STORES.notification),
    });
    runtime.markSqliteAuthoritativeProjectionsReady();

    const repository = shadow.socialWorld;
    const seedClosedPresence = async ({
      id,
      playerId,
      location,
      sourceType,
      sourceId,
      startedIGT,
      endedIGT,
      enteredAt,
      exitedAt,
    }) => {
      await repository.transitionPresence({
        intervalId: id,
        playerId,
        location,
        sourceType,
        sourceId,
        startedIGT,
        enteredAt,
        commandId: `${id}:enter`,
      });
      await repository.closePresence({
        playerId,
        endedIGT,
        exitedAt,
        closeReason: 'surface-exit',
        expectedLocation: location,
        commandId: `${id}:exit`,
      });
    };

    await repository.transitionPresence({
      intervalId: 'demo-presence-self-commons',
      playerId: 'demo-player',
      location: SEMANTIC_LOCATION.commons,
      sourceType: 'surface',
      sourceId: 'semantic-world',
      startedIGT: viewerIGT - (5 * MINUTE),
      enteredAt: at(-5 * MINUTE),
      commandId: 'demo-presence-self-commons:enter',
    });
    await seedClosedPresence({
      id: 'demo-presence-rhea-dojo',
      playerId: 'demo-rival-rhea',
      location: SEMANTIC_LOCATION.dojo,
      sourceType: 'dojo-session',
      sourceId: 'demo-dojo-rhea',
      startedIGT: viewerIGT - (25 * MINUTE),
      endedIGT: viewerIGT + (75 * MINUTE),
      enteredAt: at(-25 * MINUTE),
      exitedAt: at(75 * MINUTE),
    });
    await seedClosedPresence({
      id: 'demo-presence-mika-dojo',
      playerId: 'demo-rival-mika',
      location: SEMANTIC_LOCATION.dojo,
      sourceType: 'dojo-session',
      sourceId: 'demo-dojo-mika',
      startedIGT: viewerIGT - (18 * MINUTE),
      endedIGT: viewerIGT + (65 * MINUTE),
      enteredAt: at(-18 * MINUTE),
      exitedAt: at(65 * MINUTE),
    });

    const cast = await runtime.socialWorldCast.getDynamicCast({
      viewerId: 'demo-player',
      viewerIGT,
      committedAt: new Date(now),
    });
    const [matchFamiliar, recentFamiliar] = cast?.assignments || [];
    if (matchFamiliar?.subjectId) {
      await seedClosedPresence({
        id: `demo-presence-${matchFamiliar.subjectId}-match`,
        playerId: matchFamiliar.subjectId,
        location: SEMANTIC_LOCATION.matchArena,
        sourceType: 'match',
        sourceId: 'demo-match-window',
        startedIGT: viewerIGT - (15 * MINUTE),
        endedIGT: viewerIGT + (30 * MINUTE),
        enteredAt: at(-15 * MINUTE),
        exitedAt: at(30 * MINUTE),
      });
    }
    if (recentFamiliar?.subjectId) {
      await seedClosedPresence({
        id: `demo-presence-${recentFamiliar.subjectId}-recent`,
        playerId: recentFamiliar.subjectId,
        location: SEMANTIC_LOCATION.planning,
        sourceType: 'panel',
        sourceId: 'tasks',
        startedIGT: viewerIGT - (35 * MINUTE),
        endedIGT: viewerIGT - (10 * MINUTE),
        enteredAt: at(-35 * MINUTE),
        exitedAt: at(-10 * MINUTE),
      });
    }

    for (const task of tasks.filter((task) => task.source === 'dojo' && task.dojoSessionUUID)) {
      await shadow.dojoStandings.recordTaskCompletion({ task });
    }
    await shadow.dojoStandings.materializeRanks();

    const initialRheaMemory = await runtime.socialEncounters.getSinceLastSaw({
      viewerId: 'demo-player',
      subjectId: 'demo-rival-rhea',
      viewerIGT,
    });
    await runtime.socialEncounters.recordEncounter({
      viewerId: 'demo-player',
      subjectId: 'demo-rival-rhea',
      viewerIGT,
      surface: 'profile-drawer',
      visibleFacts: initialRheaMemory.facts,
      operationId: 'demo-rhea-baseline-encounter',
      encounteredAt: new Date(now - (12 * MINUTE)),
    });
    if (lateSocialTask) {
      await shadow.planning.upsertTask(lateSocialTask, {
        operationId: 'demo-rhea-social-update',
      });
      await runtime.socialActivityIndex.ensureSubjectIndexed({
        subjectId: 'demo-rival-rhea',
      });
    }

    return {
      status: 'seeded',
      viewerIGT,
      castSize: cast?.assignments?.length || 0,
    };
  }

  async seed() {
    await this.ready;
    const typedDemoAvailable = await this._resetTypedDemoStore();
    await this._resetLoadedData({ seed: true });
    this.demoMode = true;

    const now = Date.now();
    const iso = (offsetMs = 0) => new Date(now + offsetMs).toISOString();
    const midnightDaysAgo = (days) => {
      const date = new Date(now);
      date.setHours(0, 0, 0, 0);
      date.setDate(date.getDate() - days);
      return date.toISOString();
    };
    const dateKey = (value) => {
      const date = new Date(value);
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    };
    const demoAvatar = (initials, background, foreground = '#f8fafc') => {
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">'
        + '<defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1">'
        + '<stop stop-color="' + background + '"/><stop offset="1" stop-color="#0f172a"/>'
        + '</linearGradient></defs>'
        + '<rect width="128" height="128" rx="18" fill="url(#g)"/>'
        + '<circle cx="92" cy="34" r="24" fill="rgba(255,255,255,.16)"/>'
        + '<text x="64" y="79" text-anchor="middle" font-family="Rajdhani,Arial,sans-serif" font-size="42" font-weight="800" fill="' + foreground + '">' + initials + '</text>'
        + '</svg>';
      return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
    };
    const playerCreatedAt = midnightDaysAgo(7);
    const player = {
      UUID: 'demo-player',
      username: 'Demo Agent',
      description: 'Local demo profile for UI inspection.',
      createdAt: playerCreatedAt,
      inGameTime: getCurrentIGT({ createdAt: playerCreatedAt }, now),
      elo: 940,
      igtBaseElo: 904,
      tokens: 420,
      minutesClearedToday: 35,
      wakeTime: '07:30',
      sleepTime: '23:30',
      workStartTime: '09:00',
      workEndTime: '17:30',
      profilePicture: demoAvatar('DA', '#38bdf8'),
      activeCosmetics: { appTheme: 'minimalist', profileTheme: 'minimalist', profileLayout: 'arena', avatarFrame: 'default', lobbyCard: 'default', matchCard: 'default', standingsRow: 'default', title: 'wayfinder' },
      profilePersonalization: {
        skin: 'arena',
        tagline: 'Building momentum one focused session at a time.',
        about: 'This local profile contains representative records for every major Tapestry surface.',
        quote: 'Small starts become durable systems.',
        links: [
          { label: 'Portfolio', url: 'https://example.com' },
          { label: 'Notes', url: 'https://example.com/notes' },
          { label: '', url: '' },
        ],
        blocks: [
          { id: 'demo-about', type: 'text', columns: 12, height: 240, title: 'About this demo', content: 'A populated profile for checking **layout**, timelines, achievements, matches, and contributions.' },
          { id: 'demo-stats', type: 'stats', columns: 6, height: 240 },
          { id: 'demo-rank', type: 'rankGraph', columns: 6, height: 360 },
          { id: 'demo-achievements', type: 'achievements', columns: 6, height: 260 },
          { id: 'demo-contribution', type: 'goalContribution', columns: 6, height: 320 },
          { id: 'demo-activity', type: 'activity', columns: 12, height: 380 },
        ],
      },
      inboxNotificationsEnabled: true,
      achievements: {
        grinder_1: { earnedAt: iso(-4 * 24 * 60 * 60 * 1000) },
        scorer_1: { earnedAt: iso(-3 * 24 * 60 * 60 * 1000) },
        basket_1: { earnedAt: iso(-2 * 24 * 60 * 60 * 1000) },
        signature_1: { earnedAt: iso(-24 * 60 * 60 * 1000) },
      },
      selectedAchievements: ['grinder_1', 'scorer_1', 'basket_1'],
      selectedAchievementsV2: ['first_movement', 'wayfinder', 'balanced_pair'],
    };

    const baseIGT = player.inGameTime;
    const igt = (offsetMs = 0) => Math.max(0, baseIGT + offsetMs);

    await this.add(STORES.player, player);
    this.setActivePlayerUUID(player.UUID);
    this.setGlobalMoney(84.75);

    const demoProfiles = [
      { UUID: 'demo-rival-rhea', username: 'Rhea', description: 'Accepted friend projected into the shared Dojo and its Tavern.', elo: 930, profilePicture: demoAvatar('R', '#a78bfa'), title: 'wayfinder', theme: 'minimalist_light' },
      { UUID: 'demo-rival-mika', username: 'Mika', description: 'Accepted friend with a live Dojo room session and typed standing.', elo: 975, profilePicture: demoAvatar('M', '#34d399'), title: 'builder', theme: 'pixelated' },
      { UUID: 'demo-rival-sol', username: 'Sol', description: 'Comparison profile with recent semantic activity for the inactive rail.', elo: 890, profilePicture: demoAvatar('S', '#fb7185'), title: 'momentum', theme: 'mature_beige' },
      { UUID: 'demo-rival-iris', username: 'Iris', description: 'Comparison profile available for a factual Match Arena pulse.', elo: 1055, profilePicture: demoAvatar('I', '#f59e0b'), title: 'trailkeeper', theme: 'dreamcore' },
      { UUID: 'demo-rival-nox', username: 'Nox', description: 'Horizon profile used to exercise bounded cast selection.', elo: 1105, profilePicture: demoAvatar('N', '#60a5fa'), title: 'vanguard', theme: 'gamification' },
    ];
    for (const [index, profile] of demoProfiles.entries()) {
      const createdAt = midnightDaysAgo(6 - index);
      await this.add(STORES.player, {
        ...profile,
        createdAt,
        inGameTime: getCurrentIGT({ createdAt }, now),
        igtBaseElo: profile.elo,
        tokens: 140 + index * 65,
        minutesClearedToday: 15 + index * 10,
        wakeTime: '07:30',
        sleepTime: '23:30',
        workStartTime: '09:00',
        workEndTime: '17:30',
        activeCosmetics: { appTheme: profile.theme, profileTheme: profile.theme, profileLayout: 'arena', avatarFrame: 'default', lobbyCard: 'default', matchCard: 'default', standingsRow: 'default', title: profile.title },
        achievements: [],
      });
    }

    const goal = {
      UUID: 'demo-goal-main',
      parent: player.UUID,
      name: 'Social World Polish',
      description: 'Demo Goal used to populate semantic-world, task, event, and shop surfaces.',
      finishCondition: 'The social world is visually coherent, persistent, and ready for a stable release.',
      areaUUID: 'demo-area-charcoal',
      progressType: 'milestones',
      lifecycleStatus: 'active',
      healthStatus: 'at_risk',
      targetDate: iso(12 * 24 * 60 * 60 * 1000).slice(0, 10),
      currentMilestoneUUID: 'demo-milestone-main-2',
      nextAction: {
        entityType: 'todo',
        entityUUID: 'demo-todo-1',
        labelSnapshot: 'Review shop cart spacing',
        pinnedAt: iso(-12 * 60 * 60 * 1000),
      },
      implementationCue: 'When the afternoon focus block starts, open the visual QA checklist.',
      obstacle: 'Polish work may expand into unrelated redesigns.',
      obstacleResponse: 'Record unrelated ideas, then finish the current acceptance check.',
      participationMode: 'collaborative',
      visibility: 'participants',
      reviewIntervalDays: 7,
      lastReviewedAt: iso(-3 * 24 * 60 * 60 * 1000),
      createdAt: iso(-5 * 24 * 60 * 60 * 1000),
      status: 'active',
      accentColor: '#38bdf8',
      bannerColor: 'linear-gradient(135deg, rgba(56,189,248,.28), rgba(96,165,250,.08))',
    };
    await this.add(STORES.project, goal);
    const supportingGoals = [
      {
        UUID: 'demo-goal-learning',
        parent: player.UUID,
        name: 'Applied Learning',
        description: 'A second active Goal with contributions and scheduled work.',
        finishCondition: 'Independently reproduce the local inference baseline and evaluate one supervised change.',
        areaUUID: 'demo-area-learning',
        progressType: 'learning',
        lifecycleStatus: 'active',
        healthStatus: 'on_track',
        currentMilestoneUUID: 'demo-milestone-learning-2',
        participationMode: 'private',
        visibility: 'private',
        reviewIntervalDays: 7,
        createdAt: iso(-12 * 24 * 60 * 60 * 1000),
        status: 'active',
        accentColor: '#a78bfa',
        bannerColor: 'linear-gradient(135deg, rgba(167,139,250,.3), rgba(76,29,149,.08))',
      },
      {
        UUID: 'demo-goal-wellbeing',
        parent: player.UUID,
        name: 'Sustainable Pace',
        description: 'A Goal used to demonstrate recovery work and habit connections.',
        finishCondition: 'Complete the four-week recovery experiment and choose a sustainable weekly cadence.',
        areaUUID: 'demo-area-health',
        progressType: 'milestones',
        lifecycleStatus: 'active',
        healthStatus: 'blocked',
        blockedReason: 'Waiting for enough weekly evidence to compare routines.',
        currentMilestoneUUID: 'demo-milestone-wellbeing-1',
        participationMode: 'private',
        visibility: 'private',
        reviewIntervalDays: 7,
        createdAt: iso(-18 * 24 * 60 * 60 * 1000),
        status: 'active',
        accentColor: '#34d399',
        bannerColor: 'linear-gradient(135deg, rgba(52,211,153,.26), rgba(6,78,59,.08))',
      },
      {
        UUID: 'demo-goal-archive',
        parent: player.UUID,
        name: 'Launch Checklist',
        description: 'A completed Goal for archive and historical-state coverage.',
        finishCondition: 'Every launch requirement is verified and the release checklist is archived.',
        areaUUID: 'demo-area-charcoal',
        progressType: 'milestones',
        lifecycleStatus: 'archived',
        healthStatus: 'on_track',
        participationMode: 'collaborative',
        visibility: 'participants',
        createdAt: iso(-30 * 24 * 60 * 60 * 1000),
        completedAt: iso(-8 * 24 * 60 * 60 * 1000),
        archivedAt: iso(-7 * 24 * 60 * 60 * 1000),
        status: 'archived',
        accentColor: '#f59e0b',
      },
    ];
    for (const supportingGoal of supportingGoals) await this.add(STORES.project, supportingGoal);

    const goalAreas = [
      {
        UUID: 'demo-area-charcoal', parent: player.UUID, name: 'Charcoal', description: 'Product, persistence, and world-system development.',
        icon: '◆', accentColor: '#38bdf8', sortOrder: 0,
      },
      {
        UUID: 'demo-area-learning', parent: player.UUID, name: 'Learning', description: 'Capabilities developed through demonstrated stages.',
        icon: '✦', accentColor: '#a78bfa', sortOrder: 1,
      },
      {
        UUID: 'demo-area-health', parent: player.UUID, name: 'Health', description: 'Recovery, energy, and sustainable working rhythms.',
        icon: '◇', accentColor: '#34d399', sortOrder: 2,
      },
    ];
    for (const [index, area] of goalAreas.entries()) {
      await this.add(STORES.goalArea, {
        ...area,
        createdAt: iso(-(20 - index) * 24 * 60 * 60 * 1000),
        updatedAt: iso(-24 * 60 * 60 * 1000),
        inGameTimestamp: igt(-(20 - index) * 24 * 60 * 60 * 1000),
      });
    }

    const goalMilestones = [
      ['demo-milestone-main-1', goal.UUID, 'Persistence contracts verified', 'milestone', 0, 'completed', -2],
      ['demo-milestone-main-2', goal.UUID, 'Theme and layout QA', 'milestone', 1, 'active', null],
      ['demo-milestone-main-3', goal.UUID, 'Production-origin verification', 'milestone', 2, 'not_started', null],
      ['demo-milestone-main-4', goal.UUID, 'Release candidate approved', 'milestone', 3, 'not_started', null],
      ['demo-milestone-learning-1', 'demo-goal-learning', 'Understand the existing architecture', 'learning_stage', 0, 'completed', -5],
      ['demo-milestone-learning-2', 'demo-goal-learning', 'Reproduce the baseline model', 'learning_stage', 1, 'active', null],
      ['demo-milestone-learning-3', 'demo-goal-learning', 'Implement one supervised change', 'learning_stage', 2, 'not_started', null],
      ['demo-milestone-learning-4', 'demo-goal-learning', 'Evaluate results independently', 'learning_stage', 3, 'not_started', null],
      ['demo-milestone-wellbeing-1', 'demo-goal-wellbeing', 'Collect two weeks of recovery evidence', 'milestone', 0, 'blocked', null],
      ['demo-milestone-wellbeing-2', 'demo-goal-wellbeing', 'Compare weekly routines', 'milestone', 1, 'not_started', null],
    ];
    for (const [UUID, goalUUID, title, kind, position, status, completedDays] of goalMilestones) {
      const completedAt = completedDays == null ? null : iso(completedDays * 24 * 60 * 60 * 1000);
      await this.add(STORES.goalMilestone, {
        UUID,
        parent: player.UUID,
        goalUUID,
        title,
        kind,
        position,
        status,
        createdAt: iso(-10 * 24 * 60 * 60 * 1000),
        updatedAt: completedAt || iso(-24 * 60 * 60 * 1000),
        completedAt,
        inGameTimestamp: igt(-10 * 24 * 60 * 60 * 1000),
        completedInGameTimestamp: completedAt ? igt(completedDays * 24 * 60 * 60 * 1000) : null,
      });
    }

    for (const ownedGoal of [goal, ...supportingGoals]) {
      await this.add(STORES.goalParticipant, {
        UUID: `goal-participant:${ownedGoal.UUID}:${player.UUID}`,
        parent: player.UUID,
        goalUUID: ownedGoal.UUID,
        playerUUID: player.UUID,
        role: 'owner',
        joinedAt: ownedGoal.createdAt,
        createdAt: ownedGoal.createdAt,
        inGameTimestamp: ownedGoal.inGameTimestamp || 0,
      });
    }
    await this.add(STORES.goalParticipant, {
      UUID: `goal-participant:${goal.UUID}:demo-rival-rhea`,
      parent: 'demo-rival-rhea',
      goalUUID: goal.UUID,
      playerUUID: 'demo-rival-rhea',
      role: 'contributor',
      joinedAt: iso(-4 * 24 * 60 * 60 * 1000),
      createdAt: iso(-4 * 24 * 60 * 60 * 1000),
      inGameTimestamp: igt(-4 * 24 * 60 * 60 * 1000),
    });
    await this.add(STORES.goalUpdate, {
      UUID: 'demo-goal-update-main',
      parent: player.UUID,
      goalUUID: goal.UUID,
      kind: 'manual',
      summary: 'Persistence contracts are verified. The current pass is focused on theme and responsive QA.',
      healthStatusSnapshot: 'at_risk',
      lifecycleStatusSnapshot: 'active',
      createdAt: iso(-18 * 60 * 60 * 1000),
      inGameTimestamp: igt(-18 * 60 * 60 * 1000),
    });
    await this.add(STORES.appSetting, {
      UUID: `goals.currentFocus:${player.UUID}`,
      key: `goals.currentFocus:${player.UUID}`,
      parent: player.UUID,
      value: {
        goalUUID: goal.UUID,
        setAt: iso(-2 * 24 * 60 * 60 * 1000),
        inGameTimestamp: igt(-2 * 24 * 60 * 60 * 1000),
      },
      updatedAt: iso(-2 * 24 * 60 * 60 * 1000),
    });

    const rivalGoals = [
      {
        UUID: 'demo-rhea-goal', parent: 'demo-rival-rhea', name: 'Semantic World Rollout',
        description: 'Rhea’s continuing thread across Dojo, Taverns, and profile-presence changes.',
        status: 'active', createdAt: iso(-9 * 24 * 60 * 60 * 1000),
      },
      {
        UUID: 'demo-mika-goal', parent: 'demo-rival-mika', name: 'Dojo Reliability',
        description: 'Mika’s continuing thread for room facts and typed session standings.',
        status: 'active', createdAt: iso(-8 * 24 * 60 * 60 * 1000),
      },
      {
        UUID: 'demo-sol-goal', parent: 'demo-rival-sol', name: 'Recovery Cadence',
        description: 'Sol’s explicit objective for recent and inactive residency coverage.',
        status: 'active', createdAt: iso(-7 * 24 * 60 * 60 * 1000),
      },
      {
        UUID: 'demo-iris-goal', parent: 'demo-rival-iris', name: 'Match Arena Fluency',
        description: 'Iris’s explicit trajectory anchor for the near-peer cast role.',
        status: 'active', createdAt: iso(-6 * 24 * 60 * 60 * 1000),
      },
      {
        UUID: 'demo-nox-goal', parent: 'demo-rival-nox', name: 'Competitive Horizon',
        description: 'Nox’s explicit trajectory anchor for the horizon cast role.',
        status: 'active', createdAt: iso(-5 * 24 * 60 * 60 * 1000),
      },
    ];
    for (const rivalGoal of rivalGoals) await this.add(STORES.project, rivalGoal);
    const rivalGoalByPlayer = new Map(rivalGoals.map((entry) => [entry.parent, entry.UUID]));

    const rivalTodos = [
      {
        UUID: 'demo-rhea-todo-1', parent: 'demo-rival-rhea', projectId: 'demo-rhea-goal',
        name: 'Review Tavern roster copy', dueDate: iso(18 * 60 * 60 * 1000), estimatedDuration: 20,
        description: 'Explicit next step for Rhea’s compact profile card.', createdAt: iso(-24 * 60 * 60 * 1000),
      },
      {
        UUID: 'demo-rhea-todo-2', parent: 'demo-rival-rhea', projectId: 'demo-rhea-goal',
        name: 'Verify encounter change grouping', dueDate: iso(42 * 60 * 60 * 1000), estimatedDuration: 25,
        description: 'Second dated commitment used by the bounded Next section.', createdAt: iso(-20 * 60 * 60 * 1000),
      },
      {
        UUID: 'demo-mika-todo-1', parent: 'demo-rival-mika', projectId: 'demo-mika-goal',
        name: 'Recheck Dojo room totals', dueDate: iso(30 * 60 * 60 * 1000), estimatedDuration: 15,
        description: 'Explicit next step for Mika’s compact profile card.', createdAt: iso(-18 * 60 * 60 * 1000),
      },
    ];
    for (const rivalTodo of rivalTodos) await this.add(STORES.todo, rivalTodo);

    const todos = [
      ['demo-todo-1', 'Review shop cart spacing', 25, -45 * 60 * 1000, 4],
      ['demo-todo-2', 'Tune feed full overlay opacity', 20, 90 * 60 * 1000, 3],
      ['demo-todo-3', 'Check task full-page editor', 35, 4 * 60 * 60 * 1000, 2],
      ['demo-todo-4', 'Write notes from browser pass', 15, 24 * 60 * 60 * 1000, 1],
      ['demo-todo-5', 'Confirm events editor capsule', 30, 2 * 24 * 60 * 60 * 1000, 2],
    ];
    for (const [UUID, name, estimatedDuration, dueOffset, aversion] of todos) {
      await this.add(STORES.todo, {
        UUID,
        parent: player.UUID,
        projectId: goal.UUID,
        name,
        description: 'Demo task for layout smoke testing.',
        estimatedDuration,
        aversion,
        dueDate: iso(dueOffset),
        createdAt: iso(-24 * 60 * 60 * 1000),
      });
    }
    await this.add(STORES.todo, {
      UUID: 'demo-todo-6',
      parent: player.UUID,
      projectId: 'demo-goal-learning',
      name: 'Read the local inference report',
      description: 'An undated, low-friction task that demonstrates a different recommendation context.',
      estimatedDuration: 10,
      aversion: 1,
      dueDate: null,
      createdAt: iso(-3 * 24 * 60 * 60 * 1000),
    });
    await this.add(STORES.todo, {
      UUID: 'demo-todo-7',
      parent: player.UUID,
      projectId: 'demo-goal-wellbeing',
      name: 'Take a screen-free walking break',
      description: 'A longer description to verify wrapping, detail drawers, and duration editing across narrower layouts.',
      estimatedDuration: 45,
      aversion: 2,
      dueDate: iso(5 * 24 * 60 * 60 * 1000),
      createdAt: iso(-2 * 24 * 60 * 60 * 1000),
    });
    await this.add(STORES.todo, {
      UUID: 'demo-todo-8',
      parent: player.UUID,
      projectId: null,
      name: 'Unsorted inbox task',
      description: 'No Goal assigned, for uncategorized-state coverage.',
      estimatedDuration: 5,
      aversion: 1,
      dueDate: iso(7 * 24 * 60 * 60 * 1000),
      createdAt: iso(-30 * 60 * 1000),
    });

    await this.add(STORES.task, {
      UUID: 'demo-task-1',
      parent: player.UUID,
      todoUUID: null,
      projectId: goal.UUID,
      goalName: goal.name,
      name: 'Reviewed semantic world hierarchy',
      estimatedDuration: 30,
      sessionDuration: 30 * 60 * 1000,
      points: 180,
      pointsBase: 180,
      createdAt: iso(-5 * 60 * 60 * 1000),
      completedAt: iso(-4.5 * 60 * 60 * 1000),
      inGameTimestamp: igt(-5 * 60 * 60 * 1000),
      completedInGameTimestamp: igt(-4.5 * 60 * 60 * 1000),
    });
    await this.add(STORES.task, {
      UUID: 'demo-task-2',
      parent: player.UUID,
      todoUUID: null,
      projectId: goal.UUID,
      goalName: goal.name,
      name: 'Finished UI smoke notes',
      estimatedDuration: 20,
      sessionDuration: 20 * 60 * 1000,
      points: 120,
      pointsBase: 120,
      createdAt: iso(-2 * 60 * 60 * 1000),
      completedAt: iso(-100 * 60 * 1000),
      inGameTimestamp: igt(-2 * 60 * 60 * 1000),
      completedInGameTimestamp: igt(-100 * 60 * 1000),
    });

    const additionalCompletedTasks = [
      {
        UUID: 'demo-task-deep-work', parent: player.UUID, projectId: 'demo-goal-learning',
        name: 'Deep architecture review', estimatedDuration: 90, sessionDuration: 78 * 60 * 1000,
        points: 430, pointsBase: 430, createdAt: iso(-28 * 60 * 60 * 1000), completedAt: iso(-26.7 * 60 * 60 * 1000),
        inGameTimestamp: igt(-28 * 60 * 60 * 1000), completedInGameTimestamp: igt(-26.7 * 60 * 60 * 1000),
      },
      {
        UUID: 'demo-task-quick-win', parent: player.UUID, projectId: goal.UUID,
        name: 'Fix one high-contrast label', estimatedDuration: 5, sessionDuration: 7 * 60 * 1000,
        points: 55, pointsBase: 55, createdAt: iso(-22 * 60 * 60 * 1000), completedAt: iso(-21.8 * 60 * 60 * 1000),
        inGameTimestamp: igt(-22 * 60 * 60 * 1000), completedInGameTimestamp: igt(-21.8 * 60 * 60 * 1000),
      },
      {
        UUID: 'demo-task-dojo-1', parent: player.UUID, projectId: goal.UUID,
        name: 'Dojo navigation audit', estimatedDuration: 20, sessionDuration: 18 * 60 * 1000,
        points: 145, pointsBase: 145, source: 'dojo', dojoSessionUUID: 'demo-dojo-session-player',
        createdAt: iso(-7 * 60 * 60 * 1000), completedAt: iso(-6.7 * 60 * 60 * 1000),
        inGameTimestamp: igt(-7 * 60 * 60 * 1000), completedInGameTimestamp: igt(-6.7 * 60 * 60 * 1000),
      },
      {
        UUID: 'demo-task-dojo-2', parent: player.UUID, projectId: 'demo-goal-learning',
        name: 'Dojo recommendation follow-through', estimatedDuration: 30, sessionDuration: 27 * 60 * 1000,
        points: 220, pointsBase: 220, source: 'dojo', dojoSessionUUID: 'demo-dojo-session-player',
        createdAt: iso(-6.5 * 60 * 60 * 1000), completedAt: iso(-6.05 * 60 * 60 * 1000),
        inGameTimestamp: igt(-6.5 * 60 * 60 * 1000), completedInGameTimestamp: igt(-6.05 * 60 * 60 * 1000),
      },
      {
        UUID: 'demo-task-archive', parent: player.UUID, projectId: 'demo-goal-archive',
        name: 'Ship launch checklist', estimatedDuration: 45, sessionDuration: 42 * 60 * 1000,
        points: 310, pointsBase: 310, createdAt: iso(-8 * 24 * 60 * 60 * 1000 - 42 * 60 * 1000), completedAt: iso(-8 * 24 * 60 * 60 * 1000),
        inGameTimestamp: igt(-8 * 24 * 60 * 60 * 1000 - 42 * 60 * 1000), completedInGameTimestamp: igt(-8 * 24 * 60 * 60 * 1000),
      },
    ];
    for (const task of additionalCompletedTasks) {
      await this.add(STORES.task, { todoUUID: null, ...task });
    }

    const rivalTasks = [
      ['demo-rhea-task-a', 'demo-rival-rhea', 'Rhea planning pass', -90 * 60 * 1000, -82 * 60 * 1000, 90],
      ['demo-rhea-task-b', 'demo-rival-rhea', 'Rhea follow-through', 88 * 60 * 1000, 96 * 60 * 1000, 120],
      ['demo-mika-task-a', 'demo-rival-mika', 'Dojo baseline set', -4 * 60 * 60 * 1000, -3.8 * 60 * 60 * 1000, 160],
      ['demo-mika-task-b', 'demo-rival-mika', 'Dojo score defended', -70 * 60 * 1000, -64 * 60 * 1000, 210],
      ['demo-sol-task-a', 'demo-rival-sol', 'Deep focus block', -3 * 60 * 60 * 1000, -2.7 * 60 * 60 * 1000, 110],
      ['demo-sol-task-b', 'demo-rival-sol', 'Future planning block', 2.3 * 60 * 60 * 1000, 2.5 * 60 * 60 * 1000, 130],
    ];
    for (const [UUID, parent, name, startOffset, doneOffset, points] of rivalTasks) {
      await this.add(STORES.task, {
        UUID,
        parent,
        todoUUID: null,
        projectId: rivalGoalByPlayer.get(parent) || goal.UUID,
        goalName: goal.name,
        name,
        estimatedDuration: 25,
        sessionDuration: 25 * 60 * 1000,
        points,
        pointsBase: points,
        createdAt: iso(startOffset),
        completedAt: iso(doneOffset),
        inGameTimestamp: igt(startOffset),
        completedInGameTimestamp: igt(doneOffset),
      });
    }
    const rivalDojoTasks = [
      ['demo-rhea-dojo-1', 'demo-rival-rhea', 'demo-dojo-rhea', 'Rhea dojo sprint', 260, -12 * 60 * 60 * 1000],
      ['demo-rhea-dojo-2', 'demo-rival-rhea', 'demo-dojo-rhea', 'Rhea dojo finish', 190, -11.5 * 60 * 60 * 1000],
      ['demo-mika-dojo-1', 'demo-rival-mika', 'demo-dojo-mika', 'Mika dojo focus', 390, -18 * 60 * 60 * 1000],
      ['demo-sol-dojo-1', 'demo-rival-sol', 'demo-dojo-sol', 'Sol dojo reset', 175, -30 * 60 * 60 * 1000],
    ];
    for (const [UUID, parent, dojoSessionUUID, name, points, completedOffset] of rivalDojoTasks) {
      await this.add(STORES.task, {
        UUID,
        parent,
        todoUUID: null,
        projectId: rivalGoalByPlayer.get(parent) || goal.UUID,
        goalName: goal.name,
        name,
        source: 'dojo',
        dojoSessionUUID,
        estimatedDuration: 25,
        sessionDuration: 25 * 60 * 1000,
        points,
        pointsBase: points,
        createdAt: iso(completedOffset - 25 * 60 * 1000),
        completedAt: iso(completedOffset),
        inGameTimestamp: igt(completedOffset - 25 * 60 * 1000),
        completedInGameTimestamp: igt(completedOffset),
      });
    }
    await this.add(STORES.task, {
      UUID: 'demo-rhea-social-update',
      parent: 'demo-rival-rhea',
      todoUUID: null,
      projectId: 'demo-rhea-goal',
      goalName: 'Semantic World Rollout',
      name: 'Refined Tavern roster states',
      description: 'A deliberately late typed import so Since You Last Saw has one factual new change.',
      estimatedDuration: 18,
      sessionDuration: 18 * MINUTE,
      points: 135,
      pointsBase: 135,
      createdAt: iso(-50 * MINUTE),
      completedAt: iso(-32 * MINUTE),
      inGameTimestamp: igt(10 * MINUTE),
      completedInGameTimestamp: igt(28 * MINUTE),
    });

    await this.add(STORES.event, {
      UUID: 'demo-wake-event',
      parent: player.UUID,
      type: 'wake',
      name: 'Wake',
      createdAt: iso(-3 * 60 * 60 * 1000),
      inGameTimestamp: igt(-3 * 60 * 60 * 1000),
    });

    const demoEvents = [
      { UUID: 'demo-habit-water', name: 'Hydration Check', description: 'Tap once after drinking water.', type: 'one_time', icon: '✓', accentColor: '#22d3ee' },
      { UUID: 'demo-habit-stretch', name: 'Desk Stretch', description: 'Small recovery habit for long sessions.', type: 'one_time', icon: '✦', accentColor: '#84cc16' },
      { UUID: 'demo-quantity-pages', name: 'Pages Read', description: 'Quantity habit for reading progress.', type: 'quantity', dailyTarget: 10, unit: 'pages', accentColor: '#facc15' },
      { UUID: 'demo-duration-focus', name: 'Focused Practice', description: 'Run a timer while practicing a skill.', type: 'duration', dailyTarget: 25 * MINUTE, icon: '◷', accentColor: '#a78bfa' },
    ];
    for (const event of demoEvents) {
      const currentEraId = `${event.UUID}:era:0`;
      const createdAt = iso(-4 * 24 * 60 * 60 * 1000);
      await this.add(STORES.customEvent, {
        ownerUUID: player.UUID,
        currentEraId,
        trackingEras: [{ UUID: currentEraId, type: event.type, startedAt: createdAt, inGameTimestamp: igt(-4 * 24 * 60 * 60 * 1000) }],
        createdAt,
        updatedAt: iso(-60 * 60 * 1000),
        ...event,
      });
    }
    await this.add(STORES.eventLog, {
      UUID: 'demo-event-log-1',
      parent: player.UUID,
      eventUUID: 'demo-habit-water',
      type: 'one_time',
      status: 'success',
      action: 'complete',
      trackingEraId: 'demo-habit-water:era:0',
      value: 1,
      createdAt: iso(-70 * 60 * 1000),
      loggedAt: iso(-70 * 60 * 1000),
      loggedDate: dateKey(iso(-70 * 60 * 1000)),
      inGameTimestamp: igt(-70 * 60 * 1000),
    });
    await this.add(STORES.eventBuff, {
      UUID: 'demo-buff-1',
      parent: player.UUID,
      eventUUID: 'demo-habit-water',
      multiplierValue: 1.05,
      createdAt: iso(-70 * 60 * 1000),
      expiresAt: iso(3 * 60 * 60 * 1000),
    });
    await this.add(STORES.event, {
      UUID: 'demo-end-work-event',
      parent: player.UUID,
      type: 'end_work',
      name: 'Workday complete',
      createdAt: iso(-26 * 60 * 60 * 1000),
      inGameTimestamp: igt(-26 * 60 * 60 * 1000),
    });
    await this.add(STORES.event, {
      UUID: 'demo-item-use-event',
      parent: player.UUID,
      type: 'item_use',
      name: 'Walk Break',
      category: 'Rest',
      description: 'Used a recovery item from Inventory.',
      createdAt: iso(-80 * 60 * 1000),
      inGameTimestamp: igt(-80 * 60 * 1000),
    });
    const additionalEventLogs = [
      { UUID: 'demo-event-log-2', eventUUID: 'demo-habit-water', status: 'success', value: 1, createdAt: iso(-24 * 60 * 60 * 1000) },
      { UUID: 'demo-event-log-3', eventUUID: 'demo-habit-stretch', status: 'success', value: 1, createdAt: iso(-2 * 60 * 60 * 1000) },
      { UUID: 'demo-event-log-5', eventUUID: 'demo-quantity-pages', status: 'success', value: 7, createdAt: iso(-45 * 60 * 1000) },
      { UUID: 'demo-event-log-6', eventUUID: 'demo-quantity-pages', status: 'success', value: 10, createdAt: iso(-25 * 60 * 60 * 1000) },
    ];
    for (const log of additionalEventLogs) {
      await this.add(STORES.eventLog, {
        parent: player.UUID,
        type: log.eventUUID === 'demo-quantity-pages' ? 'quantity' : 'one_time',
        action: log.eventUUID === 'demo-quantity-pages' ? 'add' : 'complete',
        trackingEraId: `${log.eventUUID}:era:0`,
        loggedAt: log.createdAt,
        loggedDate: dateKey(log.createdAt),
        inGameTimestamp: igt(new Date(log.createdAt).getTime() - now),
        ...log,
      });
    }
    await this.add(STORES.eventBuff, {
      UUID: 'demo-buff-dojo-momentum',
      parent: player.UUID,
      eventUUID: SPECIAL_EVENT_IDS.dojoMultiplier,
      multiplierValue: 1.18,
      accumulatedValue: 0.18,
      createdAt: iso(-6 * 60 * 60 * 1000),
      updatedAt: iso(-5.8 * 60 * 60 * 1000),
      expiresAt: null,
    });
    await this.add(STORES.eventBuff, {
      UUID: 'demo-buff-expired',
      parent: player.UUID,
      eventUUID: 'demo-habit-stretch',
      multiplierValue: 1.03,
      createdAt: iso(-48 * 60 * 60 * 1000),
      expiresAt: iso(-24 * 60 * 60 * 1000),
    });

    const journals = [
      ['demo-journal-1', 'Semantic world notes', 'The semantic world should feel like the base space. Cards need clear hierarchy and readable residency.', 'reflection', -3 * 60 * 60 * 1000],
      ['demo-journal-2', 'Shop layout pass', 'The cart should read as a separate capsule beside the catalog, never as content inside it.', 'post', -90 * 60 * 1000],
      ['demo-journal-3', 'Task tray idea', 'Compact task tray should stay plain: a circular checkbox and a task name. Details belong in the full view.', 'post', -35 * 60 * 1000],
    ];
    for (const [UUID, title, entry, type, offset] of journals) {
      await this.add(STORES.journal, {
        UUID,
        parent: player.UUID,
        authorUUID: player.UUID,
        title,
        entry,
        type,
        postType: type,
        tags: ['demo', 'layout'],
        images: [],
        votes: {},
        createdAt: iso(offset),
        updatedAt: iso(offset),
        inGameTimestamp: igt(offset),
      });
    }
    const demoGoalLinks = [
      {
        UUID: 'goal-link:demo-goal-main:todo:demo-todo-1:next_action',
        goalUUID: goal.UUID,
        milestoneUUID: 'demo-milestone-main-2',
        entityType: 'todo',
        entityUUID: 'demo-todo-1',
        relation: 'next_action',
        labelSnapshot: 'Review shop cart spacing',
      },
      {
        UUID: 'goal-link:demo-goal-wellbeing:habit:demo-habit-stretch:supports',
        goalUUID: 'demo-goal-wellbeing',
        milestoneUUID: 'demo-milestone-wellbeing-1',
        entityType: 'habit',
        entityUUID: 'demo-habit-stretch',
        relation: 'supports',
        labelSnapshot: 'Desk Stretch',
      },
      {
        UUID: 'goal-link:demo-goal-main:journal:demo-journal-1:evidence',
        goalUUID: goal.UUID,
        milestoneUUID: 'demo-milestone-main-2',
        entityType: 'journal',
        entityUUID: 'demo-journal-1',
        relation: 'evidence',
        labelSnapshot: 'Semantic world notes',
      },
    ];
    for (const link of demoGoalLinks) {
      await this.add(STORES.goalLink, {
        ...link,
        parent: player.UUID,
        createdAt: iso(-3 * 60 * 60 * 1000),
        inGameTimestamp: igt(-3 * 60 * 60 * 1000),
      });
    }
    await this.add(STORES.journal, {
      UUID: 'demo-journal-rhea',
      parent: 'demo-rival-rhea',
      authorUUID: 'demo-rival-rhea',
      title: 'A compact field report',
      entry: 'Today I tested the semantic residency cards and documented the transitions that felt most natural.\n\nThe next pass is about reducing visual noise.',
      type: 'post',
      postType: 'post',
      tags: ['field-report', 'social-world'],
      images: [demoAvatar('SW', '#7c3aed')],
      votes: { 'demo-player': 1, 'demo-rival-mika': 1 },
      createdAt: iso(-50 * 60 * 1000),
      updatedAt: iso(-50 * 60 * 1000),
      inGameTimestamp: igt(-50 * 60 * 1000),
    });
    await this.add(STORES.journal, {
      UUID: 'demo-journal-mika',
      parent: 'demo-rival-mika',
      authorUUID: 'demo-rival-mika',
      title: 'What made this session work',
      entry: 'A deliberately longer post for checking truncation and the full discussion view. The task was specific, the duration was believable, and there was no extra ceremony between choosing it and beginning. That combination reduced the cost of starting.\n\nI also left a few notes about the Goal board, the contribution trail, and how completed work should appear in the profile timeline.',
      type: 'reflection',
      postType: 'reflection',
      tags: ['focus', 'retrospective', 'demo'],
      images: [],
      votes: { 'demo-rival-rhea': 1, 'demo-rival-sol': -1 },
      createdAt: iso(-4 * 60 * 60 * 1000),
      updatedAt: iso(-3.8 * 60 * 60 * 1000),
      inGameTimestamp: igt(-4 * 60 * 60 * 1000),
    });
    await this.add(STORES.journalComment, {
      UUID: 'demo-comment-1',
      journalUUID: 'demo-journal-2',
      parent: player.UUID,
      authorUUID: player.UUID,
      text: 'Cart should stay visible while editing.',
      createdAt: iso(-20 * 60 * 1000),
    });
    await this.add(STORES.journalComment, {
      UUID: 'demo-comment-2',
      journalUUID: 'demo-journal-rhea',
      parent: 'demo-rival-mika',
      authorUUID: 'demo-rival-mika',
      text: 'The reduced card noise reads much better at this density.',
      createdAt: iso(-32 * 60 * 1000),
    });
    await this.add(STORES.journalComment, {
      UUID: 'demo-comment-3',
      journalUUID: 'demo-journal-rhea',
      parent: player.UUID,
      authorUUID: player.UUID,
      text: 'Agreed. I will check the Commons treatment next.',
      createdAt: iso(-18 * 60 * 1000),
    });

    await this.add(STORES.reminder, {
      UUID: 'demo-reminder-due',
      parent: player.UUID,
      title: 'Check panel spacing',
      body: 'Clicking this opens the reminder editor.',
      remindAt: iso(-5 * 60 * 1000),
      completedAt: null,
      dismissedAt: null,
      snoozedUntil: null,
      createdAt: iso(-60 * 60 * 1000),
      updatedAt: iso(-60 * 60 * 1000),
    });
    await this.add(STORES.reminder, {
      UUID: 'demo-reminder-upcoming',
      parent: player.UUID,
      title: 'Review today’s recommendation timing',
      body: 'Upcoming reminder for the Lobby capsule and editor states.',
      remindAt: iso(75 * 60 * 1000),
      completedAt: null,
      dismissedAt: null,
      snoozedUntil: null,
      createdAt: iso(-2 * 60 * 60 * 1000),
      updatedAt: iso(-2 * 60 * 60 * 1000),
    });
    await this.add(STORES.reminder, {
      UUID: 'demo-reminder-snoozed',
      parent: player.UUID,
      title: 'Snoozed demo reminder',
      body: 'Uses snoozedUntil to cover the alternate scheduling path.',
      remindAt: iso(-30 * 60 * 1000),
      completedAt: null,
      dismissedAt: null,
      snoozedUntil: iso(3 * 60 * 60 * 1000),
      createdAt: iso(-4 * 60 * 60 * 1000),
      updatedAt: iso(-25 * 60 * 1000),
    });
    await this.add(STORES.reminder, {
      UUID: 'demo-reminder-complete',
      parent: player.UUID,
      title: 'Completed reminder example',
      body: 'Historical reminder retained for record-state coverage.',
      remindAt: iso(-2 * 24 * 60 * 60 * 1000),
      completedAt: iso(-2 * 24 * 60 * 60 * 1000 + 10 * 60 * 1000),
      dismissedAt: null,
      snoozedUntil: null,
      createdAt: iso(-3 * 24 * 60 * 60 * 1000),
      updatedAt: iso(-2 * 24 * 60 * 60 * 1000 + 10 * 60 * 1000),
    });

    for (const item of DEFAULT_SHOP_ITEMS) {
      await this.add(STORES.shop, {
        ...item,
        cost: item.cost ?? calculateItemCost(item.type, item.duration, item.quantity, item.priceTier ?? item.enjoyment),
        currencyType: item.UUID === 'shop-snack' ? 'dollars' : 'tokens',
        createdAt: iso(-3 * 24 * 60 * 60 * 1000),
      });
    }
    await this.add(STORES.shop, {
      UUID: 'demo-shop-deep-work',
      name: 'Deep Work Badge',
      description: 'A pricier demo reward to stress the wider shop card layout.',
      type: 'quantity',
      itemClass: 'consumable',
      duration: 0,
      quantity: 1,
      enjoyment: 1,
      category: 'Focus',
      cost: 160,
      currencyType: 'tokens',
      bannerImageUrl: null,
      createdAt: iso(-2 * 24 * 60 * 60 * 1000),
    });

    await this.add(STORES.inventory, {
      UUID: 'demo-inventory-1',
      parent: player.UUID,
      itemUUID: 'shop-walk-15',
      name: 'Walk Break',
      description: 'Demo inventory item.',
      type: 'duration',
      duration: 15,
      quantity: 1,
      enjoyment: 2,
      cost: 68,
      category: 'Rest',
      purchasedAt: iso(-24 * 60 * 60 * 1000),
      cooldownUntil: null,
    });
    await this.add(STORES.inventory, {
      UUID: 'demo-inventory-title-gold',
      parent: player.UUID,
      itemUUID: 'shop-title-gold',
      itemId: 'gold',
      name: 'Gold',
      description: 'A clean gold title for your profile identity.',
      type: ITEM_TYPE.cosmetic_title,
      itemClass: 'unlock',
      duration: 0,
      quantity: 1,
      enjoyment: 1,
      cost: 1000,
      category: 'Cosmetics',
      purchasedAt: iso(-18 * 60 * 60 * 1000),
      purchaseCount: 1,
      systemLocked: true,
    });

    const extraInventory = [
      {
        UUID: 'demo-inventory-focus', itemUUID: 'demo-shop-deep-work', name: 'Deep Work Badge',
        description: 'A stackable consumable example.', type: 'quantity', itemClass: 'consumable',
        duration: 0, quantity: 3, enjoyment: 1, cost: 160, category: 'Focus',
        purchasedAt: iso(-10 * 60 * 60 * 1000), cooldownUntil: iso(30 * 60 * 1000),
      },
      ...THEME_REGISTRY.filter((theme) => !theme.free).map((theme, index) => ({
        UUID: theme.id === 'pixelated' ? 'demo-inventory-theme' : `demo-inventory-theme-${theme.id}`,
        itemUUID: `contribution-theme-${theme.id}`,
        itemId: theme.id,
        name: theme.label,
        description: 'Demo theme unlock.',
        type: ITEM_TYPE.cosmetic_theme,
        itemClass: 'unlock',
        duration: 0,
        quantity: 1,
        enjoyment: 1,
        cost: 0,
        category: 'Cosmetics',
        purchasedAt: iso((-8 + index) * 24 * 60 * 60 * 1000),
        purchaseCount: 1,
      })),
      ...[
        ['rankGraph', 'profile_block_rank_graph', 'Rank Graph Block'],
        ['stats', 'profile_block_stats', 'Career Snapshot Block'],
        ['achievements', 'profile_block_achievements', 'Achievement Shelf Block'],
        ['activity', 'profile_block_activity', 'Recent Activity Block'],
        ['goalContribution', 'profile_block_contribution', 'Goal Contribution Block'],
      ].map(([blockType, itemId, name], index) => ({
        UUID: `demo-inventory-block-${index + 1}`,
        itemUUID: itemId,
        itemId,
        blockType,
        name,
        description: 'Owned profile-layout block for comprehensive demo coverage.',
        type: ITEM_TYPE.cosmetic_profile_block,
        itemClass: 'unlock',
        duration: 0,
        quantity: 1,
        enjoyment: 1,
        cost: 0,
        category: 'Cosmetics',
        purchasedAt: iso((-5 + index) * 24 * 60 * 60 * 1000),
        purchaseCount: 1,
      })),
    ];
    for (const item of extraInventory) await this.add(STORES.inventory, { parent: player.UUID, ...item });

    const demoTransactions = [
      {
        UUID: 'demo-transaction-money', parent: player.UUID, type: 'money_log',
        name: 'Freelance deposit', description: 'Positive cash ledger example.', amount: 48.5, cost: 48.5,
        createdAt: iso(-2 * 24 * 60 * 60 * 1000), completedAt: iso(-2 * 24 * 60 * 60 * 1000),
      },
      {
        UUID: 'demo-transaction-shop', parent: player.UUID, type: 'shop_purchase',
        purchaseBatchUUID: 'demo-purchase-batch', name: 'Walk Break', description: 'Token purchase example.',
        itemUUID: 'shop-walk-15', category: 'Rest', currencyType: 'tokens', quantity: 1,
        unitCost: 68, totalCost: 68, cost: 68,
        createdAt: iso(-24 * 60 * 60 * 1000), completedAt: iso(-24 * 60 * 60 * 1000),
      },
      {
        UUID: 'demo-transaction-cash-shop', parent: player.UUID, type: 'shop_purchase',
        purchaseBatchUUID: 'demo-purchase-cash', name: 'Snack', description: 'Cash purchase example.',
        itemUUID: 'shop-snack', category: 'Food', currencyType: 'dollars', quantity: 1,
        unitCost: 4.25, totalCost: 4.25, cost: 4.25,
        createdAt: iso(-16 * 60 * 60 * 1000), completedAt: iso(-16 * 60 * 60 * 1000),
      },
    ];
    for (const transaction of demoTransactions) await this.add(STORES.transaction, transaction);

    const demoContributions = [
      ['demo-contribution-1', player.UUID, goal.UUID, 'Refined the semantic world hierarchy', 64, -5 * 24 * 60 * 60 * 1000],
      ['demo-contribution-2', player.UUID, 'demo-goal-learning', 'Documented the inference lifecycle', 71, -3 * 24 * 60 * 60 * 1000],
      ['demo-contribution-3', player.UUID, 'demo-goal-wellbeing', 'Added a sustainable recovery block', 52, -24 * 60 * 60 * 1000],
      ['demo-contribution-rhea', 'demo-rival-rhea', goal.UUID, 'Validated the first residency pass', 82, -4 * 24 * 60 * 60 * 1000],
      ['demo-contribution-mika', 'demo-rival-mika', goal.UUID, 'Validated the Dojo room grouping', 96, -2 * 24 * 60 * 60 * 1000],
      ['demo-contribution-sol', 'demo-rival-sol', 'demo-goal-learning', 'Reviewed long-horizon behavior', 45, -20 * 60 * 60 * 1000],
    ];
    for (const [UUID, parent, goalUUID, summary, value, offset] of demoContributions) {
      const contributionGoal = goalUUID === goal.UUID
        ? goal
        : supportingGoals.find((entry) => entry.UUID === goalUUID);
      const contributionPlayer = parent === player.UUID
        ? player
        : demoProfiles.find((entry) => entry.UUID === parent);
      await this.add(STORES.contribution, {
        UUID,
        parent,
        goalUUID,
        projectId: goalUUID,
        taskUUID: null,
        todoUUID: null,
        taskName: summary,
        summary,
        source: 'manual',
        direction: 'positive',
        playerNameSnapshot: contributionPlayer?.username || 'Unknown',
        goalNameSnapshot: contributionGoal?.name || 'Goal',
        value,
        rewardBand: 'demo',
        rewardRarity: 'common',
        rewardCoins: 0,
        createdAt: iso(offset),
        completedAt: iso(offset),
        inGameTimestamp: igt(offset),
      });
    }

    const demoTeamOne = [player, demoProfiles[0], demoProfiles[1]].map((entry, index) => ({
      UUID: entry.UUID,
      username: entry.username,
      profilePicture: entry.profilePicture,
      elo: entry.elo,
      isCurrentPlayer: index === 0,
      playerTheme: entry.activeCosmetics?.profileTheme || entry.activeCosmetics?.appTheme || entry.activeCosmetics?.theme || entry.theme || 'minimalist',
      profileTheme: entry.activeCosmetics?.profileTheme || entry.activeCosmetics?.appTheme || entry.activeCosmetics?.theme || entry.theme || 'minimalist',
      avatarFrame: entry.activeCosmetics?.avatarFrame || 'default',
      matchCard: entry.activeCosmetics?.matchCard || 'default',
      standingsRow: entry.activeCosmetics?.standingsRow || 'default',
      activeTitle: entry.activeCosmetics?.title || entry.title || null,
      selectedAchievements: entry.selectedAchievements || [],
    }));
    const demoTeamTwo = demoProfiles.slice(2, 5).map((entry) => ({
      UUID: entry.UUID,
      username: entry.username,
      profilePicture: entry.profilePicture,
      elo: entry.elo,
      playerTheme: entry.profileTheme || entry.theme || 'minimalist',
      profileTheme: entry.profileTheme || entry.theme || 'minimalist',
      avatarFrame: entry.avatarFrame || 'default',
      matchCard: entry.matchCard || 'default',
      standingsRow: entry.standingsRow || 'default',
      activeTitle: entry.title || null,
      selectedAchievements: [],
    }));
    const demoMatches = [
      {
        UUID: 'demo-match-win', parent: player.UUID, status: 'complete', ratingMode: 'rated', duration: 1,
        createdAt: iso(-4 * 24 * 60 * 60 * 1000),
        inGameTimestamp: igt(-4 * 24 * 60 * 60 * 1000),
        completedInGameTimestamp: igt(-4 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000),
        teams: [demoTeamOne, demoTeamTwo],
        participantUUIDs: [...demoTeamOne, ...demoTeamTwo].map((entry) => entry.UUID),
        result: {
          winner: 1, team1Total: 980, team2Total: 910, iWon: true, wasForfeited: false,
          concludedAt: iso(-4 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000),
          inGameTimestamp: igt(-4 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000),
          eloChange: 18, oldElo: 904, newElo: 922,
          playerEloChanges: {
            [player.UUID]: { oldElo: 904, newElo: 922, change: 18 },
            'demo-rival-rhea': { oldElo: 915, newElo: 930, change: 15 },
            'demo-rival-mika': { oldElo: 960, newElo: 975, change: 15 },
            'demo-rival-sol': { oldElo: 902, newElo: 890, change: -12 },
            'demo-rival-iris': { oldElo: 967, newElo: 955, change: -12 },
            'demo-rival-nox': { oldElo: 922, newElo: 910, change: -12 },
          },
        },
      },
      {
        UUID: 'demo-match-loss', parent: player.UUID, status: 'complete', ratingMode: 'rated', duration: 0.5,
        createdAt: iso(-30 * 60 * 60 * 1000),
        inGameTimestamp: igt(-30 * 60 * 60 * 1000),
        completedInGameTimestamp: igt(-29.5 * 60 * 60 * 1000),
        teams: [demoTeamOne, demoTeamTwo],
        participantUUIDs: [...demoTeamOne, ...demoTeamTwo].map((entry) => entry.UUID),
        result: {
          winner: 2, team1Total: 420, team2Total: 447, iWon: false, wasForfeited: false,
          concludedAt: iso(-29.5 * 60 * 60 * 1000),
          inGameTimestamp: igt(-29.5 * 60 * 60 * 1000),
          eloChange: -9, oldElo: 922, newElo: 913,
          playerEloChanges: {
            [player.UUID]: { oldElo: 922, newElo: 913, change: -9 },
          },
        },
      },
      {
        UUID: 'demo-match-close-win', parent: player.UUID, status: 'complete', ratingMode: 'rated', duration: 0.5,
        createdAt: iso(-9 * 60 * 60 * 1000),
        inGameTimestamp: igt(-9 * 60 * 60 * 1000),
        completedInGameTimestamp: igt(-8.5 * 60 * 60 * 1000),
        teams: [demoTeamOne, demoTeamTwo],
        participantUUIDs: [...demoTeamOne, ...demoTeamTwo].map((entry) => entry.UUID),
        result: {
          winner: 1, team1Total: 512, team2Total: 506, iWon: true, wasForfeited: false,
          concludedAt: iso(-8.5 * 60 * 60 * 1000),
          inGameTimestamp: igt(-8.5 * 60 * 60 * 1000),
          eloChange: 27, oldElo: 913, newElo: 940,
          playerEloChanges: {
            [player.UUID]: { oldElo: 913, newElo: 940, change: 27 },
          },
        },
      },
    ];
    for (const match of demoMatches) await this.add(STORES.match, match);

    const demoFriendships = [
      { UUID: 'demo-friend-accepted-1', players: [player.UUID, 'demo-rival-rhea'], requestedBy: 'demo-rival-rhea', status: 'accepted', createdAt: iso(-5 * 24 * 60 * 60 * 1000), acceptedAt: iso(-4.8 * 24 * 60 * 60 * 1000), inGameTimestamp: igt(-5 * 24 * 60 * 60 * 1000) },
      { UUID: 'demo-friend-accepted-2', players: [player.UUID, 'demo-rival-mika'], requestedBy: player.UUID, status: 'accepted', createdAt: iso(-3 * 24 * 60 * 60 * 1000), acceptedAt: iso(-2.8 * 24 * 60 * 60 * 1000), inGameTimestamp: igt(-3 * 24 * 60 * 60 * 1000) },
      { UUID: 'demo-friend-pending-in', players: [player.UUID, 'demo-rival-iris'], requestedBy: 'demo-rival-iris', status: 'pending', createdAt: iso(-35 * 60 * 1000), inGameTimestamp: igt(-35 * 60 * 1000) },
      { UUID: 'demo-friend-pending-out', players: [player.UUID, 'demo-rival-sol'], requestedBy: player.UUID, status: 'pending', createdAt: iso(-2 * 60 * 60 * 1000), inGameTimestamp: igt(-2 * 60 * 60 * 1000) },
    ];
    for (const friendship of demoFriendships) await this.add(STORES.friendship, friendship);

    await this.add(STORES.notification, {
      UUID: 'demo-notification-friend-request',
      parent: player.UUID,
      title: 'Iris sent you a friend request',
      message: 'Open Iris’s profile to review the request.',
      kind: 'friend_request',
      meta: { friendshipUUID: 'demo-friend-pending-in', requesterUUID: 'demo-rival-iris' },
      createdAt: iso(-35 * 60 * 1000),
      inGameTimestamp: igt(-35 * 60 * 1000),
      readAt: null,
    });
    await this.add(STORES.notification, {
      UUID: 'demo-notification-read',
      parent: player.UUID,
      title: 'Rhea accepted your request',
      message: 'This read record covers historical notification state.',
      kind: 'friend_accepted',
      meta: { friendshipUUID: 'demo-friend-accepted-1', requesterUUID: 'demo-rival-rhea' },
      createdAt: iso(-4 * 24 * 60 * 60 * 1000),
      inGameTimestamp: igt(-4 * 24 * 60 * 60 * 1000),
      readAt: iso(-3.9 * 24 * 60 * 60 * 1000),
    });

    const demoNotes = [
      { UUID: 'demo-note-1', content: '# Visual test checklist\n\n- Lobby and leaderboards\n- Tasks and Dojo\n- Events and Feed\n- Shop, Inventory, Profile, Settings', createdAt: iso(-3 * 24 * 60 * 60 * 1000), updatedAt: iso(-40 * 60 * 1000) },
      { UUID: 'demo-note-2', content: '# Recommender observations\n\nCapture hydration, scoring, and total inference time after opening Dojo.', createdAt: iso(-2 * 24 * 60 * 60 * 1000), updatedAt: iso(-2 * 60 * 60 * 1000) },
      { UUID: 'demo-note-3', content: '# Design fragments\n\nKeep the first action obvious and the supporting information quiet.', createdAt: iso(-24 * 60 * 60 * 1000), updatedAt: iso(-6 * 60 * 60 * 1000) },
    ];
    for (const note of demoNotes) {
      await this.createNote(note, { operationId: `demo-create:${note.UUID}` });
    }

    await this.add(STORES.achievementState, {
      UUID: `achievement-state:${player.UUID}`,
      parent: player.UUID,
      counterVersion: 1,
      counters: {
        completedTasks: 7,
        lifetimeTaskPoints: 1460,
        maxTaskDurationHours: 1.3,
        taskDays: {},
        bestTasksInDay: 4,
        longestTaskDayStreak: 3,
        timelineEntries: 16,
        maxJournalWords: 74,
        ownedCosmetics: 8,
        completedMatches: 3,
        currentWinStreak: 1,
        bestWinningMargin: 6,
        largestWinningMargin: 70,
        bestEloGain: 27,
        currentElo: 940,
        eventLogs: 5,
        fellowshipContribution: 0.12,
        economyLoggedTotal: 48.5,
        profileSignatureScore: 6,
        acceptedFriends: 2,
        bestDojoSessionPoints: 365,
        dojoSessionPointsByDay: {},
      },
      appliedEvents: {},
      eventAwards: {},
      needsReconciliation: false,
      createdAt: iso(-7 * 24 * 60 * 60 * 1000),
      updatedAt: iso(-20 * 60 * 1000),
    });

    this.loadedDomains = new Set(HYDRATION_DOMAINS);
    this.loadedStoreKeys = new Set(Object.values(STORES));

    const profileSummaries = buildProfileSummaries({
      players: this._recordValues(STORES.player),
      tasks: this._recordValues(STORES.task),
      journals: this._recordValues(STORES.journal),
      events: this._recordValues(STORES.event),
      transactions: this._recordValues(STORES.transaction),
      matches: this._recordValues(STORES.match),
      friendships: this._recordValues(STORES.friendship),
      inventory: this._recordValues(STORES.inventory),
      contributions: this._recordValues(STORES.contribution),
      goals: this._recordValues(STORES.project),
    });
    this._replaceStoreRecords(STORES.profileSummary, profileSummaries);

    const typedDemo = typedDemoAvailable
      ? await this._seedTypedDemoProjections({ baseIGT, now })
      : { status: 'unavailable' };
    const { rebuildMaterializedLeaderboards } = await loadMaterializedLeaderboardJobs();
    await rebuildMaterializedLeaderboards(this, { reason: 'demo-seed' });
    recordStoreHydration('demo', this.stores);
    return { changed: true, direction: 'demo', typedDemo };
  }
}

export default DemoDataSeeder;
