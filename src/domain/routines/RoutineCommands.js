export const ROUTINE_TYPE = Object.freeze({ day: 'day', night: 'night' });
export const ROUTINE_STATUS = Object.freeze({
  pending: 'pending',
  active: 'active',
  completed: 'completed',
  skipped: 'skipped',
});

const ROUTINE_TYPES = new Set(Object.values(ROUTINE_TYPE));

function requiredText(value, label) {
  const text = String(value || '').trim();
  if (!text) throw new TypeError(`${label} is required.`);
  return text;
}

function iso(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError('Routine timestamps must be valid.');
  return date.toISOString();
}

export function localRoutineDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError('Routine dates must be valid.');
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function normalizeSteps(steps = []) {
  return (Array.isArray(steps) ? steps : [])
    .map((step, index) => {
      const label = String(typeof step === 'string' ? step : step?.label || '').trim();
      if (!label) return null;
      return {
        id: String(typeof step === 'object' && step?.id ? step.id : `step-${index + 1}`),
        label: label.slice(0, 500),
      };
    })
    .filter(Boolean);
}

function parseSteps(value) {
  if (Array.isArray(value)) return normalizeSteps(value);
  try { return normalizeSteps(JSON.parse(String(value || '[]'))); } catch { return []; }
}

function routineFromRow(row) {
  if (!row) return null;
  return Object.freeze({
    id: String(row.id),
    playerId: String(row.playerId),
    routineType: String(row.routineType),
    scheduledFor: String(row.scheduledFor),
    status: String(row.status),
    currentStepId: row.currentStepId || null,
    steps: parseSteps(row.stepsJson),
    startedAt: row.startedAt || null,
    completedAt: row.completedAt || null,
    updatedAt: String(row.updatedAt),
    version: Number(row.version || 1),
  });
}

const RUN_COLUMNS = `
  id,
  player_id AS playerId,
  routine_type AS routineType,
  scheduled_for AS scheduledFor,
  status,
  current_step_id AS currentStepId,
  steps_json AS stepsJson,
  started_at AS startedAt,
  completed_at AS completedAt,
  updated_at AS updatedAt,
  version
`;

async function sqliteClient(databaseConnection) {
  await databaseConnection.ready;
  const client = databaseConnection.persistenceRuntime?.sqliteStorageAdapter?.client;
  if (!client?.query) throw new Error('Routine commands require the SQLite runtime.');
  return client;
}

function commandContext(databaseConnection, input) {
  return databaseConnection.createSyncCommandContext?.(input)
    || { origin: input.origin || 'desktop', enqueueSync: false };
}

export async function getRoutineRun(databaseConnection, runId) {
  const client = await sqliteClient(databaseConnection);
  return routineFromRow(await client.query({
    sql: `SELECT ${RUN_COLUMNS} FROM routine_runs WHERE id=?`,
    bind: [String(runId)],
    result: 'one',
  }));
}

export async function getActiveRoutineRun(databaseConnection, playerId) {
  if (!playerId) return null;
  const client = await sqliteClient(databaseConnection);
  return routineFromRow(await client.query({
    sql: `SELECT ${RUN_COLUMNS}
          FROM routine_runs
          WHERE player_id=? AND status='active'
          ORDER BY updated_at DESC,id LIMIT 1`,
    bind: [String(playerId)],
    result: 'one',
  }));
}

export async function getRoutineStepReceipts(databaseConnection, runId) {
  const client = await sqliteClient(databaseConnection);
  return client.query({
    sql: `SELECT id,routine_run_id AS routineRunId,step_id AS stepId,
                 completed_at AS completedAt,operation_id AS operationId
          FROM routine_step_receipts WHERE routine_run_id=?
          ORDER BY completed_at,step_id`,
    bind: [String(runId)],
    result: 'all',
  });
}

