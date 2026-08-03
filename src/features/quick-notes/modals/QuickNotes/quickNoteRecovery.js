const STORAGE_PREFIX = 'tapestry:quick-note-recovery:v1:';

function defaultStorage() {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function createQuickNoteDraftStore({ storage = defaultStorage(), scope = 'default' } = {}) {
  const key = `${STORAGE_PREFIX}${String(scope || 'default')}`;

  const read = () => {
    if (!storage) return { version: 1, drafts: {} };
    try {
      const parsed = JSON.parse(storage.getItem(key) || 'null');
      if (parsed?.version === 1 && parsed.drafts && typeof parsed.drafts === 'object') return parsed;
    } catch {
      // A damaged recovery entry must never block the Notes editor.
    }
    return { version: 1, drafts: {} };
  };

  const write = (state) => {
    if (!storage) return false;
    try {
      storage.setItem(key, JSON.stringify(state));
      return true;
    } catch {
      return false;
    }
  };

  return {
    get(noteId) {
      return read().drafts?.[noteId] || null;
    },
    list() {
      return Object.values(read().drafts || {})
        .filter((draft) => draft?.noteId)
        .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    },
    save({ noteId, content = '', baseRevision, baseHash, editRevision, updatedAt } = {}) {
      if (!noteId) return false;
      const state = read();
      state.drafts[noteId] = {
        noteId: String(noteId),
        content: String(content),
        baseRevision: Math.max(0, Number(baseRevision) || 0),
        baseHash: baseHash || null,
        editRevision: Math.max(0, Number(editRevision) || 0),
        updatedAt: updatedAt || new Date().toISOString(),
      };
      return write(state);
    },
    remove(noteId, { throughEditRevision = Infinity } = {}) {
      const state = read();
      const draft = state.drafts?.[noteId];
      if (!draft) return true;
      if (Number(draft.editRevision) > Number(throughEditRevision)) return false;
      delete state.drafts[noteId];
      return write(state);
    },
    clear() {
      if (!storage) return false;
      try {
        storage.removeItem(key);
        return true;
      } catch {
        return false;
      }
    },
  };
}

export default createQuickNoteDraftStore;
