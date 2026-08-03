import { STORES } from '@domain/constants.js';
import {
  compareTaskRecommenderProtocolEvents,
  createTaskRecommenderProtocolEvent,
  isTaskRecommenderProtocolEvent,
} from './TaskRecommenderProtocol.js';

async function playerRows(databaseConnection, playerUUID) {
  if (!databaseConnection?.getPlayerStore || !playerUUID) return [];
  return databaseConnection.getPlayerStore(STORES.recommenderEvent, playerUUID).catch(() => []);
}

export async function getTaskRecommenderProtocolEvents(databaseConnection, playerUUID) {
  const rows = await playerRows(databaseConnection, playerUUID);
  return rows.filter(isTaskRecommenderProtocolEvent).sort(compareTaskRecommenderProtocolEvents);
}

export function prepareTaskRecommenderProtocolEvents(inputs = [], existingRows = []) {
  if (!inputs.length) return [];
  const playerUUID = String(inputs[0]?.playerUUID || inputs[0]?.parent || '').trim();
  if (!playerUUID) throw new TypeError('Task recommender ledger requires a playerUUID');
  const protocolRows = (existingRows || []).filter(isTaskRecommenderProtocolEvent);
  const byId = new Map(protocolRows.map((event) => [String(event.UUID), event]));
  const byIdempotency = new Map(protocolRows.map((event) => [String(event.idempotencyKey), event]));
  let nextSequence = protocolRows.reduce((maximum, event) => (
    Math.max(maximum, Number.isFinite(Number(event.sequence)) ? Number(event.sequence) : 0)
  ), 0) + 1;
  const results = [];
  for (const input of inputs) {
    if (String(input?.playerUUID || input?.parent || '') !== playerUUID) {
      throw new TypeError('A task recommender ledger batch cannot span players');
    }
    const candidate = createTaskRecommenderProtocolEvent({
      ...input,
      sequence: input.sequence || nextSequence,
    });
    const existing = byId.get(String(candidate.UUID))
      || byIdempotency.get(String(candidate.idempotencyKey));
    if (existing) {
      results.push(existing);
      continue;
    }
    byId.set(String(candidate.UUID), candidate);
    byIdempotency.set(String(candidate.idempotencyKey), candidate);
    results.push(candidate);
    nextSequence += 1;
  }
  return results;
}

async function persistPrepared(databaseConnection, prepared, existingRows, additionalPuts = []) {
  const existingIds = new Set((existingRows || []).map((event) => String(event.UUID)));
  const additions = prepared.filter((event) => !existingIds.has(String(event.UUID)));
  if (!additions.length && !additionalPuts.length) return prepared;
  if (typeof databaseConnection.commitAtomicMutation === 'function') {
    await databaseConnection.commitAtomicMutation({
      label: 'task-recommender-v12-ledger-append',
      puts: [
        ...additionalPuts,
        ...additions.map((record) => ({ store: STORES.recommenderEvent, record })),
      ],
    });
  } else {
    for (const put of additionalPuts) await databaseConnection.add(put.store, put.record);
    for (const record of additions) await databaseConnection.add(STORES.recommenderEvent, record);
  }
  return prepared;
}

export async function appendTaskRecommenderProtocolEvents(
  databaseConnection,
  inputs = [],
  options = {},
) {
  if (!databaseConnection?.add) throw new TypeError('Task recommender ledger requires a database connection');
  if (!inputs.length) return [];
  const playerUUID = String(inputs[0]?.playerUUID || inputs[0]?.parent || '').trim();
  if (!playerUUID) throw new TypeError('Task recommender ledger requires a playerUUID');
  const rows = await playerRows(databaseConnection, playerUUID);
  const prepared = prepareTaskRecommenderProtocolEvents(inputs, rows);
  return persistPrepared(databaseConnection, prepared, rows, options.additionalPuts || []);
}

export async function appendTaskRecommenderProtocolEvent(databaseConnection, input = {}) {
  return (await appendTaskRecommenderProtocolEvents(databaseConnection, [input]))[0] || null;
}
