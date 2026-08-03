import {
  PRESENCE_INTERRUPTION,
  SEMANTIC_LOCATION,
} from '../../../domain/social-world/SocialWorldContracts.js';
import {
  getLocationContinuityPolicy,
  shouldClosePresence,
} from '../../../domain/social-world/SemanticLocationPolicy.js';

const CLOSE_REASON_BY_INTERRUPTION = Object.freeze({
  [PRESENCE_INTERRUPTION.surfaceExit]: 'surface-exit',
  [PRESENCE_INTERRUPTION.appBackground]: 'backgrounded',
  [PRESENCE_INTERRUPTION.appClose]: 'interrupted',
  [PRESENCE_INTERRUPTION.profileSwitch]: 'profile-switch',
  [PRESENCE_INTERRUPTION.interruption]: 'interrupted',
  [PRESENCE_INTERRUPTION.completed]: 'completed',
});

let fallbackSequence = 0;

function generatedId(prefix) {
  if (globalThis.crypto?.randomUUID) return `${prefix}:${globalThis.crypto.randomUUID()}`;
  fallbackSequence += 1;
  return `${prefix}:${Date.now()}:${fallbackSequence}`;
}

export class SocialWorldPresenceService {
  constructor({
    repository,
    now = () => new Date(),
    idFactory = generatedId,
    presenceTTLms = 5 * 60 * 1000,
  } = {}) {
    if (!repository) throw new Error('SocialWorldPresenceService requires a presence repository.');
    this.repository = repository;
    this.now = now;
    this.idFactory = idFactory;
    this.presenceTTLms = presenceTTLms;
  }

  transitionPresence({
    playerId,
    location,
    viewerIGT,
    sourceType = null,
    sourceId = null,
    metadata = {},
    commandId,
    intervalId = this.idFactory('presence'),
    at = this.now(),
    visibilityPolicy = 'state-only',
  } = {}) {
    const enteredAt = at instanceof Date ? at : new Date(at);
    return this.repository.transitionPresence({
      intervalId,
      playerId,
      location,
      startedIGT: viewerIGT,
      enteredAt,
      sourceType,
      sourceId,
      closeReason: 'interrupted',
      metadata: {
        ...metadata,
        visibilityPolicy,
        tracksActiveElapsed: Boolean(getLocationContinuityPolicy(location)?.tracksActiveElapsed),
      },
      visibilityPolicy,
      expiresAt: new Date(enteredAt.getTime() + this.presenceTTLms),
      commandId,
    });
  }

  pausePresence({ playerId, viewerIGT, commandId, at = this.now() } = {}) {
    return this.repository.pausePresence({
      playerId,
      pausedIGT: viewerIGT,
      pausedAt: at,
      commandId,
    });
  }

  resumePresence({ playerId, viewerIGT, commandId, at = this.now() } = {}) {
    return this.repository.resumePresence({
      playerId,
      resumedIGT: viewerIGT,
      resumedAt: at,
      commandId,
    });
  }

  async closePresence({
    playerId,
    viewerIGT,
    interruption = PRESENCE_INTERRUPTION.interruption,
    domainSupportsRecovery = false,
    expectedLocation = null,
    commandId,
    at = this.now(),
  } = {}) {
    const current = await this.repository.getOpenInterval(playerId);
    if (!current || (expectedLocation && current.location !== expectedLocation)) {
      return { interval: current, unchanged: true, invalidatedDomains: [] };
    }
    if (!shouldClosePresence({
      location: current.location,
      interruption,
      domainSupportsRecovery,
    })) {
      return { interval: current, retainedForRecovery: true, invalidatedDomains: [] };
    }
    return this.repository.closePresence({
      playerId,
      endedIGT: viewerIGT,
      exitedAt: at,
      closeReason: CLOSE_REASON_BY_INTERRUPTION[interruption] || 'interrupted',
      expectedLocation,
      commandId,
    });
  }

  reconcileOpenIntervals({ commandId, at = this.now() } = {}) {
    return this.repository.reconcileOpenIntervals({ commandId, reconciledAt: at });
  }

  closeCompletedTaskSession(options = {}) {
    return this.closePresence({
      ...options,
      expectedLocation: SEMANTIC_LOCATION.taskSession,
      interruption: PRESENCE_INTERRUPTION.completed,
    });
  }
}

export default SocialWorldPresenceService;
