import { STORES } from '@domain/constants.js';
import { VALID_THEME_IDS } from '@domain/themes/ThemeRegistry.js';

const DOMAIN_COUNT_STORES = Object.freeze({
  profiles: STORES.player,
  tasks: STORES.todo,
  workEvidence: STORES.task,
  goals: STORES.project,
  milestones: STORES.goalMilestone,
  matches: STORES.match,
  chronicle: STORES.journal,
  stories: STORES.chronicleStory,
  achievements: STORES.achievementReceipt,
  inventory: STORES.inventory,
  purchases: STORES.transaction,
  resources: STORES.resource,
  roadStats: STORES.contributionRoadStat,
  roadChoices: STORES.contributionRoadChoice,
  roadUnlocks: STORES.contributionRoadUnlock,
  interfaceReveals: STORES.interfaceRevealReceipt,
});

function countDuplicates(records, keyFor) {
  const seen = new Set();
  let duplicates = 0;
  for (const record of records) {
    const key = keyFor(record);
    if (!key) continue;
    if (seen.has(key)) duplicates += 1;
    else seen.add(key);
  }
  return duplicates;
}

export class DataIntegrityService {
  constructor(facade) {
    if (!facade) throw new Error('DataIntegrityService requires a database facade.');
    this.facade = facade;
  }

  get adapter() {
    return this.facade.persistenceRuntime?.sqliteStorageAdapter;
  }

  async _safeCount(sql, bind = []) {
    try {
      return Number(await this.adapter.query({ sql, bind, result: 'value' })) || 0;
    } catch {
      return 0;
    }
  }

