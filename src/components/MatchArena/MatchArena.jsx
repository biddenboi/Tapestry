import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import NiceModal from '@ebay/nice-modal-react';
import { AppContext } from '../../App.jsx';
import { STORES, GAME_STATE, MATCH_STATUS, THEME_ACCENT_COLORS } from '../../utils/Constants.js';
import {
  generateMap, hexToPixel, pixelToHex, hexCorners, getNeighbors, inBounds, tileKey, parseKey,
  CANVAS_W, CANVAS_H, HEX_SIZE, TILE_HP, TEAM1_ZONE_END, TEAM2_ZONE_START, MAP_COLS, MAP_ROWS,
} from '../../utils/Helpers/MapGen.js';
import {
  tickGhost, applyAction, applyProximityDamage,
  GHOST_TICK_MS, burstMultiplier, getMoveCost, getClaimCost, getAttackTileCost,
  getAttackTowerCost, getReinforceCost, getPlayerAttackCost,
} from '../../utils/Helpers/GhostAI.js';
import { computeEloChanges } from '../../utils/Helpers/Match.js';
import { getRank, getRankLabel, getRankClass } from '../../utils/Helpers/Rank.js';
import { getNextTodo, getWeights } from '../../utils/Helpers/Tasks.js';
import ProfilePicture from '../ProfilePicture/ProfilePicture.jsx';
import TaskCreationMenu from '../../Modals/TaskCreationMenu/TaskCreationMenu.jsx';
import TaskPreviewMenu from '../../Modals/TaskPreviewMenu/TaskPreviewMenu.jsx';
import PreMatchBanner from './PreMatchBanner.jsx';
import TileActionPopup from './TileActionPopup.jsx';
import './MatchArena.css';

// ── Constants ─────────────────────────────────────────────────────────────────

const PHASE        = Object.freeze({ BANNER: 'banner', PLACEMENT: 'placement', ACTIVE: 'active', COMPLETE: 'complete' });
const AUTO_SAVE_MS = 90_000;
const DPR          = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;

// ───── DEV / TESTING ─────────────────────────────────────────────────────────
// Set to a positive number (e.g. 10_000_000) to hand the current player a huge
// spendable-points pool at match start so you can click around the map freely
// without grinding tasks first. MUST be 0 for real play — ghost scoring
// assumes tasks drive points.
const DEV_EXTRA_POINTS = 10_000_000;
// ─────────────────────────────────────────────────────────────────────────────

// Brighter palette — tiles need to read as terrain, not black voids
const COLORS = {
  bg:           '#0a0a14',
  mountain:     '#272736',
  mountainBrd:  '#4a4a66',
  unclaimed:    '#1f4127',       // grass green, actually green this time
  unclaimedBrd: '#3b7a48',
  team1:        '#142f55',
  team1Brd:     '#3878c0',
  team2:        '#4a1318',
  team2Brd:     '#b03a32',
  fogWash:      'rgba(6,8,16,0.55)',   // overlay — tile underneath shows through
  fogBrd:       'rgba(80,82,112,0.28)',
  selected:     'rgba(224,213,255,0.95)',
  meRing:       'rgba(255,255,255,0.9)',
  towerGlow1:   'rgba(56,189,248,0.7)',
  towerGlow2:   'rgba(248,113,113,0.7)',
};

// ── Pure helpers ──────────────────────────────────────────────────────────────

function buildTeamMap(match) {
  const map = {};
  (match.teams?.[0] || []).forEach((p) => { map[p.UUID] = 'team1'; });
  (match.teams?.[1] || []).forEach((p) => { map[p.UUID] = 'team2'; });
  return map;
}

function allPlayers(match) { return [...(match.teams?.[0] || []), ...(match.teams?.[1] || [])]; }
function ghostsOf(match)   { return allPlayers(match).filter((p) => !p.isCurrentPlayer); }

function pickTowerPosition(idx, team, tiles, usedKeys) {
  const minQ = team === 'team1' ? 0 : TEAM2_ZONE_START;
  const maxQ = team === 'team1' ? TEAM1_ZONE_END - 1 : MAP_COLS - 1;
  const tR   = Math.floor(MAP_ROWS * [0.2, 0.5, 0.8][idx % 3]);
  const tQ   = Math.floor((minQ + maxQ) / 2);
  let best = null, bd = Infinity;
  for (const key of Object.keys(tiles)) {
    if (usedKeys.has(key)) continue;
    const t = tiles[key];
    if (t.type !== 'grass' || t.q < minQ || t.q > maxQ) continue;
    const d = Math.abs(t.q - tQ) + Math.abs(t.r - tR);
    if (d < bd) { bd = d; best = t; }
  }
  return best ? tileKey(best.q, best.r) : null;
}

function placeTower(tiles, key, team) {
  if (!tiles[key]) return tiles;
  return { ...tiles, [key]: { ...tiles[key], isTower: true, owner: team, hp: TILE_HP.tower, maxHp: TILE_HP.tower } };
}

function computeExplored(mapState, teamMap, uuid) {
  const team = teamMap[uuid];
  const set  = new Set(mapState.exploredTiles || []);
  // Owned territory is always known
  if (team && mapState.tiles) {
    for (const [key, tile] of Object.entries(mapState.tiles)) {
      if (tile.owner === team) set.add(key);
    }
  }
  // Radius-1 vision from each teammate
  for (const [id, pos] of Object.entries(mapState.playerPositions)) {
    if (teamMap[id] !== team || !inBounds(pos.q, pos.r)) continue;
    set.add(tileKey(pos.q, pos.r));
    for (const { q, r } of getNeighbors(pos.q, pos.r)) { if (inBounds(q, r)) set.add(tileKey(q, r)); }
  }
  return set;
}

