export function createKeyedSerialQueue() {
  const pending = new Map();

  const run = (key, operation) => {
    const previous = pending.get(key) || Promise.resolve();
    const current = previous
      .catch(() => undefined)
      .then(operation);
    pending.set(key, current);

    const clear = () => {
      if (pending.get(key) === current) pending.delete(key);
    };
    current.then(clear, clear);
    return current;
  };

  return {
    run,
    has: (key) => pending.has(key),
  };
}

export function isCurrentSaveCompletion({
  activeNoteId,
  noteId,
  currentContent,
  savedContent,
  currentRevision,
  savedRevision,
}) {
  return activeNoteId === noteId
    && currentContent === savedContent
    && currentRevision === savedRevision;
}

export function assertDurableWrite(result) {
  if (result?.direction === 'sqlite' && result?.changed !== false) return result;
  const reason = result?.reason ? ` (${result.reason})` : '';
  throw new Error(`The note was not confirmed in SQLite${reason}.`);
}
