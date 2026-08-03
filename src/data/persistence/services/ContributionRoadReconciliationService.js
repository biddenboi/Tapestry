import { STORES } from '@domain/constants.js';
import { reconcileOpeningTrail } from '@domain/contribution-road/ContributionRoad.js';
import { CONTRIBUTION_ROAD_CATALOG_VERSION } from '@domain/contribution-road/ContributionRoadCatalog.js';

export default class ContributionRoadReconciliationService {
  constructor(facade) {
    if (!facade) throw new Error('ContributionRoadReconciliationService requires a database facade.');
    this.facade = facade;
    this.promise = null;
  }

  reconcile({ force = false } = {}) {
    if (this.promise && !force) return this.promise;
    this.promise = this._reconcile({ force }).finally(() => { this.promise = null; });
    return this.promise;
  }

  async _reconcile({ force }) {
    const players = await this.facade.getAll(STORES.player).catch(() => []);
    let reconciled = 0;
    for (const player of players) {
      const UUID = `road-migration:${player.UUID}:41`;
      const prior = await this.facade.get(STORES.contributionRoadMigration, UUID).catch(() => null);
      if (prior && !force) continue;
      // This is the one permitted historical scan. Normal board loading reads
      // the persisted projection and never walks the full activity history.
      // eslint-disable-next-line no-await-in-loop
      const trail = await reconcileOpeningTrail(this.facade, player.UUID, {
        imported: true,
        refreshStats: true,
      });
      // eslint-disable-next-line no-await-in-loop
      const inventory = await this.facade.getPlayerStore(STORES.inventory, player.UUID);
      const now = new Date().toISOString();
      // eslint-disable-next-line no-await-in-loop
      await this.facade.add(STORES.contributionRoadMigration, {
        UUID,
        parent: player.UUID,
        migrationId: '041_unified_contribution_road',
        catalogVersion: CONTRIBUTION_ROAD_CATALOG_VERSION,
        grandfatheredInventoryCount: inventory.length,
        inferredRevealCount: trail.steps.filter((step) => step.revealed).length,
        branchChoicesInferred: false,
        retroactiveContributionCharged: 0,
        reconciledAt: now,
        createdAt: now,
      });
      reconciled += 1;
    }
    return { reconciled, profiles: players.length };
  }
}
