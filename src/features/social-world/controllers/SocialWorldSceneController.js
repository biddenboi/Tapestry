export class SocialWorldSceneController {
  constructor({ gateway } = {}) {
    if (!gateway?.getSocialWorldScene) {
      throw new Error('SocialWorldSceneController requires a prepared social-world gateway.');
    }
    this.gateway = gateway;
  }

  async load({ viewerId, viewerIGT, signal } = {}) {
    if (!viewerId) return null;
    if (signal?.aborted) return null;
    const snapshot = await this.gateway.getSocialWorldScene({
      viewerId,
      viewerIGT,
      signal,
    });
    return signal?.aborted ? null : snapshot;
  }
}

export default SocialWorldSceneController;
