/**
 * Reward function for breach self-play.
 *
 * ============================================================================
 *                DESIGN NOTES — READ THIS BEFORE TUNING WEIGHTS
 * ============================================================================
 *
 * The goal of a reward function is not to encode a policy. It's to encode the
 * TARGET the policy should optimize for. If I could write the exact reward
 * formula that makes a great player, I wouldn't need a learned policy at all.
 *
 * For breach specifically, two temptations produce bad learners:
 *
 *   (1) Reward-hack friendly shaping — e.g. "+0.5 per hex moved." This tells
 *       the policy that fidgeting is valuable. Match after match, it moves
 *       constantly but never plants.
 *
 *   (2) Reward sparsity — pure win/loss only. Works in principle, but for a
 *       match where the decision sequence is 100+ actions long and wins
 *       only arrive at the end, the gradient from a lone terminal signal is
 *       vanishingly weak in the low generations.
 *
 * The compromise I use below: TERMINAL rewards dominate by a wide margin,
 * OBJECTIVE-LINKED intermediate rewards give dense signal in early training,
 * and NO reward is given for activity that doesn't advance the objective
 * (raw movement, random attacks, point accumulation). Every shaping term is
 * either:
 *
 *   - tied to a game-changing event (plant, defuse, kill, death), or
 *   - tied to a measurable progress delta toward a specific objective
 *     (hex distance to nearest idle site, time alive near a defended site).
 *
 * Values are tuned so a best-case 1-match total from shaping terms is
 * roughly 30-50% of the terminal-win reward. That ratio means a policy
 * CAN'T win a match by chasing shaping and losing — the terminal component
 * is always large enough to flip the sign.
 *
 * ── The reward schedule ──────────────────────────────────────────────
 *
 * TERMINAL (applied once at match end, per side):
 *
 *   +100 win, -100 loss, 0 draw.
 *      Why: the policy ultimately cares about wins. Symmetric zero-sum
 *      magnitude means self-play stays balanced — neither side has a
 *      gravity toward "safe draw" or "all-or-nothing attack".
 *
 *   +25 per site the side won, -25 per site lost.
 *      Why: in a 6-site match, the score can be 4-2 or 6-0, and we want
 *      policies to notice the difference. Without this a 6-0 blowout and a
 *      4-2 squeaker reward the same.
 *
 * OBJECTIVE EVENTS (applied once, to the acting ghost, multiplied across
 * the team via a small shared credit):
 *
 *   +8 self-plant, +8 self-defuse
 *      Why: the atomic strategic actions. Big enough to notice, small
 *      enough that sacrificing the match for a plant is still net-negative.
 *      (A plant that loses the match: +8 shaping - 100 terminal = -92.)
 *
 *   +2 team-plant-assist (goes to teammates of the planter)
 *   +2 team-defuse-assist (goes to teammates of the defuser)
 *      Why: shares credit so the team-brain learns to coordinate, not just
 *      compete for the plant. Without this, a supporter that clears a
 *      defender's path for the planter gets no credit.
 *
 *   +3 got a kill, -2 got killed
 *      Why: kills disrupt the opposing side's plan and move hp downstream.
 *      Small death penalty discourages suicide pushes without making the
 *      net panic-averse. (Cost of respawn is a structural penalty too —
 *      double-dinging dying-a-lot is unnecessary.)
 *
 *   +0.08 per HP of damage DEALT to an enemy
 *   -0.04 per HP of damage TAKEN
 *      Why: finer-grained kill credit — a player that damages an enemy
 *      down to 20 hp then leaves gets credit even if a teammate delivers
 *      the final blow. The damage-taken penalty is roughly half the
 *      damage-dealt reward so the net prefers trading but doesn't avoid
 *      combat.
 *
 * PROGRESS SHAPING (applied every tick an acting ghost produces a change):
 *
 *   +0.1 per hex CLOSER to the nearest idle site, -0.05 per hex FURTHER
 *      (attackers only)
 *      Why: classic potential-based shaping. Small enough that a pure-
 *      walking policy accumulates at most a few points a half, but
 *      early-training random policies get useful gradient from any
 *      accidental movement toward an objective. The asymmetric penalty
 *      (half the reward) prevents the net from pathologically refusing to
 *      move when it can't improve every step.
 *
 *   +0.15 per tick a defender is within 3 hexes of an IDLE site
 *      (defenders only, max +0.15 total per tick regardless of how many
 *      sites are in range — rewards coverage, not clustering)
 *      Why: defenders need to anchor near sites to be effective. Without
 *      this, random-init defender policies that stay at spawn "look fine"
 *      (they don't die, don't spend points) and never learn to commit.
 *
 *   -0.002 per unspent point per tick (above a 100-point threshold)
 *      Why: hoarding points is a passive-play anti-pattern. Threshold of
 *      100 gives room for a defuse (30) + respawn (40) reserve. Penalty
 *      is very small — intentional. We're nudging, not forcing.
 *
 * LEGALITY (applied per rejected action):
 *
 *   -0.5 for each action the resolver rejected
 *      Why: the action decoder is supposed to mask illegals. This penalty
 *      is a safety net that teaches the net to avoid edge cases the mask
 *      might miss (e.g. sprint paths that look legal pre-tick but get
 *      blocked mid-tick by another ghost's move).
 *
 * ============================================================================
 *                WHAT WE DELIBERATELY DO NOT REWARD
 * ============================================================================
 *
 *   - Raw movement. It's free calories for the policy — it produces
 *     something that looks like activity (the ghost runs around) without
 *     producing strategic value.
 *
 *   - Random attacks. Only DAMAGE-BASED credit. A swing at an enemy that's
 *     about to respawn anyway is worth less than a swing at a low-hp one.
 *
 *   - Point accumulation. Points are a MEANS, not an end — rewarding their
 *     accumulation incentivizes hoarding.
 *
 *   - Time alive for its own sake. Being alive matters because you act; a
 *     "survive at all costs" reward produces cowards.
 *
 *   - Predicted-future rewards (Q-style bootstraps). We're doing
 *     evolutionary self-play, not TD-learning — every reward is attributed
 *     to the match that produced it, period. This keeps the reward signal
 *     interpretable and invariant to the net's own value estimates.
 */

