import { STORES } from '../../../domain/constants.js';

export class NextMoveSurfacePreferenceRepository {
  constructor(facade) {
    if (!facade?.get || !facade?.add) {
      throw new Error('NextMoveSurfacePreferenceRepository requires the canonical database facade.');
    }
    this.facade = facade;
  }

  get(playerUUID) {
    return this.facade.get(STORES.nextMoveSurfacePreference, String(playerUUID));
  }

  save(preference) {
    return this.facade.add(STORES.nextMoveSurfacePreference, preference).then(() => preference);
  }
}

export default NextMoveSurfacePreferenceRepository;
