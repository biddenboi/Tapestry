// Canonical document tables preserve complete current records alongside the
// typed query projections. Separate tables keep identity and indexes explicit.
export const SQLITE_DOCUMENT_TABLES = Object.freeze({
  tasks: 'document_tasks',
  taskCompletionEvents: 'document_task_completion_events',
  taskCompletionReceipts: 'document_task_completion_receipts',
  actionPlans: 'document_action_plans',
  actionSessions: 'document_action_sessions',
  handoffs: 'document_handoffs',
  rhythmDefinitions: 'document_rhythm_definitions',
  rhythmOpportunities: 'document_rhythm_opportunities',
  interventionDecisions: 'document_intervention_decisions',
  rewardProvenance: 'document_reward_provenance',
  worldConsequenceReceipts: 'document_world_consequence_receipts',
  matchScoreEvents: 'document_match_score_events',
  taskPlanReceipts: 'document_task_plan_receipts',
  nextMoveDecisions: 'document_next_move_decisions',
  nextMoveFeedback: 'document_next_move_feedback',
  nextMoveSurfacePreferences: 'document_next_move_surface_preferences',
  chronicleEntryMetadata: 'document_chronicle_entry_metadata',
  chronicleStories: 'document_chronicle_stories',
  chronicleStoryEntries: 'document_chronicle_story_entries',
  chronicleEntryLinks: 'document_chronicle_entry_links',
  chronicleDrafts: 'document_chronicle_drafts',
  chronicleReactions: 'document_chronicle_reactions',
  chronicleFeedViewStates: 'document_chronicle_feed_view_states',
  chronicleStoryReadStates: 'document_chronicle_story_read_states',
  chronicleResurfaceStates: 'document_chronicle_resurface_states',
  chronicleEntryAccess: 'document_chronicle_entry_access',
  chronicleEntryRevisions: 'document_chronicle_entry_revisions',
  chronicleEntryOperationReceipts: 'document_chronicle_entry_operation_receipts',
  chronicleEntryConflicts: 'document_chronicle_entry_conflicts',
  chronicleCollaborationOutbox: 'document_chronicle_collaboration_outbox',
  chronicleLegacyNoteMappings: 'document_chronicle_legacy_note_mappings',
  achievementEvents: 'document_achievement_events',
  achievementStates: 'document_achievement_states',
  achievementReceipts: 'document_achievement_receipts',
  taskRecommendations: 'document_task_recommendations',
  analyticsEvents: 'document_analytics_events',
  journals: 'document_journals',
  players: 'document_players',
  profileSummaries: 'document_profile_summaries',
  profileContextItems: 'document_profile_context_items',
  profileContextRecipients: 'document_profile_context_recipients',
  profileContextSuggestions: 'document_profile_context_suggestions',
  profileContextPreferences: 'document_profile_context_preferences',
  profileContextAudit: 'document_profile_context_audit',
  events: 'document_events',
  shop: 'document_shop',
  todos: 'document_todos',
  transactions: 'document_transactions',
  inventory: 'document_inventory',
  matches: 'document_matches',
  backgroundJobs: 'document_background_jobs',
  backgroundJobReceipts: 'document_background_job_receipts',
  friendships: 'document_friendships',
  notifications: 'document_notifications',
  journalComments: 'document_journal_comments',
  notes: 'document_notes',
  projects: 'document_projects',
  goalAreas: 'document_goal_areas',
  goalMilestones: 'document_goal_milestones',
  goalUpdates: 'document_goal_updates',
  goalLinks: 'document_goal_links',
  goalParticipants: 'document_goal_participants',
  customEvents: 'document_custom_events',
  eventLogs: 'document_event_logs',
  eventBuffs: 'document_event_buffs',
  contributions: 'document_contributions',
  resources: 'document_resources',
  reminders: 'document_reminders',
  appSettings: 'document_app_settings',
  derivedCaches: 'document_derived_caches',
  contributionRoadStats: 'document_contribution_road_stats',
  contributionRoadChoices: 'document_contribution_road_choices',
  contributionRoadUnlocks: 'document_contribution_road_unlocks',
  contributionRoadMigrations: 'document_contribution_road_migrations',
  interfaceRevealReceipts: 'document_interface_reveal_receipts',
});

export const SQLITE_DOCUMENT_RANGE_FIELDS = Object.freeze({
  UUID: 'uuid',
  parent: 'parent_uuid',
  playerUUID: 'parent_uuid',
  authorUUID: 'parent_uuid',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  inGameTimestamp: 'in_game_timestamp',
  sortKey: 'sort_key',
});

export function documentTableForStore(store) {
  const table = SQLITE_DOCUMENT_TABLES[store];
  if (!table) throw new Error(`Store is not enabled for SQLite document storage: ${store}`);
  return table;
}

const GOAL_DOCUMENT_TABLES = new Set([
  'document_goal_areas',
  'document_goal_milestones',
  'document_goal_updates',
  'document_goal_links',
  'document_goal_participants',
]);

