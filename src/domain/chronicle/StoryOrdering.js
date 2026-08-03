function fallbackCompare(left, right) {
  return String(left.occurrenceAt || '').localeCompare(String(right.occurrenceAt || ''))
    || String(left.createdAt || '').localeCompare(String(right.createdAt || ''))
    || String(left.journalUUID || left.UUID || '').localeCompare(String(right.journalUUID || right.UUID || ''));
}

export function repairStoryOrdinals(memberships = [], entriesById = new Map()) {
  return [...memberships]
    .sort((left, right) => {
      const leftOrdinal = Number(left.ordinal);
      const rightOrdinal = Number(right.ordinal);
      if (Number.isFinite(leftOrdinal) && Number.isFinite(rightOrdinal) && leftOrdinal !== rightOrdinal) {
        return leftOrdinal - rightOrdinal;
      }
      return fallbackCompare(
        entriesById.get(String(left.journalUUID)) || left,
        entriesById.get(String(right.journalUUID)) || right,
      );
    })
    .map((membership, index) => ({ ...membership, ordinal: index + 1 }));
}

export function visibleStorySequence(memberships = [], entriesById = new Map(), canView = () => true) {
  return repairStoryOrdinals(memberships, entriesById)
    .filter((membership) => {
      const entry = entriesById.get(String(membership.journalUUID));
      return entry && canView(entry);
    })
    .map((membership, index, visible) => ({
      ...membership,
      visibleOrdinal: index + 1,
      visibleCount: visible.length,
      entry: entriesById.get(String(membership.journalUUID)),
    }));
}

export function moveStoryEntry(memberships = [], journalUUID, direction) {
  const repaired = repairStoryOrdinals(memberships);
  const index = repaired.findIndex((membership) => String(membership.journalUUID) === String(journalUUID));
  const target = direction === 'up' ? index - 1 : index + 1;
  if (index < 0 || target < 0 || target >= repaired.length) return repaired;
  const next = [...repaired];
  [next[index], next[target]] = [next[target], next[index]];
  return next.map((membership, position) => ({ ...membership, ordinal: position + 1 }));
}
