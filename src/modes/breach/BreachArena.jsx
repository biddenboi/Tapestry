import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import NiceModal from '@ebay/nice-modal-react';
import { AppContext } from '../../App.jsx';
import { GAME_STATE, MATCH_STATUS, STORES, THEME_ACCENT_COLORS, COSMETIC_THEMES } from '../../utils/Constants.js';
import { getNextTodo, getTaskDuration, getWeights } from '../../utils/Helpers/Tasks.js';
import { computeEloChanges } from '../../utils/Helpers/Match.js';
import TaskCreationMenu from '../../Modals/TaskCreationMenu/TaskCreationMenu.jsx';
import TaskPreviewMenu from '../../Modals/TaskPreviewMenu/TaskPreviewMenu.jsx';
import {
  hexToPixel, pixelToHex, hexCorners, tileKey, hexDist,
  CANVAS_W, CANVAS_H, HEX_SIZE, MAP_COLS, MAP_ROWS,
  seededRNG,
} from '../../engine/hex.js';
import { sampleGhostPlaybackWindow } from '../../engine/Playback.js';
import { useMatchClock } from '../../engine/useMatchClock.js';
import { transitionPhase } from '../../engine/phases.js';
import breachDescriptor, {
  PHASE,
  HALF_DURATION_MS,
  MATCH_DURATION_MS,
  buildInitialBreachState,
} from './index.js';
import { runTurn, resolveTick } from './Turn.js';
import { consumeResponseWindow, tickAllBombs } from './Bomb.js';
import { decideSetup } from './SetupPlanner.js';
import {
  DEFENDER_SETUP_BUDGET,
  SETUP_PHASE_CAP_MS,
  INTERMISSION_MS,
  ENEMY_VISIBILITY_RADIUS,
} from './Constants.js';
import { validatePlaceStructure, validateSetSpawn, STRUCTURE_SPECS } from './rules.js';
import BreachActionPopup from './BreachActionPopup.jsx';
import SetupPanel from './SetupPanel.jsx';
import EventBanner from './EventBanner.jsx';
import KillFeed from './KillFeed.jsx';
import PreMatchBanner from '../../components/MatchArena/PreMatchBanner.jsx';
import './BreachArena.css';

/**
 * DEV-ONLY point boost for testing movement / plant / defuse / attack
 * without grinding tasks first. Mirrors the same flag in MatchArena.jsx.
 * MUST be 0 for real play — ghost scoring assumes tasks drive the human's
 * points. Flagged in arch doc §B.6 as a ship-risk; move behind
 * `import.meta.env.DEV` and a debug menu before release.
 */
const DEV_EXTRA_POINTS = 0;

const DPR = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;

