import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const protocolSource = await readFile(new URL('./TaskRecommenderProtocol.js', import.meta.url), 'utf8');
const protocolUrl = `data:text/javascript;base64,${Buffer.from(protocolSource).toString('base64')}`;
const protocol = await import(protocolUrl);

const ledgerSourceRaw = await readFile(new URL('./TaskRecommenderLedger.js', import.meta.url), 'utf8');
const ledgerSource = ledgerSourceRaw
  .replace(
    "import { STORES } from '@domain/constants.js';",
    "const STORES = { recommenderEvent: 'taskRecommendations' };",
  )
  .replace("from './TaskRecommenderProtocol.js';", `from '${protocolUrl}';`);
const ledger = await import(`data:text/javascript;base64,${Buffer.from(ledgerSource).toString('base64')}`);

class MemoryDb {
  records = new Map();

  async get(store, UUID) {
    return this.records.get(`${store}:${UUID}`) || null;
  }

  async add(store, record) {
    this.records.set(`${store}:${record.UUID}`, record);
    return record;
  }

  async getPlayerStore(store, parent) {
    return [...this.records.entries()]
      .filter(([key]) => key.startsWith(`${store}:`))
      .map(([, record]) => record)
      .filter((record) => record.parent === parent);
  }
}

test('protocol rejects semantic and unknown event types by allowing only observable facts', () => {
  assert.throws(() => protocol.createTaskRecommenderProtocolEvent({
    playerUUID: 'player-1',
    decisionUUID: 'decision-1',
    type: 'fatigue_detected',
    occurredAt: '2026-07-11T10:00:00.000Z',
  }), /Unsupported task recommender event type/);

  const event = protocol.createTaskRecommenderProtocolEvent({
    playerUUID: 'player-1',
    decisionUUID: 'decision-1',
    type: protocol.TASK_RECOMMENDER_EVENT_TYPES.recommendationPresented,
    eventKey: 'presented',
    occurredAt: '2026-07-11T10:00:00.000Z',
    payload: { visibleMs: 1200 },
  });
  assert.equal(event.protocolFamily, 'task-recommender-v12');
  assert.equal(event.type, 'recommendation_presented');
  assert.equal(event.payload.visibleMs, 1200);
  assert.equal(Object.isFrozen(event), true);
});

test('append-only ledger assigns monotonic sequence and is idempotent', async () => {
  const db = new MemoryDb();
  const input = {
    playerUUID: 'player-1',
    decisionUUID: 'decision-1',
    type: protocol.TASK_RECOMMENDER_EVENT_TYPES.decisionCreated,
    eventKey: 'created',
    occurredAt: '2026-07-11T10:00:00.000Z',
  };
  const first = await ledger.appendTaskRecommenderProtocolEvent(db, input);
  const duplicate = await ledger.appendTaskRecommenderProtocolEvent(db, input);
  const presented = await ledger.appendTaskRecommenderProtocolEvent(db, {
    ...input,
    type: protocol.TASK_RECOMMENDER_EVENT_TYPES.recommendationPresented,
    eventKey: 'presented',
    occurredAt: '2026-07-11T10:00:01.000Z',
  });
  assert.equal(first.UUID, duplicate.UUID);
  assert.equal(first.sequence, 1);
  assert.equal(presented.sequence, 2);
  assert.equal((await ledger.getTaskRecommenderProtocolEvents(db, 'player-1')).length, 2);
});

test('decision reducer reconstructs accepted work without authored labels', () => {
  const base = {
    playerUUID: 'player-1',
    decisionUUID: 'decision-1',
    source: 'dojo',
    taskUUID: 'task-1',
  };
  const events = [
    protocol.createTaskRecommenderProtocolEvent({
      ...base,
      type: protocol.TASK_RECOMMENDER_EVENT_TYPES.decisionCreated,
      eventKey: 'created',
      sequence: 1,
      occurredAt: '2026-07-11T10:00:00.000Z',
      payload: { proposedDurationSeconds: 1500, observationSessionUUID: 'visit-1' },
    }),
    protocol.createTaskRecommenderProtocolEvent({
      ...base,
      type: protocol.TASK_RECOMMENDER_EVENT_TYPES.recommendationAccepted,
      eventKey: 'accepted',
      sequence: 2,
      occurredAt: '2026-07-11T10:00:05.000Z',
      payload: { acceptedDurationSeconds: 1200 },
    }),
    protocol.createTaskRecommenderProtocolEvent({
      ...base,
      type: protocol.TASK_RECOMMENDER_EVENT_TYPES.taskSessionFinished,
      eventKey: 'finished',
      sequence: 3,
      occurredAt: '2026-07-11T10:18:05.000Z',
      payload: { productiveSeconds: 1080 },
    }),
  ];
  const state = protocol.reduceTaskRecommenderDecision(events, 'decision-1');
  assert.equal(state.status, 'session-finished');
  assert.equal(state.proposedDurationSeconds, 1500);
  assert.equal(state.acceptedDurationSeconds, 1200);
  assert.equal(state.productiveSeconds, 1080);
  assert.equal(state.observationSessionUUID, 'visit-1');
  assert.deepEqual(state.violations, []);
});

test('decision reducer separates presentation from accumulated visibility and invalidation', () => {
  const base = {
    playerUUID: 'player-1', decisionUUID: 'decision-visible', taskUUID: 'task-1', source: 'dojo',
  };
  const created = protocol.createTaskRecommenderProtocolEvent({
    ...base,
    type: protocol.TASK_RECOMMENDER_EVENT_TYPES.decisionCreated,
    eventKey: 'created',
    sequence: 1,
    occurredAt: '2026-07-11T10:00:00.000Z',
  });
  const presented = protocol.createTaskRecommenderProtocolEvent({
    ...base,
    type: protocol.TASK_RECOMMENDER_EVENT_TYPES.recommendationPresented,
    eventKey: 'presented',
    sequence: 2,
    occurredAt: '2026-07-11T10:00:01.000Z',
    payload: { visibleMs: 500 },
  });
  const visibility = protocol.createTaskRecommenderProtocolEvent({
    ...base,
    type: protocol.TASK_RECOMMENDER_EVENT_TYPES.recommendationVisibilityAccumulated,
    eventKey: 'visibility:1',
    sequence: 3,
    occurredAt: '2026-07-11T10:00:02.000Z',
    payload: { visibleMs: 750 },
  });
  const visibleState = protocol.reduceTaskRecommenderDecision([
    created, presented, visibility,
  ]);
  assert.equal(visibleState.status, 'presented');
  assert.equal(visibleState.visibleMs, 1_250);
  assert.equal(visibleState.visibilityEventCount, 1);

  const invalidated = protocol.createTaskRecommenderProtocolEvent({
    ...base,
    decisionUUID: 'decision-invalidated',
    type: protocol.TASK_RECOMMENDER_EVENT_TYPES.recommendationInvalidated,
    eventKey: 'invalidated',
    occurredAt: '2026-07-11T10:00:01.000Z',
  });
  const invalidatedState = protocol.reduceTaskRecommenderDecision([
    { ...created, decisionUUID: 'decision-invalidated' },
    invalidated,
  ], 'decision-invalidated');
  assert.equal(invalidatedState.status, 'invalidated');
});

test('ledger ignores legacy rows during active reads', async () => {
  const db = new MemoryDb();
  await db.add('taskRecommendations', {
    UUID: 'legacy-decision-1', parent: 'player-1', type: 'next-task-impression',
  });
  const events = await ledger.getTaskRecommenderProtocolEvents(db, 'player-1');
  assert.deepEqual(events, []);
});