import { SIDE } from '../src/modes/breach/Constants.js';
import { hexDist } from '../src/engine/hex.js';

// ── Exported reward weights (single source of truth) ──────────────

export const REWARDS = Object.freeze({
  // Terminal
  matchWin:            100,
  matchLoss:          -100,
  sitePerWin:           25,
  sitePerLoss:         -25,

  // Objective events
  selfPlant:             8,
  selfDefuse:            8,
  teammatePlant:         2,
  teammateDefuse:        2,
  kill:                  3,
  death:                -2,
  damageDealtPerHp:   0.08,
  damageTakenPerHp:  -0.04,

  // Progress shaping
  attackerHexCloserToSite:  0.10,
  attackerHexFurtherFromSite: -0.05,
  defenderNearSiteTick:     0.15,
  defenderNearSiteRadius:      3,

  // Pressure — kept intentionally small because it multiplies across both
  // ticks AND excess points. A random policy accumulates ~5000 unspent
  // points over a 700-tick match; at 0.00005/tick that's -175 total,
  // roughly 2% of the terminal-win reward. Any bigger and "don't hoard"
  // drowns out "win matches."
  pointHoardPerTick:    -0.00005,
  pointHoardThreshold:      150,

  // Legality
  rejectedAction:        -0.5,
});

// ── Terminal rewards ──────────────────────────────────────────────

/**
 * Apply match-end rewards to both teams. Mutates `rewardAcc` in place.
 *
 * Terminal rewards are split equally across all ghosts on a team — the
 * team result is shared credit. Individual differentiation comes from
 * tick-by-tick shaping.
 */
