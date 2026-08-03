export const ACHIEVEMENT_RECORD_DEFINITIONS = Object.freeze([
  { id: 'best_rating', label: 'Best rating', format: 'elo' },
  { id: 'highest_ladder_position', label: 'Highest ladder position', format: 'rank' },
  { id: 'best_match_comeback', label: 'Best Match comeback', format: 'points' },
  { id: 'longest_focus_session', label: 'Longest trustworthy focus session', format: 'minutes' },
  { id: 'strongest_rhythm_period', label: 'Strongest rhythm period', format: 'percent' },
]);

export function formatAchievementRecord(record) {
  const definition = ACHIEVEMENT_RECORD_DEFINITIONS.find((entry) => entry.id === record?.recordId);
  const value = record?.value?.value ?? record?.value ?? 0;
  if (definition?.format === 'minutes') return `${Math.round(Number(value) || 0)}m`;
  if (definition?.format === 'percent') return `${Math.round((Number(value) || 0) * 100)}%`;
  if (definition?.format === 'elo') return `${Math.round(Number(value) || 0)} ELO`;
  if (definition?.format === 'rank') return `#${Math.max(1, Math.round(Number(value) || 1))}`;
  return Number(value || 0).toLocaleString();
}

