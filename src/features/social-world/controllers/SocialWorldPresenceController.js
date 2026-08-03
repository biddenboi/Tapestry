import {
  PRESENCE_INTERRUPTION,
  SEMANTIC_LOCATION,
} from '../../../domain/social-world/SocialWorldContracts.js';
import { resolveSemanticLocation } from '../../../domain/social-world/SemanticLocationPolicy.js';

let commandSequence = 0;

function newCommandId(prefix) {
  if (globalThis.crypto?.randomUUID) return `${prefix}:${globalThis.crypto.randomUUID()}`;
  commandSequence += 1;
  return `${prefix}:${Date.now()}:${commandSequence}`;
}

export function presenceSourceForState({ location, activeTask, activeMatch, dojoSessionUUID, activePanel } = {}) {
  if (location === SEMANTIC_LOCATION.taskSession) {
    return { sourceType: 'task', sourceId: activeTask?.UUID || activeTask?.createdAt || null };
  }
  if (location === SEMANTIC_LOCATION.matchArena) {
    return { sourceType: 'match', sourceId: activeMatch?.UUID || null };
  }
  if (location === SEMANTIC_LOCATION.dojo) {
    return { sourceType: 'dojo-session', sourceId: dojoSessionUUID || null };
  }
  if ([SEMANTIC_LOCATION.planning, SEMANTIC_LOCATION.marketplace].includes(location)) {
    return { sourceType: 'panel', sourceId: activePanel || null };
  }
  // Ordinary panels live physically in Commons, but the exact surface still
  // matters for presence. Persist it so Feed/Events/etc. are visible to other
  // viewers and survive projection instead of collapsing into "semantic-world".
  if (location === SEMANTIC_LOCATION.commons && activePanel) {
    return { sourceType: 'panel', sourceId: activePanel };
  }
  if (location === SEMANTIC_LOCATION.commons) return { sourceType: 'surface', sourceId: 'semantic-world' };
  return { sourceType: null, sourceId: null };
}

export class SocialWorldPresenceController {
  constructor({
    gateway,
    idFactory = newCommandId,
  } = {}) {
    if (!gateway) throw new Error('SocialWorldPresenceController requires a persistence gateway.');
    this.gateway = gateway;
    this.idFactory = idFactory;
    this.lastTransitionKey = null;
    this.foregroundAllowed = true;
    this.commandTail = Promise.resolve();
  }

  reconcile({ playerId } = {}) {
    return this._enqueue(async () => {
      if (!playerId) return { status: 'no-player' };
      return this.gateway.reconcileSocialWorldPresence({
        commandId: this.idFactory(`startup-reconcile:${playerId}`),
      });
    });
  }

  synchronize(options = {}) {
    return this._enqueue(() => this._synchronize(options));
  }

  async _synchronize({
    playerId,
    viewerIGT,
    gameState,
    activeTask,
    activeMatch,
    dojoSessionUUID,
    activePanel,
    presenceVisibilityPolicy = 'state-only',
  } = {}) {
    if (!playerId) return { status: 'no-player' };
    if (!this.foregroundAllowed) return { status: 'backgrounded' };
    const effectiveGameState = gameState === 'match' && activeMatch?.status !== 'active'
      ? 'idle'
      : gameState;
    const location = resolveSemanticLocation({
      gameState: effectiveGameState,
      activeTask,
      activePanel,
    });
    const source = presenceSourceForState({
      location,
      activeTask,
      activeMatch,
      dojoSessionUUID,
      activePanel,
    });
    // Dojo's session identifier is the factual source boundary. Waiting one
    // render for it avoids writing an anonymous interval and immediately
    // replacing it with an identified one.
    if (location === SEMANTIC_LOCATION.dojo && !source.sourceId) {
      return { status: 'waiting-for-source', location };
    }
    const key = [playerId, location || 'none', source.sourceType || '', source.sourceId || ''].join(':');
    if (key === this.lastTransitionKey) return { status: 'unchanged', location };
    this.lastTransitionKey = key;
    try {
      if (!location) {
        return await this.gateway.closeSocialWorldPresence({
          playerId,
          viewerIGT,
          interruption: PRESENCE_INTERRUPTION.surfaceExit,
          commandId: this.idFactory(`presence-exit:${playerId}`),
        });
      }
      return await this.gateway.transitionSocialWorldPresence({
        playerId,
        location,
        viewerIGT,
        ...source,
        visibilityPolicy: ['state-only', 'goal', 'task', 'private'].includes(presenceVisibilityPolicy)
          ? presenceVisibilityPolicy
          : 'state-only',
        commandId: this.idFactory(`presence-enter:${playerId}:${location}`),
      });
    } catch (error) {
      // A failed write must remain retryable on the next render. Keep the key
      // while the request is pending so concurrent effects cannot open twice.
      if (this.lastTransitionKey === key) this.lastTransitionKey = null;
      throw error;
    }
  }

  closeForInterruption(options = {}) {
    if ([
      PRESENCE_INTERRUPTION.appBackground,
      PRESENCE_INTERRUPTION.appClose,
    ].includes(options.interruption)) {
      // Block render effects from reopening presence while the close is still
      // in flight or while the document remains hidden.
      this.foregroundAllowed = false;
    }
    return this._enqueue(() => this._closeForInterruption(options));
  }

  async _closeForInterruption({
    playerId,
    viewerIGT,
    interruption,
    gameState,
  } = {}) {
    if (!playerId) return { status: 'no-player' };
    const result = await this.gateway.closeSocialWorldPresence({
      playerId,
      viewerIGT,
      interruption,
      domainSupportsRecovery: gameState === 'match',
      commandId: this.idFactory(`presence-interruption:${playerId}:${interruption}`),
    });
    if (!result?.retainedForRecovery) this.lastTransitionKey = null;
    return result;
  }

  resumeForeground(options = {}) {
    return this._enqueue(async () => {
      this.foregroundAllowed = true;
      // A recoverable Match interval still needs a fresh desired-state check.
      this.lastTransitionKey = null;
      return this._synchronize(options);
    });
  }

  dispose() {
    this.foregroundAllowed = false;
  }

  _enqueue(command) {
    const operation = this.commandTail.then(command, command);
    this.commandTail = operation.catch(() => undefined);
    return operation;
  }

}

export default SocialWorldPresenceController;
