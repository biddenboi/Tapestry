const occurredAt = (entry) => (
  entry.occurredAt
  || entry.createdAt
  || entry.completedAt
  || entry.updatedAt
  || ''
);

export function buildGoalTimeline({
  goalUUID,
  contributions = [],
  updates = [],
  milestones = [],
  links = [],
  journals = [],
  players = [],
} = {}) {
  const playerMap = new Map(players.map((player) => [String(player.UUID), player]));
  const journalMap = new Map(journals.map((journal) => [String(journal.UUID), journal]));
  const rows = [];
  for (const contribution of contributions) {
    if (String(contribution.goalUUID || contribution.projectId) !== String(goalUUID)) continue;
    rows.push({
      UUID: `contribution:${contribution.UUID}`,
      type: 'contribution',
      label: contribution.summary || contribution.taskName || 'Linked work completed',
      sourceLabel: contribution.source === 'manual' ? 'Legacy manual report' : contribution.source || 'Activity',
      actor: playerMap.get(String(contribution.parent))?.username
        || contribution.playerNameSnapshot
        || 'Unknown player',
      contributionValue: Number(contribution.value) || 0,
      occurredAt: occurredAt(contribution),
      inGameTimestamp: contribution.inGameTimestamp,
    });
  }
  for (const update of updates) {
    if (String(update.goalUUID) !== String(goalUUID)) continue;
    rows.push({
      UUID: `update:${update.UUID}`,
      type: update.kind || 'manual',
      label: update.summary,
      sourceLabel: update.kind === 'manual' ? 'Goal update' : String(update.kind || 'Update').replaceAll('_', ' '),
      actor: playerMap.get(String(update.parent))?.username || 'You',
      contributionValue: null,
      occurredAt: occurredAt(update),
      inGameTimestamp: update.inGameTimestamp,
    });
  }
  for (const milestone of milestones) {
    if (String(milestone.goalUUID) !== String(goalUUID) || !milestone.completedAt) continue;
    rows.push({
      UUID: `milestone:${milestone.UUID}`,
      type: 'milestone',
      label: `${milestone.kind === 'learning_stage' ? 'Stage' : 'Milestone'} completed: ${milestone.title}`,
      sourceLabel: 'Outcome progress',
      actor: 'You',
      contributionValue: null,
      occurredAt: milestone.completedAt,
      inGameTimestamp: milestone.completedInGameTimestamp ?? milestone.inGameTimestamp,
    });
  }
  for (const link of links) {
    if (String(link.goalUUID) !== String(goalUUID) || link.entityType !== 'journal') continue;
    const journal = journalMap.get(String(link.entityUUID));
    rows.push({
      UUID: `journal:${link.UUID}`,
      type: 'journal',
      label: journal?.title || link.labelSnapshot || 'Linked journal evidence',
      sourceLabel: 'Journal evidence · no reward',
      actor: playerMap.get(String(link.parent))?.username || 'You',
      contributionValue: null,
      occurredAt: journal?.createdAt || link.createdAt,
      inGameTimestamp: link.inGameTimestamp,
    });
  }
  const deduped = new Map();
  for (const row of rows) deduped.set(row.UUID, row);
  return [...deduped.values()].sort((left, right) => (
    String(occurredAt(right)).localeCompare(String(occurredAt(left)))
    || String(right.UUID).localeCompare(String(left.UUID))
  ));
}
