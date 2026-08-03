export const TASK_RECOMMENDER_V12_MIGRATION_CONTRACT_VERSION = 2;

export const TASK_RECOMMENDER_V11_SUPPORTED_PERSISTED_FORMATS = Object.freeze({
  weightsExport: Object.freeze({
    id: 'v11-weights-export',
    format: 'tapestry-task-recommender-weights',
    versions: Object.freeze([11]),
  }),
  rawWeights: Object.freeze({
    id: 'v11-raw-weights',
    format: null,
    versions: Object.freeze([11]),
  }),
  trainingDataV3: Object.freeze({
    id: 'v11-training-data-v3',
    format: 'tapestry-task-recommender-training-data',
    formatVersions: Object.freeze([3]),
  }),
  trainingDataV2: Object.freeze({
    id: 'v11-training-data-v2',
    format: 'tapestry-task-recommender-training-data',
    formatVersions: Object.freeze([2]),
  }),
  linkedFolderRecords: Object.freeze({
    id: 'v11-linked-folder-records',
    format: 'tapestry-v11-linked-folder-records',
    formatVersions: Object.freeze([1]),
  }),
});

/**
 * Field disposition for the one-time offline conversion. Raw v11 artifacts are
 * retained only until the converted v12 generation is durably committed. The
 * repair state retains corrupt or unsupported input for an explicit repair;
 * successful migration does not keep v11 runtime artifacts.
 */
export const TASK_RECOMMENDER_V11_FIELD_DISPOSITION = Object.freeze([
  Object.freeze({
    match: 'recommenderEvents[].UUID|recommendationEvents[].UUID',
    disposition: 'transformed',
    destination: 'protocolEvents[].legacySourceUUID',
    reason: 'Protocol event IDs are deterministic v12 IDs while preserving the legacy identity.',
  }),
  Object.freeze({
    match: 'recommenderEvents[].parent|recommendationEvents[].parent',
    disposition: 'retained',
    destination: 'protocolEvents[].parent',
    reason: 'Profile ownership remains authoritative.',
  }),
  Object.freeze({
    match: 'recommenderEvents[].source|recommendationEvents[].source',
    disposition: 'retained',
    destination: 'protocolEvents[].source',
    reason: 'The recommendation surface remains an observed fact.',
  }),
  Object.freeze({
    match: 'recommenderEvents[].taskUUID|recommendationEvents[].taskUUID',
    disposition: 'retained',
    destination: 'protocolEvents[].taskUUID',
    reason: 'The selected task identity remains an observed fact.',
  }),
  Object.freeze({
    match: 'recommenderEvents[].taskSnapshot|recommendationEvents[].taskSnapshot|referenceData.tasks[]|referenceData.todos[]',
    disposition: 'transformed',
    destination: 'protocolEvents[].payload.taskSnapshot',
    reason: 'Task facts are normalized to the v12 portable task snapshot contract.',
  }),
  Object.freeze({
    match: 'recommenderEvents[].createdAt|recommendationEvents[].createdAt|recommenderEvents[].outcomeAt|recommendationEvents[].outcomeAt',
    disposition: 'retained',
    destination: 'protocolEvents[].occurredAt',
    reason: 'Observed event time is retained.',
  }),
  Object.freeze({
    match: 'recommenderEvents[].decisionContext.raw|recommendationEvents[].decisionContext.raw',
    disposition: 'discarded',
    destination: null,
    reason: 'Old proxy, semantic, planning, and duration-candidate fields are not valid v12 facts.',
  }),
  Object.freeze({
    match: 'recommenderEvents[].outcomeHistory|recommendationEvents[].outcomeHistory',
    disposition: 'transformed',
    destination: 'protocol outcome events',
    reason: 'Append-only legacy outcomes become typed v12 protocol facts.',
  }),
  Object.freeze({
    match: 'recommenderEvents[].probability|recommendationEvents[].probability',
    disposition: 'transformed',
    destination: 'protocolEvents[].payload.behaviorProbability',
    reason: 'Legacy propensities are retained but explicitly marked unverifiable when reconstruction evidence is absent.',
  }),
  Object.freeze({
    match: 'recommenderEvents[].features|recommendationEvents[].features|recommenderEvents[].portableDerived.features|recommendationEvents[].portableDerived.features',
    disposition: 'discarded',
    destination: null,
    reason: 'v11 feature vectors are not compatible with the v12 encoder and are recomputed from raw facts.',
  }),
  Object.freeze({
    match: 'proxyHead|proxyHeads|syntheticWeights|semanticFeatures|semanticFeatureVector|semanticEmbedding|planningAuthority|planningScore|planningCandidates|durationLadder|durationLadders|durationCandidates|candidateDurations',
    disposition: 'discarded',
    destination: null,
    reason: 'Removed runtime fields are never rewritten into v12 protocol facts, settings, checkpoints, or recovery records.',
  }),
  Object.freeze({
    match: 'recommenderEvents[].reward|recommendationEvents[].reward|recommenderEvents[].labels|recommendationEvents[].labels|recommenderEvents[].portableDerived.reward|recommendationEvents[].portableDerived.reward',
    disposition: 'discarded',
    destination: null,
    reason: 'v11 derived labels and rewards are not imported into v12 training state.',
  }),
  Object.freeze({
    match: 'behaviorEvents[]',
    disposition: 'transformed',
    destination: 'protocol outcome events when targetType is task',
    reason: 'Only task behavior facts are admitted; unrelated product behavior is excluded.',
  }),
  Object.freeze({
    match: 'settings.continuousTraining|settings.minimumEventsBeforeTraining|settings.minimumResolvedDecisionsBeforeTraining',
    disposition: 'transformed',
    destination: 'task-recommender-v12-settings',
    reason: 'Supported operating preferences are normalized into the v12 settings contract.',
  }),
  Object.freeze({
    match: 'settings.weights|settings.weightControls|settings.diagnostics',
    disposition: 'discarded',
    destination: null,
    reason: 'v11 weight editing and diagnostics have no v12 runtime representation.',
  }),
  Object.freeze({
    match: 'weights|featureCounts|stumps|headModels|utilityWeights|deepGate|embeddingDimensions',
    disposition: 'discarded',
    destination: null,
    reason: 'v11 learned parameters cannot initialize the v12 recurrent Bayesian model.',
  }),
  Object.freeze({
    match: 'trainedAt|trainingEvents|trainedThroughAt|trainedThroughEventId|trainingMode|validationLoss|syntheticBootstrapEvents',
    disposition: 'discarded',
    destination: null,
    reason: 'v11 training provenance cannot establish a v12 checkpoint and is removed after durable conversion.',
  }),
  Object.freeze({
    match: 'algorithm|policyVersion|featureSchemaVersion|rewardSchemaVersion|modelVersion',
    disposition: 'transformed',
    destination: 'migrationEvidence.sourceVersions',
    reason: 'Legacy version identifiers become source provenance, not v12 runtime identifiers.',
  }),
]);

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function inspectWeights(value) {
  if (value?.format && value.format !== 'tapestry-task-recommender-weights') return null;
  const isPersistedWeightsRecord = object(value?.value)
    && /^taskRecommenderWeights(?::|$)/.test(String(value.UUID || ''));
  const payload = isPersistedWeightsRecord ? value.value : value;
  if (!object(payload)) return null;
  if (value?.format === 'tapestry-task-recommender-weights') {
    return Number(value.modelVersion) === 11 ? 'v11-weights-export' : null;
  }
  const looksLikeWeights = isPersistedWeightsRecord
    || object(payload.weights)
    || String(payload.algorithm || '').includes('v11');
  return looksLikeWeights && Number(payload.modelVersion) === 11 ? 'v11-raw-weights' : null;
}