const CONTINUITY_DOCUMENT_TABLES = new Set([
  'document_action_plans',
  'document_action_sessions',
  'document_handoffs',
  'document_rhythm_definitions',
  'document_rhythm_opportunities',
  'document_intervention_decisions',
  'document_reward_provenance',
  'document_world_consequence_receipts',
  'document_match_score_events',
]);

const PROFILE_CONTEXT_DOCUMENT_TABLES = new Set([
  'document_profile_context_items',
  'document_profile_context_recipients',
  'document_profile_context_suggestions',
  'document_profile_context_preferences',
  'document_profile_context_audit',
]);

const NEXT_MOVE_DOCUMENT_TABLES = new Set([
  'document_task_plan_receipts',
  'document_next_move_decisions',
  'document_next_move_feedback',
  'document_next_move_surface_preferences',
]);

const CHRONICLE_DOCUMENT_TABLES = new Set([
  'document_chronicle_entry_metadata',
  'document_chronicle_stories',
  'document_chronicle_story_entries',
  'document_chronicle_entry_links',
  'document_chronicle_drafts',
  'document_chronicle_reactions',
  'document_chronicle_feed_view_states',
  'document_chronicle_story_read_states',
  'document_chronicle_resurface_states',
  'document_chronicle_entry_access',
  'document_chronicle_entry_revisions',
  'document_chronicle_entry_operation_receipts',
  'document_chronicle_entry_conflicts',
  'document_chronicle_collaboration_outbox',
  'document_chronicle_legacy_note_mappings',
]);

const CONTRIBUTION_ROAD_DOCUMENT_TABLES = new Set([
  'document_contribution_road_stats',
  'document_contribution_road_choices',
  'document_contribution_road_unlocks',
  'document_contribution_road_migrations',
  'document_interface_reveal_receipts',
]);

export function buildDocumentSchemaSql({
  includeGoalStores = true,
  includeContinuityStores = false,
  includeProfileContextStores = false,
  includeNextMoveStores = false,
  includeChronicleStores = false,
  includeContributionRoadStores = false,
  onlyContributionRoadStores = false,
} = {}) {
  const tables = Object.values(SQLITE_DOCUMENT_TABLES)
    .filter((table) => !onlyContributionRoadStores || CONTRIBUTION_ROAD_DOCUMENT_TABLES.has(table))
    .filter((table) => includeGoalStores || !GOAL_DOCUMENT_TABLES.has(table))
    .filter((table) => includeContinuityStores || !CONTINUITY_DOCUMENT_TABLES.has(table))
    .filter((table) => includeProfileContextStores || !PROFILE_CONTEXT_DOCUMENT_TABLES.has(table))
    .filter((table) => includeNextMoveStores || !NEXT_MOVE_DOCUMENT_TABLES.has(table))
    .filter((table) => includeChronicleStores || !CHRONICLE_DOCUMENT_TABLES.has(table))
    .filter((table) => includeContributionRoadStores || !CONTRIBUTION_ROAD_DOCUMENT_TABLES.has(table));
  return tables.map((table) => `
CREATE TABLE ${table} (
  uuid TEXT PRIMARY KEY,
  record_json TEXT NOT NULL CHECK (json_valid(record_json)),
  parent_uuid TEXT,
  created_at TEXT,
  updated_at TEXT,
  in_game_timestamp INTEGER,
  sort_key TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence >= 1)
) STRICT;

CREATE INDEX ${table}_parent_timeline_idx
ON ${table}(parent_uuid, in_game_timestamp, sort_key, uuid);

CREATE INDEX ${table}_sort_idx
ON ${table}(sort_key, uuid);

CREATE UNIQUE INDEX ${table}_sequence_idx
ON ${table}(sequence);
`.trim()).join('\n\n');
}

export function projectDocumentRecord(record) {
  if (!record?.UUID) throw new Error('SQLite document records require UUID.');
  const rawIgt = record.inGameTimestamp;
  const finiteIgt = rawIgt == null || rawIgt === '' ? null : Number(rawIgt);
  const createdAt = record.createdAt ?? record.created ?? record.date ?? null;
  const updatedAt = record.updatedAt ?? record.editedAt ?? null;
  return {
    uuid: String(record.UUID),
    recordJson: JSON.stringify(record),
    parentUuid: record.parent ?? record.playerUUID ?? record.authorUUID ?? record.requestedBy ?? null,
    createdAt: createdAt == null ? null : String(createdAt),
    updatedAt: updatedAt == null ? null : String(updatedAt),
    inGameTimestamp: Number.isFinite(finiteIgt) ? Math.trunc(finiteIgt) : null,
    sortKey: String(
      record.completedAt
      ?? updatedAt
      ?? createdAt
      ?? record.name
      ?? record.UUID,
    ),
  };
}