  async verify({ persistReport = true } = {}) {
    await this.facade.ready;
    await this.facade.compactWritePromise;
    const integrity = await this.adapter.integrityCheck({
      mode: 'full',
      reason: 'settings-verify-save',
    }, { timeoutMs: 30_000 });
    const status = await this.adapter.status({ timeoutMs: 10_000 });
    const schemaVersion = status?.migrations?.at?.(-1)?.id
      || status?.metadata?.['schema.latest_migration']
      || 'unknown';

    const recordCounts = {};
    for (const [domain, store] of Object.entries(DOMAIN_COUNT_STORES)) {
      recordCounts[domain] = (await this.facade.getAll(store).catch(() => [])).length;
    }
    Object.assign(recordCounts, {
      achievementV2Evidence: await this._safeCount('SELECT COUNT(*) FROM achievement_evidence_receipts'),
      achievementLegacy: await this._safeCount('SELECT COUNT(*) FROM achievement_legacy_awards'),
      achievementRecords: await this._safeCount('SELECT COUNT(*) FROM achievement_records'),
      navigationPreferences: await this._safeCount('SELECT COUNT(*) FROM navigation_preferences'),
      retrospectiveDialogue: await this._safeCount('SELECT COUNT(*) FROM chronicle_retrospective_dialogue'),
      themeRecipes: await this._safeCount('SELECT COUNT(*) FROM theme_recipe_manifests'),
      chronicleAccess: await this._safeCount('SELECT COUNT(*) FROM document_chronicle_entry_access'),
      chronicleRevisions: await this._safeCount('SELECT COUNT(*) FROM document_chronicle_entry_revisions'),
      chronicleOperationReceipts: await this._safeCount('SELECT COUNT(*) FROM document_chronicle_entry_operation_receipts'),
      chronicleConflicts: await this._safeCount('SELECT COUNT(*) FROM document_chronicle_entry_conflicts'),
      chronicleOutbox: await this._safeCount('SELECT COUNT(*) FROM document_chronicle_collaboration_outbox'),
      legacyNoteMappings: await this._safeCount('SELECT COUNT(*) FROM document_chronicle_legacy_note_mappings'),
      achievementStages: await this._safeCount('SELECT COUNT(*) FROM achievement_stage_receipts'),
      roadStatSources: await this._safeCount('SELECT COUNT(*) FROM contribution_road_stat_source_receipts'),
      roadCommits: await this._safeCount('SELECT COUNT(*) FROM contribution_road_commit_receipts'),
      cosmeticCatalogVersions: await this._safeCount('SELECT COUNT(*) FROM cosmetic_catalog_versions'),
      cosmeticMigrationReceipts: await this._safeCount('SELECT COUNT(*) FROM cosmetic_migration_receipts'),
    });

    const orphanCounts = {
      chronicleStoryEntries: await this._safeCount(`
        SELECT COUNT(*) FROM chronicle_story_entries se
        LEFT JOIN chronicle_stories s ON s.id=se.story_id
        LEFT JOIN journals j ON j.id=se.journal_id
        WHERE s.id IS NULL OR j.id IS NULL
      `),
      goalMilestones: await this._safeCount(`
        SELECT COUNT(*) FROM goal_milestones gm
        LEFT JOIN goals g ON g.id=gm.goal_id
        WHERE g.id IS NULL
      `),
      matchParticipants: await this._safeCount(`
        SELECT COUNT(*) FROM match_participants mp
        LEFT JOIN matches m ON m.id=mp.match_id
        LEFT JOIN players p ON p.id=mp.player_id
        WHERE m.id IS NULL OR p.id IS NULL
      `),
      achievementReceipts: await this._safeCount(`
        SELECT COUNT(*) FROM achievement_evidence_receipts r
        LEFT JOIN players p ON p.id=r.profile_id
        WHERE p.id IS NULL
      `),
      retrospectiveDialogue: await this._safeCount(`
        SELECT COUNT(*) FROM chronicle_retrospective_dialogue d
        LEFT JOIN journals j ON j.id=d.source_journal_id
        WHERE j.id IS NULL
      `),
      chronicleAccess: await this._safeCount(`
        SELECT COUNT(*) FROM document_chronicle_entry_metadata m
        LEFT JOIN document_chronicle_entry_access a ON a.uuid=m.uuid
        WHERE a.uuid IS NULL
      `),
      chronicleRevisions: await this._safeCount(`
        SELECT COUNT(*) FROM document_chronicle_entry_metadata m
        LEFT JOIN document_chronicle_entry_revisions r
          ON json_extract(r.record_json,'$.entryUUID')=m.uuid
        WHERE r.uuid IS NULL
      `),
      chronicleRevisionHeads: await this._safeCount(`
        SELECT COUNT(*)
        FROM document_journals j
        JOIN document_chronicle_entry_metadata m ON m.uuid=j.uuid
        JOIN document_chronicle_entry_revisions r
          ON json_extract(r.record_json,'$.entryUUID')=j.uuid
         AND CAST(json_extract(r.record_json,'$.revisionNumber') AS INTEGER)=(
           SELECT MAX(CAST(json_extract(r2.record_json,'$.revisionNumber') AS INTEGER))
           FROM document_chronicle_entry_revisions r2
           WHERE json_extract(r2.record_json,'$.entryUUID')=j.uuid
         )
        WHERE COALESCE(
          json_extract(j.record_json,'$.revisionContentHash'),
          json_extract(r.record_json,'$.contentHash')
        ) != json_extract(r.record_json,'$.contentHash')
      `),
      roadCommits: await this._safeCount(`
        SELECT COUNT(*) FROM contribution_road_commit_receipts r
        LEFT JOIN players p ON p.id=r.profile_id
        WHERE p.id IS NULL
      `),
      achievementStages: await this._safeCount(`
        SELECT COUNT(*) FROM achievement_stage_receipts r
        LEFT JOIN players p ON p.id=r.profile_id
        WHERE p.id IS NULL
      `),
      cosmeticMigrationReceipts: await this._safeCount(`
        SELECT COUNT(*) FROM cosmetic_migration_receipts r
        LEFT JOIN players p ON p.id=r.profile_id
        WHERE p.id IS NULL
      `),
    };

    const [players, inventory, resources, completions, rewards, derivedCaches] = await Promise.all([
      this.facade.getAll(STORES.player).catch(() => []),
      this.facade.getAll(STORES.inventory).catch(() => []),
      this.facade.getAll(STORES.resource).catch(() => []),
      this.facade.getAll(STORES.taskCompletionEvent).catch(() => []),
      this.facade.getAll(STORES.rewardProvenance).catch(() => []),
      this.facade.getAll(STORES.derivedCache).catch(() => []),
    ]);
    const resourceIds = new Set(resources.map((record) => String(record.UUID)));
    const referencedResourceIds = this.facade._collectResourceRefs?.() || new Set();
    const missingResources = [...referencedResourceIds].filter((id) => !resourceIds.has(String(id)));
    const invalidThemeReferences = players.flatMap((player) => ([
      { playerUUID: player.UUID, slot: 'appTheme', themeId: player.activeCosmetics?.appTheme || player.activeCosmetics?.theme },
      { playerUUID: player.UUID, slot: 'profileTheme', themeId: player.activeCosmetics?.profileTheme },
    ])).filter(({ themeId }) => themeId && !VALID_THEME_IDS.has(String(themeId)));
    const duplicateCounts = {
      completionEvents: countDuplicates(completions, (event) => (
        (event.sourceTaskUUID || event.taskUUID) && (event.outcome || event.type)
          ? `${event.parent}:${event.sourceTaskUUID || event.taskUUID}:${event.outcome || event.type}:${event.completedAt || ''}`
          : null
      )),
      rewardReceipts: countDuplicates(rewards, (receipt) => (
        receipt.sourceEventUUID || receipt.idempotencyKey || null
      )),
    };
    const activeProfileUUID = await this.facade.getActivePlayerUUID?.();
    const activeProfileValid = !activeProfileUUID
      || players.some((player) => String(player.UUID) === String(activeProfileUUID));
    const cachesRequiringRebuild = derivedCaches
      .filter((entry) => entry.invalidatedAt || entry.value?.invalidatedAt)
      .map((entry) => entry.UUID);
    const orphanTotal = Object.values(orphanCounts).reduce((sum, value) => sum + value, 0);
    const persistedBackup = await this.adapter.query({
      sql: `SELECT started_at AS createdAt,manifest_checksum AS checksum,
                   snapshot_byte_length AS byteLength,source_schema_version AS sourceSchemaVersion,
                   target_schema_version AS targetSchemaVersion,outcome
            FROM migration_safety_receipts
            ORDER BY started_at DESC,id DESC LIMIT 1`,
      result: 'one',
    }).catch(() => null);
    const sessionBackup = this.adapter.lastPreMigrationBackup;

    const report = {
      id: `save-verification:${new Date().toISOString()}`,
      schemaVersion: String(schemaVersion).replaceAll('"', ''),
      lastMigration: String(schemaVersion).replaceAll('"', ''),
      integrityStatus: integrity.ok ? 'ok' : 'failed',
      foreignKeyStatus: integrity.foreignKeyViolations?.length ? 'failed' : 'ok',
      recordCounts,
      orphanCounts,
      orphanTotal,
      missingResources,
      invalidThemeReferences,
      duplicateCounts,
      activeProfileValid,
      lastBackup: sessionBackup
        ? {
            createdAt: sessionBackup.startedAt,
            checksum: sessionBackup.manifestChecksum,
            byteLength: sessionBackup.snapshotByteLength,
            sourceSchemaVersion: sessionBackup.sourceSchemaVersion,
            targetSchemaVersion: sessionBackup.targetSchemaVersion,
            outcome: 'completed',
          }
        : persistedBackup,
      exportReady: integrity.ok
        && !integrity.foreignKeyViolations?.length
        && orphanTotal === 0
        && missingResources.length === 0
        && invalidThemeReferences.length === 0
        && activeProfileValid
        && duplicateCounts.completionEvents === 0
        && duplicateCounts.rewardReceipts === 0,
      cachesRequiringRebuild,
      verifiedAt: integrity.checkedAt || new Date().toISOString(),
      technical: {
        integrityRows: integrity.integrityRows,
        foreignKeyViolations: integrity.foreignKeyViolations,
        migrationCount: status?.migrations?.length || 0,
        runtimeRole: this.adapter.role,
      },
    };

    if (persistReport) {
      await this.adapter.query({
        sql: `INSERT INTO save_verification_reports(
                id,schema_version,integrity_status,foreign_key_status,record_counts_json,
                orphan_counts_json,missing_resources_json,cache_status_json,technical_json,verified_at
              ) VALUES(?,?,?,?,?,?,?,?,?,?)`,
        bind: [
          report.id,
          report.schemaVersion,
          report.integrityStatus,
          report.foreignKeyStatus,
          JSON.stringify(recordCounts),
          JSON.stringify(orphanCounts),
          JSON.stringify(missingResources),
          JSON.stringify({ cachesRequiringRebuild }),
          JSON.stringify(report.technical),
          report.verifiedAt,
        ],
        result: 'changes',
      });
    }
    return report;
  }
}

export default DataIntegrityService;
