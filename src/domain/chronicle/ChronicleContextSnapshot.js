export function createChronicleContextSnapshot({
  privateContext = {},
  sharedContext = {},
  capturedAt = new Date().toISOString(),
} = {}) {
  return Object.freeze({
    version: 1,
    capturedAt,
    private: { ...privateContext },
    shared: { ...sharedContext },
  });
}

export function projectChronicleContext(snapshot = {}, { owner = false } = {}) {
  const projected = {
    version: snapshot.version || 1,
    capturedAt: snapshot.capturedAt || null,
    shared: { ...(snapshot.shared || {}) },
  };
  if (owner) projected.private = { ...(snapshot.private || {}) };
  return Object.freeze(projected);
}
