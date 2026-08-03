export const DEFAULT_WORKSPACE_ID = 'workspace:default';

export function planningWorkspaceId(record, fallback = DEFAULT_WORKSPACE_ID) {
  const value = String(record?.workspaceId || record?.workspace_id || '').trim();
  return value || fallback;
}

export function planningCreatorId(record, fallback = null) {
  const value = record?.createdByPlayerId
    ?? record?.created_by_player_id
    ?? record?.parent
    ?? record?.playerUUID
    ?? fallback;
  const normalized = String(value || '').trim();
  return normalized || null;
}

export function withWorkspacePlanningScope(record, {
  workspaceId = DEFAULT_WORKSPACE_ID,
  createdByPlayerId = null,
} = {}) {
  if (!record || typeof record !== 'object') return record;
  return {
    ...record,
    workspaceId: planningWorkspaceId(record, workspaceId),
    createdByPlayerId: planningCreatorId(record, createdByPlayerId),
  };
}

export function isPlanningRecordInWorkspace(record, workspaceId = DEFAULT_WORKSPACE_ID) {
  return planningWorkspaceId(record) === String(workspaceId);
}

export function dedupePlanningRecords(records = []) {
  const byId = new Map();
  for (const record of records) {
    if (!record?.UUID) continue;
    const current = byId.get(String(record.UUID));
    if (!current) {
      byId.set(String(record.UUID), record);
      continue;
    }
    const currentTime = new Date(current.updatedAt || current.createdAt || 0).getTime() || 0;
    const candidateTime = new Date(record.updatedAt || record.createdAt || 0).getTime() || 0;
    if (candidateTime >= currentTime) byId.set(String(record.UUID), record);
  }
  return [...byId.values()];
}

export default DEFAULT_WORKSPACE_ID;
