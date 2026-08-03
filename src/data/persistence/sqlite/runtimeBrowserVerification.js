import SqliteWorkerClient from './SqliteWorkerClient.js';
import MigrationRunner from './MigrationRunner.js';
import SQLITE_MIGRATIONS from './migrations/index.js';
import SqliteShadowDomainRuntime from './SqliteShadowDomainRuntime.js';
import { SQLITE_WORKER_COMMANDS } from './sqliteProtocol.js';
import { DirectoryJournalFileAdapter } from '../journals/JournalFileAdapters.js';
import { DirectoryResourceFileAdapter } from '../resources/ResourceFileAdapters.js';
import { sha256Bytes } from '../resources/ResourceOperationService.js';

const statusNode = document.querySelector('#status');
const resultsNode = document.querySelector('#results');
const unique = crypto.randomUUID();
const databaseOptions = {
  mode: 'persistent',
  databaseFilename: '/tapestry-sqlite-runtime-verification.sqlite3',
  poolDirectory: '/tapestry-sqlite-runtime-verification-pool',
  poolName: 'tapestry-runtime-verification-sahpool',
  poolCapacity: 8,
};

const assert = (condition, message, details = null) => {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
};

async function openClient({ waitForWriterMs = 0 } = {}) {
  const client = new SqliteWorkerClient({ requestTimeoutMs: 20_000 });
  const initializationOptions = { ...databaseOptions, enableTestHooks: true };
  const initialization = waitForWriterMs > 0
    ? await client.waitForWriter(initializationOptions, { maxWaitMs: waitForWriterMs, pollMs: 100, timeoutMs: 30_000 })
    : await client.initialize(initializationOptions, { timeoutMs: 30_000 });
  if (initialization.initialized) {
    await new MigrationRunner({
      client,
      migrations: SQLITE_MIGRATIONS,
      applicationVersion: 'browser-verification',
    }).run({ timeoutMs: 30_000 });
  }
  return { client, initialization };
}

