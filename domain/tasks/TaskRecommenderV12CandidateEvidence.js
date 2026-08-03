import { STORES } from '@domain/constants.js';
import {
  TASK_RECOMMENDER_V12_ACTION_SCHEMA_VERSION,
  TASK_RECOMMENDER_V12_ENCODER_VERSION,
} from './TaskRecommenderV12Encoding.js';

export const TASK_RECOMMENDER_V12_CANDIDATE_MANIFEST_VERSION = 1;
export const TASK_RECOMMENDER_V12_TASK_SNAPSHOT_RECORD_VERSION = 1;
export const TASK_RECOMMENDER_V12_TASK_SNAPSHOT_PREFIX = 'task-recommender-v12-task-snapshot';

function stableSerialize(value) {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${stableSerialize(value[key])}`
  )).join(',')}}`;
}

export function taskRecommenderV12TaskSnapshotId(playerUUID, snapshot = {}) {
  if (!playerUUID || !snapshot?.contentHash) {
    throw new TypeError('Candidate evidence requires a player and content-addressed task snapshot');
  }
  return `${TASK_RECOMMENDER_V12_TASK_SNAPSHOT_PREFIX}:${playerUUID}:${snapshot.contentHash}`;
}

function portableConstraints(constraints = {}) {
  return Object.freeze(Object.fromEntries([
    'minDurationSeconds',
    'maxDurationSeconds',
    'hardMaxDurationSeconds',
    'targetDurationSeconds',
    'durationQuantumSeconds',
    'durationPointCount',
  ].flatMap((key) => (
    Number.isFinite(Number(constraints[key])) ? [[key, Number(constraints[key])]] : []
  ))));
}

export function buildTaskRecommenderV12CandidateEvidence({
  playerUUID,
  candidateActions = [],
  occurredAt,
  source,
  constraints = {},
} = {}) {
  if (!playerUUID) throw new TypeError('Candidate evidence requires playerUUID');
  const snapshotsById = new Map();
  const actions = [];
  for (const action of candidateActions || []) {
    const snapshot = action?.taskSnapshot;
    if (!snapshot?.UUID || !snapshot?.contentHash) {
      throw new TypeError('Every candidate action requires an immutable task snapshot');
    }
    const snapshotUUID = taskRecommenderV12TaskSnapshotId(playerUUID, snapshot);
    const previous = snapshotsById.get(snapshotUUID);
    if (previous && stableSerialize(previous) !== stableSerialize(snapshot)) {
      throw new Error('Task snapshot content hash collision');
    }
    snapshotsById.set(snapshotUUID, snapshot);
    actions.push(Object.freeze({
      actionKey: String(action.actionKey),
      actionSchemaVersion: TASK_RECOMMENDER_V12_ACTION_SCHEMA_VERSION,
      taskUUID: String(action.taskUUID),
      durationSeconds: Math.max(0, Number(action.durationSeconds) || 0),
      durationQuantumSeconds: Math.max(1, Number(action.durationQuantumSeconds) || 60),
      snapshotUUID,
      contentHash: String(snapshot.contentHash),
    }));
  }
  const snapshots = [...snapshotsById.entries()].map(([snapshotUUID, snapshot]) => Object.freeze({
    snapshotUUID,
    taskUUID: String(snapshot.UUID),
    contentHash: String(snapshot.contentHash),
  }));
  return Object.freeze({
    records: Object.freeze([...snapshotsById.entries()].map(([UUID, snapshot]) => Object.freeze({
      store: STORES.appSetting,
      record: Object.freeze({
        UUID,
        parent: String(playerUUID),
        value: Object.freeze({
          taskSnapshotRecordVersion: TASK_RECOMMENDER_V12_TASK_SNAPSHOT_RECORD_VERSION,
          encoderVersion: TASK_RECOMMENDER_V12_ENCODER_VERSION,
          contentHash: String(snapshot.contentHash),
          snapshot,
        }),
        updatedAt: occurredAt,
      }),
    }))),
    manifest: Object.freeze({
      candidateManifestVersion: TASK_RECOMMENDER_V12_CANDIDATE_MANIFEST_VERSION,
      actionSchemaVersion: TASK_RECOMMENDER_V12_ACTION_SCHEMA_VERSION,
      encoderVersion: TASK_RECOMMENDER_V12_ENCODER_VERSION,
      occurredAt,
      source: source == null ? null : String(source),
      constraints: portableConstraints(constraints),
      taskCount: snapshots.length,
      actionCount: actions.length,
      snapshots: Object.freeze(snapshots),
      actions: Object.freeze(actions),
    }),
  });
}

export async function validateTaskRecommenderV12CandidateEvidenceRecords(
  databaseConnection,
  evidence,
) {
  for (const put of evidence?.records || []) {
    const existing = await databaseConnection.get(put.store, put.record.UUID).catch(() => null);
    if (!existing) continue;
    if (stableSerialize(existing.value?.snapshot) !== stableSerialize(put.record.value?.snapshot)) {
      throw new Error('Stored task snapshot does not match its content address');
    }
  }
  return evidence;
}