function towerTotals(tiles) {
  let t1 = 0, t2 = 0;
  for (const t of Object.values(tiles)) {
    if (!t.isTower) continue;
    if (t.owner === 'team1') t1 += t.hp;
    else if (t.owner === 'team2') t2 += t.hp;
  }
  return { team1: t1, team2: t2 };
}

function checkWin(tiles) {
  const a1 = Object.values(tiles).some((t) => t.isTower && t.owner === 'team1');
  const a2 = Object.values(tiles).some((t) => t.isTower && t.owner === 'team2');
  if (!a2) return 'team1';
  if (!a1) return 'team2';
  return null;
}

function respawn(team, tiles) {
  const opts = Object.values(tiles).filter((t) => t.isTower && t.owner === team);
  if (!opts.length) return null;
  const t = opts[Math.floor(Math.random() * opts.length)];
  return { q: t.q, r: t.r };
}

/** Card-banner cosmetic → inline style. Shop sells gradient/color/image banners. */
function bannerStyle(cb) {
  if (!cb) return null;
  if (cb.type === 'gradient') return { background: cb.value };
  if (cb.type === 'color')    return { background: cb.value };
  if (cb.type === 'image')    return { backgroundImage: `url(${cb.value})`, backgroundSize: 'cover', backgroundPosition: 'center' };
  return null;
}

// ── Rich sidebar player row ──────────────────────────────────────────────────
// Profile picture + rank color + card banner (shop cosmetic) + HP bar.
// Everything that makes a player *feel* like someone lives here.