async function run() {
  const report = {
    recordedAt: new Date().toISOString(),
    origin: location.origin,
    userAgent: navigator.userAgent,
    checks: {},
  };

  statusNode.textContent = 'Opening persistent worker…';
  const first = await openClient();
  assert(first.initialization.initialized, 'Primary writer failed to initialize.', first.initialization);
  report.initialization = first.initialization;

  statusNode.textContent = 'Checking Batches 11–16 migrations and shadow repositories…';
  const migrationRows = await first.client.query({
    sql: 'SELECT migration_id AS migrationId, checksum FROM schema_migrations ORDER BY migration_id',
    result: 'all',
  });
  assert(migrationRows.length === SQLITE_MIGRATIONS.length,
    'The persistent browser database did not apply the complete migration chain.', {
      expected: SQLITE_MIGRATIONS.length,
      actual: migrationRows,
    });
  const shadow = new SqliteShadowDomainRuntime({ client: first.client });
  const playerId = `browser-player-${unique}`;
  const friendPlayerId = `browser-friend-${unique}`;
  const projectId = `browser-project-${unique}`;
  const todoId = `browser-todo-${unique}`;
  const firstTaskId = `browser-task-a-${unique}`;
  const secondTaskId = `browser-task-b-${unique}`;
  const reminderId = `browser-reminder-${unique}`;
  const noteId = `browser-note-${unique}`;
  const journalId = `browser-journal-${unique}`;
  const matchId = `browser-match-${unique}`;
  const matchJobId = `browser-match-job-${unique}`;
  const lifecycleEventId = `browser-lifecycle-${unique}`;
  const customEventId = `browser-custom-event-${unique}`;
  const eventLogId = `browser-event-log-${unique}`;
  const eventBuffId = `browser-event-buff-${unique}`;
  const contributionId = `browser-contribution-${unique}`;
  const tokenShopItemId = `browser-token-item-${unique}`;
  const cashShopItemId = `browser-cash-item-${unique}`;
  const purchaseBatchId = `browser-purchase-${unique}`;
  const resourceOperationId = `browser-resource-${unique}`;
  const friendshipId = `browser-friendship-${unique}`;
  const friendRequestNotificationId = `browser-friend-request-${unique}`;
  const friendAcceptedNotificationId = `browser-friend-accepted-${unique}`;
  const achievementEventId = `browser-achievement-${unique}`;
  const recommendationEventId = `browser-recommendation-${unique}`;
  const analyticsEventId = `browser-analytics-${unique}`;
  const derivedCacheKey = `browser-profile-cache-${unique}`;
  const timestamp = new Date().toISOString();
  await shadow.importers.coreProfiles.import({
    players: [{
      UUID: playerId,
      username: 'Browser Shadow Probe',
      elo: 1400,
      tokens: 7,
      money: 12.5,
      activeCosmetics: { title: 'runtime-verifier' },
      createdAt: timestamp,
    }, {
      UUID: friendPlayerId,
      username: 'Browser Friend Probe',
      elo: 1200,
      createdAt: timestamp,
    }],
    appState: { activePlayerUUID: playerId },
    economyState: { globalMoney: 88.25 },
    settings: [{ UUID: `browser-setting-${unique}`, parent: playerId, settingKey: 'probe', value: true }],
  });
  const activePlayer = await shadow.coreProfiles.getCurrentPlayer();
  assert(activePlayer?.UUID === playerId && activePlayer.elo === 1400,
    'Core/profile shadow import did not round-trip in persistent SQLite.', activePlayer);

  await shadow.importers.planning.import({
    projects: [{ UUID: projectId, parent: playerId, name: 'Browser project', createdAt: timestamp }],
    todos: [{ UUID: todoId, parent: playerId, projectId, name: 'Browser todo', efficiency: 'preserve todo plan', createdAt: timestamp }],
    tasks: [{
      UUID: firstTaskId,
      parent: playerId,
      projectId,
      todoUUID: todoId,
      name: 'First browser task',
      efficiency: 'preserve task plan',
      completedAt: timestamp,
      completedInGameTimestamp: 11,
      createdAt: timestamp,
    }, {
      UUID: secondTaskId,
      parent: playerId,
      projectId,
      name: 'Second browser task',
      lastCompletedTask: { UUID: firstTaskId, name: 'embedded source must normalize' },
      completedAt: timestamp,
      completedInGameTimestamp: 12,
      createdAt: timestamp,
    }],
    reminders: [{ UUID: reminderId, parent: playerId, title: 'Browser reminder', remindAt: timestamp, createdAt: timestamp }],
  });
  const normalizedTask = await shadow.planning.getTask(secondTaskId);
  const taskPlan = await shadow.planning.explainTaskTimeline(playerId);
  assert(normalizedTask?.previousTaskId === firstTaskId && !Object.hasOwn(normalizedTask, 'lastCompletedTask'),
    'Planning shadow import did not normalize the embedded previous task.', normalizedTask);
  assert(taskPlan.some((row) => String(row.detail || row).includes('tasks_player_igt_idx')),
    'The persistent planning query did not use the expected timeline index.', taskPlan);

  const createdNote = await shadow.notes.createNote({
    UUID: noteId,
    parent: playerId,
    content: 'browser note v1',
  }, { operationId: `browser-note-create-${unique}` });
  const updatedNote = await shadow.notes.updateNoteIfCurrent(noteId, {
    content: 'browser note v2',
    expectedRevision: createdNote.record.revision,
    expectedHash: createdNote.record.contentHash,
    operationId: `browser-note-update-${unique}`,
  });
  const staleNote = await shadow.notes.updateNoteIfCurrent(noteId, {
    content: 'stale browser note',
    expectedRevision: createdNote.record.revision,
    expectedHash: createdNote.record.contentHash,
    operationId: `browser-note-stale-${unique}`,
  });
  assert(updatedNote.status === 'applied' && staleNote.status === 'conflict',
    'Protected Notes CAS did not reject a stale persistent-browser writer.', { updatedNote, staleNote });
  assert((await shadow.notes.get(noteId)).content === 'browser note v2',
    'A stale note write replaced newer canonical text in persistent-browser storage.');

  const journalSourcePath = `journals/2026/07/12/${journalId}.md`;
  const journalMarkdown = `> uuid: ${journalId}\n> player: ${playerId}\n> createdAt: ${timestamp}\n> editedAt:\n> inGameTimestamp: 15\n\n# Browser journal\n\nPersistent journal body\n`;
  await shadow.importers.journals.import({
    journals: [{
      path: journalSourcePath,
      manifestEntry: { uuid: journalId, path: journalSourcePath },
      markdown: journalMarkdown,
    }],
    journalMetadata: [{ UUID: journalId, tags: ['browser'], votes: { [playerId]: 1 }, pinned: true }],
  });
  await shadow.importers.journalRelations.import({
    journalMetadata: [{ UUID: journalId, tags: ['browser'], votes: { [playerId]: 1 }, pinned: true }],
    journalComments: [{
      UUID: `browser-comment-${unique}`,
      journalUUID: journalId,
      authorUUID: playerId,
      text: 'Persistent browser comment',
      createdAt: timestamp,
      inGameTimestamp: 16,
      votes: { [playerId]: 1 },
    }],
  });
  const browserDirectoryRoot = await navigator.storage.getDirectory();
  const journalFiles = new DirectoryJournalFileAdapter({ rootHandle: browserDirectoryRoot });
  let publicationInterrupted = false;
  const interruptedJournalOps = shadow.createJournalFileOperations(journalFiles, {
    phaseHook: (phase) => {
      if (!publicationInterrupted && phase === 'after-file-publish') {
        publicationInterrupted = true;
        throw new Error('browser-journal-publication-interrupted');
      }
    },
  });
  let journalInterruption = null;
  try {
    await interruptedJournalOps.publishStagedImport(journalId, { operationId: `browser-journal-publish-${unique}` });
  } catch (error) {
    journalInterruption = error.message;
  }
  assert(journalInterruption === 'browser-journal-publication-interrupted',
    'Journal verification did not enter the deterministic cross-store interruption point.', journalInterruption);
  const recoveredJournalOps = shadow.createJournalFileOperations(journalFiles);
  const journalRecovery = await recoveredJournalOps.reconcile();
  const journalRepository = shadow.createJournalRepository({ fileAdapter: journalFiles, random: () => 0 });
  const browserJournal = await journalRepository.getJournal(journalId);
  const browserComments = await journalRepository.getCommentsForJournalThroughIGT(journalId, 20);
  assert(browserJournal?.documentState === 'indexed'
    && browserJournal.entry === 'Persistent journal body'
    && browserJournal.tags.includes('browser')
    && browserJournal.votes[playerId] === 1,
  'Journal document/relation recovery did not round-trip in persistent browser storage.', browserJournal);
  assert(browserComments.length === 1 && browserComments[0].votes[playerId] === 1,
    'Journal comment/vote relations did not round-trip in persistent browser storage.', browserComments);
  assert(journalRecovery.resumed.some((row) => row.operationId === `browser-journal-publish-${unique}` && row.status === 'indexed'),
    'Journal startup reconciliation did not finish the interrupted publication.', journalRecovery);
  report.checks.journalDocumentRecovery = true;

  statusNode.textContent = 'Checking Batches 17–20 shadow workflows…';
  const resourceFiles = new DirectoryResourceFileAdapter({ rootHandle: browserDirectoryRoot });
  const resourceBytes = new Uint8Array([
    0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,
    ...new TextEncoder().encode(unique),
  ]);
  const expectedResourceHash = await sha256Bytes(resourceBytes);
  let resourcePublicationInterrupted = false;
  const interruptedResourceOps = shadow.createResourceOperations(resourceFiles, {
    phaseHook: (phase) => {
      if (!resourcePublicationInterrupted && phase === 'after-file-publish') {
        resourcePublicationInterrupted = true;
        throw new Error('browser-resource-publication-interrupted');
      }
    },
  });
  let resourceInterruption = null;
  try {
    await interruptedResourceOps.promote(resourceBytes, {
      operationId: resourceOperationId,
      ownerType: 'journal', ownerId: journalId, role: 'image:0', declaredMime: 'image/png',
    });
  } catch (error) {
    resourceInterruption = error.message;
  }
  assert(resourceInterruption === 'browser-resource-publication-interrupted',
    'Resource verification did not enter the deterministic publication interruption point.', resourceInterruption);
  const resourceOps = shadow.createResourceOperations(resourceFiles);
  const resourceRecovery = await resourceOps.reconcile();
  const recoveredResource = await resourceOps.promote(resourceBytes, {
    operationId: resourceOperationId,
    ownerType: 'journal', ownerId: journalId, role: 'image:0', declaredMime: 'image/png',
  });
  const deduplicatedResource = await resourceOps.promote(resourceBytes, {
    operationId: `browser-resource-dedup-${unique}`,
    ownerType: 'profile', ownerId: playerId, role: 'avatar', declaredMime: 'image/png',
  });
  const resourceReferences = await resourceOps.listReferences(expectedResourceHash);
  assert(recoveredResource.status === 'indexed'
    && deduplicatedResource.duplicateBytes === true
    && resourceReferences.length === 2
    && resourceRecovery.resumed.some((row) => row.operation?.operationId === resourceOperationId && row.status === 'indexed'),
  'Content-addressed resource recovery/deduplication failed in persistent browser storage.', {
    recoveredResource, deduplicatedResource, resourceReferences, resourceRecovery,
  });

  await shadow.importers.matches.import({
    matches: [{
      UUID: matchId, parent: playerId, status: 'complete', duration: 0.5,
      createdAt: timestamp, completedInGameTimestamp: 40,
      teams: [[{ UUID: playerId, username: 'Browser Shadow Probe', elo: 1400, power: 10 }],
        [{ UUID: `browser-opponent-${unique}`, username: 'Browser Opponent', elo: 1390, power: 9 }]],
      result: { winner: 1, team1Total: 100, team2Total: 90, iWon: true },
    }],
    backgroundJobs: [{
      UUID: matchJobId, jobType: 'post-match', status: 'pending',
      idempotencyKey: `browser-match-job-key-${unique}`, matchId, createdAt: timestamp, updatedAt: timestamp,
    }],
  });
  const appliedMatch = await shadow.matches.applyPostMatch({
    matchId, operationId: `browser-post-match-${unique}`, jobId: matchJobId,
    eloChanges: [{ playerId, oldElo: 1400, newElo: 1405 }], outcome: { winner: 1 },
  });
  const replayedMatch = await shadow.matches.applyPostMatch({
    matchId, operationId: `browser-post-match-${unique}`, jobId: matchJobId,
    eloChanges: [{ playerId, oldElo: 1400, newElo: 1405 }], outcome: { winner: 1 },
  });
  assert(appliedMatch.duplicate === false && replayedMatch.duplicate === true
    && (await shadow.coreProfiles.getPlayer(playerId)).elo === 1405,
  'Post-match Elo/job effects were not exactly-once in persistent browser storage.', { appliedMatch, replayedMatch });

  await shadow.importers.events.import({
    events: [{
      UUID: lifecycleEventId, parent: playerId, type: 'arrival', name: 'Browser arrival',
      createdAt: timestamp, inGameTimestamp: 41,
    }],
    customEvents: [{
      UUID: customEventId, ownerUUID: playerId, type: 'one_time', name: 'Browser event', currentEraId: 'browser-era', trackingEras: [{ UUID: 'browser-era', type: 'one_time', startedAt: fixed.toISOString(), inGameTimestamp: 0 }],
      dailyTarget: 1, createdAt: timestamp,
    }],
    eventLogs: [{
      UUID: eventLogId, parent: playerId, eventUUID: customEventId, type: 'one_time', status: 'success', action: 'complete', trackingEraId: 'browser-era',
      value: 1, loggedAt: timestamp, createdAt: timestamp, inGameTimestamp: 42,
    }],
    eventBuffs: [{
      UUID: eventBuffId, parent: playerId, eventUUID: customEventId,
      multiplierValue: 1.1, createdAt: timestamp, expiresAt: '2099-01-01T00:00:00.000Z',
    }],
    contributions: [{
      UUID: contributionId, parent: playerId, goalUUID: `browser-goal-${unique}`,
      projectId, taskUUID: secondTaskId, source: 'task', value: 2,
      createdAt: timestamp, inGameTimestamp: 43,
    }],
  });
  const activeBuffs = await shadow.events.getActiveBuffs(playerId, { at: new Date(timestamp) });
  const eventLogs = await shadow.events.getEventLogsForEvent(customEventId, { playerId, viewerIGT: 100 });
  const contributions = await shadow.events.getContributionsForGoal(`browser-goal-${unique}`);
  assert(activeBuffs.length === 1 && eventLogs.length === 1 && contributions.length === 1,
    'Event and contribution shadow queries failed in persistent browser storage.', { activeBuffs, eventLogs, contributions });

  await shadow.importers.commerce.import({
    shop: [{
      UUID: tokenShopItemId, itemId: `browser-token-sku-${unique}`, name: 'Browser token item',
      type: 'quantity', currencyType: 'tokens', cost: 2, quantity: 1, stockLimit: 10, soldCount: 0,
    }, {
      UUID: cashShopItemId, itemId: `browser-cash-sku-${unique}`, name: 'Browser cash item',
      type: 'quantity', currencyType: 'dollars', cost: 1.25, quantity: 1, stockLimit: 10, soldCount: 0,
    }],
  });
  const purchase = await shadow.commerce.commitPurchase({
    playerId, purchaseBatchId, operationId: `browser-purchase-op-${unique}`, occurredAt: timestamp,
    cart: [{ itemId: tokenShopItemId, quantity: 1 }, { itemId: cashShopItemId, quantity: 1 }],
  });
  const purchaseReplay = await shadow.commerce.commitPurchase({
    playerId, purchaseBatchId, operationId: `browser-purchase-op-${unique}`, occurredAt: timestamp,
    cart: [{ itemId: tokenShopItemId, quantity: 1 }, { itemId: cashShopItemId, quantity: 1 }],
  });
  assert(purchase.duplicate === false && purchaseReplay.duplicate === true
    && purchase.player.tokens === 5 && purchase.globalMoneyAfter === 87
    && purchase.playerInventory.length === 2 && purchase.ledgerRecords.length === 2,
  'Atomic commerce workflow failed in persistent browser storage.', { purchase, purchaseReplay });

  statusNode.textContent = 'Checking Batches 21–22 social and recovery/model state…';
  const friendshipRequest = await shadow.social.requestFriendship({
    friendshipId,
    requesterId: playerId,
    recipientId: friendPlayerId,
    notificationId: friendRequestNotificationId,
    operationId: `browser-friend-request-op-${unique}`,
    createdAt: timestamp,
    inGameTimestamp: 44,
    title: 'Browser friend request',
    message: 'Persistent social probe',
  });
  const friendshipAcceptance = await shadow.social.acceptFriendship({
    friendshipId,
    accepterId: friendPlayerId,
    notificationId: friendAcceptedNotificationId,
    operationId: `browser-friend-accept-op-${unique}`,
    acceptedAt: new Date(new Date(timestamp).getTime() + 1000),
    inGameTimestamp: 45,
  });
  const friendshipReplay = await shadow.social.acceptFriendship({
    friendshipId,
    accepterId: friendPlayerId,
    notificationId: `ignored-${unique}`,
    operationId: `browser-friend-accept-op-${unique}`,
    acceptedAt: new Date(new Date(timestamp).getTime() + 2000),
  });
  const playerFriendships = await shadow.social.listFriendshipsForPlayer(playerId, { status: 'accepted', viewerIGT: 100 });
  const friendInbox = await shadow.social.listNotificationsForPlayer(friendPlayerId, { viewerIGT: 100 });
  assert(friendshipRequest.friendship?.status === 'pending'
    && friendshipAcceptance.friendship?.status === 'accepted'
    && friendshipReplay.duplicate === true
    && playerFriendships.length === 1
    && playerFriendships[0].players.includes(friendPlayerId)
    && friendInbox.some((row) => row.UUID === friendRequestNotificationId && row.readAt),
  'Social relationship/notification state failed in persistent browser storage.', {
    friendshipRequest, friendshipAcceptance, friendshipReplay, playerFriendships, friendInbox,
  });

  const recordedAchievement = await shadow.recoveryModel.recordAchievementEvent({
    UUID: achievementEventId,
    parent: playerId,
    type: 'task-completed',
    sourceUUID: secondTaskId,
    eventSchemaVersion: 1,
    occurredAt: timestamp,
    createdAt: timestamp,
    payload: { points: 25 },
  }, { operationId: `browser-achievement-record-${unique}` });
  const completedAchievement = await shadow.recoveryModel.completeAchievementEvent({
    eventId: achievementEventId,
    playerId,
    operationId: `browser-achievement-process-${unique}`,
    processorVersion: 1,
    state: {
      counterVersion: 1,
      counters: { completedTasks: 2, lifetimeTaskPoints: 25 },
      appliedEvents: { [achievementEventId]: timestamp },
      eventAwards: { [achievementEventId]: ['browser_probe'] },
    },
    earnedKeys: ['browser_probe'],
    completedAt: timestamp,
  });
  const achievementReplay = await shadow.recoveryModel.completeAchievementEvent({
    eventId: achievementEventId,
    playerId,
    operationId: `browser-achievement-process-replay-${unique}`,
    processorVersion: 1,
    state: {
      counterVersion: 1,
      counters: { completedTasks: 999 },
      appliedEvents: {},
      eventAwards: {},
    },
    earnedKeys: ['wrong'],
    completedAt: timestamp,
  });
  await shadow.recoveryModel.appendRecommendationEvent({
    UUID: recommendationEventId,
    parent: playerId,
    protocolFamily: 'task-recommender-v12',
    protocolSchemaVersion: 1,
    recordType: 'event',
    type: 'decision_created',
    decisionUUID: `browser-decision-${unique}`,
    eventKey: 'created',
    idempotencyKey: `browser-decision-${unique}:created`,
    sequence: 1,
    taskUUID: secondTaskId,
    occurredAt: timestamp,
    recordedAt: timestamp,
    payload: { source: 'browser-verification' },
  });
  await shadow.recoveryModel.recordAnalyticsEvent({
    UUID: analyticsEventId,
    parent: playerId,
    eventName: 'browser_verification_opened',
    surface: 'sqlite-runtime',
    targetType: 'task',
    targetUUID: secondTaskId,
    metadata: { verification: true },
    createdAt: timestamp,
  });
  const profileSummary = await shadow.recoveryModel.getProfileSummary(playerId);
  await shadow.recoveryModel.putDerivedCache({
    cacheKey: derivedCacheKey,
    cacheKind: 'profile-summary',
    requiredSources: ['social','tasks','achievements'],
    payload: profileSummary,
    operationId: `browser-cache-put-${unique}`,
    createdAt: timestamp,
  });
  const currentCache = await shadow.recoveryModel.getDerivedCache(derivedCacheKey);
  await shadow.recoveryModel.invalidateSources(['social'], {
    operationId: `browser-cache-invalidate-${unique}`,
    invalidatedAt: new Date(new Date(timestamp).getTime() + 3000),
  });
  const invalidatedCache = await shadow.recoveryModel.getDerivedCache(derivedCacheKey, { includeStale: true });
  const rebuiltSummary = await shadow.recoveryModel.getProfileSummary(playerId);
  assert(recordedAchievement.duplicate === false
    && completedAchievement.duplicate === false
    && completedAchievement.receipt?.status === 'completed'
    && achievementReplay.duplicate === true
    && achievementReplay.state?.counters?.completedTasks === 2
    && currentCache?.stale === false
    && invalidatedCache?.stale === true
    && rebuiltSummary?.acceptedFriends === 1,
  'Achievement recovery or disposable derived-state behavior failed in persistent browser storage.', {
    recordedAchievement, completedAchievement, achievementReplay, currentCache, invalidatedCache, rebuiltSummary,
  });

  report.checks.contentAddressedResources = true;
  report.checks.matchesAndJobs = true;
  report.checks.eventsContributionsAndMap = true;
  report.checks.commerceTransactions = true;
  report.checks.socialRelationshipsAndNotifications = true;
  report.checks.achievementRecovery = true;
  report.checks.modelAnalyticsAndDerivedViews = true;
  report.checks.shadowDomainMigrations = true;
  report.shadowDomainProbe = {
    migrations: migrationRows.map((row) => row.migrationId),
    playerId,
    taskId: secondTaskId,
    noteId,
    staleConflictId: staleNote.conflict?.UUID || null,
    journalId,
    journalPath: browserJournal.filePath,
    resourceHash: expectedResourceHash,
    resourcePath: recoveredResource.resource.storagePath,
    matchId,
    lifecycleEventId,
    contributionId,
    purchaseBatchId,
    friendshipId,
    achievementEventId,
    recommendationEventId,
    analyticsEventId,
  };

  const setupId = `browser-setup:${unique}`;
  await first.client.executeAtomic({
    commandId: setupId,
    label: 'browser-verification-setup',
    statements: [
      { sql: 'CREATE TABLE IF NOT EXISTS runtime_browser_probe(id TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT' },
      { sql: 'CREATE TABLE IF NOT EXISTS runtime_kill_probe(id INTEGER PRIMARY KEY, value TEXT NOT NULL) STRICT' },
      { sql: 'DELETE FROM runtime_browser_probe', result: 'changes' },
      { sql: 'DELETE FROM runtime_kill_probe', result: 'changes' },
    ],
  });

  statusNode.textContent = 'Checking idempotent command receipts…';
  const insertCommand = {
    commandId: `browser-insert:${unique}`,
    label: 'browser-idempotency',
    statements: [{
      sql: 'INSERT INTO runtime_browser_probe(id,value) VALUES(?,?)',
      bind: ['persisted-marker', unique],
      result: 'changes',
    }],
  };
  const inserted = await first.client.executeAtomic(insertCommand);
  const duplicate = await first.client.executeAtomic(insertCommand);
  const markerCount = await first.client.query({
    sql: 'SELECT count(*) FROM runtime_browser_probe WHERE id=? AND value=?',
    bind: ['persisted-marker', unique],
    result: 'value',
  });
  assert(inserted.duplicate === false && duplicate.duplicate === true && markerCount === 1,
    'Duplicate command receipt behavior failed.', { inserted, duplicate, markerCount });
  report.checks.idempotentCommand = true;

  statusNode.textContent = 'Checking rollback…';
  let rollbackError = null;
  try {
    await first.client.executeAtomic({
      commandId: `browser-rollback:${unique}`,
      label: 'browser-rollback',
      statements: [
        { sql: 'INSERT INTO runtime_browser_probe(id,value) VALUES(?,?)', bind: ['rollback-marker', unique] },
        { sql: 'INSERT INTO missing_browser_table(id) VALUES(?)', bind: ['fail'] },
      ],
    });
  } catch (error) {
    rollbackError = { code: error.code, message: error.message };
  }
  const rollbackCount = await first.client.query({
    sql: 'SELECT count(*) FROM runtime_browser_probe WHERE id=?',
    bind: ['rollback-marker'],
    result: 'value',
  });
  assert(rollbackError && rollbackCount === 0, 'Failed atomic batch left a partial row.', { rollbackError, rollbackCount });
  report.checks.rollback = true;

  statusNode.textContent = 'Checking second-tab lease behavior…';
  const second = await openClient();
  assert(second.initialization.role === 'recovery_readonly' && second.initialization.initialized === false,
    'Second writer was not rejected into recovery_readonly.', second.initialization);
  second.client.terminate();
  report.checks.secondTabReadonly = true;

  statusNode.textContent = 'Checking timeout and caller disappearance…';
  let timeoutCode = null;
  try {
    await first.client.call('__testDelay', { milliseconds: 80 }, { timeoutMs: 5 });
  } catch (error) {
    timeoutCode = error.code;
  }
  const abortController = new AbortController();
  const abandoned = first.client.call('__testDelay', { milliseconds: 80 }, {
    timeoutMs: 1000,
    signal: abortController.signal,
  }).catch((error) => error.code);
  abortController.abort();
  const abortCode = await abandoned;
  assert(timeoutCode === 'SQLITE_REQUEST_TIMEOUT' && abortCode === 'SQLITE_REQUEST_ABORTED',
    'Timeout/abort typed results were incorrect.', { timeoutCode, abortCode });
  report.checks.timeoutAndCallerDisappearance = true;

  statusNode.textContent = 'Checking clean close and persistent reopen…';
  await first.client.close();
  const reopened = await openClient();
  assert(reopened.initialization.initialized, 'Reopen failed.', reopened.initialization);
  const persistedValue = await reopened.client.query({
    sql: 'SELECT value FROM runtime_browser_probe WHERE id=?',
    bind: ['persisted-marker'],
    result: 'value',
  });
  assert(persistedValue === unique, 'Persistent marker did not survive worker restart.', { persistedValue, unique });
  assert(reopened.initialization.previousCleanShutdown === true,
    'Clean shutdown marker was not observed on reopen.', reopened.initialization);
  const reopenedShadow = new SqliteShadowDomainRuntime({ client: reopened.client });
  const persistedNote = await reopenedShadow.notes.get(noteId);
  assert(persistedNote?.content === 'browser note v2' && persistedNote.revision === 2,
    'Protected note revision did not survive persistent worker restart.', persistedNote);
  const reopenedJournalFiles = new DirectoryJournalFileAdapter({ rootHandle: await navigator.storage.getDirectory() });
  const persistedJournal = await reopenedShadow.createJournalRepository({ fileAdapter: reopenedJournalFiles }).getJournal(journalId);
  assert(persistedJournal?.entry === 'Persistent journal body'
    && persistedJournal.documentState === 'indexed'
    && persistedJournal.revision === 1,
  'Recovered journal index/file did not survive persistent worker restart.', persistedJournal);
  const reopenedResourceFiles = new DirectoryResourceFileAdapter({ rootHandle: await navigator.storage.getDirectory() });
  const reopenedResourceOps = reopenedShadow.createResourceOperations(reopenedResourceFiles);
  const persistedResource = await reopenedResourceOps.getResource(expectedResourceHash);
  const persistedResourceBytes = await reopenedResourceFiles.readBytes(persistedResource?.storagePath);
  const persistedMatch = await reopenedShadow.matches.getMatch(matchId);
  const persistedEventLogs = await reopenedShadow.events.getEventLogsForEvent(customEventId, { playerId, viewerIGT: 100 });
  const persistedContributions = await reopenedShadow.events.getContributionsForGoal(`browser-goal-${unique}`);
  const persistedPurchase = await reopenedShadow.commerce.getPurchase(purchaseBatchId);
  assert(persistedResource?.state === 'active'
    && await sha256Bytes(persistedResourceBytes) === expectedResourceHash
    && (await reopenedResourceOps.listReferences(expectedResourceHash)).length === 2,
  'Content-addressed resource state did not survive persistent worker restart.', persistedResource);
  assert(persistedMatch?.result?.playerEloChanges?.[playerId]?.newElo === 1405,
    'Match/Elo receipt state did not survive persistent worker restart.', persistedMatch);
  assert(persistedEventLogs.length === 1 && persistedContributions.length === 1,
    'Event/contribution state did not survive persistent worker restart.', { persistedEventLogs, persistedContributions });
  assert(persistedPurchase?.tokenCost === 2 && persistedPurchase?.dollarCost === 1.25
    && persistedPurchase?.ledgerRecords?.length === 2,
  'Commerce state did not survive persistent worker restart.', persistedPurchase);
  const persistedFriendship = await reopenedShadow.social.getFriendship(friendshipId);
  const persistedAchievement = await reopenedShadow.recoveryModel.getAchievementReceipt(achievementEventId);
  const persistedRecommendations = await reopenedShadow.recoveryModel.listRecommendationEvents({ playerId });
  const persistedAnalytics = await reopenedShadow.recoveryModel.listAnalyticsEvents(playerId, { eventName: 'browser_verification_opened' });
  const persistedSummary = await reopenedShadow.recoveryModel.getProfileSummary(playerId);
  const persistedStaleCache = await reopenedShadow.recoveryModel.getDerivedCache(derivedCacheKey, { includeStale: true });
  assert(persistedFriendship?.status === 'accepted'
    && persistedFriendship.players.includes(friendPlayerId),
  'Social relationship state did not survive persistent worker restart.', persistedFriendship);
  assert(persistedAchievement?.status === 'completed'
    && persistedAchievement.earnedKeys.includes('browser_probe')
    && persistedRecommendations.some((row) => row.UUID === recommendationEventId)
    && persistedAnalytics.some((row) => row.UUID === analyticsEventId)
    && persistedSummary?.acceptedFriends === 1
    && persistedStaleCache?.stale === true,
  'Achievement/model/analytics/derived state did not survive persistent worker restart.', {
    persistedAchievement, persistedRecommendations, persistedAnalytics, persistedSummary, persistedStaleCache,
  });
  report.checks.persistenceAndCleanShutdown = true;

  statusNode.textContent = 'Checking forced worker termination rollback…';
  let enteredCrashWindow;
  const crashWindowEntered = new Promise((resolve) => { enteredCrashWindow = resolve; });
  const killCommand = reopened.client.call(SQLITE_WORKER_COMMANDS.executeAtomic, {
    command: {
      commandId: `browser-kill:${unique}`,
      label: 'browser-forced-termination',
      statements: [{
        sql: 'INSERT INTO runtime_kill_probe(id,value) VALUES(?,?)',
        bind: [1, unique],
        result: 'changes',
      }],
    },
    testPauseBeforeCommitMs: 2_000,
  }, {
    timeoutMs: 60_000,
    onProgress: (progress) => {
      if (progress?.stage === 'before-commit' && progress?.testHook === true) enteredCrashWindow();
    },
  }).catch((error) => error.code);
  await Promise.race([
    crashWindowEntered,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Worker never entered the deterministic crash window.')), 10_000)),
  ]);
  reopened.client.terminate();
  const terminationCode = await killCommand;
  assert(terminationCode === 'SQLITE_WORKER_TERMINATED', 'Pending request did not observe worker termination.', { terminationCode });
  await new Promise((resolve) => setTimeout(resolve, 80));

  const afterKill = await openClient({ waitForWriterMs: 10_000 });
  assert(afterKill.initialization.initialized, 'Writer lease did not recover after termination.', afterKill.initialization);
  const killedRows = await afterKill.client.query({
    sql: 'SELECT count(*) FROM runtime_kill_probe',
    result: 'value',
  });
  const killedReceipt = await afterKill.client.query({
    sql: 'SELECT count(*) FROM runtime_command_receipts WHERE command_id=?',
    bind: [`browser-kill:${unique}`],
    result: 'value',
  });
  assert(killedRows === 0 && killedReceipt === 0,
    'Forced worker termination left partial rows or an invalid receipt.', { killedRows, killedReceipt });
  report.checks.workerTerminationRollback = true;
  report.afterTerminationInitialization = afterKill.initialization;

  statusNode.textContent = 'Running integrity hooks…';
  report.integrity = await afterKill.client.integrityCheck({ mode: 'quick', reason: 'browser-verification' });
  assert(report.integrity.ok === true, 'Integrity hook failed.', report.integrity);
  report.checks.integrity = true;
  await afterKill.client.close();

  report.ok = Object.values(report.checks).every(Boolean);
  return report;
}

run().then((report) => {
  resultsNode.textContent = JSON.stringify(report, null, 2);
  resultsNode.dataset.complete = report.ok ? 'true' : 'false';
  statusNode.textContent = report.ok ? 'Complete.' : 'Failed.';
  document.documentElement.dataset.sqliteRuntimeComplete = report.ok ? 'true' : 'false';
}).catch((error) => {
  const report = {
    ok: false,
    error: error.message,
    details: error.details || null,
    stack: error.stack || null,
  };
  resultsNode.textContent = JSON.stringify(report, null, 2);
  resultsNode.dataset.complete = 'error';
  statusNode.textContent = 'Failed.';
  document.documentElement.dataset.sqliteRuntimeComplete = 'error';
});