export function computeTerminalRewards({ winner, sitesA, sitesB, rewardAcc }) {
  const teamSum = (team) => {
    const uuids = Object.keys(rewardAcc[team].perGhost);
    const match = winner === team ? REWARDS.matchWin
                : winner === 'draw' ? 0
                : REWARDS.matchLoss;
    const sitesWon  = team === 'A' ? sitesA : sitesB;
    const sitesLost = team === 'A' ? sitesB : sitesA;
    const sites = sitesWon * REWARDS.sitePerWin + sitesLost * REWARDS.sitePerLoss;
    const total = match + sites;
    const perGhost = total / Math.max(1, uuids.length);
    for (const u of uuids) rewardAcc[team].perGhost[u] += perGhost;
    rewardAcc[team].sum += total;
  };
  teamSum('A');
  teamSum('B');
}

// ── Tick-level rewards ────────────────────────────────────────────
//
// Called once per tick with the before/after snapshots and the resolver's
// event log. We diff the snapshots to attribute HP deltas, deaths, site
// state changes, and position deltas.

export function computeTickRewards({
  prev, next, events, ghostSides, teamSideByUUID, sitesMap, rewardAcc, halfDurationMs,
}) {
  const { teamOfUUID } = rewardAcc;

  // ── HP-delta attribution ────────────────────────────────────────
  // A positive HP delta between prev and next means heal (n/a in breach
  // except respawn). A negative delta is damage taken. We separate damage-
  // taken (penalty for the victim's team) from damage-dealt (credit to the
  // attacker's team). Events carry kill attribution; we use them to split.
  const attackerOfTick = new Map();     // victim uuid → attacker uuid, inferred from event log
  for (const { actor, applied } of (events || [])) {
    for (const a of applied || []) {
      if (a?.kind === 'attack' && a.targetUUID) attackerOfTick.set(a.targetUUID, actor);
      if (a?.mineTriggered) {
        // Mine triggers already deducted HP — no attacker to credit (mines
        // are static structures, placed during setup; the placer isn't
        // in-scope for training).
      }
    }
  }

  for (const [uuid, before] of Object.entries(prev.positions || {})) {
    const after = next.positions?.[uuid];
    if (!after) continue;
    const team = teamOfUUID[uuid];
    if (!team) continue;
    const hpDelta = (after.hp ?? 100) - (before.hp ?? 100);
    const diedThisTick = before.alive && !after.alive;

    if (hpDelta < 0) {
      // Damage taken — victim penalty.
      rewardAcc[team].perGhost[uuid] += hpDelta * -REWARDS.damageTakenPerHp;  // penalty is negative-multiplied
      rewardAcc[team].sum            += hpDelta * -REWARDS.damageTakenPerHp;

      // Damage dealt — attacker credit, if attributed.
      const attackerUUID = attackerOfTick.get(uuid);
      if (attackerUUID && teamOfUUID[attackerUUID] && teamOfUUID[attackerUUID] !== team) {
        const atkTeam = teamOfUUID[attackerUUID];
        const credit = (-hpDelta) * REWARDS.damageDealtPerHp;
        rewardAcc[atkTeam].perGhost[attackerUUID] += credit;
        rewardAcc[atkTeam].sum                    += credit;
      }
    }

    if (diedThisTick) {
      rewardAcc[team].perGhost[uuid] += REWARDS.death;
      rewardAcc[team].sum            += REWARDS.death;
      const attackerUUID = attackerOfTick.get(uuid);
      if (attackerUUID && teamOfUUID[attackerUUID] && teamOfUUID[attackerUUID] !== team) {
        const atkTeam = teamOfUUID[attackerUUID];
        rewardAcc[atkTeam].perGhost[attackerUUID] += REWARDS.kill;
        rewardAcc[atkTeam].sum                    += REWARDS.kill;
      }
    }
  }

  // ── Plant / defuse events ───────────────────────────────────────
  for (const { actor, applied } of (events || [])) {
    const actTeam = teamOfUUID[actor];
    if (!actTeam) continue;
    for (const a of applied || []) {
      if (a?.kind === 'plant') {
        rewardAcc[actTeam].perGhost[actor] += REWARDS.selfPlant;
        rewardAcc[actTeam].sum             += REWARDS.selfPlant;
        // Teammate assist
        for (const otherUUID of Object.keys(rewardAcc[actTeam].perGhost)) {
          if (otherUUID === actor) continue;
          rewardAcc[actTeam].perGhost[otherUUID] += REWARDS.teammatePlant;
          rewardAcc[actTeam].sum                 += REWARDS.teammatePlant;
        }
      }
      if (a?.kind === 'defuse') {
        rewardAcc[actTeam].perGhost[actor] += REWARDS.selfDefuse;
        rewardAcc[actTeam].sum             += REWARDS.selfDefuse;
        for (const otherUUID of Object.keys(rewardAcc[actTeam].perGhost)) {
          if (otherUUID === actor) continue;
          rewardAcc[actTeam].perGhost[otherUUID] += REWARDS.teammateDefuse;
          rewardAcc[actTeam].sum                 += REWARDS.teammateDefuse;
        }
      }
    }
    // Rejected-action penalty
    // (`rejected` is the one action that caused the turn to abort; applied
    // tail may be truncated. We penalize once per rejected turn.)
    // `rejected` field can be null or { action, reason }.
  }
  for (const { actor, rejected } of (events || [])) {
    if (!rejected) continue;
    const team = teamOfUUID[actor];
    if (!team) continue;
    rewardAcc[team].perGhost[actor] += REWARDS.rejectedAction;
    rewardAcc[team].sum             += REWARDS.rejectedAction;
  }

  // ── Progress shaping: distance to idle sites (attackers) ────────
  // Compare prev vs next for each ghost's distance to its NEAREST idle
  // site. We use prev's site map because sites may have transitioned
  // this tick (planted → armed), which we want to treat as progress
  // separately (captured by selfPlant).
  const idleSiteIds = Object.values(sitesMap || {})
    .filter((s) => s && s.state === 'idle')
    .map((s) => s);
  if (idleSiteIds.length > 0) {
    for (const [uuid, before] of Object.entries(prev.positions || {})) {
      const after = next.positions?.[uuid];
      if (!after || !after.alive || !before.alive) continue;
      const side = ghostSides[uuid] || teamSideByUUID?.[uuid];
      if (side !== SIDE.attacker) continue;
      const team = teamOfUUID[uuid];
      if (!team) continue;
      // Before-nearest and after-nearest — potential based.
      let dBefore = Infinity, dAfter = Infinity;
      for (const s of idleSiteIds) {
        dBefore = Math.min(dBefore, hexDist(before.q, before.r, s.position.q, s.position.r));
        dAfter  = Math.min(dAfter,  hexDist(after.q,  after.r,  s.position.q, s.position.r));
      }
      if (dAfter < dBefore) {
        const delta = (dBefore - dAfter) * REWARDS.attackerHexCloserToSite;
        rewardAcc[team].perGhost[uuid] += delta;
        rewardAcc[team].sum            += delta;
      } else if (dAfter > dBefore) {
        const delta = (dAfter - dBefore) * REWARDS.attackerHexFurtherFromSite; // negative
        rewardAcc[team].perGhost[uuid] += delta;
        rewardAcc[team].sum            += delta;
      }
    }
  }

  // ── Progress shaping: defender coverage ──────────────────────────
  if (idleSiteIds.length > 0) {
    for (const [uuid, pos] of Object.entries(next.positions || {})) {
      if (!pos?.alive) continue;
      const side = ghostSides[uuid] || teamSideByUUID?.[uuid];
      if (side !== SIDE.defender) continue;
      const team = teamOfUUID[uuid];
      if (!team) continue;
      const closeToAny = idleSiteIds.some((s) =>
        hexDist(pos.q, pos.r, s.position.q, s.position.r) <= REWARDS.defenderNearSiteRadius);
      if (closeToAny) {
        rewardAcc[team].perGhost[uuid] += REWARDS.defenderNearSiteTick;
        rewardAcc[team].sum            += REWARDS.defenderNearSiteTick;
      }
    }
  }

  // ── Point hoarding ──────────────────────────────────────────────
  for (const [uuid, points] of Object.entries(next.points || {})) {
    const excess = points - REWARDS.pointHoardThreshold;
    if (excess <= 0) continue;
    const team = teamOfUUID[uuid];
    if (!team) continue;
    const penalty = excess * REWARDS.pointHoardPerTick;
    rewardAcc[team].perGhost[uuid] += penalty;
    rewardAcc[team].sum            += penalty;
  }
}