export async function startRoutineRun(databaseConnection, {
  playerId,
  routineType,
  scheduledFor = localRoutineDate(),
  steps = [],
  at = new Date(),
  origin = 'desktop',
  enqueueSync = true,
  operationId: requestedOperationId = null,
} = {}) {
  const owner = requiredText(playerId, 'Routine player');
  const type = requiredText(routineType, 'Routine type');
  if (!ROUTINE_TYPES.has(type)) throw new TypeError(`Unsupported routine type: ${type}`);
  const day = requiredText(scheduledFor, 'Routine scheduled date');
  const runId = `routine:${owner}:${type}:${day}`;
  const existing = await getRoutineRun(databaseConnection, runId);
  if (existing?.status === ROUTINE_STATUS.completed) return existing;
  const timestamp = iso(at);
  const normalizedSteps = normalizeSteps(steps);
  const run = {
    id: runId,
    playerId: owner,
    routineType: type,
    scheduledFor: day,
    status: ROUTINE_STATUS.active,
    currentStepId: existing?.currentStepId || normalizedSteps[0]?.id || null,
    steps: normalizedSteps.length ? normalizedSteps : existing?.steps || [],
    startedAt: existing?.startedAt || timestamp,
    completedAt: null,
    updatedAt: timestamp,
    version: Number(existing?.version || 0) + 1,
  };
  const operationId = requestedOperationId || `routine-start:${runId}`;
  const sync = commandContext(databaseConnection, {
    origin,
    enqueueSync,
    operationId,
    playerId: owner,
    commandType: 'startRoutineRun',
    entityType: 'routine-run',
    entityId: runId,
    baseVersion: existing?.version || 0,
    payload: { run },
    occurredAt: timestamp,
  });
  await databaseConnection.commitAtomicMutation({
    operationId,
    label: 'routine-run-start',
    additionalStatements: [{
      sql: `INSERT INTO routine_runs(
              id,player_id,routine_type,scheduled_for,status,current_step_id,
              steps_json,started_at,completed_at,updated_at,version
            ) VALUES(?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET
              status=excluded.status,current_step_id=excluded.current_step_id,
              steps_json=excluded.steps_json,started_at=COALESCE(routine_runs.started_at,excluded.started_at),
              completed_at=NULL,updated_at=excluded.updated_at,version=excluded.version
            WHERE routine_runs.status<>'completed'`,
      bind: [run.id, run.playerId, run.routineType, run.scheduledFor, run.status,
        run.currentStepId, JSON.stringify(run.steps), run.startedAt, null, run.updatedAt, run.version],
      result: 'changes',
    }],
    sync,
  });
  return getRoutineRun(databaseConnection, runId);
}

export async function completeRoutineStep(databaseConnection, runId, stepId, {
  at = new Date(),
  origin = 'desktop',
  enqueueSync = true,
  operationId: requestedOperationId = null,
} = {}) {
  const current = await getRoutineRun(databaseConnection, runId);
  if (!current || current.status !== ROUTINE_STATUS.active) return current;
  const step = current.steps.find((candidate) => candidate.id === String(stepId));
  if (!step) throw new TypeError('The routine step is not part of this run.');
  const receipts = await getRoutineStepReceipts(databaseConnection, runId);
  if (receipts.some((receipt) => receipt.stepId === step.id)) return current;
  const timestamp = iso(at);
  const completed = new Set(receipts.map((receipt) => receipt.stepId));
  completed.add(step.id);
  const nextStepId = current.steps.find((candidate) => !completed.has(candidate.id))?.id || null;
  const operationId = requestedOperationId || `routine-step:${runId}:${step.id}`;
  const next = {
    ...current,
    currentStepId: nextStepId,
    updatedAt: timestamp,
    version: current.version + 1,
  };
  const sync = commandContext(databaseConnection, {
    origin,
    enqueueSync,
    operationId,
    playerId: current.playerId,
    commandType: 'completeRoutineStep',
    entityType: 'routine-step',
    entityId: `${runId}:${step.id}`,
    payload: { run: next, stepId: step.id, completedAt: timestamp },
    occurredAt: timestamp,
  });
  await databaseConnection.commitAtomicMutation({
    operationId,
    label: 'routine-step-complete',
    additionalStatements: [
      {
        sql: `INSERT INTO routine_step_receipts(id,routine_run_id,step_id,completed_at,operation_id)
              VALUES(?,?,?,?,?) ON CONFLICT(routine_run_id,step_id) DO NOTHING`,
        bind: [`receipt:${runId}:${step.id}`, runId, step.id, timestamp, operationId],
        result: 'changes',
      },
      {
        sql: `UPDATE routine_runs
              SET current_step_id=?,updated_at=?,version=version+1
              WHERE id=? AND status='active'
                AND EXISTS(SELECT 1 FROM routine_step_receipts WHERE operation_id=?)`,
        bind: [nextStepId, timestamp, runId, operationId],
        result: 'changes',
      },
    ],
    sync,
  });
  return getRoutineRun(databaseConnection, runId);
}

