import migration001 from './001_runtime_control.js';
import migration002 from './002_document_stores.js';
import migration003 from './003_core_profiles.js';
import migration004 from './004_planning.js';
import migration005 from './005_protected_notes.js';
import migration006 from './006_compact_journals.js';
import migration007 from './007_journal_file_ops.js';
import migration008 from './008_journal_relations.js';
import migration009 from './009_content_addressed_resources.js';
import migration010 from './010_matches_and_jobs.js';
import migration011 from './011_events_contributions_map.js';
import migration012 from './012_commerce_transactions.js';
import migration013 from './013_social_notifications.js';
import migration014 from './014_recovery_model_derived.js';
import migration019 from './019_social_world_presence_cast.js';
import migration020 from './020_dynamic_social_cast.js';
import migration021 from './021_friend_residency_visibility.js';
import migration022 from './022_social_encounter_memory.js';
import migration023 from './023_dojo_session_standings.js';
import migration028 from './028_immutable_migration_repair.js';
import migration029 from './029_document_resource_payloads.js';
import migration030 from './030_goal_system.js';
import migration031 from './031_continuity_system.js';
import migration032 from './032_profile_context.js';
import migration033 from './033_pair_match.js';
import migration034 from './034_next_move_phase_navigator.js';
import migration035 from './035_feed_chronicle.js';
import migration036 from './036_achievement_system_v2.js';
import migration037 from './037_theme_recipe_architecture.js';
import migration038 from './038_navigation_preferences.js';
import migration039 from './039_retrospective_dialogue.js';
import migration040 from './040_global_collaborative_feed.js';
import migration041 from './041_unified_contribution_road.js';
import migration042 from './042_preset_appearance_system.js';
import migration043 from './043_restore_consistency.js';
import migration044 from './044_legacy_task_base_points.js';
import migration045 from './045_match_promise_rewards.js';
import migration046 from './046_cross_device_sync_foundation.js';
import migration047 from './047_effect_intervals.js';
import migration048 from './048_routine_runs.js';
import migration049 from './049_effect_cancellations.js';
import migration050 from './050_workspace_planning_scope.js';
import migration051 from './051_durable_reference_outbox.js';
import migration052 from './052_durable_reference_capture.js';
import migration053 from './053_remote_reference_capture_guard.js';
import migration054 from './054_journal_comment_reference_capture.js';
import migration055 from './055_habit_reference_capture.js';
import migration056 from './056_mobile_ml_model_reference_capture.js';
import migration057 from './057_demo_agent_reset.js';

export const SQLITE_MIGRATIONS = Object.freeze([
  migration001,
  migration002,
  migration003,
  migration004,
  migration005,
  migration006,
  migration007,
  migration008,
  migration009,
  migration010,
  migration011,
  migration012,
  migration013,
  migration014,
  migration019,
  migration020,
  migration021,
  migration022,
  migration023,
  migration028,
  migration029,
  migration030,
  migration031,
  migration032,
  migration033,
  migration034,
  migration035,
  migration036,
  migration037,
  migration038,
  migration039,
  migration040,
  migration041,
  migration042,
  migration043,
  migration044,
  migration045,
  migration046,
  migration047,
  migration048,
  migration049,
  migration050,
  migration051,
  migration052,
  migration053,
  migration054,
  migration055,
  migration056,
  migration057,
]);

export default SQLITE_MIGRATIONS;
