export const NAVIGATION_PREFERENCES_SCHEMA_SQL = `
CREATE TABLE navigation_preferences (
  profile_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  section_id TEXT NOT NULL,
  page_id TEXT NOT NULL,
  selected_entity_id TEXT,
  filters_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(filters_json) AND json_type(filters_json)='object'),
  scroll_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(scroll_json) AND json_type(scroll_json)='object'),
  preference_version INTEGER NOT NULL DEFAULT 1 CHECK (preference_version>=1),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(profile_id,section_id)
) STRICT;

CREATE INDEX navigation_preferences_page_idx
ON navigation_preferences(profile_id,page_id,updated_at DESC);

CREATE TABLE navigation_preference_migrations (
  profile_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  section_id TEXT NOT NULL,
  legacy_page_id TEXT,
  mapped_page_id TEXT NOT NULL,
  migration_id TEXT NOT NULL,
  migrated_at TEXT NOT NULL,
  PRIMARY KEY(profile_id,section_id,migration_id)
) STRICT;
`.trim();

export const migration038 = Object.freeze({
  id: '038_navigation_preferences',
  description: 'Persist profile-scoped local subpages, selected entities, filters, and scroll state with legacy-route provenance.',
  sourceApplicationVersion: 'local-navigation-v1',
  sql: NAVIGATION_PREFERENCES_SCHEMA_SQL,
  checksum: 'e761bb1a6f1d9df34de4f3d2e6ce80e6483ffac45e60d00512a0948bac8426c1',
});

export default migration038;
