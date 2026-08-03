import { createKeyedSerialQueue } from './quickNotesPersistence.js';

export function createQuickNotesController({
  autosaveDelay = 900,
  maxHistory = 100,
  setTimer = (callback, delay) => setTimeout(callback, delay),
  clearTimer = (timer) => clearTimeout(timer),
} = {}) {
  const queue = createKeyedSerialQueue();
  const noteState = new Map();
  let activeNoteId = null;
  let autosaveTimer = null;

  const stateFor = (noteId) => {
    if (!noteState.has(noteId)) {
      noteState.set(noteId, {
        savedContent: '',
        revision: 0,
        baseRevision: 0,
        baseHash: null,
        pendingWrite: null,
        undo: [],
        redo: [],
      });
    }
    return noteState.get(noteId);
  };

  const cancelAutosave = () => {
    if (autosaveTimer != null) clearTimer(autosaveTimer);
    autosaveTimer = null;
  };

  const remember = (notes = []) => {
    for (const note of notes) {
      if (!note?.UUID) continue;
      const state = stateFor(note.UUID);
      state.savedContent = note.content || '';
      state.baseRevision = Math.max(1, Number(note.revision) || 1);
      state.baseHash = note.contentHash || null;
    }
  };

  const activate = (noteOrId, content = '') => {
    const note = noteOrId && typeof noteOrId === 'object' ? noteOrId : null;
    const noteId = note?.UUID || noteOrId;
    const durableContent = note ? note.content || '' : content;
    cancelAutosave();
    activeNoteId = noteId || null;
    if (!noteId) return;
    const state = stateFor(noteId);
    state.undo = [];
    state.redo = [];
    if (state.savedContent === undefined) state.savedContent = durableContent;
    if (note) {
      state.savedContent = durableContent;
      state.baseRevision = Math.max(1, Number(note.revision) || 1);
      state.baseHash = note.contentHash || null;
    }
  };

  const recordEdit = (noteId, previousContent, nextContent) => {
    if (!noteId) return 0;
    const state = stateFor(noteId);
    if (previousContent !== nextContent) {
      state.undo = [...state.undo, previousContent].slice(-maxHistory);
      state.redo = [];
      state.revision += 1;
    }
    return state.revision;
  };

  const restore = (noteId, currentContent, direction) => {
    const state = stateFor(noteId);
    const source = direction === 'undo' ? state.undo : state.redo;
    const target = direction === 'undo' ? state.redo : state.undo;
    const next = source.pop();
    if (next == null) return null;
    target.push(currentContent);
    if (target.length > maxHistory) target.splice(0, target.length - maxHistory);
    state.revision += 1;
    return { content: next, revision: state.revision };
  };

  const schedule = (noteId, content, persist) => {
    cancelAutosave();
    if (!noteId || typeof persist !== 'function') return;
    const revision = stateFor(noteId).revision;
    autosaveTimer = setTimer(() => {
      autosaveTimer = null;
      void persist(noteId, content, revision);
    }, autosaveDelay);
  };

  const markSaved = (noteId, saved) => {
    if (!noteId) return;
    const state = stateFor(noteId);
    if (saved && typeof saved === 'object') {
      state.savedContent = saved.content || '';
      state.baseRevision = Math.max(1, Number(saved.revision) || state.baseRevision || 1);
      state.baseHash = saved.contentHash || state.baseHash || null;
    } else {
      state.savedContent = saved || '';
    }
  };

  const remove = (noteId) => {
    if (activeNoteId === noteId) activeNoteId = null;
    noteState.delete(noteId);
  };

  return {
    activate,
    activeNoteId: () => activeNoteId,
    baseFor: (noteId) => {
      const state = stateFor(noteId);
      return { revision: state.baseRevision, hash: state.baseHash };
    },
    cancelAutosave,
    currentRevision: (noteId) => stateFor(noteId).revision,
    hasPendingOperation: (noteId) => queue.has(noteId),
    pendingWrite: (noteId) => stateFor(noteId).pendingWrite,
    lastSavedContent: (noteId) => stateFor(noteId).savedContent,
    markSaved,
    rememberPendingWrite: (noteId, pendingWrite) => {
      stateFor(noteId).pendingWrite = pendingWrite || null;
    },
    clearPendingWrite: (noteId, operationId = null) => {
      const state = stateFor(noteId);
      if (!operationId || state.pendingWrite?.operationId === operationId) state.pendingWrite = null;
    },
    recordEdit,
    redo: (noteId, currentContent) => restore(noteId, currentContent, 'redo'),
    remember,
    remove,
    run: (noteId, operation) => queue.run(noteId, operation),
    schedule,
    undo: (noteId, currentContent) => restore(noteId, currentContent, 'undo'),
  };
}
