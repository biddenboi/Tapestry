import { STORES } from '../../../domain/constants.js';
import { createChronicleContextSnapshot } from '../../../domain/chronicle/ChronicleContextSnapshot.js';

export class ChronicleContextService {
  constructor(facade) {
    if (!facade?.getAll) throw new Error('ChronicleContextService requires a database facade.');
    this.facade = facade;
  }

  async capture({ player, shared = {} } = {}) {
    if (!player?.UUID) return createChronicleContextSnapshot();
    const [goals, milestones] = await Promise.all([
      this.facade.getPlayerStore(STORES.project, player.UUID),
      this.facade.getAll(STORES.goalMilestone),
    ]);
    const activeGoal = goals.find((goal) => !goal.completedAt && !goal.archivedAt) || null;
    const activeMilestone = activeGoal
      ? milestones.find((item) => (
          String(item.goalUUID || item.goalId || item.parent) === String(activeGoal.UUID)
          && item.status === 'active'
        ))
      : null;
    return createChronicleContextSnapshot({
      privateContext: {
        profileUUID: player.UUID,
        eraLabel: player.eraLabel || player.activeProfileLabel || null,
        inGameTimestamp: player.inGameTime ?? null,
        goal: activeGoal ? { UUID: activeGoal.UUID, label: activeGoal.name } : null,
        milestone: activeMilestone
          ? { UUID: activeMilestone.UUID, label: activeMilestone.title || activeMilestone.name }
          : null,
      },
      sharedContext: shared,
    });
  }
}

export default ChronicleContextService;
