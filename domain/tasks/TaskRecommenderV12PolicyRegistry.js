import { STORES } from '@domain/constants.js';
import {
  createTaskRecommenderV12Model,
  restoreTaskRecommenderV12Model,
  serializeTaskRecommenderV12Model,
} from './TaskRecommenderV12Model.js';

export const TASK_RECOMMENDER_V12_POLICY_MANIFEST_SCHEMA_VERSION = 1;
export const TASK_RECOMMENDER_V12_CHAMPION_POINTER_SCHEMA_VERSION = 1;
export const TASK_RECOMMENDER_V12_EXPERIMENT_SCHEMA_VERSION = 1;
export const TASK_RECOMMENDER_V12_ASSIGNMENT_SCHEMA_VERSION = 1;
export const TASK_RECOMMENDER_V12_PROMOTION_AUDIT_SCHEMA_VERSION = 1;

export const TASK_RECOMMENDER_V12_POLICY_MANIFEST_PREFIX = 'task-recommender-v12-policy';
export const TASK_RECOMMENDER_V12_CHAMPION_POINTER_PREFIX = 'task-recommender-v12-champion';
export const TASK_RECOMMENDER_V12_EXPERIMENT_PREFIX = 'task-recommender-v12-experiment';
export const TASK_RECOMMENDER_V12_ACTIVE_EXPERIMENT_PREFIX = 'task-recommender-v12-active-experiment';
export const TASK_RECOMMENDER_V12_ASSIGNMENT_PREFIX = 'task-recommender-v12-assignment';
export const TASK_RECOMMENDER_V12_PROMOTION_AUDIT_PREFIX = 'task-recommender-v12-promotion-audit';

export const TASK_RECOMMENDER_V12_POLICY_ROLES = Object.freeze([
  'neutral',
  'current',
  'candidate',
  'ablation',
]);

export const TASK_RECOMMENDER_V12_ASSIGNMENT_METHODS = Object.freeze([
  'micro-randomized',
  'switchback',
]);

const ROLE_SET = new Set(TASK_RECOMMENDER_V12_POLICY_ROLES);
const METHOD_SET = new Set(TASK_RECOMMENDER_V12_ASSIGNMENT_METHODS);

