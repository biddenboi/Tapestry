import assert from 'node:assert/strict';
import test from 'node:test';
import { STORES } from '@domain/constants.js';
import InProcessSqliteClient from '../persistence/sqlite/testing/InProcessSqliteClient.js';
import SQLITE_MIGRATIONS from '../persistence/sqlite/migrations/index.js';
import SqliteDocumentRepository from '../persistence/sqlite/SqliteDocumentRepository.js';
import { referenceCaptureGuard } from './ReferenceCaptureGuard.js';
import SyncRuntime from './SyncRuntime.js';
import { synchronizeMobileReferenceData } from './MobileReferenceSync.js';
import {
  LIVE_REFERENCE_TYPES,
  PROMPT_REFERENCE_TYPES,
  synchronizeReferenceTypes,
} from './ReferenceSyncLanes.js';
import { patchMatchStateCommand } from '@domain/matches/MatchSyncCommands.js';

function copy(value) {
  return JSON.parse(JSON.stringify(value));
}

class InMemoryReferenceServer {
  constructor() {
    this.records = new Map();
    this.registrations = new Set();
    this.sequence = 0;
  }

  async registerDevice(device) {
    this.registrations.add(String(device.id));
    return { registered: true };
  }

  async mergeMobileReferenceRecords(records = []) {
    let merged = 0;
    for (const record of records) {
      const key = `${record.recordType}:${record.recordId}`;
      const current = this.records.get(key);
      const incomingTime = new Date(record.updatedAt || 0).getTime() || 0;
      const currentTime = new Date(current?.updatedAt || 0).getTime() || 0;
      if (!current || incomingTime >= currentTime) {
        const canonical = copy(record);
        const changed = !current || JSON.stringify({ ...current, serverSequence: undefined, serverVersion: undefined })
          !== JSON.stringify({ ...canonical, serverSequence: undefined, serverVersion: undefined });
        if (changed) {
          canonical.serverSequence = ++this.sequence;
          canonical.serverVersion = Number(current?.serverVersion || 0) + 1;
        } else {
          canonical.serverSequence = current.serverSequence;
          canonical.serverVersion = current.serverVersion;
        }
        this.records.set(key, canonical);
        merged += 1;
      }
    }
    return { merged };
  }

  async getMobileReferenceRecords(recordTypes = null) {
    const types = Array.isArray(recordTypes) && recordTypes.length
      ? new Set(recordTypes.map(String))
      : null;
    return [...this.records.values()]
      .filter((record) => !types || types.has(String(record.recordType)))
      .map(copy);
  }

  async getMobileReferenceChanges({ after = 0, limit = 500 } = {}) {
    return [...this.records.values()]
      .filter((record) => Number(record.serverSequence || 0) > Number(after || 0))
      .sort((left, right) => Number(left.serverSequence) - Number(right.serverSequence))
      .slice(0, limit)
      .map(copy);
  }

  async getMobileReferenceHead() {
    return this.sequence;
  }
}

async function createEndpoint({ server, deviceId, now }) {
  const client = new InProcessSqliteClient();
  await client.initialize({ mode: 'memory' });
  client.applyMigrations(SQLITE_MIGRATIONS, { applicationVersion: 'cross-device-sync-test' });
  const documents = new SqliteDocumentRepository(client);
  let activePlayerUUID = null;
  let activePlayerChangedAt = null;
  const connection = {
    ready: Promise.resolve(),
    demoMode: false,
    persistenceRuntime: { sqliteStorageAdapter: { client } },
    get: (store, UUID) => documents.get(store, UUID),
    getAll: (store) => documents.getAll(store),
    getActivePlayerUUID: () => activePlayerUUID,
    getActivePlayerChangedAt: () => activePlayerChangedAt,
    setActivePlayerUUID(playerUUID, options = {}) {
      activePlayerUUID = String(playerUUID);
      activePlayerChangedAt = options.changedAt || now().toISOString();
    },
    async flushWrites() {},
    async commitAtomicMutation({
      operationId,
      label,
      puts = [],
      deletes = [],
      additionalStatements = [],
      sync = {},
    } = {}) {
      const capture = referenceCaptureGuard(sync.origin);
      return documents.commitBatch({
        commandId: operationId,
        label,
        beforeStatements: capture.beforeStatements,
        operations: [
          ...puts.map((entry) => ({ type: 'put', store: entry.store, record: entry.record })),
          ...deletes.map((entry) => ({ type: 'delete', store: entry.store, UUID: entry.UUID })),
        ],
        additionalStatements,
        afterStatements: capture.afterStatements,
      });
    },
  };
  const runtime = new SyncRuntime({
    client,
    connection,
    transport: server,
    now,
    windowRef: null,
  });
  connection.syncRuntime = runtime;
  await runtime.initialize({ start: false });
  await runtime.configure({
    transport: server,
    device: {
      id: deviceId,
      ownerId: 'owner-1',
      displayName: deviceId,
      platform: 'test',
    },
    schedule: false,
  });
  return { client, connection, documents, runtime };
}

