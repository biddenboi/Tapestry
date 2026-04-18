/**
 * Breach mode descriptor.
 *
 * The contract a mode provides to the engine (architecture doc §B.1):
 *   - phases        : ordered phase ids
 *   - transitions   : guarded edges (checked by engine/phases.js)
 *   - isLivePhase   : whether matchClock should tick in a given phase
 *   - initialState  : builds match.breach for a freshly-created match
 *   - mapGen        : seed → map-state slice
 *   - teamPlanner   : pure decideTeamTurn function
 *   - resolveTick   : pure tick resolver
 *
 * The engine doesn't know the rules; the mode doesn't know the loop.
 *
 * ── AI driver ─────────────────────────────────────────────────────
 *
 * Ghost behavior is produced by a LEARNED policy network — no rule-based
 * planner exists in this build. The old hand-written TeamPlanner.js and
 * GhostPlanner.js were deleted along with their rule logic; the network
 * loads its weights from neural/weights.default.json at module load.
 *
 * If weights-loading fails (file missing, malformed, shape mismatch),
 * `createNeuralTeamPlanner` returns a pass-everywhere planner — matches
 * stay playable (no crashes, no freezes) but ghosts do nothing until
 * weights are restored. There is NO hand-written fallback to coast on;
 * a valid weights file is the only way to restore interesting behavior.
 * See training/README.md for how to produce weights.
 */

import { generateBreachMap } from './MapGen.js';
import { createNeuralTeamPlanner } from './NeuralTeamPlanner.js';
import { resolveTick } from './Turn.js';
import defaultWeights from './neural/weights.default.json';
import {
  PHASE,
  LIVE_PHASES,
  HALF_DURATION_MS,
  MATCH_DURATION_MS,
  PLAYER_MAX_HP,
} from './Constants.js';

// ── Phase edges and guards ────────────────────────────────────────

const TRANSITIONS = {
  [PHASE.loading]: {
    [PHASE.setup_h1]: (m) => {
      const st = m.breach;
      if (!st) return 'no breach state';
      const ghostCount = Object.keys(st.ghostPlayback || {}).length;
      if (ghostCount < 5) return `need 5 ghost playback windows, have ${ghostCount}`;
      const siteCount = Object.values(st.mapState?.sites || {}).length;
      if (siteCount !== 3) return `need 3 sites, have ${siteCount}`;
      if (!st.mapState?.spawnZones?.attacker?.length) return 'no attacker spawn zone';
      if (!st.mapState?.spawnZones?.defender?.length) return 'no defender spawn zone';
      return true;
    },
  },
  [PHASE.setup_h1]: {
    [PHASE.live_h1]: (m) => {
      const positions = m.breach?.mapState?.playerPositions || {};
      if (Object.keys(positions).length < 6) return 'not all players positioned';
      return true;
    },
  },
  [PHASE.live_h1]: {
    [PHASE.intermission]: (m) => {
      const elapsed = m.breach?.matchElapsedMs || 0;
      const sites = Object.values(m.breach?.mapState?.sites || {});
      const allResolved = sites.every((s) => s.state !== 'idle');
      if (elapsed >= HALF_DURATION_MS || allResolved) return true;
      return `half 1 still active (${elapsed}ms elapsed, ${sites.filter((s) => s.state === 'idle').length} idle sites)`;
    },
  },
  [PHASE.intermission]: {
    [PHASE.setup_h2]: (m) => {
      if (m.breach?.halfNumber !== 2) return 'half number not swapped';
      return true;
    },
  },
  [PHASE.setup_h2]: {
    [PHASE.live_h2]: (m) => {
      const positions = m.breach?.mapState?.playerPositions || {};
      if (Object.keys(positions).length < 6) return 'not all players positioned';
      return true;
    },
  },
  [PHASE.live_h2]: {
    [PHASE.conclusion]: (m) => {
      const elapsed = m.breach?.matchElapsedMs || 0;
      const sites = Object.values(m.breach?.mapState?.sites || {});
      const allResolved = sites.every((s) => s.state !== 'idle');
      if (elapsed >= MATCH_DURATION_MS || allResolved) return true;
      return 'half 2 still active';
    },
  },
};

function isLivePhase(phase) {
  return LIVE_PHASES.has(phase);
}

// ── Initial state builder ─────────────────────────────────────────

function buildInitialBreachState({ teams, sideByPlayerUUID, ghostPlayback, map }) {
  const playerUUIDs = [...(teams[0] || []), ...(teams[1] || [])].map((p) => p.UUID);
  const points = Object.fromEntries(playerUUIDs.map((u) => [u, 0]));
  const pointsSpent = Object.fromEntries(playerUUIDs.map((u) => [u, 0]));
  const playerPositions = {};

  return {
    phase: PHASE.loading,
    halfNumber: 1,
    matchElapsedMs: 0,
    halfStartedAtWallMs: null,
    sideByPlayerUUID,
    ghostPlayback,
    templateId: map.templateId,
    templateLabel: map.templateLabel,
    mapState: {
      tiles: map.tiles,
      sites: map.sites,
      structures: {},
      playerPositions,
      spawnZones: map.spawnZones,
      points,
      pointsSpent,
    },
    armedBombs: { A: null, B: null, C: null },
    siteOutcomes: [],
  };
}

// ── Neural team planner (module singleton) ────────────────────────

const teamPlanner = createNeuralTeamPlanner(defaultWeights);

// ── Descriptor export ─────────────────────────────────────────────

const breachDescriptor = {
  id: 'breach',
  label: 'Breach',
  matchDurationHours: 2,
  playerMaxHp: PLAYER_MAX_HP,

  phases: [
    PHASE.loading,
    PHASE.setup_h1,
    PHASE.live_h1,
    PHASE.intermission,
    PHASE.setup_h2,
    PHASE.live_h2,
    PHASE.conclusion,
  ],
  transitions: TRANSITIONS,
  isLivePhase,

  getPhase: (match) => match?.breach?.phase,
  setPhase: (match, phase) => ({
    ...match,
    breach: { ...(match.breach || {}), phase },
  }),

  mapGen: generateBreachMap,
  teamPlanner,
  resolveTick,
  buildInitialBreachState,
};

export default breachDescriptor;
export {
  PHASE,
  LIVE_PHASES,
  HALF_DURATION_MS,
  MATCH_DURATION_MS,
  buildInitialBreachState,
  teamPlanner,
  createNeuralTeamPlanner,
  generateBreachMap,
  resolveTick,
  isLivePhase,
  TRANSITIONS,
};
