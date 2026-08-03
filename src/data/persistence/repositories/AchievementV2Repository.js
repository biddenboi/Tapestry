import { ACHIEVEMENT_DEFINITIONS_V2 } from '@domain/achievements-v2/AchievementCatalogV2.js';

function parse(value, fallback) {
  try {
    return value == null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}

export class AchievementV2Repository {
  constructor(facade) {
    this.facade = facade;
  }

  get adapter() {
    return this.facade?.persistenceRuntime?.sqliteStorageAdapter;
  }

  async synchronizeDefinitions() {
    const now = new Date().toISOString();
    await this.adapter.executeAtomic({
      commandId: `achievement-v2-definitions:${ACHIEVEMENT_DEFINITIONS_V2[0]?.version || 2}`,
      label: 'achievement-v2-definition-sync',
      statements: ACHIEVEMENT_DEFINITIONS_V2.map((entry) => ({
        sql: `INSERT INTO achievement_v2_definitions(
                achievement_id,version,category,title,description,permanence,visibility,
                secret,evidence_rule_id,progress_rule_id,reward_json,retired_at,replacement_id
              ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
              ON CONFLICT(achievement_id,version) DO UPDATE SET
                category=excluded.category,title=excluded.title,description=excluded.description,
                permanence=excluded.permanence,visibility=excluded.visibility,secret=excluded.secret,
                evidence_rule_id=excluded.evidence_rule_id,progress_rule_id=excluded.progress_rule_id,
                reward_json=excluded.reward_json,retired_at=excluded.retired_at,replacement_id=excluded.replacement_id`,
        bind: [
          entry.id, entry.version, entry.category, entry.title, entry.description,
          entry.permanence, entry.visibility, entry.secret ? 1 : 0, entry.evidenceRuleId,
          entry.progressRuleId, JSON.stringify(entry.reward || {}), entry.retiredAt || null,
          entry.replacementId || null,
        ],
        result: 'changes',
      })),
    });
    return { synchronized: true, count: ACHIEVEMENT_DEFINITIONS_V2.length, updatedAt: now };
  }

  async getEvidence(profileId) {
    const rows = await this.adapter.query({
      sql: `SELECT id,profile_id AS profileId,achievement_id AS achievementId,
                   achievement_version AS achievementVersion,source_event_ids_json AS sourceEventIds,
                   evidence_snapshot_json AS evidenceSnapshot,earned_at AS earnedAt,
                   processor_version AS processorVersion,migration_source AS migrationSource
            FROM achievement_evidence_receipts WHERE profile_id=? ORDER BY earned_at DESC,id`,
      bind: [profileId],
      result: 'all',
    });
    return rows.map((row) => ({
      ...row,
      sourceEventIds: parse(row.sourceEventIds, []),
      evidenceSnapshot: parse(row.evidenceSnapshot, {}),
    }));
  }

  async getLegacyAwards(profileId) {
    const rows = await this.adapter.query({
      sql: `SELECT profile_id AS profileId,legacy_key AS legacyKey,title_snapshot AS title,
                   earned_at AS earnedAt,evidence_json AS evidence,migration_source AS migrationSource,
                   preserved_selected AS preservedSelected
            FROM achievement_legacy_awards WHERE profile_id=? ORDER BY earned_at DESC,legacy_key`,
      bind: [profileId],
      result: 'all',
    });
    return rows.map((row) => ({
      ...row,
      evidence: parse(row.evidence, {}),
      preservedSelected: Boolean(row.preservedSelected),
    }));
  }

  async getRecords(profileId) {
    const rows = await this.adapter.query({
      sql: `SELECT profile_id AS profileId,record_id AS recordId,value_json AS value,
                   achieved_at AS achievedAt,updated_at AS updatedAt,source_event_id AS sourceEventId
            FROM achievement_records WHERE profile_id=? ORDER BY record_id`,
      bind: [profileId],
      result: 'all',
    });
    return rows.map((row) => ({ ...row, value: parse(row.value, null) }));
  }

  async getRecord(profileId, recordId) {
    const row = await this.adapter.query({
      sql: `SELECT profile_id AS profileId,record_id AS recordId,value_json AS value,
                   achieved_at AS achievedAt,updated_at AS updatedAt,source_event_id AS sourceEventId
            FROM achievement_records WHERE profile_id=? AND record_id=?`,
      bind: [profileId, recordId],
      result: 'one',
    });
    return row ? { ...row, value: parse(row.value, null) } : null;
  }

  async getProgress(profileId, achievementId, version) {
    const row = await this.adapter.query({
      sql: `SELECT progress_json AS progress FROM achievement_v2_progress
            WHERE profile_id=? AND achievement_id=? AND achievement_version=?`,
      bind: [profileId, achievementId, version],
      result: 'one',
    });
    return parse(row?.progress, {});
  }

  async getAllProgress(profileId) {
    const rows = await this.adapter.query({
      sql: `SELECT achievement_id AS achievementId,achievement_version AS achievementVersion,
                   progress_json AS progress,updated_at AS updatedAt
            FROM achievement_v2_progress WHERE profile_id=? ORDER BY achievement_id`,
      bind: [profileId],
      result: 'all',
    });
    return rows.map((row) => ({ ...row, progress: parse(row.progress, {}) }));
  }

  async getStageReceipts(profileId, achievementId = null) {
    const rows = await this.adapter.query({
      sql: `SELECT id,profile_id AS profileId,achievement_id AS achievementId,
                   achievement_version AS achievementVersion,stage,threshold_value AS thresholdValue,
                   source_event_ids_json AS sourceEventIds,evidence_snapshot_json AS evidenceSnapshot,
                   earned_at AS earnedAt,migration_source AS migrationSource
            FROM achievement_stage_receipts
            WHERE profile_id=? AND (? IS NULL OR achievement_id=?)
            ORDER BY achievement_id,stage`,
      bind: [profileId, achievementId, achievementId],
      result: 'all',
    });
    return rows.map((row) => ({
      ...row,
      sourceEventIds: parse(row.sourceEventIds, []),
      evidenceSnapshot: parse(row.evidenceSnapshot, {}),
    }));
  }

  async awardStage({ profileId, definition, stage, thresholdValue, sourceEventIds, evidenceSnapshot, earnedAt, migrationSource = null }) {
    const id = `achievement-stage:${profileId}:${definition.id}:${definition.version}:${stage}`;
    const changes = await this.adapter.query({
      sql: `INSERT INTO achievement_stage_receipts(
              id,profile_id,achievement_id,achievement_version,stage,threshold_value,
              source_event_ids_json,evidence_snapshot_json,earned_at,migration_source
            ) VALUES(?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(profile_id,achievement_id,achievement_version,stage) DO NOTHING`,
      bind: [
        id, profileId, definition.id, definition.version, stage, thresholdValue,
        JSON.stringify(sourceEventIds || []), JSON.stringify(evidenceSnapshot || {}),
        earnedAt || new Date().toISOString(), migrationSource,
      ],
      result: 'changes',
    });
    return { id, awarded: Number(changes?.changes ?? changes) > 0 };
  }

  async saveProgress(profileId, definition, progress, now = new Date().toISOString()) {
    await this.adapter.query({
      sql: `INSERT INTO achievement_v2_progress(
              profile_id,achievement_id,achievement_version,progress_json,updated_at
            ) VALUES(?,?,?,?,?)
            ON CONFLICT(profile_id,achievement_id,achievement_version) DO UPDATE SET
              progress_json=excluded.progress_json,updated_at=excluded.updated_at`,
      bind: [profileId, definition.id, definition.version, JSON.stringify(progress), now],
      result: 'changes',
    });
  }

  async award({ profileId, definition, sourceEventIds, evidenceSnapshot, earnedAt, processorVersion, migrationSource = null }) {
    const id = `achievement-v2:${profileId}:${definition.id}:${definition.version}`;
    const changes = await this.adapter.query({
      sql: `INSERT INTO achievement_evidence_receipts(
              id,profile_id,achievement_id,achievement_version,source_event_ids_json,
              evidence_snapshot_json,earned_at,processor_version,migration_source
            ) VALUES(?,?,?,?,?,?,?,?,?)
            ON CONFLICT(profile_id,achievement_id,achievement_version) DO NOTHING`,
      bind: [
        id, profileId, definition.id, definition.version,
        JSON.stringify(sourceEventIds), JSON.stringify(evidenceSnapshot),
        earnedAt, processorVersion, migrationSource,
      ],
      result: 'changes',
    });
    return { id, awarded: Number(changes?.changes ?? changes) > 0 };
  }

  async upsertRecord({ profileId, recordId, value, achievedAt, sourceEventId }) {
    const existing = await this.adapter.query({
      sql: 'SELECT value_json AS value FROM achievement_records WHERE profile_id=? AND record_id=?',
      bind: [profileId, recordId],
      result: 'one',
    });
    const prior = parse(existing?.value, null);
    const nextNumber = Number(value?.value ?? value);
    const priorNumber = Number(prior?.value ?? prior);
    if (Number.isFinite(priorNumber) && Number.isFinite(nextNumber) && priorNumber >= nextNumber) {
      return { updated: false, value: prior };
    }
    const now = new Date().toISOString();
    await this.adapter.query({
      sql: `INSERT INTO achievement_records(
              profile_id,record_id,value_json,achieved_at,updated_at,source_event_id
            ) VALUES(?,?,?,?,?,?)
            ON CONFLICT(profile_id,record_id) DO UPDATE SET
              value_json=excluded.value_json,achieved_at=excluded.achieved_at,
              updated_at=excluded.updated_at,source_event_id=excluded.source_event_id`,
      bind: [profileId, recordId, JSON.stringify(value), achievedAt, now, sourceEventId],
      result: 'changes',
    });
    return { updated: true, value };
  }

  async setRecord({ profileId, recordId, value, achievedAt, sourceEventId }) {
    const now = new Date().toISOString();
    await this.adapter.query({
      sql: `INSERT INTO achievement_records(
              profile_id,record_id,value_json,achieved_at,updated_at,source_event_id
            ) VALUES(?,?,?,?,?,?)
            ON CONFLICT(profile_id,record_id) DO UPDATE SET
              value_json=excluded.value_json,achieved_at=excluded.achieved_at,
              updated_at=excluded.updated_at,source_event_id=excluded.source_event_id`,
      bind: [profileId, recordId, JSON.stringify(value), achievedAt || now, now, sourceEventId],
      result: 'changes',
    });
    return { updated: true, value };
  }
}

export default AchievementV2Repository;