function finite(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function normalizedISO(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError('A valid timestamp is required');
  return date.toISOString();
}

function stableSerialize(value) {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${stableSerialize(value[key])}`
  )).join(',')}}`;
}

export function taskRecommenderV12EvidenceFingerprint(value) {
  const text = stableSerialize(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}:${text.length}`;
}

function deterministicUnitInterval(value) {
  const fingerprint = taskRecommenderV12EvidenceFingerprint(value);
  const hexadecimal = fingerprint.split(':')[1];
  return Number.parseInt(hexadecimal, 16) / 0x1_0000_0000;
}

function portableClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function required(value, label) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new TypeError(`${label} is required`);
  return normalized;
}

async function getRecord(databaseConnection, UUID) {
  if (typeof databaseConnection?.get !== 'function') return null;
  return databaseConnection.get(STORES.appSetting, UUID).catch(() => null);
}

async function putRecords(databaseConnection, label, records = []) {
  if (!records.length || typeof databaseConnection?.add !== 'function') return;
  if (typeof databaseConnection.commitAtomicMutation === 'function') {
    await databaseConnection.commitAtomicMutation({
      label,
      puts: records.map((record) => ({ store: STORES.appSetting, record })),
    });
    return;
  }
  for (const record of records) await databaseConnection.add(STORES.appSetting, record);
}

export function taskRecommenderV12PolicyManifestId(playerUUID, policyUUID) {
  return `${TASK_RECOMMENDER_V12_POLICY_MANIFEST_PREFIX}:${required(playerUUID, 'playerUUID')}:${required(policyUUID, 'policyUUID')}`;
}

export function taskRecommenderV12ChampionPointerId(playerUUID) {
  return `${TASK_RECOMMENDER_V12_CHAMPION_POINTER_PREFIX}:${required(playerUUID, 'playerUUID')}`;
}

export function taskRecommenderV12ExperimentId(playerUUID, experimentUUID) {
  return `${TASK_RECOMMENDER_V12_EXPERIMENT_PREFIX}:${required(playerUUID, 'playerUUID')}:${required(experimentUUID, 'experimentUUID')}`;
}

export function taskRecommenderV12ActiveExperimentId(playerUUID) {
  return `${TASK_RECOMMENDER_V12_ACTIVE_EXPERIMENT_PREFIX}:${required(playerUUID, 'playerUUID')}`;
}

function policyUUID(role, model, policyOptions = {}, parentPolicyUUID = null) {
  const fingerprint = taskRecommenderV12EvidenceFingerprint({
    model: serializeTaskRecommenderV12Model(model),
    policyOptions,
    parentPolicyUUID,
  });
  return `${role}:${fingerprint.split(':')[1]}`;
}

export function createTaskRecommenderV12PolicyManifest({
  playerUUID,
  policyUUID: requestedPolicyUUID = null,
  role,
  model,
  targetModel = model,
  parentPolicyUUID = null,
  policyOptions = {},
  trainingEvidence = null,
  createdAt = new Date(),
} = {}) {
  const owner = required(playerUUID, 'playerUUID');
  if (!ROLE_SET.has(role)) throw new TypeError(`Unsupported v12 policy role: ${role}`);
  const normalizedModel = restoreTaskRecommenderV12Model(serializeTaskRecommenderV12Model(model));
  const normalizedTarget = restoreTaskRecommenderV12Model(
    serializeTaskRecommenderV12Model(targetModel),
  );
  const UUID = requestedPolicyUUID || policyUUID(
    role,
    normalizedModel,
    policyOptions,
    parentPolicyUUID,
  );
  const serializedModel = serializeTaskRecommenderV12Model(normalizedModel);
  const serializedTarget = serializeTaskRecommenderV12Model(normalizedTarget);
  const checkpointBytes = JSON.stringify({
    model: serializedModel,
    targetModel: serializedTarget,
  }).length;
  const generatedAt = normalizedISO(createdAt);
  return Object.freeze({
    policyManifestSchemaVersion: TASK_RECOMMENDER_V12_POLICY_MANIFEST_SCHEMA_VERSION,
    runtime: 'v12',
    planningSemantics: 'verified-work-only',
    legacyPlanningSemantics: false,
    playerUUID: owner,
    policyUUID: UUID,
    role,
    parentPolicyUUID: parentPolicyUUID == null ? null : String(parentPolicyUUID),
    modelVersion: normalizedModel.modelVersion,
    checkpointFingerprint: taskRecommenderV12EvidenceFingerprint({
      model: serializedModel,
      targetModel: serializedTarget,
    }),
    checkpointBytes,
    policyOptions: portableClone(policyOptions) || {},
    trainingEvidence: portableClone(trainingEvidence),
    createdAt: generatedAt,
    model: serializedModel,
    targetModel: serializedTarget,
  });
}

function manifestRecord(manifest) {
  return {
    UUID: taskRecommenderV12PolicyManifestId(manifest.playerUUID, manifest.policyUUID),
    parent: manifest.playerUUID,
    value: manifest,
    updatedAt: manifest.createdAt,
  };
}

function pointerRecord(playerUUID, championPolicyUUID, previousChampionPolicyUUID, reason, now) {
  const updatedAt = normalizedISO(now);
  return {
    UUID: taskRecommenderV12ChampionPointerId(playerUUID),
    parent: String(playerUUID),
    value: {
      championPointerSchemaVersion: TASK_RECOMMENDER_V12_CHAMPION_POINTER_SCHEMA_VERSION,
      runtime: 'v12',
      championPolicyUUID: String(championPolicyUUID),
      previousChampionPolicyUUID: previousChampionPolicyUUID == null
        ? null
        : String(previousChampionPolicyUUID),
      reason: String(reason || 'registry-initialization'),
      updatedAt,
    },
    updatedAt,
  };
}

export async function getTaskRecommenderV12PolicyManifest(
  databaseConnection,
  playerUUID,
  requestedPolicyUUID,
) {
  const record = await getRecord(
    databaseConnection,
    taskRecommenderV12PolicyManifestId(playerUUID, requestedPolicyUUID),
  );
  const value = record?.value;
  if (Number(value?.policyManifestSchemaVersion)
      !== TASK_RECOMMENDER_V12_POLICY_MANIFEST_SCHEMA_VERSION
    || value.runtime !== 'v12'
    || value.legacyPlanningSemantics !== false
    || !ROLE_SET.has(value.role)
    || String(value.playerUUID) !== String(playerUUID)
    || String(value.policyUUID) !== String(requestedPolicyUUID)) return null;
  try {
    restoreTaskRecommenderV12Model(value.model);
    restoreTaskRecommenderV12Model(value.targetModel);
    return value;
  } catch {
    return null;
  }
}

export async function ensureTaskRecommenderV12PolicyRegistry(
  databaseConnection,
  playerUUID,
  checkpoint,
  options = {},
) {
  const owner = required(playerUUID, 'playerUUID');
  const pointerId = taskRecommenderV12ChampionPointerId(owner);
  const existingPointer = await getRecord(databaseConnection, pointerId);
  const existingChampion = existingPointer?.value?.championPolicyUUID
    ? await getTaskRecommenderV12PolicyManifest(
      databaseConnection,
      owner,
      existingPointer.value.championPolicyUUID,
    )
    : null;
  if (existingChampion) {
    return Object.freeze({ pointer: existingPointer.value, champion: existingChampion });
  }

  const now = options.now || new Date();
  const neutralModel = createTaskRecommenderV12Model({ seed: `profile:${owner}:neutral-policy` });
  const neutral = createTaskRecommenderV12PolicyManifest({
    playerUUID: owner,
    role: 'neutral',
    model: neutralModel,
    policyOptions: {
      minimumChampionEvidence: Number.MAX_SAFE_INTEGER,
      baselineEligible: false,
    },
    createdAt: now,
  });
  const current = createTaskRecommenderV12PolicyManifest({
    playerUUID: owner,
    role: 'current',
    model: checkpoint?.model || neutralModel,
    targetModel: checkpoint?.targetModel || checkpoint?.model || neutralModel,
    parentPolicyUUID: neutral.policyUUID,
    trainingEvidence: checkpoint?.manifest || null,
    createdAt: now,
  });
  const pointer = pointerRecord(owner, current.policyUUID, null, 'registry-initialization', now);
  await putRecords(databaseConnection, 'task-recommender-v12-policy-registry-initialize', [
    manifestRecord(neutral),
    manifestRecord(current),
    pointer,
  ]);
  return Object.freeze({ pointer: pointer.value, champion: current, neutral });
}

export async function registerTaskRecommenderV12PolicyCandidate(
  databaseConnection,
  playerUUID,
  checkpoint,
  options = {},
) {
  const registry = await ensureTaskRecommenderV12PolicyRegistry(
    databaseConnection,
    playerUUID,
    options.parentCheckpoint || checkpoint,
    options,
  );
  const role = options.role || 'candidate';
  const manifest = createTaskRecommenderV12PolicyManifest({
    playerUUID,
    policyUUID: options.policyUUID,
    role,
    model: checkpoint.model,
    targetModel: checkpoint.targetModel || checkpoint.model,
    parentPolicyUUID: options.parentPolicyUUID || registry.pointer.championPolicyUUID,
    policyOptions: options.policyOptions,
    trainingEvidence: options.trainingEvidence || checkpoint.manifest || null,
    createdAt: options.now || new Date(),
  });
  await putRecords(databaseConnection, `task-recommender-v12-register-${role}`, [
    manifestRecord(manifest),
  ]);
  return manifest;
}

function normalizeExperiment(input = {}) {
  const method = String(input.assignmentMethod || 'micro-randomized');
  if (!METHOD_SET.has(method)) throw new TypeError(`Unsupported assignment method: ${method}`);
  if (!Array.isArray(input.arms) || input.arms.length < 2) {
    throw new TypeError('A controlled v12 experiment requires at least two arms');
  }
  const raw = input.arms.map((arm, index) => ({
    armUUID: required(arm.armUUID || `arm-${index + 1}`, 'armUUID'),
    policyUUID: required(arm.policyUUID, 'policyUUID'),
    weight: Math.max(0, finite(arm.weight, 1)),
  }));
  const total = raw.reduce((sum, arm) => sum + arm.weight, 0);
  if (!(total > 0)) throw new TypeError('Experiment arm weights must have positive mass');
  const arms = raw.map((arm) => Object.freeze({
    ...arm,
    assignmentProbability: arm.weight / total,
  }));
  return Object.freeze({
    experimentSchemaVersion: TASK_RECOMMENDER_V12_EXPERIMENT_SCHEMA_VERSION,
    runtime: 'v12',
    experimentUUID: required(input.experimentUUID, 'experimentUUID'),
    playerUUID: required(input.playerUUID, 'playerUUID'),
    status: input.status === 'paused' ? 'paused' : 'active',
    assignmentMethod: method,
    assignmentUnit: input.assignmentUnit || (
      method === 'switchback' ? 'time-block' : 'decision-or-observation-session'
    ),
    switchbackIntervalMs: Math.max(60_000, Math.floor(finite(
      input.switchbackIntervalMs,
      6 * 60 * 60 * 1000,
    ))),
    startedAt: normalizedISO(input.startedAt || new Date()),
    arms: Object.freeze(arms),
  });
}

export async function saveTaskRecommenderV12Experiment(
  databaseConnection,
  input = {},
) {
  const experiment = normalizeExperiment(input);
  for (const arm of experiment.arms) {
    const manifest = await getTaskRecommenderV12PolicyManifest(
      databaseConnection,
      experiment.playerUUID,
      arm.policyUUID,
    );
    if (!manifest) throw new TypeError(`Experiment arm has no valid v12 policy: ${arm.policyUUID}`);
  }
  const updatedAt = new Date().toISOString();
  const experimentRecord = {
    UUID: taskRecommenderV12ExperimentId(experiment.playerUUID, experiment.experimentUUID),
    parent: experiment.playerUUID,
    value: experiment,
    updatedAt,
  };
  const activeRecord = {
    UUID: taskRecommenderV12ActiveExperimentId(experiment.playerUUID),
    parent: experiment.playerUUID,
    value: {
      experimentSchemaVersion: TASK_RECOMMENDER_V12_EXPERIMENT_SCHEMA_VERSION,
      runtime: 'v12',
      experimentUUID: experiment.status === 'active' ? experiment.experimentUUID : null,
      updatedAt,
    },
    updatedAt,
  };
  await putRecords(databaseConnection, 'task-recommender-v12-save-controlled-experiment', [
    experimentRecord,
    activeRecord,
  ]);
  return experiment;
}

export function assignTaskRecommenderV12Experiment(experimentInput, context = {}) {
  const experiment = normalizeExperiment(experimentInput);
  const occurredAt = normalizedISO(context.occurredAt || new Date());
  const occurredAtMs = new Date(occurredAt).getTime();
  const startedAtMs = new Date(experiment.startedAt).getTime();
  const blockIndex = Math.max(0, Math.floor(
    (occurredAtMs - startedAtMs) / experiment.switchbackIntervalMs,
  ));
  const assignmentKey = experiment.assignmentMethod === 'switchback'
    ? `${experiment.experimentUUID}:block:${blockIndex}`
    : `${experiment.experimentUUID}:${required(context.assignmentKey, 'assignmentKey')}`;
  const bucket = deterministicUnitInterval(assignmentKey);
  let cursor = bucket;
  let selected = experiment.arms.at(-1);
  for (const arm of experiment.arms) {
    cursor -= arm.assignmentProbability;
    if (cursor <= 0) {
      selected = arm;
      break;
    }
  }
  const assignmentUUID = taskRecommenderV12EvidenceFingerprint({
    experimentUUID: experiment.experimentUUID,
    assignmentKey,
  }).split(':')[1];
  const assignedAt = experiment.assignmentMethod === 'switchback'
    ? new Date(startedAtMs + blockIndex * experiment.switchbackIntervalMs).toISOString()
    : occurredAt;
  return Object.freeze({
    assignmentSchemaVersion: TASK_RECOMMENDER_V12_ASSIGNMENT_SCHEMA_VERSION,
    runtime: 'v12',
    experimentUUID: experiment.experimentUUID,
    playerUUID: experiment.playerUUID,
    assignmentUUID,
    assignmentMethod: experiment.assignmentMethod,
    assignmentUnit: experiment.assignmentUnit,
    assignmentKey,
    blockIndex: experiment.assignmentMethod === 'switchback' ? blockIndex : null,
    deterministicBucket: bucket,
    armUUID: selected.armUUID,
    policyUUID: selected.policyUUID,
    assignmentProbability: selected.assignmentProbability,
    support: experiment.arms.map((arm) => ({
      armUUID: arm.armUUID,
      policyUUID: arm.policyUUID,
      probability: arm.assignmentProbability,
    })),
    assignedAt,
  });
}

async function activeExperiment(databaseConnection, playerUUID) {
  const active = await getRecord(
    databaseConnection,
    taskRecommenderV12ActiveExperimentId(playerUUID),
  );
  const experimentUUID = active?.value?.runtime === 'v12'
    ? active.value.experimentUUID
    : null;
  if (!experimentUUID) return null;
  const record = await getRecord(
    databaseConnection,
    taskRecommenderV12ExperimentId(playerUUID, experimentUUID),
  );
  if (record?.value?.runtime !== 'v12' || record.value.status !== 'active') return null;
  try {
    return normalizeExperiment(record.value);
  } catch {
    return null;
  }
}

async function persistAssignment(databaseConnection, assignment) {
  if (!assignment || typeof databaseConnection?.add !== 'function') return;
  const UUID = `${TASK_RECOMMENDER_V12_ASSIGNMENT_PREFIX}:${assignment.playerUUID}:${assignment.assignmentUUID}`;
  const existing = await getRecord(databaseConnection, UUID);
  if (existing?.value) {
    if (stableSerialize(existing.value) !== stableSerialize(assignment)) {
      throw new Error('A persisted v12 assignment cannot be changed');
    }
    return;
  }
  await putRecords(databaseConnection, 'task-recommender-v12-persist-assignment', [{
    UUID,
    parent: assignment.playerUUID,
    value: assignment,
    updatedAt: assignment.assignedAt,
  }]);
}

function servingCheckpoint(manifest) {
  return {
    model: restoreTaskRecommenderV12Model(manifest.model),
    targetModel: restoreTaskRecommenderV12Model(manifest.targetModel),
    manifest: manifest.trainingEvidence || null,
  };
}

export async function resolveTaskRecommenderV12ServingPolicy(
  databaseConnection,
  playerUUID,
  checkpoint,
  context = {},
) {
  if (typeof databaseConnection?.get !== 'function'
    || typeof databaseConnection?.add !== 'function') {
    return Object.freeze({
      checkpoint,
      policyManifest: null,
      assignment: Object.freeze({
        assignmentSchemaVersion: TASK_RECOMMENDER_V12_ASSIGNMENT_SCHEMA_VERSION,
        runtime: 'v12',
        assignmentMethod: 'champion-pointer',
        policyUUID: 'ephemeral-current',
        assignmentProbability: 1,
        assignedAt: normalizedISO(context.occurredAt || new Date()),
      }),
    });
  }
  const registry = await ensureTaskRecommenderV12PolicyRegistry(
    databaseConnection,
    playerUUID,
    checkpoint,
    context,
  );
  const experiment = await activeExperiment(databaseConnection, playerUUID);
  if (experiment) {
    const assignment = assignTaskRecommenderV12Experiment(experiment, context);
    const assignedManifest = await getTaskRecommenderV12PolicyManifest(
      databaseConnection,
      playerUUID,
      assignment.policyUUID,
    );
    if (assignedManifest) {
      const enriched = Object.freeze({
        ...assignment,
        policyRole: assignedManifest.role,
        checkpointBytes: assignedManifest.checkpointBytes,
        checkpointFingerprint: assignedManifest.checkpointFingerprint,
      });
      await persistAssignment(databaseConnection, enriched);
      return Object.freeze({
        checkpoint: servingCheckpoint(assignedManifest),
        policyManifest: assignedManifest,
        assignment: enriched,
      });
    }
  }
  const champion = registry.champion;
  return Object.freeze({
    checkpoint: servingCheckpoint(champion),
    policyManifest: champion,
    assignment: Object.freeze({
      assignmentSchemaVersion: TASK_RECOMMENDER_V12_ASSIGNMENT_SCHEMA_VERSION,
      runtime: 'v12',
      assignmentMethod: 'champion-pointer',
      playerUUID: String(playerUUID),
      policyUUID: champion.policyUUID,
      policyRole: champion.role,
      assignmentProbability: 1,
      checkpointBytes: champion.checkpointBytes,
      checkpointFingerprint: champion.checkpointFingerprint,
      assignedAt: normalizedISO(context.occurredAt || new Date()),
    }),
  });
}

export async function promoteTaskRecommenderV12Champion(
  databaseConnection,
  playerUUID,
  candidatePolicyUUID,
  promotionDecision,
  options = {},
) {
  if (typeof databaseConnection?.commitAtomicMutation !== 'function') {
    throw new Error('V12 champion promotion requires atomic persistence');
  }
  if (!promotionDecision?.eligible
    || promotionDecision.runtime !== 'v12'
    || Number(promotionDecision.promotionDecisionSchemaVersion) !== 1
    || promotionDecision.effectiveness?.eligible !== true
    || promotionDecision.feasibility?.eligible !== true
    || !promotionDecision.evidenceFingerprint
    || String(promotionDecision.candidatePolicyUUID) !== String(candidatePolicyUUID)) {
    throw new Error('A v12 policy cannot be promoted without passing effectiveness and feasibility gates');
  }
  const candidate = await getTaskRecommenderV12PolicyManifest(
    databaseConnection,
    playerUUID,
    candidatePolicyUUID,
  );
  if (!candidate || !['candidate', 'ablation'].includes(candidate.role)) {
    throw new TypeError('Promotion requires a valid candidate or ablation v12 manifest');
  }
  const pointerId = taskRecommenderV12ChampionPointerId(playerUUID);
  const pointer = await getRecord(databaseConnection, pointerId);
  const previous = pointer?.value?.championPolicyUUID;
  if (!previous) throw new Error('The v12 champion pointer is missing');
  if (String(promotionDecision.championPolicyUUID) !== String(previous)) {
    throw new Error('Promotion evidence does not compare against the active v12 champion');
  }
  const now = normalizedISO(options.now || new Date());
  const nextPointer = pointerRecord(
    playerUUID,
    candidatePolicyUUID,
    previous,
    'controlled-evidence-promotion',
    now,
  );
  const audit = {
    UUID: `${TASK_RECOMMENDER_V12_PROMOTION_AUDIT_PREFIX}:${playerUUID}:${taskRecommenderV12EvidenceFingerprint({ candidatePolicyUUID, now }).split(':')[1]}`,
    parent: String(playerUUID),
    value: {
      promotionAuditSchemaVersion: TASK_RECOMMENDER_V12_PROMOTION_AUDIT_SCHEMA_VERSION,
      runtime: 'v12',
      action: 'promote',
      previousChampionPolicyUUID: previous,
      championPolicyUUID: String(candidatePolicyUUID),
      evidenceFingerprint: taskRecommenderV12EvidenceFingerprint(promotionDecision),
      promotionDecision: portableClone(promotionDecision),
      occurredAt: now,
    },
    updatedAt: now,
  };
  await putRecords(databaseConnection, 'task-recommender-v12-atomic-champion-promotion', [
    nextPointer,
    audit,
  ]);
  return Object.freeze({ pointer: nextPointer.value, audit: audit.value });
}

export async function rollbackTaskRecommenderV12Champion(
  databaseConnection,
  playerUUID,
  options = {},
) {
  if (typeof databaseConnection?.commitAtomicMutation !== 'function') {
    throw new Error('V12 champion rollback requires atomic persistence');
  }
  const pointerId = taskRecommenderV12ChampionPointerId(playerUUID);
  const pointer = await getRecord(databaseConnection, pointerId);
  const current = pointer?.value?.championPolicyUUID;
  const previous = options.policyUUID || pointer?.value?.previousChampionPolicyUUID;
  if (!current || !previous) throw new Error('No previous v12 champion is available for rollback');
  const previousManifest = await getTaskRecommenderV12PolicyManifest(
    databaseConnection,
    playerUUID,
    previous,
  );
  if (!previousManifest) throw new Error('The rollback target is not a valid v12 policy');
  const now = normalizedISO(options.now || new Date());
  const nextPointer = pointerRecord(
    playerUUID,
    previous,
    current,
    'immediate-rollback',
    now,
  );
  const audit = {
    UUID: `${TASK_RECOMMENDER_V12_PROMOTION_AUDIT_PREFIX}:${playerUUID}:${taskRecommenderV12EvidenceFingerprint({ previous, now }).split(':')[1]}`,
    parent: String(playerUUID),
    value: {
      promotionAuditSchemaVersion: TASK_RECOMMENDER_V12_PROMOTION_AUDIT_SCHEMA_VERSION,
      runtime: 'v12',
      action: 'rollback',
      previousChampionPolicyUUID: current,
      championPolicyUUID: String(previous),
      occurredAt: now,
    },
    updatedAt: now,
  };
  await putRecords(databaseConnection, 'task-recommender-v12-immediate-champion-rollback', [
    nextPointer,
    audit,
  ]);
  return Object.freeze({ pointer: nextPointer.value, audit: audit.value });
}