export function inspectTaskRecommenderV11PersistedArtifact(value) {
  if (!object(value)) return Object.freeze({ supported: false, sourceFormat: null, reason: 'not-an-object' });

  const weightsFormat = inspectWeights(value);
  if (weightsFormat) {
    return Object.freeze({
      supported: true,
      sourceFormat: weightsFormat,
      sourceModelVersion: 11,
      migrationMode: 'offline-version-detection',
    });
  }

  if (value.format === 'tapestry-task-recommender-training-data') {
    const version = Number(value.formatVersion || 1);
    if (version === 3 || version === 2) {
      return Object.freeze({
        supported: true,
        sourceFormat: `v11-training-data-v${version}`,
        sourceModelVersion: Number(value.modelVersion) || 11,
        migrationMode: 'raw-facts-to-v12-protocol',
      });
    }
    return Object.freeze({
      supported: false,
      sourceFormat: 'v11-training-data-unsupported',
      reason: `unsupported-format-version:${version}`,
    });
  }

  if (value.format === 'tapestry-v11-linked-folder-records' && Number(value.formatVersion) === 1) {
    const appSettings = Array.isArray(value.appSettings) ? value.appSettings : [];
    const taskRecommendations = Array.isArray(value.taskRecommendations)
      ? value.taskRecommendations
      : [];
    return Object.freeze({
      supported: true,
      sourceFormat: 'v11-linked-folder-records',
      sourceModelVersion: 11,
      migrationMode: 'persisted-records-to-v12-bundle',
      counts: Object.freeze({
        appSettings: appSettings.length,
        taskRecommendations: taskRecommendations.length,
      }),
    });
  }

  return Object.freeze({ supported: false, sourceFormat: null, reason: 'unknown-format' });
}

export function buildTaskRecommenderV11MigrationPlan(value, { targetPlayerUUID = null } = {}) {
  const inspection = inspectTaskRecommenderV11PersistedArtifact(value);
  if (!inspection.supported) throw new TypeError(`Unsupported v11 recommender artifact: ${inspection.reason}`);
  return Object.freeze({
    contractVersion: TASK_RECOMMENDER_V12_MIGRATION_CONTRACT_VERSION,
    sourceFormat: inspection.sourceFormat,
    sourceModelVersion: inspection.sourceModelVersion,
    targetPlayerUUID: targetPlayerUUID == null ? null : String(targetPlayerUUID),
    writesActiveArtifacts: true,
    stagesV12BeforeLegacyDiscard: true,
    retainsSourceUntilDurableCommit: true,
    retainsSourceAfterSuccessfulCommit: false,
    repairStateOnUnsupportedOrCorruptInput: true,
    runtimeFallbackAllowed: false,
    migrationMode: inspection.migrationMode,
    fieldDisposition: TASK_RECOMMENDER_V11_FIELD_DISPOSITION,
  });
}