export default function BreachArena() {
  const {
    databaseConnection,
    currentPlayer,
    timestamp,
    refreshApp,
    openPanel,
    gameState: [, setGameState],
    activeMatch: [match, setMatch],
    activeTask: [activeTask, setActiveTask],
    notify,
  } = useContext(AppContext);

  const [popupTile, setPopupTile] = useState(null);
  const [popupPos, setPopupPos] = useState({ x: 0, y: 0 });
  const [lastEvent, setLastEvent] = useState(null);
  const [bannerQueue, setBannerQueue] = useState([]);
  const [feedEntries, setFeedEntries] = useState([]);
  const [final5Shown, setFinal5Shown] = useState({ h1: false, h2: false });
  const [nextTodo, setNextTodo] = useState(null);
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [scale, setScale] = useState(1);
  const inTaskSession = !!activeTask?.createdAt;

  // ── Task controls (mirrors MatchArena's header pattern) ────────
  // Poll the todo queue to surface the "next" suggested task. Re-runs on
  // the global `timestamp` heartbeat and whenever a session starts/ends,
  // so the NEXT button reflects the live queue without manual refresh.
  useEffect(() => {
    if (!currentPlayer?.UUID) { setNextTodo(null); return undefined; }
    let cancelled = false;
    (async () => {
      try {
        const todos = await databaseConnection.getAll(STORES.todo);
        if (!cancelled) setNextTodo(getNextTodo(todos, getWeights(todos)));
      } catch {
        if (!cancelled) setNextTodo(null);
      }
    })();
    return () => { cancelled = true; };
  }, [databaseConnection, currentPlayer?.UUID, timestamp, inTaskSession]);

  const handleAddTask = useCallback(() => NiceModal.show(TaskCreationMenu), []);
  const handleNextTask = useCallback(async () => {
    if (!nextTodo || inTaskSession) return;
    setActiveTask({ ...nextTodo, originalDuration: Number(nextTodo.estimatedDuration || 0) });
    await databaseConnection.remove(STORES.todo, nextTodo.UUID);
    refreshApp?.();
    NiceModal.show(TaskPreviewMenu, { start: true });
  }, [nextTodo, inTaskSession, setActiveTask, databaseConnection, refreshApp]);
  const handleOpenQueue = useCallback(() => openPanel?.('tasks'), [openPanel]);

  // Stable username lookup for feed labels.
  const playerLabels = useMemo(() => {
    const m = {};
    if (match?.teams) {
      for (const p of [...(match.teams[0] || []), ...(match.teams[1] || [])]) {
        m[p.UUID] = p.username;
      }
    }
    return m;
  }, [match?.teams]);

  // Cap feed at 4 visible rows; prune rows older than 5s.
  const FEED_LIFETIME_MS = 5000;
  const FEED_CAP = 4;
  const pushFeedItems = useCallback((items) => {
    const now = Date.now();
    setFeedEntries((cur) => {
      const merged = [...items.map((i) => ({ ...i, createdAtWallMs: now })), ...cur];
      return merged.slice(0, FEED_CAP);
    });
  }, []);
  const pushBannerItems = useCallback((items) => {
    setBannerQueue((cur) => [...cur, ...items]);
  }, []);

  useEffect(() => {
    if (feedEntries.length === 0) return undefined;
    const id = window.setInterval(() => {
      const now = Date.now();
      setFeedEntries((cur) => cur.filter((e) => now - e.createdAtWallMs < FEED_LIFETIME_MS));
    }, 500);
    return () => window.clearInterval(id);
  }, [feedEntries.length]);

  const dismissActiveBanner = useCallback(() => {
    setBannerQueue((cur) => cur.slice(1));
  }, []);

  const breach = match?.breach || null;
  const phase = breach?.phase || PHASE.loading;

  // Rehydrate seeded RNG from match UUID so every tick that needs randomness
  // (respawn tile choice) is deterministic per match.
  const rngRef = useRef(null);
  useEffect(() => {
    if (match?.UUID && !rngRef.current) {
      const seed = hashString(match.UUID);
      rngRef.current = seededRNG(seed ^ 0xdeadbeef);
    }
  }, [match?.UUID]);

  // ── Teams & sides ───────────────────────────────────────────────
  const teamSideByUUID = breach?.sideByPlayerUUID || {};
  const allPlayers = useMemo(() => {
    if (!match?.teams) return [];
    return [...(match.teams[0] || []), ...(match.teams[1] || [])];
  }, [match?.teams]);
  const ghostSides = useMemo(() => {
    const out = {};
    for (const p of allPlayers) {
      if (p.isCurrentPlayer) continue;
      out[p.UUID] = teamSideByUUID[p.UUID];
    }
    return out;
  }, [allPlayers, teamSideByUUID]);

  const currentPlayerUUID = currentPlayer?.UUID;

  // ── Theme integration ─────────────────────────────────────────────
  // Mirrors MatchArena's pattern: the active cosmetic theme drives an accent
  // color (applied as --ma-accent on the arena root + used for the player's
  // own side in the canvas) and a dark/light mode flag (switches the canvas
  // background palette). Without this the breach arena was hard-coded to the
  // default dark blue regardless of the player's selected theme.
  const themeId = currentPlayer?.activeCosmetics?.theme || 'default';
  const myAccent = THEME_ACCENT_COLORS[themeId] || THEME_ACCENT_COLORS.default;
  const isDarkTheme = COSMETIC_THEMES.find((t) => t.id === themeId)?.dark !== false;
  const canvasPalette = useMemo(
    () => buildCanvasPalette(isDarkTheme, myAccent),
    [isDarkTheme, myAccent],
  );

  const self = useMemo(() => {
    if (!breach || !currentPlayerUUID) return null;
    const pos = breach.mapState.playerPositions[currentPlayerUUID];
    if (!pos) return null;
    return {
      uuid: currentPlayerUUID,
      side: teamSideByUUID[currentPlayerUUID],
      position: { q: pos.q, r: pos.r },
      points: breach.mapState.points[currentPlayerUUID] || 0,
      alive: pos.alive !== false,
      hp: pos.hp ?? 100,
    };
  }, [breach, currentPlayerUUID, teamSideByUUID]);

  // ── Final-stretch warning (fires once per half near the end) ───────
  //
  // FIX (final-5 bug): the threshold was hardcoded at 5 minutes. When
  // FAST_DEBUG compressed a half to 3 minutes, `halfEnd - elapsed` was
  // ≤ 5min from the very first tick, so the banner and red pulsing clock
  // fired immediately. Scale the threshold with half duration: 5min for
  // a 60-min half, 30s for a 3-min half — effectively "last 1/6 of the
  // half" capped at the old 5-minute value.
  const FINAL_PUSH_MS = Math.min(5 * 60 * 1000, Math.floor(HALF_DURATION_MS / 6));

  useEffect(() => {
    if (!breach) return;
    if (inTaskSession) return;
    const elapsed = breach.matchElapsedMs || 0;
    const halfEnd = breach.halfNumber === 1 ? HALF_DURATION_MS : MATCH_DURATION_MS;
    const timeLeft = halfEnd - elapsed;
    const halfKey = breach.halfNumber === 1 ? 'h1' : 'h2';
    if (timeLeft > 0 && timeLeft <= FINAL_PUSH_MS && !final5Shown[halfKey]) {
      setFinal5Shown((s) => ({ ...s, [halfKey]: true }));
      const selfSide = teamSideByUUID[currentPlayerUUID];
      const subtitle = selfSide === 'attacker' ? 'FINAL PUSH'
        : selfSide === 'defender' ? 'HOLD THE LINE'
        : null;
      setBannerQueue((cur) => [...cur, {
        id: `final5-${halfKey}`,
        variant: 'final5',
        subtitle,
        isMyTeam: true,
        durationMs: 3000,
      }]);
    }
  }, [breach?.matchElapsedMs, breach?.halfNumber, inTaskSession, currentPlayerUUID, teamSideByUUID, final5Shown, FINAL_PUSH_MS]);

  // ── Session-start consumes defender response window ───────────────
  //
  // Per the clarified spec (user feedback): when a bomb is planted, each
  // defender has until they START THEIR NEXT TASK SESSION — or until the
  // 90s hard-cap timer — to act against the plant. Starting a new session
  // signals "I've chosen not to defuse" and consumes that defender's
  // response slot (1/3 → 2/3 → 3/3 → BOOM).
  //
  // Ghosts already get this treatment implicitly — their playback unlock
  // fires a turn, which runs through Turn.js::maybeConsumeResponseWindow.
  // The human needs an explicit hook on the inTaskSession false→true edge.
  //
  // Note: `prevInTaskSession` starts set to the current value so we don't
  // fire spuriously on mount if the player was already in a session.
  const prevInTaskSession = useRef(inTaskSession);
  useEffect(() => {
    const was = prevInTaskSession.current;
    prevInTaskSession.current = inTaskSession;
    // Only fire on the false → true transition (session JUST started).
    if (was || !inTaskSession) return;
    if (!currentPlayerUUID) return;

    const m = matchRef.current;
    if (!m?.breach) return;
    const b = m.breach;
    if (b.phase !== PHASE.live_h1 && b.phase !== PHASE.live_h2) return;

    const side = teamSideByUUID[currentPlayerUUID];
    if (side !== 'defender') return;

    const armed = b.armedBombs || {};
    const hasOpenWindow = Object.values(armed).some(
      (bm) => bm?.defenderResponseAvailable?.[currentPlayerUUID] === true,
    );
    if (!hasOpenWindow) return;

    (async () => {
      try {
        const newArmed = consumeResponseWindow(armed, currentPlayerUUID);
        const swept = tickAllBombs(
          b.mapState.sites, newArmed, b.matchElapsedMs, b.halfNumber,
        );
        const nextBreach = {
          ...b,
          armedBombs: swept.armedBombs,
          siteOutcomes: swept.outcomes.length > 0
            ? [...(b.siteOutcomes || []), ...swept.outcomes]
            : b.siteOutcomes,
          mapState: { ...b.mapState, sites: swept.sites },
        };
        await persistAndSet({ ...m, breach: nextBreach });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[breach] failed to consume response window on session start', err);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inTaskSession, currentPlayerUUID, teamSideByUUID]);

  // ── Phase 1: Loading ────────────────────────────────────────────
  // While prep runs (seed map, sample ghost playback, build initial state),
  // the PreMatchBanner plays as the visual. We gate the phase transition
  // on BOTH prep completion AND a ~4.8s minimum so the banner always gets
  // its full cinematic beat. Prep is typically sub-second; the delay is
  // what the user actually sees.
  const LOADING_MIN_MS = 4800;
  const loadingRan = useRef(false);
  useEffect(() => {
    if (phase !== PHASE.loading || loadingRan.current || !match?.UUID) return;
    loadingRan.current = true;
    (async () => {
      const prep = (async () => {
        const seed = hashString(match.UUID);
        const rng = seededRNG(seed);
        const map = breachDescriptor.mapGen(seed);

        // Assign sides: stable hash of the match UUID.
        //
        // FIX (issue #6): previously `rng() < 0.5`. A small streak of all-
        // attacker-H1 matches in testing suggested the LCG's first output
        // wasn't well-distributed across the seed values we see in practice
        // (mulberry-style LCGs are known to correlate on short streaks
        // when seeded from narrowly-spaced values). Hashing the UUID with a
        // distinct salt decouples side selection from map selection and gives
        // a clean 50/50 flip per match.
        const sideBits = hashString(`${match.UUID}::sides::v2`);
        const team0IsAttackerH1 = (sideBits & 1) === 1;
        const sideByPlayerUUID = {};
        for (const p of match.teams[0] || []) sideByPlayerUUID[p.UUID] = team0IsAttackerH1 ? 'attacker' : 'defender';
        for (const p of match.teams[1] || []) sideByPlayerUUID[p.UUID] = team0IsAttackerH1 ? 'defender' : 'attacker';

        // Sample ghost playback windows for every non-human player.
        // Passing MATCH_DURATION_MS lets synthetic schedules shrink in
        // FAST_DEBUG mode (and real-history sampling picks a correspondingly
        // shorter slice, avoiding the "ghost gets points past match end" bug).
        const ghostPlayback = {};
        const ghosts = allPlayers.filter((p) => !p.isCurrentPlayer);
        for (const ghost of ghosts) {
          // eslint-disable-next-line no-await-in-loop
          ghostPlayback[ghost.UUID] = await sampleGhostPlaybackWindow(
            databaseConnection, ghost, rng, MATCH_DURATION_MS,
          );
        }

        const initialBreach = buildInitialBreachState({
          teams: match.teams,
          sideByPlayerUUID,
          ghostPlayback,
          map,
        });

        const nextMatch = { ...match, mode: 'breach', breach: initialBreach };
        await persistAndSet(nextMatch);
        return nextMatch;
      })();

      const delay = new Promise((r) => setTimeout(r, LOADING_MIN_MS));
      const [nextMatch] = await Promise.all([prep, delay]);

      // Guard check + phase advance in one. Descriptor's setPhase writes
      // into match.breach.phase for us.
      const finalMatch = transitionPhase(
        nextMatch, PHASE.loading, PHASE.setup_h1, breachDescriptor,
      );
      await persistAndSet(finalMatch);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, match?.UUID]);

  // ── Phases 2 & 5: Setup ────────────────────────────────────────
  //
  // When entering a setup phase:
  //   1. Every ghost's decideSetup is called (sequential, UUID-sorted so
  //      later ghosts see earlier teammates' commits).
  //   2. The plans are validated and applied — structures written,
  //      player positions seeded, ghost ready flags set.
  //   3. The human sees SetupPanel and places structures / sets spawn
  //      interactively via setup action callbacks.
  //   4. When the human clicks READY or the 3-minute cap expires, the
  //      human is committed (uncommitted humans get their planner-default
  //      plan applied) and the phase transitions to live.
  const setupRan = useRef({ h1: false, h2: false });

  useEffect(() => {
    if (phase !== PHASE.setup_h1 && phase !== PHASE.setup_h2) return;
    const halfKey = phase === PHASE.setup_h1 ? 'h1' : 'h2';
    if (setupRan.current[halfKey]) return;
    if (!breach) return;
    setupRan.current[halfKey] = true;

    (async () => {
      // FIX (issue #8): the original effect had no try/catch. If any ghost's
      // `decideSetup` or `validateAndApplyPlan` threw, the IIFE would fail
      // silently WITHOUT writing `setupPhaseStartedAtWallMs`. The cap-timer
      // effect then returned early (`if (!breach?.setupPhaseStartedAtWallMs)
      // return;`), the all-ready effect never fires (no one is ready), and
      // the phase sits on SETUP_* forever with no UI affordance to escape.
      // This is the most likely cause of "stuck on setting up round 2" after
      // the OS clock skip — a partially-populated breach state from the
      // intermission transition could fail a ghost plan on stale inputs.
      //
      // Fix: wrap the whole body in try/catch, and on any error, persist
      // whatever partial state we did compute along with a valid
      // `setupPhaseStartedAtWallMs` so the cap timer can auto-commit the
      // defaults. Also reset `setupRan` on catch so the effect re-runs on
      // the next render in case it was a transient failure.
      let nextStructures = { ...(breach.mapState.structures || {}) };
      const nextPositions = { ...(breach.mapState.playerPositions || {}) };
      const nextBudgets = { ...(breach.setupBudgets || {}) };
      const nextReady = { ...(breach.setupReady || {}) };

      try {
        // Sort ghosts by UUID for deterministic setup ordering. Defenders
        // process first so their structures exist before attackers pick spawns
        // (though attacker spawn placement is unaffected by structures —
        // ordering here is for stability, not correctness).
        const ghosts = allPlayers
          .filter((p) => !p.isCurrentPlayer)
          .sort((a, b) => a.UUID.localeCompare(b.UUID));

        const committedPlans = {};

        for (const ghost of ghosts) {
          const side = teamSideByUUID[ghost.UUID];
          const teammatesCommitted = ghosts
            .filter((g) => g.UUID !== ghost.UUID && teamSideByUUID[g.UUID] === side && committedPlans[g.UUID])
            .map((g) => committedPlans[g.UUID]);

          // Wrap each ghost's plan individually — a single ghost failure
          // should not abort setup for everyone else.
          let validated;
          try {
            const plan = decideSetup({
              self: {
                uuid: ghost.UUID,
                side,
                behaviorProfile: ghost.behaviorProfile || null,
                budget: side === 'defender' ? DEFENDER_SETUP_BUDGET : 0,
              },
              map: {
                tiles: breach.mapState.tiles,
                sites: breach.mapState.sites,
                spawnZones: breach.mapState.spawnZones,
              },
              teammates: teammatesCommitted,
            });

            validated = validateAndApplyPlan(
              plan, ghost.UUID, side,
              { tiles: breach.mapState.tiles, sites: breach.mapState.sites, spawnZones: breach.mapState.spawnZones },
              nextStructures,
              DEFENDER_SETUP_BUDGET,
            );
          } catch (err) {
            // eslint-disable-next-line no-console
            console.warn(`[breach] ghost ${ghost.UUID} setup failed; falling back to spawn-default`, err);
            // Fallback: cluster[0] for this side, no structures.
            const cluster = breach.mapState.spawnZones?.[side] || [];
            const [q, r] = (cluster[0] || '0,0').split(',').map(Number);
            validated = {
              structures: nextStructures,
              spawnPosition: { q, r, hp: 100, alive: true },
              budgetRemaining: side === 'defender' ? DEFENDER_SETUP_BUDGET : 0,
              placedStructures: [],
            };
          }

          nextStructures = validated.structures;
          nextPositions[ghost.UUID] = validated.spawnPosition;
          nextBudgets[ghost.UUID] = validated.budgetRemaining;
          nextReady[ghost.UUID] = true;
          committedPlans[ghost.UUID] = {
            uuid: ghost.UUID,
            structures: validated.placedStructures,
            startingTile: validated.spawnPosition,
          };
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[breach] setup effect failed before writing state', err);
        // Allow re-entry on the next render.
        setupRan.current[halfKey] = false;
      }

      // Human starts unready, no structures, full budget if defender.
      // Seed a default position so `self` resolves during setup and the
      // SetupPanel + canvas interactions have an actor to work with. The
      // player can relocate via SET SPAWN; if they never do, this is the
      // same fallback that commitAndAdvance would have applied anyway.
      const humanSide = teamSideByUUID[currentPlayerUUID];
      if (currentPlayerUUID) {
        nextBudgets[currentPlayerUUID] = humanSide === 'defender' ? DEFENDER_SETUP_BUDGET : 0;
        nextReady[currentPlayerUUID] = false;
        if (!nextPositions[currentPlayerUUID]) {
          const cluster = breach.mapState.spawnZones?.[humanSide] || [];
          const defaultKey = cluster[0];
          if (defaultKey) {
            const [dq, dr] = defaultKey.split(',').map(Number);
            nextPositions[currentPlayerUUID] = { q: dq, r: dr, hp: 100, alive: true };
          }
        }
      }

      const nextBreach = {
        ...breach,
        mapState: {
          ...breach.mapState,
          structures: nextStructures,
          playerPositions: nextPositions,
        },
        setupBudgets: nextBudgets,
        setupReady: nextReady,
        // CRITICAL: always set this, even on error paths. The cap timer
        // depends on it to auto-advance when the player doesn't commit.
        setupPhaseStartedAtWallMs: Date.now(),
      };
      try {
        await persistAndSet({ ...match, breach: nextBreach });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[breach] failed to persist setup state', err);
        setupRan.current[halfKey] = false;
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, breach?.phase]);

  // ── Setup cap timer + transition to live ───────────────────────
  //
  // When all players are ready OR the 3-minute cap expires, transition to
  // the live phase. Uncommitted humans are auto-committed to their spawn
  // cluster default (attacker) or a planner-default placement (defender).
  const [setupTimeLeftMs, setSetupTimeLeftMs] = useState(SETUP_PHASE_CAP_MS);
  useEffect(() => {
    if (phase !== PHASE.setup_h1 && phase !== PHASE.setup_h2) return;
    if (!breach?.setupPhaseStartedAtWallMs) return;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      const elapsed = Date.now() - breach.setupPhaseStartedAtWallMs;
      const left = Math.max(0, SETUP_PHASE_CAP_MS - elapsed);
      setSetupTimeLeftMs(left);
      if (left === 0) commitAndAdvance(true);
    };
    tick();
    const id = setInterval(tick, 250);
    return () => { cancelled = true; clearInterval(id); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, breach?.setupPhaseStartedAtWallMs]);

  useEffect(() => {
    if (phase !== PHASE.setup_h1 && phase !== PHASE.setup_h2) return;
    if (!breach?.setupReady) return;
    const ready = breach.setupReady;
    const allReady = allPlayers.every((p) => ready[p.UUID]);
    if (allReady) commitAndAdvance(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, breach?.setupReady]);

  async function commitAndAdvance(autoCommitHuman) {
    const m = matchRef.current;
    if (!m?.breach) return;
    const b = m.breach;
    if (b.phase !== PHASE.setup_h1 && b.phase !== PHASE.setup_h2) return;

    let positions = { ...b.mapState.playerPositions };
    let structures = { ...b.mapState.structures };
    let budgets = { ...b.setupBudgets };

    // Auto-commit the human if they haven't set a spawn, or if the cap
    // expired while they were fiddling.
    if (currentPlayerUUID && !b.setupReady?.[currentPlayerUUID]) {
      const humanSide = teamSideByUUID[currentPlayerUUID];
      const teammatesCommitted = allPlayers
        .filter((p) => p.UUID !== currentPlayerUUID && teamSideByUUID[p.UUID] === humanSide && b.setupReady?.[p.UUID])
        .map((p) => ({
          uuid: p.UUID,
          startingTile: positions[p.UUID] ? { q: positions[p.UUID].q, r: positions[p.UUID].r } : null,
          structures: [],
        }));
      // If human already set a spawn but just didn't click READY, keep that
      // spawn. Otherwise fall back to the planner default.
      if (!positions[currentPlayerUUID]) {
        const plan = decideSetup({
          self: {
            uuid: currentPlayerUUID,
            side: humanSide,
            behaviorProfile: null,
            budget: humanSide === 'defender' ? budgets[currentPlayerUUID] : 0,
          },
          map: {
            tiles: b.mapState.tiles,
            sites: b.mapState.sites,
            spawnZones: b.mapState.spawnZones,
          },
          teammates: teammatesCommitted,
        });
        const applied = validateAndApplyPlan(
          plan, currentPlayerUUID, humanSide,
          { tiles: b.mapState.tiles, sites: b.mapState.sites, spawnZones: b.mapState.spawnZones },
          structures,
          budgets[currentPlayerUUID] ?? DEFENDER_SETUP_BUDGET,
        );
        structures = applied.structures;
        positions[currentPlayerUUID] = applied.spawnPosition;
        budgets[currentPlayerUUID] = applied.budgetRemaining;
      }
    }

    const targetPhase = b.phase === PHASE.setup_h1 ? PHASE.live_h1 : PHASE.live_h2;
    // Run guard against a match that already carries the finalized positions
    // and structures — they're what the guard validates against.
    const probe = {
      ...m,
      breach: {
        ...b,
        mapState: { ...b.mapState, playerPositions: positions, structures },
        setupBudgets: budgets,
        halfStartedAtWallMs: Date.now(),
      },
    };
    const finalMatch = transitionPhase(probe, b.phase, targetPhase, breachDescriptor);
    await persistAndSet(finalMatch);
  }

  /**
   * Validate + apply a setup plan for a single player. Pure given the
   * inputs; mutation-free. Returns { structures, spawnPosition,
   * budgetRemaining, placedStructures } for the arena to merge into
   * persistent state.
   */
  function validateAndApplyPlan(plan, uuid, side, map, structuresBase, budgetStart) {
    let structures = { ...structuresBase };
    let budget = budgetStart;
    const placed = [];

    if (side === 'defender' && Array.isArray(plan.structures)) {
      for (const p of plan.structures) {
        const ctx = {
          tiles: map.tiles,
          sites: map.sites,
          structures,
          spawnZones: map.spawnZones,
          actor: { uuid, side },
          budgetRemaining: budget,
        };
        const v = validatePlaceStructure(p, ctx);
        if (!v.ok) continue;   // drop invalid placements silently — spec §3.7
        structures[tileKey(p.at.q, p.at.r)] = {
          kind: p.kind,
          ownerSide: side,
          ownerUUID: uuid,
          hp: v.hp,
          visibleToAttacker: false,
        };
        budget -= v.cost;
        placed.push({ kind: p.kind, at: { q: p.at.q, r: p.at.r } });
      }
    }

    // Spawn: validate or fall back to cluster[0].
    let spawnPosition = null;
    if (plan.startingTile) {
      const ctx = {
        tiles: map.tiles,
        sites: map.sites,
        structures,
        spawnZones: map.spawnZones,
        actor: { uuid, side },
        budgetRemaining: budget,
      };
      const v = validateSetSpawn(plan.startingTile, ctx);
      if (v.ok) spawnPosition = { q: plan.startingTile.q, r: plan.startingTile.r };
    }
    if (!spawnPosition) {
      const fallback = (map.spawnZones?.[side] || [])[0] || '0,0';
      const [q, r] = fallback.split(',').map(Number);
      spawnPosition = { q, r };
    }

    return {
      structures,
      spawnPosition: { ...spawnPosition, hp: 100, alive: true },
      budgetRemaining: budget,
      placedStructures: placed,
    };
  }

  // ── Human setup action callbacks (from SetupPanel) ─────────────
  const onHumanPlace = useCallback(async (placement) => {
    const m = matchRef.current;
    if (!m?.breach) return;
    const b = m.breach;
    const ctx = {
      tiles: b.mapState.tiles,
      sites: b.mapState.sites,
      structures: b.mapState.structures || {},
      spawnZones: b.mapState.spawnZones,
      actor: { uuid: currentPlayerUUID, side: teamSideByUUID[currentPlayerUUID] },
      budgetRemaining: b.setupBudgets?.[currentPlayerUUID] ?? 0,
    };
    const v = validatePlaceStructure(placement, ctx);
    if (!v.ok) {
      notify?.({ title: 'Placement rejected', message: v.reason, kind: 'warning', persist: false });
      return;
    }
    const structures = {
      ...b.mapState.structures,
      [tileKey(placement.at.q, placement.at.r)]: {
        kind: placement.kind,
        ownerSide: teamSideByUUID[currentPlayerUUID],
        ownerUUID: currentPlayerUUID,
        hp: v.hp,
        visibleToAttacker: false,
      },
    };
    const budgets = {
      ...b.setupBudgets,
      [currentPlayerUUID]: (b.setupBudgets?.[currentPlayerUUID] ?? 0) - v.cost,
    };
    await persistAndSet({
      ...m,
      breach: {
        ...b,
        mapState: { ...b.mapState, structures },
        setupBudgets: budgets,
      },
    });
  }, [currentPlayerUUID, teamSideByUUID, notify]);

  const onHumanRemove = useCallback(async (key) => {
    const m = matchRef.current;
    if (!m?.breach) return;
    const b = m.breach;
    const existing = b.mapState.structures?.[key];
    if (!existing || existing.ownerUUID !== currentPlayerUUID) return;
    const refund = STRUCTURE_SPECS[existing.kind]?.cost || 0;
    const structures = { ...b.mapState.structures };
    delete structures[key];
    const budgets = {
      ...b.setupBudgets,
      [currentPlayerUUID]: (b.setupBudgets?.[currentPlayerUUID] ?? 0) + refund,
    };
    await persistAndSet({
      ...m,
      breach: {
        ...b,
        mapState: { ...b.mapState, structures },
        setupBudgets: budgets,
      },
    });
  }, [currentPlayerUUID]);

  const onHumanSetSpawn = useCallback(async (tile) => {
    const m = matchRef.current;
    if (!m?.breach) return;
    const b = m.breach;
    const ctx = {
      spawnZones: b.mapState.spawnZones,
      actor: { uuid: currentPlayerUUID, side: teamSideByUUID[currentPlayerUUID] },
    };
    const v = validateSetSpawn(tile, ctx);
    if (!v.ok) {
      notify?.({ title: 'Spawn rejected', message: v.reason, kind: 'warning', persist: false });
      return;
    }
    await persistAndSet({
      ...m,
      breach: {
        ...b,
        mapState: {
          ...b.mapState,
          playerPositions: {
            ...b.mapState.playerPositions,
            [currentPlayerUUID]: { q: tile.q, r: tile.r, hp: 100, alive: true },
          },
        },
      },
    });
  }, [currentPlayerUUID, teamSideByUUID, notify]);

  const onHumanReady = useCallback(async () => {
    const m = matchRef.current;
    if (!m?.breach) return;
    const b = m.breach;
    if (!b.mapState.playerPositions[currentPlayerUUID]) return;
    await persistAndSet({
      ...m,
      breach: {
        ...b,
        setupReady: { ...b.setupReady, [currentPlayerUUID]: true },
      },
    });
  }, [currentPlayerUUID]);

  // ── Human task-driven points stream ────────────────────────────
  // Poll the player's completed tasks and credit points to `self`.
  // This mirrors conquest's model — tasks drive the human's budget.
  //
  // CRITICAL: all reads are from matchRef.current, NOT the effect's
  // captured closure. Before this fix the poll used the initial `match`
  // and `breach` from the effect's deps, so every 10s it wrote back a
  // stale snapshot — zeroing matchElapsedMs, clearing armedBombs, and
  // reverting player positions from the prior ~10s of clock work.
  useEffect(() => {
    if (!currentPlayerUUID) return undefined;
    if (phase !== PHASE.live_h1 && phase !== PHASE.live_h2) return undefined;
    let cancelled = false;
    const poll = async () => {
      const m = matchRef.current;
      if (!m?.breach || cancelled) return;
      const b = m.breach;
      if (b.phase !== PHASE.live_h1 && b.phase !== PHASE.live_h2) return;
      const tasks = await databaseConnection.getPlayerStore(STORES.task, currentPlayerUUID);
      if (cancelled) return;
      // Re-read matchRef after the async gap — the clock may have ticked.
      const latest = matchRef.current;
      if (!latest?.breach) return;
      const lb = latest.breach;
      const matchStart = Date.parse(latest.createdAt);
      const total = (tasks || [])
        .filter((t) => t.completedAt && Date.parse(t.completedAt) >= matchStart)
        .reduce((s, t) => s + Number(t.points || 0), 0) + DEV_EXTRA_POINTS;
      const spent = lb.mapState.pointsSpent?.[currentPlayerUUID] || 0;
      const newPoints = Math.max(0, total - spent);
      if ((lb.mapState.points?.[currentPlayerUUID] || 0) === newPoints) return;
      const nextBreach = {
        ...lb,
        mapState: {
          ...lb.mapState,
          points: { ...lb.mapState.points, [currentPlayerUUID]: newPoints },
        },
      };
      await persistAndSet({ ...latest, breach: nextBreach });
    };
    poll();
    const id = setInterval(poll, 10_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [phase, currentPlayerUUID, databaseConnection]);

  // ── Match clock — ticks once a second during live phases ───────
  useMatchClock({
    phase,
    isLivePhase: breachDescriptor.isLivePhase,
    onTick: (wallDelta) => {
      const m = matchRef.current;
      if (!m?.breach) return;
      const b = m.breach;
      const nextMs = Math.min(MATCH_DURATION_MS, b.matchElapsedMs + wallDelta);

      // Step 3/4: playback unlocks + ghost turns.
      const halfEndMs = b.halfNumber === 1 ? HALF_DURATION_MS : MATCH_DURATION_MS;
      const halfStartMs = b.halfNumber === 1 ? 0 : HALF_DURATION_MS;
      const state = {
        tiles:         b.mapState.tiles,
        structures:    b.mapState.structures,
        positions:     b.mapState.playerPositions,
        sites:         b.mapState.sites,
        armedBombs:    b.armedBombs || { A: null, B: null, C: null },
        siteOutcomes:  b.siteOutcomes || [],
        points:        b.mapState.points,
        pointsSpent:   b.mapState.pointsSpent,
      };
      const result = resolveTick({
        matchMs: nextMs,
        halfNumber: b.halfNumber,
        halfStartMs,
        halfEndMs,
        state,
        playback: b.ghostPlayback,
        ghostSides,
        teamSideByUUID,
        spawnKeys: b.mapState.spawnZones,
        rng: rngRef.current || Math.random,
        planner: breachDescriptor.planner,
        teamPlanner: breachDescriptor.teamPlanner,
      });
      if (result.events.length) setLastEvent(result.events[result.events.length - 1]);

      // Drama detection — feed + banners, suppressed during task session.
      if (!inTaskSession) {
        const ctx = {
          matchMs: nextMs,
          halfNumber: b.halfNumber,
          selfSide: teamSideByUUID[currentPlayerUUID],
          selfUUID: currentPlayerUUID,
          teamSideByUUID,
          positions: result.state.positions,
          sites: result.state.sites,
        };
        const { feedItems, bannerItems } = extractEvents(result.events, null, ctx);
        if (feedItems.length) pushFeedItems(feedItems);
        if (bannerItems.length) pushBannerItems(bannerItems);
      }

      const nextBreach = {
        ...b,
        matchElapsedMs: nextMs,
        ghostPlayback: result.playback,
        armedBombs: result.state.armedBombs,
        siteOutcomes: result.state.siteOutcomes,
        mapState: {
          ...b.mapState,
          tiles:             result.state.tiles,
          structures:        result.state.structures,
          playerPositions:   result.state.positions,
          sites:             result.state.sites,
          points:            result.state.points,
          pointsSpent:       result.state.pointsSpent,
        },
      };

      // Half end: transition to intermission / conclusion.
      // FIX (issue #5): previously this only checked the clock. Spec §3.10
      // and the live_h1 → intermission / live_h2 → conclusion guards in
      // modes/breach/index.js both require "matchMs ≥ halfEnd OR all 3 sites
      // resolved" — but the OR branch was never triggering the transition,
      // only gating the guard. So when an attacker detonated all three bombs
      // at, say, 20 min into a half, the game would just keep running until
      // 60 min. `siteOutcomes` has one entry per resolved site per half; if
      // we have 3 entries for the current half, it's over.
      const currentHalfOutcomes = (nextBreach.siteOutcomes || [])
        .filter((o) => o.half === b.halfNumber);
      const allSitesResolved = currentHalfOutcomes.length >= 3;

      const halfOver = (b.halfNumber === 1 && nextMs >= HALF_DURATION_MS)
        || (b.halfNumber === 2 && nextMs >= MATCH_DURATION_MS)
        || allSitesResolved;

      if (halfOver) {
        // Any site not yet resolved for this half goes to defenders by
        // default (spec §3.10 — "defence wins unless the bomb reached
        // EXPLODED"). Covers both idle and still-armed-at-boundary cases.
        const already = new Set(
          (nextBreach.siteOutcomes || [])
            .filter((o) => o.half === b.halfNumber)
            .map((o) => o.siteId),
        );
        const autoOutcomes = [];
        for (const site of Object.values(nextBreach.mapState.sites)) {
          if (already.has(site.id)) continue;
          autoOutcomes.push({ siteId: site.id, outcome: 'defenders', half: b.halfNumber });
        }
        const siteOutcomesWithAuto = [...(nextBreach.siteOutcomes || []), ...autoOutcomes];

        const newPhase = b.halfNumber === 1 ? PHASE.intermission : PHASE.conclusion;
        const phaseTransitioned = {
          ...nextBreach,
          phase: newPhase,
          siteOutcomes: siteOutcomesWithAuto,
          ...(newPhase === PHASE.intermission
            ? {
                // Swap sides. Clear positions. Clear structures. Clear armed
                // bombs. Reset sites.
                halfNumber: 2,
                sideByPlayerUUID: swapSides(b.sideByPlayerUUID),
                armedBombs: { A: null, B: null, C: null },
                mapState: {
                  ...nextBreach.mapState,
                  playerPositions: {},
                  structures: {},
                  sites: Object.fromEntries(
                    Object.entries(nextBreach.mapState.sites).map(
                      ([k, s]) => [k, { ...s, state: 'idle', resolvedInHalf: undefined }],
                    ),
                  ),
                },
                // FIX (issue: H2 skips setup): clear setup-phase state so the
                // setup_h2 effect can rebuild it from scratch. Leaving these
                // in place caused two bugs:
                //  1. setupPhaseStartedAtWallMs from H1 was already older than
                //     SETUP_PHASE_CAP_MS → the cap-timer effect fired
                //     commitAndAdvance(true) on its first tick, skipping setup.
                //  2. setupReady had all 5 ghosts still marked true → the
                //     all-ready effect fired as soon as the setup_h2 effect
                //     wrote its first ghost commit, short-circuiting the
                //     human's placement window.
                setupReady: {},
                setupBudgets: {},
                setupPhaseStartedAtWallMs: null,
              }
            : {}),
        };
        if (newPhase === PHASE.intermission) {
          setupRan.current.h2 = false;
          // Re-arm the final-push banner for H2 so it fires again on the
          // clock reaching the last stretch of the second half.
          setFinal5Shown((s) => ({ ...s, h2: false }));
        }
        persistAndSet({ ...m, breach: phaseTransitioned });
      } else {
        persistAndSet({ ...m, breach: nextBreach });
      }
    },
  });

  // ── Intermission auto-advance ──────────────────────────────────
  useEffect(() => {
    if (phase !== PHASE.intermission) return;
    const id = setTimeout(async () => {
      try {
        const finalMatch = transitionPhase(
          matchRef.current,
          PHASE.intermission,
          PHASE.setup_h2,
          breachDescriptor,
        );
        await persistAndSet(finalMatch);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[breach] intermission → setup_h2 failed', err);
      }
    }, INTERMISSION_MS);   // was hardcoded 30s — honor the constant so
                           // FAST_DEBUG can shorten intermission too
    return () => clearTimeout(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // ── Conclusion: tally site-rounds, compute ELO, mark complete ─
  useEffect(() => {
    if (phase !== PHASE.conclusion) return;
    (async () => {
      const m = matchRef.current;
      if (!m || m.status === MATCH_STATUS.complete) return;
      const outcomes = m.breach?.siteOutcomes || [];

      // Each site-round entry records the outcome for a (half, siteId). The
      // attacker for each half depends on which side was attacker THAT half:
      //   H1 attacker  = original teams[0]/teams[1] per initial side assignment
      //   H2 attacker  = the other team
      // So "attackers won site-round X" translates to "team[attackerThatHalf]
      // won site-round X" for the purpose of scoring to a team index.
      //
      // We reconstruct by looking at sideByPlayerUUID at conclusion time
      // against each team's roster. sideByPlayerUUID at conclusion reflects
      // H2 sides (swap happened at intermission). H1 sides are the inverse.
      const h2Attacker = Object.entries(m.breach.sideByPlayerUUID)
        .filter(([, side]) => side === 'attacker')
        .map(([uuid]) => uuid);
      const team0UUIDs = new Set((m.teams[0] || []).map((p) => p.UUID));
      const team0IsAttackerH2 = h2Attacker.every((u) => team0UUIDs.has(u));
      const team0IsAttackerH1 = !team0IsAttackerH2;

      const teamScore = [0, 0];
      for (const o of outcomes) {
        const isAttackingH1 = o.half === 1;
        const winnerTeamIdx = o.outcome === 'attackers'
          ? (isAttackingH1 ? (team0IsAttackerH1 ? 0 : 1) : (team0IsAttackerH2 ? 0 : 1))
          : (isAttackingH1 ? (team0IsAttackerH1 ? 1 : 0) : (team0IsAttackerH2 ? 1 : 0));
        teamScore[winnerTeamIdx] += 1;
      }

      const winningTeamIndex = teamScore[0] > teamScore[1] ? 0
        : teamScore[1] > teamScore[0] ? 1
        : null;
      const myTeamIdx = (m.teams[0] || []).some((p) => p.UUID === currentPlayerUUID) ? 0 : 1;
      const iWon = winningTeamIndex === myTeamIdx;

      // ELO — reuse conquest's helper with a score map derived from
      // site-round wins (not tower HP). Each team's score is their
      // site-round count; the function's own normalization handles the rest.
      const scoreMap = {};
      for (const p of m.teams[0] || []) scoreMap[p.UUID] = teamScore[0];
      for (const p of m.teams[1] || []) scoreMap[p.UUID] = teamScore[1];
      let eloDeltas = {};
      try {
        eloDeltas = computeEloChanges(m, scoreMap, currentPlayerUUID);
      } catch {
        eloDeltas = {};
      }

      const result = {
        endedAt: new Date().toISOString(),
        siteRounds: outcomes,
        finalScore: { team1: teamScore[0], team2: teamScore[1] },
        winningTeamIndex,
        // Compat fields — MatchDetailsModal reads `result.winner` (1 or 2),
        // `result.team1Total` / `result.team2Total`, and `result.eloChange`;
        // Profile's matchOutcomeFor also reads `result.winner`. Without these,
        // concluded breach matches show "In progress" and render as losses on
        // other players' profiles.
        winner: winningTeamIndex == null ? null : winningTeamIndex + 1,
        team1Total: teamScore[0],
        team2Total: teamScore[1],
        iWon,
        eloChange: eloDeltas[currentPlayerUUID] || 0,
      };

      // Persist ELO deltas to each player record, mirroring conquest.
      try {
        for (const p of [...(m.teams[0] || []), ...(m.teams[1] || [])]) {
          const delta = eloDeltas[p.UUID] || 0;
          if (!delta) continue;
          const dbPlayer = await databaseConnection.getPlayerByUUID(p.UUID);
          if (dbPlayer) {
            await databaseConnection.update(STORES.player, p.UUID, {
              elo: Math.max(0, (dbPlayer.elo || 0) + delta),
            });
          }
        }
      } catch {
        // ELO persistence failure is non-fatal — match still completes.
      }

      await persistAndSet({ ...m, status: MATCH_STATUS.complete, result });
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // ── Match ref for tick callback (escape hatch so interval lifecycle
  // isn't tied to every re-render). Mirrors conquest's liveRef pattern. ───
  const matchRef = useRef(match);
  matchRef.current = match;

  async function persistAndSet(nextMatch) {
    // Eager-update the ref BEFORE the async write. Without this, a
    // concurrent writer (points poll, setup effect, etc.) that reads
    // matchRef.current between our `setMatch` and the next render would
    // see the pre-write state and overwrite our changes on its next
    // persist — the exact pattern that caused matchElapsedMs / armedBombs
    // / positions to reset every 10 seconds when the points poll fired.
    matchRef.current = nextMatch;
    await databaseConnection.update(STORES.match, nextMatch.UUID, nextMatch);
    setMatch(nextMatch);
  }

  // ── Human action dispatch ─────────────────────────────────────
  const handleAction = useCallback(async (action) => {
    if (!breach || !self || !match) return;
    if (phase !== PHASE.live_h1 && phase !== PHASE.live_h2) return;

    const ctx = {
      tiles:        breach.mapState.tiles,
      structures:   breach.mapState.structures,
      positions:    breach.mapState.playerPositions,
      sites:        breach.mapState.sites,
      armedBombs:   breach.armedBombs || { A: null, B: null, C: null },
      siteOutcomes: breach.siteOutcomes || [],
      points:       breach.mapState.points,
      pointsSpent:  breach.mapState.pointsSpent,
      actor:        { uuid: self.uuid, side: self.side },
      teamSideByUUID,
      spawnKeys:    breach.mapState.spawnZones,
      rng:          rngRef.current || Math.random,
      matchMs:      breach.matchElapsedMs,
      halfNumber:   breach.halfNumber,
    };

    const outcome = runTurn([action], ctx);
    if (outcome.rejected) {
      notify?.({
        title: 'Action rejected',
        message: outcome.rejected.reason,
        kind: 'warning',
        persist: false,
      });
      setPopupTile(null);
      return;
    }

    const nextBreach = {
      ...breach,
      armedBombs:   outcome.state.armedBombs,
      siteOutcomes: outcome.state.siteOutcomes,
      mapState: {
        ...breach.mapState,
        tiles:            outcome.state.tiles,
        structures:       outcome.state.structures,
        playerPositions:  outcome.state.positions,
        sites:            outcome.state.sites,
        points:           outcome.state.points,
        pointsSpent:      outcome.state.pointsSpent,
      },
    };
    setLastEvent({ type: 'human-turn', actor: self.uuid, applied: outcome.applied });

    if (!inTaskSession) {
      const ctx = {
        matchMs: breach.matchElapsedMs,
        halfNumber: breach.halfNumber,
        selfSide: self.side,
        selfUUID: self.uuid,
        teamSideByUUID,
        positions: outcome.state.positions,
        sites: outcome.state.sites,
      };
      const { feedItems, bannerItems } = extractEvents(
        [],
        { actor: self.uuid, applied: outcome.applied },
        ctx,
      );
      if (feedItems.length) pushFeedItems(feedItems);
      if (bannerItems.length) pushBannerItems(bannerItems);
    }
    setPopupTile(null);
    await persistAndSet({ ...match, breach: nextBreach });
  }, [breach, self, match, phase, teamSideByUUID, notify, databaseConnection, setMatch]);

  // ── Canvas render ─────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !breach) return;
    const ctx = canvas.getContext('2d');
    canvas.width = CANVAS_W * DPR;
    canvas.height = CANVAS_H * DPR;
    canvas.style.width = `${CANVAS_W}px`;
    canvas.style.height = `${CANVAS_H}px`;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    draw(ctx, breach, self, teamSideByUUID, allPlayers, canvasPalette);
  }, [breach, self, teamSideByUUID, allPlayers, canvasPalette]);

  const wrapRef = useRef(null);
  // ── Responsive scale ──────────────────────────────────────────
  // Measure the canvas wrap directly instead of the outer arena minus a
  // guess-offset — the previous approach over-subtracted and compressed
  // the canvas, leaving dead space to the right. Pure fit-to-container
  // math; the cap allows modest upscaling on bigger viewports.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const obs = new ResizeObserver(() => {
      const pad = 36;   // matches .breach-canvas-wrap padding (18 each side)
      const w = Math.max(0, el.clientWidth - pad);
      const h = Math.max(0, el.clientHeight - pad);
      const fit = Math.min(w / CANVAS_W, h / CANVAS_H);
      setScale(Math.max(0.3, Math.min(1.8, fit)));
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // ── Click handling ────────────────────────────────────────────
  const onCanvasClick = (e) => {
    if (!canvasRef.current) return;
    const isLive = phase === PHASE.live_h1 || phase === PHASE.live_h2;
    const isSetup = phase === PHASE.setup_h1 || phase === PHASE.setup_h2;
    if (!isLive && !isSetup) return;
    // FIX (issue #3): previously we returned early here for dead players:
    //   `if (isLive && !self?.alive) return;`
    // That gate made the only respawn entrypoint (the popup's `!self.alive`
    // branch) unreachable — dead players had no way to open the popup, so
    // they had no way to respawn. The popup handles the dead case on its own
    // (see BreachActionPopup.jsx ~line 80), so letting the click through is
    // the right fix. Setup phase has always been click-through.
    const rect = canvasRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / scale;
    const y = (e.clientY - rect.top) / scale;
    const hex = pixelToHex(x, y);
    if (hex.q < 0 || hex.q >= MAP_COLS || hex.r < 0 || hex.r >= MAP_ROWS) return;
    const p = hexToPixel(hex.q, hex.r);
    setPopupTile(hex);
    setPopupPos({ x: p.x * scale + 20, y: p.y * scale });
  };

  // ── Forfeit / leave ───────────────────────────────────────────
  //
  // FIX (issue #1): `setActiveMatch(null)` is REQUIRED before `setGameState`,
  // matching the pattern in `MatchArena.jsx` (the conquest arena). Without it,
  // `activeMatch` is still the forfeited match when GameHub re-renders, and
  // `renderMain()` dispatches on `activeMatch?.mode === 'breach'` — keeping
  // the arena mounted. The user reports "clicking leave once causes a refresh
  // but nothing changes" because BreachArena unmounts then Lobby's load effect
  // refetches the match, sees `status === 'active'` still present from before
  // the persist settled, and routes straight back in. Two clicks works because
  // the second click's persist has landed by then. Clearing activeMatch here
  // makes the single-click path deterministic.
  const leave = async () => {
    const m = matchRef.current;
    if (!m) return;
    // Forfeit: count the forfeiter's team as the loser. `winner` is written
    // in 1-indexed form for MatchDetailsModal / Profile compat.
    const myTeamIdx = (m.teams?.[0] || []).some((p) => p.UUID === currentPlayerUUID) ? 0 : 1;
    const winnerIdx = 1 - myTeamIdx;
    await persistAndSet({
      ...m,
      status: MATCH_STATUS.forfeited,
      result: {
        endedAt: new Date().toISOString(),
        iWon: false,
        winner: winnerIdx + 1,
        winningTeamIndex: winnerIdx,
        team1Total: 0,
        team2Total: 0,
        forfeited: true,
      },
    });
    setMatch(null);
    setGameState(GAME_STATE.idle);
  };

  if (!match) return <div className="breach-arena"><div className="breach-loading">No match.</div></div>;

  const clock = formatClock(breach?.matchElapsedMs || 0);
  const half = breach?.halfNumber || 1;
  const template = breach?.templateLabel || '';
  const siteOutcomes = breach?.siteOutcomes || [];
  const attackerWins = siteOutcomes.filter((o) => o.outcome === 'attackers').length;
  const defenderWins = siteOutcomes.filter((o) => o.outcome === 'defenders').length;

  // Final-stretch visual state: pulsing red clock in the last portion of
  // a half. Uses the same scaled threshold as the banner effect above so
  // both fire together and don't both trigger at t=0 in FAST_DEBUG.
  const halfEnd = half === 1 ? HALF_DURATION_MS : MATCH_DURATION_MS;
  const timeLeftInHalf = halfEnd - (breach?.matchElapsedMs || 0);
  const isFinal5 = (phase === PHASE.live_h1 || phase === PHASE.live_h2)
    && timeLeftInHalf > 0 && timeLeftInHalf <= FINAL_PUSH_MS;

  // Halftime outcome summary (H1 only — displayed during intermission).
  const h1Outcomes = siteOutcomes.filter((o) => o.half === 1);
  const h1ByeSite = (id) => h1Outcomes.find((o) => o.siteId === id)?.outcome;

  // Match-end data (displayed at conclusion phase).
  const matchResult = match?.result;
  const myTeamIdx = (match?.teams?.[0] || []).some((p) => p.UUID === currentPlayerUUID) ? 0 : 1;
  const iWon = matchResult?.winningTeamIndex === myTeamIdx;
  const isDraw = matchResult?.winningTeamIndex == null && matchResult;

  const activeBanner = bannerQueue[0] || null;

  return (
    <div
      className={`breach-arena ${isDarkTheme ? 'theme-dark' : 'theme-light'}`}
      ref={containerRef}
      style={{
        '--ma-accent': myAccent,
        '--breach-accent': myAccent,
        '--breach-bg': canvasPalette.bg,
        '--breach-tile': canvasPalette.tile,
        '--breach-ink': canvasPalette.ink,
      }}
    >
      <div className="breach-top">
        <div className="breach-top-left">
          <span className="breach-phase">{(phase || '').toUpperCase()}</span>
          <span className="breach-template">{template}</span>
          <span className={`breach-clock${isFinal5 ? ' final5' : ''}`}>{clock}</span>
          <span className="breach-half">HALF {half}</span>
          <span className="breach-score">
            <span className="breach-score-atk">ATK {attackerWins}</span>
            <span className="breach-score-sep">·</span>
            <span className="breach-score-def">DEF {defenderWins}</span>
          </span>
        </div>
        <div className="breach-top-right">
          {(phase === PHASE.live_h1 || phase === PHASE.live_h2
            || phase === PHASE.setup_h1 || phase === PHASE.setup_h2) && (
            <div className="breach-task-controls">
              <button
                className="breach-tctrl"
                onClick={handleAddTask}
                disabled={inTaskSession}
                title="Create a new task"
              >
                + TASK
              </button>
              <button
                className="breach-tctrl breach-tctrl--primary"
                onClick={handleNextTask}
                disabled={!nextTodo || inTaskSession}
                title={
                  inTaskSession ? 'Session already active'
                    : nextTodo ? `Start: ${nextTodo.name}`
                    : 'No queued tasks'
                }
              >
                ↑ NEXT
                {nextTodo && !inTaskSession && (
                  <span className="breach-tctrl-sub">{nextTodo.name.slice(0, 14)}</span>
                )}
              </button>
              <button className="breach-tctrl" onClick={handleOpenQueue} title="Open task queue">
                QUEUE
              </button>
              {inTaskSession && (
                <span className="breach-session-pill" title={activeTask?.name}>
                  <span className="breach-session-dot" />
                  {(activeTask?.name || 'SESSION').slice(0, 16)}
                </span>
              )}
            </div>
          )}
          {self && (
            <>
              <span className={`breach-side breach-side--${self.side}`}>{(self.side || '').toUpperCase()}</span>
              <span className="breach-hp">HP {self.hp}</span>
              <span className="breach-pts">{self.points} pts</span>
              <span className={`breach-alive ${self.alive ? '' : 'dead'}`}>{self.alive ? 'ALIVE' : 'DEAD'}</span>
              {/* FIX (issue #3): one-click HUD respawn so the player doesn't
                  need to discover the "click a tile then pick RESPAWN" flow.
                  Only shown when dead and in a live phase. Button is disabled
                  when points are insufficient. */}
              {!self.alive && (phase === PHASE.live_h1 || phase === PHASE.live_h2) && (
                <button
                  className="breach-respawn"
                  onClick={() => handleAction({ kind: 'respawn' })}
                  disabled={self.points < (self.side === 'attacker' ? 60 : 40)}
                  title="Respawn at your team's spawn cluster"
                >
                  RESPAWN ({self.side === 'attacker' ? 60 : 40}pt)
                </button>
              )}
            </>
          )}
          <button className="breach-leave" onClick={leave}>LEAVE</button>
        </div>
      </div>

      <div className="breach-canvas-wrap" ref={wrapRef}>
        <div
          className="breach-canvas-inner"
          style={{ width: CANVAS_W * scale, height: CANVAS_H * scale }}
        >
          <canvas
            ref={canvasRef}
            onClick={onCanvasClick}
            className="breach-canvas"
            style={{ transform: `scale(${scale})`, transformOrigin: 'top left' }}
          />
          {popupTile && self && (phase === PHASE.live_h1 || phase === PHASE.live_h2) && (
            <BreachActionPopup
              tile={popupTile}
              state={{
                tiles: breach.mapState.tiles,
                structures: breach.mapState.structures,
                positions: breach.mapState.playerPositions,
                sites: breach.mapState.sites,
                armedBombs: breach.armedBombs,
              }}
              self={self}
              teamSideByUUID={teamSideByUUID}
              style={{ left: popupPos.x, top: popupPos.y }}
              onAction={handleAction}
              onClose={() => setPopupTile(null)}
            />
          )}
        </div>
      </div>

      {(phase === PHASE.setup_h1 || phase === PHASE.setup_h2) && self && breach && (
        <SetupPanel
          tile={popupTile}
          self={{
            uuid: self.uuid,
            side: self.side,
            budgetRemaining: breach.setupBudgets?.[self.uuid] ?? DEFENDER_SETUP_BUDGET,
            spawnTile: breach.mapState.playerPositions[self.uuid]
              ? { q: breach.mapState.playerPositions[self.uuid].q, r: breach.mapState.playerPositions[self.uuid].r }
              : null,
            structures: Object.entries(breach.mapState.structures || {})
              .filter(([, s]) => s.ownerUUID === self.uuid)
              .map(([k, s]) => { const [q, r] = k.split(',').map(Number); return { kind: s.kind, at: { q, r } }; }),
            ready: !!breach.setupReady?.[self.uuid],
          }}
          state={{
            tiles: breach.mapState.tiles,
            sites: breach.mapState.sites,
            structures: breach.mapState.structures,
            spawnZones: breach.mapState.spawnZones,
          }}
          phaseTimeLeftMs={setupTimeLeftMs}
          onPlace={onHumanPlace}
          onRemove={onHumanRemove}
          onSetSpawn={onHumanSetSpawn}
          onReady={onHumanReady}
          onClose={() => setPopupTile(null)}
        />
      )}

      <div className="breach-event-strip">
        {lastEvent && (
          <span>
            {lastEvent.type} · {lastEvent.actor?.slice(0, 6)}
            {lastEvent.pointsUnlocked ? ` · +${lastEvent.pointsUnlocked}pt unlock` : ''}
            {lastEvent.applied?.length ? ` · ${lastEvent.applied.map((a) => a.kind).join(',')}` : ''}
            {lastEvent.rejected ? ` · rejected: ${lastEvent.rejected.reason}` : ''}
          </span>
        )}
      </div>

      {/* Kill feed — persistent during live/setup; suppressed during task sessions */}
      {!inTaskSession && (phase === PHASE.live_h1 || phase === PHASE.live_h2) && (
        <KillFeed entries={feedEntries} suppress={inTaskSession} labels={playerLabels} />
      )}

      {/* Event banner — one at a time, auto-dismiss */}
      {!inTaskSession && activeBanner && (
        <EventBanner
          key={activeBanner.id}
          variant={activeBanner.variant}
          siteId={activeBanner.siteId}
          subtitle={activeBanner.subtitle}
          actorLabel={activeBanner.actorLabel ? playerLabels[activeBanner.actorLabel] || activeBanner.actorLabel.slice(0, 6) : null}
          clutch={activeBanner.clutch}
          isMyTeam={activeBanner.isMyTeam}
          durationMs={activeBanner.durationMs}
          onDismiss={dismissActiveBanner}
        />
      )}

      {/* Half-time summary overlay */}
      {phase === PHASE.intermission && (
        <div className="breach-halftime">
          <div className="bht-header">HALF-TIME</div>
          <div className="bht-score">
            <span className="bht-score-atk">ATK {attackerWins}</span>
            <span className="bht-score-sep">—</span>
            <span className="bht-score-def">DEF {defenderWins}</span>
          </div>
          <div className="bht-sites">
            {['A', 'B', 'C'].map((id) => {
              const o = h1ByeSite(id);
              return (
                <div key={id} className="bht-site">
                  <span className="bht-site-letter">{id}</span>
                  <span className={`bht-site-outcome ${o === 'attackers' ? 'atk' : 'def'}`}>
                    {o === 'attackers' ? 'ATK WON' : 'DEF WON'}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="bht-countdown">SIDES SWAPPING · H2 SETUP SOON</div>
        </div>
      )}

      {/* Match-end overlay */}
      {phase === PHASE.conclusion && matchResult && (
        <div className="breach-endscreen">
          <div className={`bes-header ${isDraw ? 'draw' : iWon ? 'win' : 'loss'}`}>
            {isDraw ? 'DRAW' : iWon ? 'VICTORY' : 'DEFEAT'}
          </div>
          <div className="bes-score">
            <span className="bht-score-atk">
              {matchResult.finalScore?.team1 ?? 0}
            </span>
            <span className="bht-score-sep">—</span>
            <span className="bht-score-def">
              {matchResult.finalScore?.team2 ?? 0}
            </span>
          </div>
          <div className="bes-rounds">
            {(matchResult.siteRounds || []).map((o, i) => (
              <div
                key={i}
                className={`bes-round-cell ${o.outcome === 'attackers' ? 'atk' : 'def'}`}
                title={`Half ${o.half} · Site ${o.siteId} · ${o.outcome}`}
              >
                {o.siteId}
                {o.half === 1 ? '₁' : '₂'}
              </div>
            ))}
          </div>
          {typeof matchResult.eloChange === 'number' && (
            <div className={`bes-elo ${matchResult.eloChange > 0 ? 'pos' : matchResult.eloChange < 0 ? 'neg' : ''}`}>
              ELO {matchResult.eloChange >= 0 ? '+' : ''}{matchResult.eloChange}
            </div>
          )}
          <button className="bes-cta" onClick={() => { setMatch(null); setGameState(GAME_STATE.idle); }}>
            RETURN TO LOBBY
          </button>
        </div>
      )}

      {/* Loading overlay — renders the existing conquest PreMatchBanner
          (mode-agnostic: takes match + currentPlayerUUID + onComplete).
          The loading effect gates the phase transition on a minimum
          duration so the banner always gets its full ~4.8s beat. Breach-
          specific extensions (map name display, "YOU ATTACK FIRST",
          countdown-to-SETUP_H1) are still deferred per README §A.6.1. */}
      {phase === PHASE.loading && (
        <div className="breach-prematch-wrap">
          <PreMatchBanner
            match={match}
            currentPlayerUUID={currentPlayerUUID}
            onComplete={() => { /* phase transition is timer-gated in loading effect */ }}
          />
        </div>
      )}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────

function hashString(s = '') {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) {
    h = ((h << 5) - h) + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h) >>> 0;
}

function swapSides(sideByUUID) {
  const out = {};
  for (const [uuid, side] of Object.entries(sideByUUID)) {
    out[uuid] = side === 'attacker' ? 'defender' : 'attacker';
  }
  return out;
}

function formatClock(ms) {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Extract feed + banner entries from a tick result plus optional human turn.
 *
 * `events` is the tick's event list (ghost turns, clock events).
 * `humanTurn` is null or { actor, applied } for a click-dispatched turn.
 *
 * Returns { feedItems, bannerItems } — each carries a synthetic monotonic
 * id so the arena's state can dedup and cap easily.
 */
function extractEvents(events, humanTurn, ctx) {
  const { matchMs, halfNumber, selfSide, selfUUID, teamSideByUUID, positions } = ctx;
  const feedItems = [];
  const bannerItems = [];
  let seq = 0;
  const nextId = () => `${matchMs}:${seq++}`;

  const pushFeed = (item) => feedItems.push({ ...item, id: nextId(), matchMs });
  const pushBanner = (item) => bannerItems.push({ ...item, id: nextId(), matchMs });

  const turnSources = [
    ...(events || []).filter((e) => e.type === 'ghost-turn'),
    ...(humanTurn ? [{ actor: humanTurn.actor, applied: humanTurn.applied }] : []),
  ];

  for (const turn of turnSources) {
    const actor = turn.actor;
    const actorSide = teamSideByUUID[actor];
    const isMyTeam = actorSide && selfSide && actorSide === selfSide;

    for (const a of turn.applied || []) {
      if (a.kind === 'plant') {
        pushFeed({ kind: 'plant', actor, siteId: a.site, isMyTeam });
        const clutch = isClutchPlant(actor, teamSideByUUID, positions);
        pushBanner({
          variant: 'plant',
          siteId: a.site,
          actorLabel: actor,
          isMyTeam,
          clutch,
        });
        if (clutch) pushFeed({ kind: 'plant', actor, siteId: a.site, isMyTeam, clutch: true });
      } else if (a.kind === 'defuse') {
        pushFeed({ kind: 'defuse', actor, siteId: a.site, isMyTeam });
        const remainingMs = a.remainingMs ?? Infinity;
        const clutchTime = remainingMs < 5000;
        const clutchMulti = isClutchDefuseMultiEnemy(a.site, ctx);
        const clutch = clutchTime || clutchMulti;
        pushBanner({
          variant: 'defuse',
          siteId: a.site,
          actorLabel: actor,
          isMyTeam,
          clutch,
        });
        if (clutch) pushFeed({ kind: 'defuse', actor, siteId: a.site, isMyTeam, clutch: true });
      } else if (a.kind === 'attack') {
        pushFeed({
          kind: a.killed ? 'kill' : 'attack',
          actor,
          target: a.targetUUID,
          isMyTeam,
        });
      } else if (a.kind === 'breach') {
        pushFeed({ kind: 'breach', actor, isMyTeam });
      } else if (a.mineTriggered?.length) {
        pushFeed({ kind: 'mine', actor, isMyTeam });
      }
    }
  }

  // Clock events: bomb-exploded.
  for (const e of events || []) {
    if (e.type === 'bomb-exploded') {
      // "my team lost the site" iff I'm the defender this half.
      const isMyTeam = selfSide === 'attacker';
      pushFeed({ kind: 'explode', siteId: e.siteId, actor: null });
      pushBanner({ variant: 'explode', siteId: e.siteId, isMyTeam });
    }
  }

  return { feedItems, bannerItems };
}

function isClutchPlant(actorUUID, teamSideByUUID, positions) {
  // Last living attacker: actor is attacker, and every other attacker is dead.
  if (teamSideByUUID[actorUUID] !== 'attacker') return false;
  for (const [uuid, side] of Object.entries(teamSideByUUID)) {
    if (uuid === actorUUID) continue;
    if (side !== 'attacker') continue;
    if (positions[uuid]?.alive !== false) return false;
  }
  return true;
}

function isClutchDefuseMultiEnemy(siteId, ctx) {
  // Multiple living attackers on or adjacent (hex-dist ≤ 1) to the site.
  const site = ctx.sites?.[siteId];
  if (!site) return false;
  let count = 0;
  for (const [uuid, side] of Object.entries(ctx.teamSideByUUID)) {
    if (side !== 'attacker') continue;
    const pos = ctx.positions?.[uuid];
    if (!pos || pos.alive === false) continue;
    const d = hexDist(pos.q, pos.r, site.position.q, site.position.r);
    if (d <= 1) count += 1;
  }
  return count >= 2;
}

// ── Canvas drawing ────────────────────────────────────────────────
//
// Render order (bottom → top):
//   background tiles → spawn zone tints → defender placement zones (setup
//   only) → structures → sites → players. Players render last so avatars
//   sit on top of everything.
//
// Step 11 — 30-hex visibility: enemy avatars render only if within 30 hexes
// of any living teammate of the human viewer. The planner input already
// applies this filter for ghost decisions; here it applies to what the
// human's canvas displays.
//
// Structure visibility: defender structures are invisible to the attacking
// side until damaged (walls) or triggered (mines) per spec §3.9 — the
// `visibleToAttacker` flag controls rendering. Defenders always see their
// own team's structures.

function draw(ctx, breach, self, teamSideByUUID, allPlayers, palette) {
  const P = palette || {
    bg: '#0a0a14', tile: '#1b2236', tileStroke: '#2c3450',
    mountain: '#272736', mountainStroke: '#4a4a66',
    ink: '#e0e6f0', myTeam: '#6bd1ff', enemy: '#ed4a4a',
    defender: '#34d399', attacker: '#ed4a4a',
  };
  // Fill full canvas with theme background so light-mode themes render a light
  // board instead of exposing the CSS wrap color through hex gaps.
  ctx.fillStyle = P.bg;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  const phase = breach.phase;
  const isSetup = phase === 'setup_h1' || phase === 'setup_h2';

  // ── Tiles ───────────────────────────────────────────────────────
  for (const [, tile] of Object.entries(breach.mapState.tiles || {})) {
    const { x, y } = hexToPixel(tile.q, tile.r);
    const pts = hexCorners(x, y);
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < 6; i += 1) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
    if (tile.type === 'mountain') {
      ctx.fillStyle = P.mountain;
      ctx.fill();
      ctx.strokeStyle = P.mountainStroke;
      ctx.lineWidth = 1;
      ctx.stroke();
    } else {
      ctx.fillStyle = P.tile;
      ctx.fill();
      ctx.strokeStyle = P.tileStroke;
      ctx.lineWidth = 0.5;
      ctx.stroke();
    }
  }

  // ── Spawn zone tints ────────────────────────────────────────────
  const zones = breach.mapState.spawnZones || {};
  for (const side of ['attacker', 'defender']) {
    ctx.fillStyle = side === 'attacker' ? 'rgba(237, 74, 74, 0.15)' : 'rgba(52, 211, 153, 0.15)';
    for (const k of zones[side] || []) {
      const [q, r] = k.split(',').map(Number);
      const { x, y } = hexToPixel(q, r);
      const pts = hexCorners(x, y);
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < 6; i += 1) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.closePath();
      ctx.fill();
    }
  }

  // ── Defender placement zone highlight (setup only, defenders only) ─
  if (isSetup && self?.side === 'defender') {
    const R = 8;  // DEFENDER_SETUP_RADIUS
    ctx.fillStyle = 'rgba(107, 163, 255, 0.08)';
    ctx.strokeStyle = 'rgba(107, 163, 255, 0.22)';
    ctx.lineWidth = 0.7;
    for (const [, tile] of Object.entries(breach.mapState.tiles || {})) {
      if (tile.type === 'mountain') continue;
      const inZone = Object.values(breach.mapState.sites || {}).some(
        (s) => hexDist(s.position.q, s.position.r, tile.q, tile.r) <= R
          && !(s.position.q === tile.q && s.position.r === tile.r),
      );
      if (!inZone) continue;
      const { x, y } = hexToPixel(tile.q, tile.r);
      const pts = hexCorners(x, y);
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < 6; i += 1) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }

  // ── Structures (walls, mines) ──────────────────────────────────
  // Visibility: self always sees their own side's structures; attackers see
  // opposing structures only if `visibleToAttacker` is true.
  const structures = breach.mapState.structures || {};
  for (const [key, s] of Object.entries(structures)) {
    const visibleToSelf =
      !self || s.ownerSide === self.side || s.visibleToAttacker === true;
    if (!visibleToSelf) continue;
    const [q, r] = key.split(',').map(Number);
    const { x, y } = hexToPixel(q, r);
    if (s.kind === 'wall' || s.kind === 'reinforced_wall') {
      const maxHp = s.kind === 'reinforced_wall' ? 120 : 60;
      const hpRatio = Math.max(0, Math.min(1, s.hp / maxHp));
      // Fill: team-colored slab; grey as HP drops.
      const base = s.ownerSide === 'defender' ? [52, 211, 153] : [237, 74, 74];
      const r2 = Math.round(base[0] * (0.4 + hpRatio * 0.6));
      const g2 = Math.round(base[1] * (0.4 + hpRatio * 0.6));
      const b2 = Math.round(base[2] * (0.4 + hpRatio * 0.6));
      ctx.fillStyle = `rgba(${r2},${g2},${b2},0.55)`;
      ctx.strokeStyle = s.kind === 'reinforced_wall' ? '#c8d0e0' : '#5a6578';
      ctx.lineWidth = s.kind === 'reinforced_wall' ? 2.2 : 1.5;
      const pts = hexCorners(x, y, HEX_SIZE * 0.88);
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < 6; i += 1) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // Crack overlay when damaged.
      if (hpRatio < 0.5) {
        ctx.strokeStyle = 'rgba(0,0,0,0.7)';
        ctx.lineWidth = hpRatio < 0.25 ? 2 : 1;
        ctx.beginPath();
        ctx.moveTo(x - HEX_SIZE * 0.5, y - HEX_SIZE * 0.3);
        ctx.lineTo(x + HEX_SIZE * 0.2, y + HEX_SIZE * 0.4);
        ctx.moveTo(x - HEX_SIZE * 0.2, y + HEX_SIZE * 0.4);
        ctx.lineTo(x + HEX_SIZE * 0.4, y - HEX_SIZE * 0.2);
        ctx.stroke();
      }
    } else if (s.kind === 'mine') {
      // Understated X so the map doesn't turn to noise.
      ctx.strokeStyle = 'rgba(255, 183, 77, 0.75)';
      ctx.lineWidth = 1.5;
      const r3 = HEX_SIZE * 0.35;
      ctx.beginPath();
      ctx.moveTo(x - r3, y - r3);
      ctx.lineTo(x + r3, y + r3);
      ctx.moveTo(x - r3, y + r3);
      ctx.lineTo(x + r3, y - r3);
      ctx.stroke();
    }
  }

  // ── Sites (big letter rings + armed-bomb countdown) ───────────
  const sites = breach.mapState.sites || {};
  const armedBombs = breach.armedBombs || {};
  const matchMs = breach.matchElapsedMs || 0;
  for (const [id, site] of Object.entries(sites)) {
    const { x, y } = hexToPixel(site.position.q, site.position.r);
    ctx.beginPath();
    ctx.arc(x, y, HEX_SIZE * 2.2, 0, Math.PI * 2);
    const isArmed = site.state === 'armed';
    ctx.strokeStyle = site.state === 'exploded' ? '#c0392b'
      : site.state === 'defused' ? '#7aaa72'
      : isArmed ? '#ff4a4a'
      : '#8898b5';
    ctx.lineWidth = isArmed ? 4 : 3;
    ctx.stroke();
    ctx.font = `bold ${HEX_SIZE * 2}px sans-serif`;
    ctx.fillStyle = site.state === 'exploded' ? '#6b3030'
      : site.state === 'defused' ? '#6b9f6b'
      : P.ink;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(id, x, y - (isArmed ? HEX_SIZE * 0.4 : 0));
    if (isArmed && armedBombs[id]) {
      const remaining = Math.max(0, armedBombs[id].expiresAtMatchMs - matchMs);
      const secs = Math.ceil(remaining / 1000);
      ctx.font = `bold ${HEX_SIZE * 0.95}px 'JetBrains Mono', ui-monospace, monospace`;
      ctx.fillStyle = secs <= 5 ? '#ffb74d' : '#ff7878';
      ctx.fillText(`0:${String(secs).padStart(2, '0')}`, x, y + HEX_SIZE * 0.95);
    }
  }

  // ── Players — step-11 visibility filter for enemies ───────────
  const positions = breach.mapState.playerPositions || {};
  // Teammate anchor set: my position + every living teammate.
  const teammateAnchors = [];
  if (self?.alive) teammateAnchors.push(self.position);
  for (const [uuid, pos] of Object.entries(positions)) {
    if (!self || uuid === self.uuid) continue;
    if (teamSideByUUID[uuid] !== self.side) continue;
    if (pos.alive !== false) teammateAnchors.push({ q: pos.q, r: pos.r });
  }

  for (const [uuid, pos] of Object.entries(positions)) {
    const side = teamSideByUUID[uuid];
    const isMe = uuid === self?.uuid;
    const isTeammate = self && side === self.side;

    // Enemy visibility gate: only render if within 30 hexes of any living
    // teammate anchor.
    if (!isTeammate && !isMe) {
      const visible = teammateAnchors.some(
        (a) => hexDist(a.q, a.r, pos.q, pos.r) <= ENEMY_VISIBILITY_RADIUS,
      );
      if (!visible) continue;
    }

    const alive = pos.alive !== false;
    const { x, y } = hexToPixel(pos.q, pos.r);
    ctx.beginPath();
    ctx.arc(x, y, HEX_SIZE * 0.55, 0, Math.PI * 2);
    // Color policy:
    //  - Dead        → dark
    //  - My own side → theme accent (so the chosen theme is visible where it
    //                  matters most, on your teammates' dots)
    //  - Enemies     → the opposing-side color baked into the palette
    //                  (attacker red for defender viewers, defender green for
    //                  attacker viewers)
    const mySide = self?.side;
    ctx.fillStyle = !alive
      ? (P.dead || '#222')
      : (mySide && side === mySide)
        ? P.myTeam
        : (side === 'attacker' ? P.attacker : P.defender);
    ctx.fill();
    if (isMe) {
      ctx.strokeStyle = P.ink;
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }
  }
}

// ── Palette helper ────────────────────────────────────────────────
//
// Builds the canvas color set from the player's theme. Dark themes get the
// original dark-blue tile palette; light themes get a parchment-toned palette
// so the map doesn't blow out when paired with a light UI. The accent color
// drives the "my team" dot color and the side-wall tint the user cares about
// most. Enemy color stays a universal red/green so threat recognition doesn't
// depend on theme choice (arch doc §A.5 "unified enemy threat color").
function buildCanvasPalette(isDark, accent) {
  if (isDark) {
    return {
      bg: '#0a0a14',
      tile: '#1b2236',
      tileStroke: '#2c3450',
      mountain: '#272736',
      mountainStroke: '#4a4a66',
      ink: '#e0e6f0',
      myTeam: accent || '#6bd1ff',
      attacker: '#ed4a4a',
      defender: '#34d399',
      enemy: '#ed4a4a',
      dead: '#222',
    };
  }
  return {
    bg: '#ece3d0',            // warm parchment
    tile: '#f5eedc',
    tileStroke: '#b8ad8f',
    mountain: '#8a7d64',
    mountainStroke: '#605640',
    ink: '#2a241b',
    myTeam: accent || '#2563eb',
    attacker: '#b0311a',
    defender: '#1f7a4e',
    enemy: '#b0311a',
    dead: '#776f5d',
  };
}