test('two local clients converge through the server without a physical mobile device', async (t) => {
  let currentTime = new Date('2026-08-03T12:00:00.000Z').getTime();
  const now = () => new Date(currentTime);
  const server = new InMemoryReferenceServer();
  const desktop = await createEndpoint({ server, deviceId: 'desktop-test', now });
  const mobileHarness = await createEndpoint({ server, deviceId: 'mobile-test', now });
  t.after(async () => {
    await desktop.client.close();
    await mobileHarness.client.close();
  });

  const profile = {
    UUID: 'profile-1',
    username: 'Canonical profile',
    elo: 942,
    points: 388,
    inGameTime: 7_654_321,
    syncUpdatedAt: now().toISOString(),
  };
  const task = {
    UUID: 'sync-task-1',
    parent: profile.UUID,
    name: 'Created on desktop',
    syncUpdatedAt: now().toISOString(),
  };
  const journal = {
    UUID: 'journal-1',
    parent: profile.UUID,
    title: 'Shared post',
    entry: 'A post with a conversation.',
    visibility: 'global',
    createdAt: now().toISOString(),
    syncUpdatedAt: now().toISOString(),
  };
  await desktop.documents.put(STORES.player, profile);
  await desktop.documents.put(STORES.todo, task);
  await desktop.documents.put(STORES.journal, journal);
  await desktop.runtime.queueActiveProfileState(profile.UUID, now().toISOString());
  await desktop.runtime.flushReferenceOutbox();

  await synchronizeMobileReferenceData(mobileHarness.connection, server, {
    uploadReferences: false,
    forceActiveProfile: true,
  });
  assert.deepEqual(await mobileHarness.documents.get(STORES.todo, task.UUID), {
    ...task,
    workspaceId: 'workspace:default',
    createdByPlayerId: profile.UUID,
  });
  assert.deepEqual(await mobileHarness.documents.get(STORES.player, profile.UUID), profile);
  assert.equal(mobileHarness.connection.getActivePlayerUUID(), profile.UUID);
  assert.equal(await mobileHarness.client.query({
    sql: 'SELECT COUNT(*) FROM sync_reference_outbox',
    result: 'value',
  }), 0, 'server writes must not echo back into the mobile outbox');

  currentTime += 60_000;
  await desktop.documents.put(STORES.todo, {
    ...task,
    name: 'Renamed on desktop',
    syncUpdatedAt: now().toISOString(),
  });
  await desktop.runtime.flushReferenceOutbox();
  await synchronizeMobileReferenceData(mobileHarness.connection, server, {
    uploadReferences: false,
    forceActiveProfile: true,
  });
  assert.equal((await mobileHarness.documents.get(STORES.todo, task.UUID)).name, 'Renamed on desktop');

  currentTime += 60_000;
  const mobileTask = {
    UUID: 'sync-task-mobile-1',
    parent: profile.UUID,
    name: 'Created on mobile',
    syncUpdatedAt: now().toISOString(),
  };
  const mobileComment = {
    UUID: 'comment-mobile-1',
    journalUUID: journal.UUID,
    authorUUID: profile.UUID,
    text: 'Posted from mobile',
    createdAt: now().toISOString(),
    updatedAt: now().toISOString(),
    syncUpdatedAt: now().toISOString(),
  };
  await mobileHarness.documents.put(STORES.todo, mobileTask);
  await mobileHarness.documents.put(STORES.journalComment, mobileComment);
  await mobileHarness.runtime.flushReferenceOutbox();
  await synchronizeMobileReferenceData(desktop.connection, server, {
    uploadReferences: false,
  });
  assert.equal((await desktop.documents.get(STORES.todo, mobileTask.UUID)).name, 'Created on mobile');
  assert.equal(
    (await desktop.documents.get(STORES.journalComment, mobileComment.UUID)).text,
    'Posted from mobile',
  );

  currentTime += 60_000;
  await desktop.documents.remove(STORES.todo, task.UUID);
  await desktop.runtime.flushReferenceOutbox();
  await synchronizeMobileReferenceData(mobileHarness.connection, server, {
    uploadReferences: false,
    forceActiveProfile: true,
  });
  assert.equal(await mobileHarness.documents.get(STORES.todo, task.UUID), null);

  currentTime += 60_000;
  const sharedEvent = {
    UUID: 'custom-event-desktop-1',
    parent: profile.UUID,
    name: 'Desktop Event',
    syncUpdatedAt: now().toISOString(),
  };
  await desktop.documents.put(STORES.customEvent, sharedEvent);
  await synchronizeReferenceTypes(desktop.connection, {
    recordTypes: PROMPT_REFERENCE_TYPES,
    reason: 'desktop-event-create-test',
  });
  await synchronizeReferenceTypes(mobileHarness.connection, {
    recordTypes: PROMPT_REFERENCE_TYPES,
    reason: 'mobile-event-create-test',
  });
  assert.equal(
    (await mobileHarness.documents.get(STORES.customEvent, sharedEvent.UUID)).name,
    'Desktop Event',
  );

  currentTime += 60_000;
  await desktop.documents.remove(STORES.customEvent, sharedEvent.UUID);
  await synchronizeReferenceTypes(desktop.connection, {
    recordTypes: PROMPT_REFERENCE_TYPES,
    reason: 'desktop-event-delete-test',
  });
  await synchronizeReferenceTypes(mobileHarness.connection, {
    recordTypes: PROMPT_REFERENCE_TYPES,
    reason: 'mobile-event-delete-test',
  });
  assert.equal(await mobileHarness.documents.get(STORES.customEvent, sharedEvent.UUID), null);
  assert.equal(await desktop.runtime.referenceOutbox.diagnostics().then((value) => value.pending), 0);
  assert.equal(await mobileHarness.runtime.referenceOutbox.diagnostics().then((value) => value.pending), 0);
});

