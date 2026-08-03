import {
  buildProfileArcSummary,
  buildProfileMilestones,
} from '@domain/profile/ProfileBiography.js';
import { buildProfileStatsFromRecords } from '@domain/profile/DerivedStats.js';

export function buildOptionalProfileNarrative({
  player,
  profileView,
  history = [],
  matches = [],
  allPlayers = [],
  contributions = [],
  viewerIGT = Infinity,
} = {}) {
  if (!player || !profileView) {
    return {
      milestones: [],
      arc: {
        type: 'unavailable',
        title: 'No narrative available',
        description: 'Open recorded activity to build this optional profile view.',
      },
    };
  }
  const stats = buildProfileStatsFromRecords({
    tasks: history.filter((entry) => entry.type === 'task'),
    journals: history.filter((entry) => entry.type === 'journal'),
    events: history
      .filter((entry) => entry.type === 'event' || entry.type === 'item_use')
      .map((entry) => ({ ...entry, type: entry.originalType || entry.type })),
    transactions: history
      .filter((entry) => entry.type === 'transaction' || entry.type === 'money_log')
      .map((entry) => ({ ...entry, type: entry.originalType || entry.type })),
    matches,
    inventory: [],
    allPlayers,
    contributions,
  }, player, viewerIGT);
  const milestones = buildProfileMilestones(profileView, {
    player,
    history,
    matches,
    allPlayers,
  });
  return {
    milestones,
    arc: buildProfileArcSummary(profileView, { stats }),
  };
}
