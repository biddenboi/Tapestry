function parse(value, fallback = {}) {
  try {
    return value == null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}

export class NavigationPreferenceRepository {
  constructor(facade) {
    this.facade = facade;
  }

  get adapter() {
    return this.facade?.persistenceRuntime?.sqliteStorageAdapter;
  }

  async get(profileId, sectionId) {
    if (!profileId || !sectionId || !this.adapter?.query) return null;
    const row = await this.adapter.query({
      sql: `SELECT profile_id AS profileId,section_id AS sectionId,page_id AS pageId,
                   selected_entity_id AS selectedEntityUUID,filters_json AS filters,
                   scroll_json AS scroll,preference_version AS version,updated_at AS updatedAt
            FROM navigation_preferences WHERE profile_id=? AND section_id=?`,
      bind: [profileId, sectionId],
      result: 'one',
    });
    return row ? {
      ...row,
      filters: parse(row.filters),
      scroll: parse(row.scroll),
    } : null;
  }

  async save({
    profileUUID,
    sectionId,
    pageId,
    selectedEntityUUID = null,
    filters = {},
    scroll = {},
    version = 1,
    updatedAt = new Date().toISOString(),
  }) {
    if (!profileUUID || !sectionId || !pageId || !this.adapter?.query) return null;
    await this.adapter.query({
      sql: `INSERT INTO navigation_preferences(
              profile_id,section_id,page_id,selected_entity_id,filters_json,scroll_json,
              preference_version,updated_at
            ) VALUES(?,?,?,?,?,?,?,?)
            ON CONFLICT(profile_id,section_id) DO UPDATE SET
              page_id=excluded.page_id,selected_entity_id=excluded.selected_entity_id,
              filters_json=excluded.filters_json,scroll_json=excluded.scroll_json,
              preference_version=excluded.preference_version,updated_at=excluded.updated_at`,
      bind: [
        profileUUID,
        sectionId,
        pageId,
        selectedEntityUUID,
        JSON.stringify(filters || {}),
        JSON.stringify(scroll || {}),
        version,
        updatedAt,
      ],
      result: 'changes',
    });
    return this.get(profileUUID, sectionId);
  }
}

export default NavigationPreferenceRepository;
