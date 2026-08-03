export class SocialWorldProfileCardController {
  constructor({ gateway } = {}) {
    if (!gateway?.getSocialWorldProfileCard) {
      throw new Error('SocialWorldProfileCardController requires a prepared profile-card gateway.');
    }
    this.gateway = gateway;
  }

  async load({ viewerId, profileId, viewerIGT, signal } = {}) {
    if (!viewerId || !profileId || signal?.aborted) return null;
    const card = await this.gateway.getSocialWorldProfileCard({ viewerId, profileId, viewerIGT });
    return signal?.aborted ? null : card;
  }

  async recordEncounter({ viewerId, profileId, viewerIGT, surface, visibleFacts, operationId } = {}) {
    if (!viewerId || !profileId || viewerId === profileId || !this.gateway.recordSocialEncounter) {
      return { recorded: false, invalidatedDomains: [] };
    }
    return this.gateway.recordSocialEncounter({
      viewerId,
      subjectId: profileId,
      viewerIGT,
      surface,
      visibleFacts,
      operationId,
    });
  }
}

export default SocialWorldProfileCardController;