test('targeted live sync converges sessions and matches without uploading background records', async (t) => {
  let currentTime = new Date('2026-08-03T15:00:00.000Z').getTime();
  const now = () => new Date(currentTime);
  const server = new InMemoryReferenceServer();
  const desktop = await createEndpoint({ server, deviceId: 'desktop-live-test', now });
  const mobileHarness = await createEndpoint({ server, deviceId: 'mobile-live-test', now });
  t.after(async () => {
    await desktop.client.close();
    await mobileHarness.client.close();
  });

  const session = {
    UUID: 'action-session-live-1',
    parent: 'profile-live-1',
    taskUUID: 'task-live-1',
    status: 'active',
    paused: false,
    startedAt: now().toISOString(),
    syncUpdatedAt: now().toISOString(),
  };
  const match = {
    UUID: 'match-live-1',
    parent: 'profile-live-1',
    status: 'active',
    playerScore: 4,
    opponentScore: 2,
    startedAt: now().toISOString(),
    syncUpdatedAt: now().toISOString(),
  };
  const backgroundJournal = {
    UUID: 'journal-background-1',
    parent: 'profile-live-1',
    title: 'Background record',
    entry: 'This must not ride the live lane.',
    createdAt: now().toISOString(),
    syncUpdatedAt: now().toISOString(),
  };
  await desktop.documents.put(STORES.actionSession, session);
  await desktop.documents.put(STORES.match, match);
  await desktop.documents.put(STORES.journal, backgroundJournal);

  const uploaded = await synchronizeReferenceTypes(desktop.connection, {
    recordTypes: LIVE_REFERENCE_TYPES,
    reason: 'desktop-live-test',
  });
  assert.equal(uploaded.uploaded, 2);
  assert.equal(server.records.has(`journal:${backgroundJournal.UUID}`), false);
  assert.equal((await desktop.runtime.referenceOutbox.listPending()).length, 1);

  const downloaded = await synchronizeReferenceTypes(mobileHarness.connection, {
    recordTypes: LIVE_REFERENCE_TYPES,
    reason: 'mobile-live-test',
  });
  assert.equal(downloaded.applied, 2);
  assert.equal((await mobileHarness.documents.get(STORES.actionSession, session.UUID)).paused, false);
  assert.equal((await mobileHarness.documents.get(STORES.match, match.UUID)).playerScore, 4);

  currentTime += 1_000;
  await mobileHarness.documents.put(STORES.actionSession, {
    ...session,
    paused: true,
    pausedAt: now().toISOString(),
    syncUpdatedAt: now().toISOString(),
  });
  // The downloaded Match intentionally still carries its older sync clock.
  // The command must advance that clock or the server will reject a fresh
  // pause/forfeit/cancellation as an older record.
  await patchMatchStateCommand(
    mobileHarness.connection,
    await mobileHarness.documents.get(STORES.match, match.UUID),
    { status: 'cancelled', completedAt: now().toISOString() },
    { origin: 'mobile', at: now().toISOString() },
  );
  await synchronizeReferenceTypes(mobileHarness.connection, {
    recordTypes: LIVE_REFERENCE_TYPES,
    reason: 'mobile-live-update-test',
  });
  await synchronizeReferenceTypes(desktop.connection, {
    recordTypes: LIVE_REFERENCE_TYPES,
    reason: 'desktop-live-refresh-test',
  });

  assert.equal((await desktop.documents.get(STORES.actionSession, session.UUID)).paused, true);
  const convergedMatch = await desktop.documents.get(STORES.match, match.UUID);
  assert.equal(convergedMatch.status, 'cancelled');
  assert.equal(convergedMatch.syncUpdatedAt, now().toISOString());
  assert.equal(
    (await desktop.runtime.referenceOutbox.listPending()).some((record) => record.recordType === 'journal'),
    true,
  );
});