function PlayerRow({ player, pos, isMe, isEnemy, visible }) {
  const rank       = getRank(player.elo || 0);
  const rankCls    = getRankClass(player.elo || 0);
  const rankTxt    = getRankLabel(player.elo || 0);
  const themeColor = THEME_ACCENT_COLORS[player.playerTheme || player.activeCosmetics?.theme || 'default']
                  || THEME_ACCENT_COLORS.default;
  const bg         = bannerStyle(player.cardBanner || player.activeCosmetics?.cardBanner);
  const hp         = pos?.hp ?? 100;
  const hpPct      = Math.max(0, Math.min(100, hp));
  const hpColor    = hp > 50 ? '#22c55e' : hp > 25 ? '#f59e0b' : '#ef4444';

  const hidden = isEnemy && !visible;

  return (
    <div
      className={`ma-prow ${isMe ? 'ma-prow--me' : ''} ${isEnemy ? 'ma-prow--enemy' : ''} ${hidden ? 'ma-prow--fog' : ''}`}
      style={{
        '--prow-accent': themeColor,
        '--prow-rank':   rank.color,
        '--prow-glow':   rank.glow,
      }}
    >
      {bg && !hidden && <div className="ma-prow-banner" style={bg} />}
      <div className="ma-prow-shade" />
      <div className="ma-prow-avatar" style={{ boxShadow: hidden ? 'none' : `0 0 12px ${rank.glow}` }}>
        {hidden
          ? <span className="ma-prow-unknown">?</span>
          : <ProfilePicture src={player.profilePicture} username={player.username} size={34} />}
      </div>
      <div className="ma-prow-body">
        <div className="ma-prow-name" style={{ color: hidden ? 'rgba(255,255,255,0.35)' : rank.color }}>
          {player.username}
          {isMe && <span className="ma-prow-youtag">YOU</span>}
        </div>
        <div className={`ma-prow-rank rank-${rankCls}`}>
          {hidden ? '— hidden —' : `${rank.icon} ${rankTxt}`}
        </div>
        {!hidden && (
          <div className="ma-prow-hp">
            <div className="ma-prow-hp-track">
              <div className="ma-prow-hp-fill" style={{ width: `${hpPct}%`, background: hpColor }} />
            </div>
            <span className="ma-prow-hp-num">{hp}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Screen-offset layout for N avatars sharing one tile.
 * 1: center. 2: side-by-side. 3: triangle. 4+: 2×2 grid (first 4 only).
 */
function avatarLayout(n, cx, cy) {
  const d = HEX_SIZE * 0.32;
  if (n <= 1) return [{ x: cx, y: cy, scale: 1 }];
  if (n === 2) return [
    { x: cx - d, y: cy, scale: 0.8 },
    { x: cx + d, y: cy, scale: 0.8 },
  ];
  if (n === 3) return [
    { x: cx,     y: cy - d * 0.7, scale: 0.68 },
    { x: cx - d, y: cy + d * 0.5, scale: 0.68 },
    { x: cx + d, y: cy + d * 0.5, scale: 0.68 },
  ];
  return [
    { x: cx - d, y: cy - d, scale: 0.6 },
    { x: cx + d, y: cy - d, scale: 0.6 },
    { x: cx - d, y: cy + d, scale: 0.6 },
    { x: cx + d, y: cy + d, scale: 0.6 },
  ].slice(0, n);
}

// ── Canvas draw helpers ───────────────────────────────────────────────────────

function drawHex(ctx, cx, cy, tile, fogged, selected, inPlacement) {
  const pts = hexCorners(cx, cy);
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.closePath();

  // Always paint the real terrain colour first so fog becomes a *wash*
  // rather than a wall — the map outline stays readable everywhere.
  let fill, stroke;
  if (tile.type === 'mountain')    { fill = COLORS.mountain; stroke = COLORS.mountainBrd; }
  else if (!tile.owner)            { fill = COLORS.unclaimed; stroke = COLORS.unclaimedBrd; }
  else if (tile.owner === 'team1') { fill = COLORS.team1;    stroke = COLORS.team1Brd; }
  else                             { fill = COLORS.team2;    stroke = COLORS.team2Brd; }

  ctx.fillStyle   = fill;
  ctx.fill();
  ctx.strokeStyle = selected ? COLORS.selected : (fogged ? COLORS.fogBrd : stroke);
  ctx.lineWidth   = selected ? 2.2 : 0.8;
  ctx.stroke();

  if (fogged) {
    ctx.fillStyle = COLORS.fogWash;
    ctx.fill();
    return;
  }

  // Reinforcement shimmer
  if (tile.reinforceTier > 0 && !tile.isTower) {
    ctx.fillStyle = tile.owner === 'team1'
      ? `rgba(56,189,248,${tile.reinforceTier * 0.08})`
      : `rgba(248,113,113,${tile.reinforceTier * 0.08})`;
    ctx.fill();
  }

  // HP bar on damaged tiles
  if (tile.maxHp > 0 && tile.hp < tile.maxHp) {
    const pct = tile.hp / tile.maxHp;
    const bw = HEX_SIZE * 1.4, bx = cx - bw / 2, by = cy + HEX_SIZE * 0.65;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(bx, by, bw, 2.5);
    ctx.fillStyle = pct > 0.5 ? '#22c55e' : pct > 0.25 ? '#f59e0b' : '#ef4444';
    ctx.fillRect(bx, by, bw * pct, 2.5);
  }

  // Placement-phase zone highlight
  if (inPlacement && tile.type === 'grass' && !tile.isTower) {
    const isZone = tile.q < TEAM1_ZONE_END || tile.q >= TEAM2_ZONE_START;
    if (isZone) {
      ctx.strokeStyle = tile.q < TEAM1_ZONE_END ? 'rgba(56,189,248,0.55)' : 'rgba(248,113,113,0.55)';
      ctx.lineWidth   = 1.5;
      ctx.stroke();
    }
  }
}

function drawTower(ctx, cx, cy, tile) {
  const col  = tile.owner === 'team1' ? '#38bdf8' : '#f87171';
  const glow = tile.owner === 'team1' ? COLORS.towerGlow1 : COLORS.towerGlow2;
  ctx.shadowBlur  = 14;
  ctx.shadowColor = glow;
  const s = HEX_SIZE * 0.52;
  ctx.beginPath();
  ctx.moveTo(cx, cy - s); ctx.lineTo(cx + s, cy);
  ctx.lineTo(cx, cy + s); ctx.lineTo(cx - s, cy);
  ctx.closePath();
  ctx.fillStyle   = col;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth   = 0.9;
  ctx.stroke();
  ctx.shadowBlur  = 0;

  if (tile.maxHp > 0) {
    const pct = tile.hp / tile.maxHp;
    const bw = HEX_SIZE * 1.6, bx = cx - bw / 2, by = cy - HEX_SIZE;
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(bx, by, bw, 3);
    ctx.fillStyle = pct > 0.5 ? '#22c55e' : pct > 0.25 ? '#f59e0b' : '#ef4444';
    ctx.fillRect(bx, by, bw * pct, 3);
  }
}

function drawPlayerAvatar(ctx, cx, cy, hp, team, isMe, s = 1) {
  const col = team === 'team1' ? '#38bdf8' : '#f87171';
  const r   = HEX_SIZE * 0.38 * s;
  ctx.shadowBlur  = 6;
  ctx.shadowColor = col;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle   = col;
  ctx.fill();
  ctx.strokeStyle = isMe ? COLORS.meRing : 'rgba(255,255,255,0.6)';
  ctx.lineWidth   = isMe ? 1.7 : 0.8;
  ctx.stroke();
  ctx.shadowBlur  = 0;

  if (hp < 100) {
    const pct = hp / 100;
    const bw = HEX_SIZE * 1.2 * s, bx = cx - bw / 2, by = cy + r + 2;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(bx, by, bw, 2);
    ctx.fillStyle = pct > 0.5 ? '#22c55e' : pct > 0.25 ? '#f59e0b' : '#ef4444';
    ctx.fillRect(bx, by, bw * pct, 2);
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function MatchArena() {
  const {
    databaseConnection, currentPlayer, timestamp, refreshApp, notify,
    activeMatch: [activeMatch, setActiveMatch],
    gameState:  [, setGameState],
    activeTask: [activeTask, setActiveTask],
    openPanel,
  } = useContext(AppContext);

  const match   = activeMatch;
  const teamMap = useMemo(() => buildTeamMap(match), [match]);
  const myTeam  = teamMap[currentPlayer?.UUID];
  const ghosts  = useMemo(() => ghostsOf(match), [match]);

  // Player's own theme color — drives the whole arena accent
  const myAccent = THEME_ACCENT_COLORS[currentPlayer?.activeCosmetics?.theme || 'default']
                || THEME_ACCENT_COLORS.default;
  const inTask   = !!activeTask?.createdAt;

  // Next suggested todo (fetched alongside task-count polling)
  const [nextTodo, setNextTodo] = useState(null);

  // ── Core state ─────────────────────────────────────────────────
  const [phase, setPhase] = useState(() => {
    if (match?.matchPhase === 'active'    && match?.mapState?.tiles) return PHASE.ACTIVE;
    if (match?.matchPhase === 'placement' && match?.mapState?.tiles) return PHASE.PLACEMENT;
    return PHASE.BANNER;
  });
  const [mapState, setMapState] = useState(() => match?.mapState || null);
  const mapRef = useRef(null);
  // Ref mirrors state so ghost loop / auto-save always see latest tiles
  mapRef.current = mapState;

  const [placedTowers, setPlacedTowers] = useState({});
  const [myPlaced,     setMyPlaced]     = useState(false);
  const [spendable,    setSpendable]    = useState(0);
  const [totalPts,     setTotalPts]     = useState(0);
  const [burstSpent,   setBurstSpent]   = useState(0);
  const [selectedTile, setSelectedTile] = useState(null);
  const [popupPos,     setPopupPos]     = useState({ left: 0, top: 0 });
  const [matchResult,  setMatchResult]  = useState(null);
  const [eloDeltas,    setEloDeltas]    = useState(null);
  const [timeLeft,     setTimeLeft]     = useState(0);
  const [scale,        setScale]        = useState(1);
  const prevPtsRef    = useRef(0);
  const concludingRef = useRef(false);

  const canvasRef    = useRef(null);
  const containerRef = useRef(null);
  const ghostIntRef  = useRef(null);
  const saveIntRef   = useRef(null);

  // ── Responsive scale — fit canvas to container, preserve hex aspect ──────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const update = () => {
      const rect = container.getBoundingClientRect();
      const availW = Math.max(200, rect.width  - 8);
      const availH = Math.max(200, rect.height - 16);
      const s = Math.max(0.5, Math.min(2.2, Math.min(availW / CANVAS_W, availH / CANVAS_H)));
      setScale(s);
    };
    update();
    const obs = new ResizeObserver(update);
    obs.observe(container);
    return () => obs.disconnect();
  }, []);

  // ── Canvas bitmap + CSS size sync (reacts to scale) ─────────────
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    c.width  = Math.round(CANVAS_W * scale * DPR);
    c.height = Math.round(CANVAS_H * scale * DPR);
    c.style.width  = `${CANVAS_W * scale}px`;
    c.style.height = `${CANVAS_H * scale}px`;
  }, [scale]);

  // ── Generate map eagerly (so placement starts instant banner ends) ──
  useEffect(() => {
    if (mapRef.current) return;
    if (!match?.mapSeed) return;
    const tiles = generateMap(match.mapSeed);
    setMapState({
      seed:            match.mapSeed,
      tiles,
      playerPositions: {},
      towerOwners:     {},
      pointsSpent:     {},
      exploredTiles:   [],
    });
  }, [match?.mapSeed]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Canvas render ───────────────────────────────────────────────
  const render = useCallback(() => {
    const c = canvasRef.current;
    if (!c || !mapState) return;
    const ctx = c.getContext('2d');
    // Combined DPR + responsive-scale transform. All inner code uses
    // logical coords (CANVAS_W × CANVAS_H) and ignores scaling.
    ctx.setTransform(DPR * scale, 0, 0, DPR * scale, 0, 0);
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    if (!currentPlayer) return;
    const explored = phase === PHASE.PLACEMENT
      ? null   // full visibility during placement
      : computeExplored(mapState, teamMap, currentPlayer.UUID);

    const selKey = selectedTile ? tileKey(selectedTile.q, selectedTile.r) : '';
    const inPl   = phase === PHASE.PLACEMENT;

    // Pass 1: tiles
    for (const tile of Object.values(mapState.tiles)) {
      const { x, y } = hexToPixel(tile.q, tile.r);
      const fogged   = explored ? !explored.has(tileKey(tile.q, tile.r)) : false;
      drawHex(ctx, x, y, tile, fogged, tileKey(tile.q, tile.r) === selKey, inPl);
    }
    // Pass 2: towers
    for (const tile of Object.values(mapState.tiles)) {
      if (!tile.isTower) continue;
      if (explored && !explored.has(tileKey(tile.q, tile.r))) continue;
      const { x, y } = hexToPixel(tile.q, tile.r);
      drawTower(ctx, x, y, tile);
    }
    // Pass 3: players — group so shared tiles fan out
    const byTile = {};
    for (const [uuid, pos] of Object.entries(mapState.playerPositions)) {
      if (!inBounds(pos.q, pos.r)) continue;
      if (explored && !explored.has(tileKey(pos.q, pos.r))) continue;
      const k = tileKey(pos.q, pos.r);
      (byTile[k] ||= []).push({ uuid, pos });
    }
    for (const group of Object.values(byTile)) {
      const { x, y } = hexToPixel(group[0].pos.q, group[0].pos.r);
      const layout = avatarLayout(group.length, x, y);
      group.forEach(({ uuid, pos }, i) => {
        const slot = layout[i] || layout[0];
        drawPlayerAvatar(ctx, slot.x, slot.y, pos.hp ?? 100, teamMap[uuid], uuid === currentPlayer.UUID, slot.scale);
      });
    }
  }, [mapState, selectedTile, phase, teamMap, currentPlayer, scale]);

  useEffect(() => { render(); }, [render]);

  // ── Banner complete ─────────────────────────────────────────────
  // Persist matchPhase AND mapState together — the reload guard requires
  // both to skip the banner. Saving only matchPhase is what caused the
  // countdown to replay on every reload.
  const onBannerDone = useCallback(async () => {
    setPhase(PHASE.PLACEMENT);
    const s = mapRef.current;
    await databaseConnection.update(STORES.match, match.UUID, {
      matchPhase: 'placement',
      ...(s ? { mapState: s } : {}),
    });
  }, [match, databaseConnection]);

  // ── Tower placement ─────────────────────────────────────────────
  const handlePlace = useCallback((q, r) => {
    if (myPlaced || !mapRef.current) return;
    const key = tileKey(q, r);
    const t   = mapRef.current.tiles[key];
    if (!t || t.type !== 'grass' || t.isTower) return;
    const minQ = myTeam === 'team1' ? 0 : TEAM2_ZONE_START;
    const maxQ = myTeam === 'team1' ? TEAM1_ZONE_END - 1 : MAP_COLS - 1;
    if (t.q < minQ || t.q > maxQ) return;

    setMyPlaced(true);
    setPlacedTowers((p) => ({ ...p, [currentPlayer.UUID]: key }));

    const myGhosts    = ghosts.filter((g) => teamMap[g.UUID] === myTeam);
    const enemyGhosts = ghosts.filter((g) => teamMap[g.UUID] !== myTeam);
    const enemyTeam   = myTeam === 'team1' ? 'team2' : 'team1';

    myGhosts.forEach((g, i) => setTimeout(() => {
      setPlacedTowers((p) => {
        const used = new Set([...Object.values(p), key]);
        const pos  = pickTowerPosition(i, myTeam, mapRef.current?.tiles || {}, used);
        return pos ? { ...p, [g.UUID]: pos } : p;
      });
    }, 900 + i * 1100));

    enemyGhosts.forEach((g, i) => setTimeout(() => {
      setPlacedTowers((p) => {
        const used = new Set(Object.values(p));
        const pos  = pickTowerPosition(i, enemyTeam, mapRef.current?.tiles || {}, used);
        return pos ? { ...p, [g.UUID]: pos } : p;
      });
    }, 1400 + i * 900));
  }, [myPlaced, myTeam, ghosts, teamMap, currentPlayer]);

  // Transition PLACEMENT → ACTIVE once every tower is down
  useEffect(() => {
    if (phase !== PHASE.PLACEMENT || !mapState) return;
    if (Object.keys(placedTowers).length < allPlayers(match).length) return;

    let tiles = { ...mapState.tiles };
    const towerOwners = {}, playerPositions = {};
    for (const [uuid, key] of Object.entries(placedTowers)) {
      const team = teamMap[uuid];
      tiles = placeTower(tiles, key, team);
      towerOwners[key] = uuid;
      const { q, r } = parseKey(key);
      playerPositions[uuid] = { q, r, hp: 100, team };
    }
    const exploredTiles = Object.values(tiles)
      .filter((t) => t.owner === myTeam)
      .map((t) => tileKey(t.q, t.r));

    const s = { ...mapState, tiles, towerOwners, playerPositions, exploredTiles };
    setMapState(s);
    setPhase(PHASE.ACTIVE);
    databaseConnection.update(STORES.match, match.UUID, { mapState: s, matchPhase: 'active' });
  }, [placedTowers, phase, mapState, match, teamMap, myTeam, databaseConnection]);

  // ── Conclude match ──────────────────────────────────────────────
  const conclude = useCallback(async (state, winner, reason = 'towers') => {
    if (concludingRef.current) return;
    concludingRef.current = true;
    setPhase(PHASE.COMPLETE);
    clearInterval(ghostIntRef.current);
    clearInterval(saveIntRef.current);

    const iWon = winner === myTeam;
    const { team1, team2 } = towerTotals(state.tiles);
    const scoreMap = {};
    allPlayers(match).forEach((p) => {
      scoreMap[p.UUID] = teamMap[p.UUID] === 'team1' ? team1 : team2;
    });
    const deltas  = computeEloChanges(match, scoreMap, currentPlayer.UUID);
    const result  = { iWon, winner, reason, team1TowerHp: team1, team2TowerHp: team2, endedAt: new Date().toISOString() };
    const updated = { ...match, status: MATCH_STATUS.complete, result, mapState: state };
    await databaseConnection.update(STORES.match, match.UUID, updated);

    for (const [uuid, delta] of Object.entries(deltas)) {
      if (!delta) continue;
      try {
        const p = await databaseConnection.getPlayerByUUID(uuid);
        if (p) await databaseConnection.update(STORES.player, p.UUID, { elo: (p.elo || 0) + delta });
      } catch { /* ghost UUIDs may not exist locally */ }
    }

    setMatchResult({ iWon, winner, reason, team1TowerHp: team1, team2TowerHp: team2 });
    setEloDeltas(deltas);
    setActiveMatch(updated);
    refreshApp();
  }, [myTeam, match, teamMap, currentPlayer, databaseConnection, setActiveMatch, refreshApp]);

  // ── Player action ───────────────────────────────────────────────
  const handleAction = useCallback((action) => {
    const state = mapRef.current;
    if (!state || phase !== PHASE.ACTIVE) return;
    const d    = match.duration / 4;
    const mult = burstMultiplier(burstSpent);
    const baseCosts = {
      move:          getMoveCost(d),
      claim:         getClaimCost(d),
      attack_tile:   getAttackTileCost(d),
      attack_tower:  getAttackTowerCost(d),
      reinforce:     getReinforceCost((action.tier ?? 1) - 1, d),
      attack_player: getPlayerAttackCost(d),
    };
    const cost = Math.ceil((baseCosts[action.type] || 0) * mult);
    if (spendable < cost) return;

    let { tiles, playerPositions, pointsSpent } = applyAction(
      { ...action, cost }, state.tiles, state.playerPositions, state.pointsSpent, currentPlayer.UUID,
    );

    const myP = playerPositions[currentPlayer.UUID];
    if (myP?.hp <= 0) {
      const sp = respawn(myTeam, tiles);
      if (sp) playerPositions = { ...playerPositions, [currentPlayer.UUID]: { ...myP, ...sp, hp: 100 } };
    }

    const newExp = computeExplored({ ...state, tiles, playerPositions }, teamMap, currentPlayer.UUID);
    const ns = { ...state, tiles, playerPositions, pointsSpent, exploredTiles: [...newExp] };
    setMapState(ns);
    setSpendable((s) => s - cost);
    setBurstSpent((b) => b + cost);
    setSelectedTile(null);

    const winner = checkWin(tiles);
    if (winner) conclude(ns, winner);
  }, [phase, match, burstSpent, spendable, currentPlayer, myTeam, teamMap, conclude]);

  // ── Stable ref bag for long-lived intervals ─────────────────────
  // React re-creates currentPlayer (via App.jsx's 10s player re-fetch) with
  // a fresh object reference every tick, which would otherwise invalidate
  // every interval's useCallback and *clear the setInterval before it fires*.
  // Intervals read from this ref instead of from reactive closures.
  const liveRef = useRef({});
  liveRef.current = {
    match, myTeam, teamMap, currentPlayerUUID: currentPlayer?.UUID,
    ghosts, notify, conclude, phase,
  };

  // ── Ghost AI loop ───────────────────────────────────────────────
  // Interval is created once per phase entry, NOT tied to any reactive dep
  // other than phase itself. All state is read from liveRef at tick time.
  useEffect(() => {
    if (phase !== PHASE.ACTIVE) return;

    const tickOnce = () => {
      const live = liveRef.current;
      const state = mapRef.current;
      if (!state || live.phase !== PHASE.ACTIVE) return;

      let { tiles, playerPositions, pointsSpent } = state;

      for (const ghost of live.ghosts) {
        const ghostWithTeam = { ...ghost, team: live.teamMap[ghost.UUID] };
        for (let i = 0; i < 4; i++) {
          const act = tickGhost(ghostWithTeam, tiles, playerPositions, pointsSpent, live.match.createdAt, live.match.duration);
          if (!act) break;
          ({ tiles, playerPositions, pointsSpent } = applyAction(act, tiles, playerPositions, pointsSpent, ghost.UUID));
        }
      }

      playerPositions = applyProximityDamage(playerPositions, live.match);

      const myP = playerPositions[live.currentPlayerUUID];
      if (myP?.hp <= 0) {
        const sp = respawn(live.myTeam, tiles);
        if (sp) {
          playerPositions = { ...playerPositions, [live.currentPlayerUUID]: { ...myP, ...sp, hp: 100 } };
          live.notify?.({ title: '💀 Defeated', message: 'Respawned at a friendly tower.', kind: 'error', persist: false });
        }
      }
      for (const g of live.ghosts) {
        const gp = playerPositions[g.UUID];
        if (gp?.hp <= 0) {
          const sp = respawn(live.teamMap[g.UUID], tiles);
          if (sp) playerPositions = { ...playerPositions, [g.UUID]: { ...gp, ...sp, hp: 100 } };
        }
      }

      const exp = computeExplored({ ...state, tiles, playerPositions }, live.teamMap, live.currentPlayerUUID);
      const ns  = { ...state, tiles, playerPositions, pointsSpent, exploredTiles: [...exp] };
      setMapState(ns);

      const winner = checkWin(tiles);
      if (winner) live.conclude?.(ns, winner);
    };

    // Fire once immediately so the player sees activity within seconds of
    // entering the arena — waiting a full 25s for the first tick felt dead.
    tickOnce();
    const id = setInterval(tickOnce, GHOST_TICK_MS);
    ghostIntRef.current = id;
    return () => clearInterval(id);
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Match timer — independent 1-second interval ─────────────────
  // Previously this was piggy-backed on the `timestamp` useEffect, which
  // fired every 10s and also flickered currentPlayer's reference, defeating
  // it. Now it's a plain setInterval with no reactive deps except phase.
  useEffect(() => {
    if (phase !== PHASE.ACTIVE || !match) return;
    const createdAt = new Date(match.createdAt).getTime();
    const totalMs   = match.duration * 3_600_000;
    const tick = () => {
      const remaining = Math.max(0, totalMs - (Date.now() - createdAt));
      setTimeLeft(remaining);
      if (remaining <= 0 && !concludingRef.current) {
        const st = mapRef.current;
        if (st) {
          const { team1, team2 } = towerTotals(st.tiles);
          liveRef.current.conclude?.(st, team1 >= team2 ? 'team1' : 'team2', 'time');
        }
      }
    };
    tick();
    const id = setInterval(tick, 1_000);
    return () => clearInterval(id);
  }, [phase, match?.UUID, match?.createdAt, match?.duration]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Point tracking + next-todo (data refresh, not timer) ────────
  // Keyed on primitive IDs so App's currentPlayer re-fetches don't spam it.
  useEffect(() => {
    if (phase !== PHASE.ACTIVE || !match || !currentPlayer) return;
    const refresh = async () => {
      const tasks = await databaseConnection.getStoreFromRange(STORES.task, match.createdAt, new Date().toISOString());
      const myPts = tasks
        .filter((t) => t.parent === currentPlayer.UUID && t.completedAt)
        .reduce((s, t) => s + Number(t.points || 0), 0);

      const spent = mapRef.current?.pointsSpent?.[currentPlayer.UUID] || 0;
      setTotalPts(myPts + DEV_EXTRA_POINTS);
      setSpendable(Math.max(0, myPts + DEV_EXTRA_POINTS - spent));

      if (myPts > prevPtsRef.current) { setBurstSpent(0); prevPtsRef.current = myPts; }

      const todos = await databaseConnection.getAll(STORES.todo);
      setNextTodo(getNextTodo(todos, getWeights(todos)));
    };
    refresh();
  }, [timestamp, phase, match?.UUID, currentPlayer?.UUID, databaseConnection]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Task control handlers (mirror PracticeDojo pattern) ─────────
  const handleAddTask = useCallback(() => NiceModal.show(TaskCreationMenu), []);
  const handleNextTask = useCallback(async () => {
    if (!nextTodo || inTask) return;
    setActiveTask({ ...nextTodo, originalDuration: Number(nextTodo.estimatedDuration || 0) });
    await databaseConnection.remove(STORES.todo, nextTodo.UUID);
    refreshApp();
    NiceModal.show(TaskPreviewMenu, { start: true });
  }, [nextTodo, inTask, setActiveTask, databaseConnection, refreshApp]);
  const handleOpenQueue = useCallback(() => openPanel('tasks'), [openPanel]);

  // ── Auto-save ───────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== PHASE.ACTIVE) return;
    const save = () => { const s = mapRef.current; if (s) databaseConnection.update(STORES.match, match.UUID, { mapState: s }); };
    saveIntRef.current = setInterval(save, AUTO_SAVE_MS);
    const onHide = () => { if (document.hidden) save(); };
    document.addEventListener('visibilitychange', onHide);
    return () => { clearInterval(saveIntRef.current); document.removeEventListener('visibilitychange', onHide); };
  }, [phase, match?.UUID, databaseConnection]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Canvas click ────────────────────────────────────────────────
  const onClick = useCallback((e) => {
    const c = canvasRef.current;
    if (!c || !mapState) return;
    const rect = c.getBoundingClientRect();
    // Undo CSS scale to recover logical canvas coordinates
    const logicalX = (e.clientX - rect.left) / scale;
    const logicalY = (e.clientY - rect.top)  / scale;
    const { q, r } = pixelToHex(logicalX, logicalY);
    if (!inBounds(q, r)) return;

    if (phase === PHASE.PLACEMENT) { handlePlace(q, r); return; }
    if (phase !== PHASE.ACTIVE)    return;

    const tile = mapState.tiles[tileKey(q, r)];
    if (!tile) return;

    // Anchor popup to the click in viewport space — the popup uses
    // position: fixed, sidestepping all overflow/stacking-context issues.
    const POPUP_W = 210, POPUP_H = 280;
    setSelectedTile({ ...tile, q, r });
    setPopupPos({
      left: Math.min(window.innerWidth  - POPUP_W - 12, Math.max(12, e.clientX + 16)),
      top:  Math.min(window.innerHeight - POPUP_H - 12, Math.max(12, e.clientY - 40)),
    });
  }, [mapState, phase, handlePlace, scale]);

  // ── Forfeit / leave ─────────────────────────────────────────────
  const forfeit = useCallback(async () => {
    if (!window.confirm('Forfeit this match?')) return;
    const st = mapRef.current;
    if (st) conclude(st, myTeam === 'team1' ? 'team2' : 'team1', 'forfeit');
  }, [myTeam, conclude]);

  const leave = useCallback(() => {
    setActiveMatch(null);
    setGameState(GAME_STATE.idle);
  }, [setActiveMatch, setGameState]);

  // ── Derived display values ──────────────────────────────────────
  const myPos    = mapState?.playerPositions?.[currentPlayer?.UUID];
  const myHp     = myPos?.hp ?? 100;
  const { team1: t1Hp, team2: t2Hp } = mapState ? towerTotals(mapState.tiles) : { team1: 0, team2: 0 };
  const myTowHp  = myTeam === 'team1' ? t1Hp : t2Hp;
  const enTowHp  = myTeam === 'team1' ? t2Hp : t1Hp;

  const h = Math.floor(timeLeft / 3_600_000);
  const m = Math.floor((timeLeft % 3_600_000) / 60_000);
  const s = Math.floor((timeLeft % 60_000) / 1_000);
  const timeStr = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;

  const [myTeamList, enTeamList] = useMemo(() => {
    const t1 = match.teams?.[0] || [], t2 = match.teams?.[1] || [];
    return myTeam === 'team1' ? [t1, t2] : [t2, t1];
  }, [match, myTeam]);

  // Shared explored set — sidebar + render both need it
  const exploredSet = useMemo(() => (
    mapState && currentPlayer ? computeExplored(mapState, teamMap, currentPlayer.UUID) : new Set()
  ), [mapState, teamMap, currentPlayer]);

  const playerOnTile = selectedTile
    ? Object.entries(mapState?.playerPositions || {}).map(([id, pos]) => {
        if (pos.q !== selectedTile.q || pos.r !== selectedTile.r) return null;
        const p = allPlayers(match).find((x) => x.UUID === id);
        return p ? { ...p, ...pos } : null;
      }).find(Boolean)
    : null;

  // ── Render ──────────────────────────────────────────────────────
  // Canvas is ALWAYS mounted (banner + end-card are overlays) so the
  // DPR/size-sync effects have a stable target from first paint.
  return (
    <div className="ma-root" style={{ '--ma-accent': myAccent }}>

      {phase === PHASE.BANNER && (
        <PreMatchBanner match={match} currentPlayerUUID={currentPlayer?.UUID} onComplete={onBannerDone} />
      )}

      {phase === PHASE.COMPLETE && matchResult && (() => {
        const friendlyHp = matchResult.iWon ? matchResult.team1TowerHp : matchResult.team2TowerHp;
        const enemyHp    = matchResult.iWon ? matchResult.team2TowerHp : matchResult.team1TowerHp;
        return (
          <div className="ma-end-overlay">
            <div className="ma-end-card">
              <div className={`ma-end-verdict ${matchResult.iWon ? 'ma-end-verdict--win' : 'ma-end-verdict--loss'}`}>
                {matchResult.iWon ? '⚡ VICTORY' : '💀 DEFEAT'}
              </div>
              {matchResult.reason !== 'towers' && (
                <div className="ma-end-reason">
                  {matchResult.reason === 'time' ? 'Time expired — tower HP compared' : 'Match forfeited'}
                </div>
              )}
              <div className="ma-end-towers">
                <div className="ma-end-tw-row"><span className="ma-end-tw-label friendly">Your towers</span><span className="ma-end-tw-hp">{friendlyHp} HP</span></div>
                <div className="ma-end-tw-row"><span className="ma-end-tw-label enemy">Enemy towers</span><span className="ma-end-tw-hp">{enemyHp} HP</span></div>
              </div>
              {eloDeltas && (
                <div className="ma-end-elo">
                  ELO {(eloDeltas[currentPlayer.UUID] || 0) >= 0 ? '+' : ''}{eloDeltas[currentPlayer.UUID] || 0}
                </div>
              )}
              <button className="ma-end-btn" onClick={leave}>Return to Lobby</button>
            </div>
          </div>
        );
      })()}

      <header className="ma-header">
        <span className={`ma-phase-label ${phase === PHASE.PLACEMENT ? 'placing' : ''}`}>
          {phase === PHASE.BANNER    ? '⚡ PREPARING MATCH'
         : phase === PHASE.PLACEMENT ? '⬡ PLACE YOUR TOWER'
         : phase === PHASE.COMPLETE  ? '🏁 MATCH OVER'
         :                             '⚔ ACTIVE'}
        </span>
        {phase === PHASE.ACTIVE && <span className="ma-timer">{timeStr}</span>}

        {phase === PHASE.ACTIVE && (
          <div className="ma-task-controls">
            <button className="ma-ctrl" onClick={handleAddTask} disabled={inTask} title="Create a new task">
              <span className="ma-ctrl-sym">+</span> TASK
            </button>
            <button className="ma-ctrl ma-ctrl--primary" onClick={handleNextTask} disabled={!nextTodo || inTask}
              title={inTask ? 'Session already active' : nextTodo ? `Start: ${nextTodo.name}` : 'No queued tasks'}>
              <span className="ma-ctrl-sym">↑</span> NEXT
              {nextTodo && !inTask && <span className="ma-ctrl-sub">{nextTodo.name.slice(0, 16)}</span>}
            </button>
            <button className="ma-ctrl" onClick={handleOpenQueue} title="Open task queue">
              QUEUE
            </button>
            {inTask && (
              <span className="ma-session-pill">
                <span className="ma-session-dot" />
                {(activeTask?.name || 'SESSION').slice(0, 18)}
              </span>
            )}
          </div>
        )}

        {phase !== PHASE.BANNER && phase !== PHASE.COMPLETE && (
          <button className="ma-forfeit" onClick={forfeit}>Forfeit</button>
        )}
      </header>

      <div className="ma-body">
        <aside className="ma-sidebar">
          <section className="ma-section">
            <div className="ma-label">YOUR HP</div>
            <div className="ma-hp-bar">
              <div className="ma-hp-fill" style={{ width: `${myHp}%`, background: myHp > 50 ? '#22c55e' : myHp > 25 ? '#f59e0b' : '#ef4444' }} />
            </div>
            <span className="ma-hp-txt">{myHp}/100</span>
          </section>

          <section className="ma-section">
            <div className="ma-label">POINTS</div>
            <div className="ma-pts-main">{spendable} <span className="ma-pts-sub">spendable</span></div>
            <div className="ma-pts-total">{totalPts} earned total</div>
            {burstSpent >= 60 && <div className="ma-burst">⚡ Burst ×{burstMultiplier(burstSpent).toFixed(1)} active</div>}
          </section>

          <section className="ma-section">
            <div className="ma-label">TOWER HP</div>
            <div className="ma-tw-row"><span className="ma-tw-friendly">Friendly</span><span className="ma-tw-val">{myTowHp}</span></div>
            <div className="ma-tw-row"><span className="ma-tw-enemy">Enemy</span><span className="ma-tw-val">{enTowHp}</span></div>
          </section>

          <section className="ma-section">
            <div className="ma-label">YOUR TEAM</div>
            <div className="ma-prow-list">
              {myTeamList.map((p) => {
                const pos = mapState?.playerPositions?.[p.UUID];
                const enriched = p.UUID === currentPlayer.UUID
                  ? { ...p,
                      playerTheme: currentPlayer.activeCosmetics?.theme || p.playerTheme || 'default',
                      cardBanner:  currentPlayer.activeCosmetics?.cardBanner ?? p.cardBanner ?? null,
                      profilePicture: currentPlayer.profilePicture ?? p.profilePicture }
                  : p;
                return (
                  <PlayerRow key={p.UUID} player={enriched} pos={pos}
                             isMe={p.UUID === currentPlayer.UUID} isEnemy={false} visible />
                );
              })}
            </div>
          </section>

          <section className="ma-section">
            <div className="ma-label">ENEMIES</div>
            <div className="ma-prow-list">
              {enTeamList.map((p) => {
                const pos = mapState?.playerPositions?.[p.UUID];
                const visible = pos && exploredSet.has(tileKey(pos.q, pos.r));
                return (
                  <PlayerRow key={p.UUID} player={p} pos={pos}
                             isMe={false} isEnemy visible={visible} />
                );
              })}
            </div>
          </section>
        </aside>

        <div className="ma-map" ref={containerRef}>
          {phase === PHASE.PLACEMENT && (
            <div className={`ma-place-hint ${myPlaced ? 'waiting' : ''}`}>
              {myPlaced ? 'Tower placed — waiting for teammates…' : 'Click a highlighted tile in your zone to place your tower'}
            </div>
          )}

          <canvas
            ref={canvasRef}
            className="ma-canvas"
            onClick={onClick}
            style={{ cursor: phase === PHASE.PLACEMENT ? (myPlaced ? 'default' : 'crosshair') : 'pointer' }}
          />

          {selectedTile && phase === PHASE.ACTIVE && (
            <TileActionPopup
              tile={selectedTile}
              playerOnTile={playerOnTile}
              currentPosition={myPos}
              currentTeam={myTeam}
              match={match}
              spendable={spendable}
              burstSpent={burstSpent}
              durationHours={match.duration}
              onAction={handleAction}
              onClose={() => setSelectedTile(null)}
              style={{ left: popupPos.left, top: popupPos.top }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