export async function completeRoutineRun(databaseConnection, runId, {
  at = new Date(),
  origin = 'desktop',
  enqueueSync = true,
  operationId: requestedOperationId = null,
} = {}) {
  const current = await getRoutineRun(databaseConnection, runId);
  if (!current || current.status === ROUTINE_STATUS.completed) return current;
  const timestamp = iso(at);
  const next = {
    ...current,
    status: ROUTINE_STATUS.completed,
    currentStepId: null,
    completedAt: timestamp,
    updatedAt: timestamp,
    version: current.version + 1,
  };
  const operationId = requestedOperationId || `routine-complete:${runId}`;
  const sync = commandContext(databaseConnection, {
    origin,
    enqueueSync,
    operationId,
    playerId: current.playerId,
    commandType: 'completeRoutineRun',
    entityType: 'routine-run',
    entityId: runId,
    baseVersion: current.version,
    payload: { run: next },
    occurredAt: timestamp,
  });
  await databaseConnection.commitAtomicMutation({
    operationId,
    label: 'routine-run-complete',
    additionalStatements: [{
      sql: `UPDATE routine_runs
            SET status='completed',current_step_id=NULL,completed_at=?,updated_at=?,version=version+1
            WHERE id=? AND status<>'completed'`,
      bind: [timestamp, timestamp, runId],
      result: 'changes',
    }],
    sync,
  });
  return getRoutineRun(databaseConnection, runId);
}

export function buildRemoteRoutineRunStatements(run) {
  if (!run?.id) throw new TypeError('A canonical routine run is required.');
  const steps = normalizeSteps(run.steps);
  return [{
    sql: `INSERT INTO routine_runs(
            id,player_id,routine_type,scheduled_for,status,current_step_id,
            steps_json,started_at,completed_at,updated_at,version
          ) VALUES(?,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(id) DO UPDATE SET
            status=excluded.status,current_step_id=excluded.current_step_id,
            steps_json=excluded.steps_json,started_at=COALESCE(routine_runs.started_at,excluded.started_at),
            completed_at=excluded.completed_at,updated_at=excluded.updated_at,
            version=MAX(routine_runs.version,excluded.version)`,
    bind: [run.id, run.playerId, run.routineType, run.scheduledFor, run.status,
      run.currentStepId || null, JSON.stringify(steps), run.startedAt || null,
      run.completedAt || null, run.updatedAt, Number(run.version || 1)],
    result: 'changes',
  }];
}

export function buildRemoteRoutineStepStatements(payload, operationId) {
  const run = payload?.run;
  const stepId = requiredText(payload?.stepId, 'Routine step');
  return [
    ...buildRemoteRoutineRunStatements(run),
    {
      sql: `INSERT INTO routine_step_receipts(id,routine_run_id,step_id,completed_at,operation_id)
            VALUES(?,?,?,?,?) ON CONFLICT(routine_run_id,step_id) DO NOTHING`,
      bind: [`receipt:${run.id}:${stepId}`, run.id, stepId, iso(payload.completedAt), operationId],
      result: 'changes',
    },
  ];
}
