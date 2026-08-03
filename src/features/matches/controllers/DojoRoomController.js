import { buildDojoRoomFactRequest } from '../../../domain/social-world/DojoRoom.js';

export class DojoRoomController {
  constructor({ gateway } = {}) {
    if (!gateway?.getDojoRoomFacts) {
      throw new Error('DojoRoomController requires a batched Dojo-room gateway.');
    }
    this.gateway = gateway;
  }

  async load({ scene, viewerIGT, dojoSessionUUID, signal } = {}) {
    if (!scene || signal?.aborted) return [];
    const occupants = buildDojoRoomFactRequest({ scene, viewerIGT, dojoSessionUUID });
    if (!occupants.length) return [];
    const facts = await this.gateway.getDojoRoomFacts({ occupants, viewerIGT });
    return signal?.aborted ? [] : facts;
  }
}

export default DojoRoomController;
