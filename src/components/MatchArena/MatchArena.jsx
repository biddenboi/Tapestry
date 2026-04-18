import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import NiceModal from '@ebay/nice-modal-react';
import { AppContext } from '../../App.jsx';
import { STORES, GAME_STATE, MATCH_STATUS, THEME_ACCENT_COLORS, COSMETIC_THEMES } from '../../utils/Constants.js';
import {
  generateMap, hexToPixel, pixelToHex, hexCorners, getNeighbors, inBounds, tileKey, parseKey,
  hexDist, CANVAS_W, CANVAS_H, HEX_SIZE, TILE_HP, TEAM1_ZONE_END, TEAM2_ZONE_START, MAP_COLS, MAP_ROWS,
} from '../../utils/Helpers/MapGen.js';
import {
  tickGhost, applyAction, applyProximityDamage,
  GHOST_TICK_MS, burstMultiplier, getMoveCost, getClaimCost, getAttackTileCost,
  getAttackTowerCost, getReinforceCost, getPlayerAttackCost,
} from '../../utils/Helpers/GhostAI.js';
import { computeEloChanges } from '../../utils/Helpers/Match.js';
import { getRank, getRankLabel, getRankClass, getRankGroupFloor } from '../../utils/Helpers/Rank.js';
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

// ── Theme-aware canvas colours ────────────────────────────────────────────────
// Canvas can't read CSS variables directly, so we supply two palettes and pick
// at render time based on whether the active cosmetic theme is dark or light.

function makeColors(isDark) {
  return isDark ? {
    mountain:     '#272736',
    mountainBrd:  '#4a4a66',
    unclaimed:    '#1f4127',
    unclaimedBrd: '#3b7a48',
    team1:        '#142f55',
    team1Brd:     '#3878c0',
    team2:        '#4a1318',
    team2Brd:     '#b03a32',
    fogWash:      'rgba(6,8,16,0.62)',
    fogBrd:       'rgba(80,82,112,0.28)',
    selected:     'rgba(224,213,255,0.95)',
    meRing:       'rgba(255,255,255,0.9)',
    towerGlow1:   'rgba(56,189,248,0.7)',
    towerGlow2:   'rgba(248,113,113,0.7)',
  } : {
    mountain:     '#8e8e7a',
    mountainBrd:  '#6a6a58',
    unclaimed:    '#bfd4b6',
    unclaimedBrd: '#7aaa72',
    team1:        '#b0ccee',
    team1Brd:     '#3a78c8',
    team2:        '#eec0b8',
    team2Brd:     '#c84040',
    fogWash:      'rgba(245,242,235,0.58)',
    fogBrd:       'rgba(160,150,130,0.35)',
    selected:     'rgba(60,40,200,0.9)',
    meRing:       'rgba(0,0,0,0.85)',
    towerGlow1:   'rgba(20,110,220,0.8)',
    towerGlow2:   'rgba(200,50,50,0.8)',
  };
}

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

// ── Cube-coordinate helpers for hex line-of-sight ─────────────────────────────

function offsetToCube(q, r) {
  const x = q - (r - (r & 1)) / 2;
  return { x, y: -x - r, z: r };
}
function cubeToOffset(x, z) {
  const r = z;
  return { q: x + (r - (r & 1)) / 2, r };
}

/**
 * If (tq,tr) lies on a straight hex axis from (sq,sr) and is more than 1 step away,
 * returns the ordered path [{q,r}…] from step 1 through N (not including source).
 * Returns null if not a straight hex line or only adjacent.
 */
export function getStraightLinePath(sq, sr, tq, tr) {
  const a = offsetToCube(sq, sr), b = offsetToCube(tq, tr);
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  if (dx === 0 && dz === 0) return null;

  const DIRS = [[1,-1,0],[1,0,-1],[0,1,-1],[-1,1,0],[-1,0,1],[0,-1,1]];
  for (const [ddx, ddy, ddz] of DIRS) {
    const Nx = ddx !== 0 ? dx / ddx : null;
    const Ny = ddy !== 0 ? dy / ddy : null;
    const Nz = ddz !== 0 ? dz / ddz : null;
    const vals = [Nx, Ny, Nz].filter((v) => v !== null);
    if (vals.length === 0) continue;
    const N = vals[0];
    if (!Number.isInteger(N) || N <= 1) continue;
    if (vals.some((v) => v !== N)) continue;
    if (dx !== ddx * N || dy !== ddy * N || dz !== ddz * N) continue;
    const path = [];
    for (let i = 1; i <= N; i++) path.push(cubeToOffset(a.x + ddx * i, a.z + ddz * i));
    return path;
  }
  return null;
}

/**
 * Shadow-casting LOS — processes every tile in BFS (shortest-hex-distance)
 * order from the observer.  A non-mountain tile is fogged when ALL of its
 * "parent" neighbours (those strictly closer to the observer) are either
 * mountains or already fogged.  This propagates shadows correctly in every
 * direction without any ray-casting or floating-point issues.
 *
 * Mountains are always visible (you see the wall; not past it).
 */
function computeSingleLOS(oq, or_, tiles) {
  const obsKey = tileKey(oq, or_);
  const visible = new Set([obsKey]);
  const fogged  = new Set();
  const visited = new Set([obsKey]);
  const queue   = [{ q: oq, r: or_ }];

  while (queue.length) {
    const { q, r } = queue.shift();

    for (const { q: nq, r: nr } of getNeighbors(q, r)) {
      if (!inBounds(nq, nr)) continue;
      const nKey = tileKey(nq, nr);
      if (visited.has(nKey)) continue;
      visited.add(nKey);
      queue.push({ q: nq, r: nr });            // always expand to maintain BFS order

      const nd    = hexDist(oq, or_, nq, nr);
      const nTile = tiles[nKey];

      // Parents = all in-bounds neighbours of (nq,nr) that are strictly
      // closer to the observer.  BFS guarantees every parent has already
      // been classified before we reach (nq,nr).
      const parents = getNeighbors(nq, nr).filter(
        ({ q: pq, r: pr }) => inBounds(pq, pr) && hexDist(oq, or_, pq, pr) < nd
      );

      const allBlocked = parents.length > 0 && parents.every(({ q: pq, r: pr }) => {
        const pTile = tiles[tileKey(pq, pr)];
        return pTile?.type === 'mountain' || fogged.has(tileKey(pq, pr));
      });

      if (nTile?.type === 'mountain' || !allBlocked) {
        visible.add(nKey);  // mountains always visible; clear LoS → visible
      } else {
        fogged.add(nKey);   // all paths blocked → in shadow
      }
    }
  }
  return visible;
}

function computeLOS(mapState, teamMap, uuid) {
  const team      = teamMap[uuid];
  const tiles     = mapState.tiles || {};
  const visible   = new Set();
  const observers = Object.entries(mapState.playerPositions || {})
    .filter(([id]) => teamMap[id] === team)
    .map(([, pos]) => pos)
    .filter((pos) => inBounds(pos.q, pos.r));

  for (const obs of observers) {
    for (const key of computeSingleLOS(obs.q, obs.r, tiles)) visible.add(key);
  }
  return visible;
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

function drawHex(ctx, cx, cy, tile, fogged, selected, inPlacement, colors) {
  const pts = hexCorners(cx, cy);
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.closePath();

  let fill, stroke;
  if (tile.type === 'mountain')    { fill = colors.mountain; stroke = colors.mountainBrd; }
  else if (!tile.owner)            { fill = colors.unclaimed; stroke = colors.unclaimedBrd; }
  else if (tile.owner === 'team1') { fill = colors.team1;    stroke = colors.team1Brd; }
  else                             { fill = colors.team2;    stroke = colors.team2Brd; }

  ctx.fillStyle   = fill;
  ctx.fill();
  ctx.strokeStyle = selected ? colors.selected : (fogged ? colors.fogBrd : stroke);
  ctx.lineWidth   = selected ? 2.2 : 0.8;
  ctx.stroke();

  if (fogged) {
    ctx.fillStyle = colors.fogWash;
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

function drawTower(ctx, cx, cy, tile, colors) {
  const col  = tile.owner === 'team1' ? '#38bdf8' : '#f87171';
  const glow = tile.owner === 'team1' ? colors.towerGlow1 : colors.towerGlow2;
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

function drawPlayerAvatar(ctx, cx, cy, hp, team, isMe, s = 1, colors) {
  const col = team === 'team1' ? '#38bdf8' : '#f87171';
  const r   = HEX_SIZE * 0.38 * s;
  ctx.shadowBlur  = 6;
  ctx.shadowColor = col;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle   = col;
  ctx.fill();
  ctx.strokeStyle = isMe ? colors.meRing : 'rgba(255,255,255,0.6)';
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

// ── Rank tier: maps ELO rank group to a visual-intensity tier ─────────────────

function getRankTier(elo = 0) {
  const group = getRank(elo).group;
  if (group === 'Radiant')                         return 'apex';
  if (group === 'Immortal')                        return 'elite';
  if (group === 'Ascendant')                       return 'high';
  if (group === 'Diamond' || group === 'Platinum') return 'mid';
  if (group === 'Gold'    || group === 'Silver')   return 'low';
  return 'base';
}

// ── Animated ELO counter ──────────────────────────────────────────────────────

function AnimatedElo({ from, to, duration = 1800 }) {
  const [display, setDisplay] = useState(from);
  useEffect(() => {
    const start = performance.now();
    const diff  = to - from;
    const frame = (now) => {
      const t    = Math.min(1, (now - start) / duration);
      const ease = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(from + diff * ease));
      if (t < 1) requestAnimationFrame(frame);
    };
    const id = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(id);
  }, [from, to, duration]);
  return <>{display.toLocaleString()}</>;
}

// ── Match End Screen ──────────────────────────────────────────────────────────

function MatchEndScreen({ matchResult, eloDeltas, currentPlayer, match, myTeam, onLeave }) {
  const { iWon, reason, team1TowerHp, team2TowerHp } = matchResult;

  const team1       = match.teams?.[0] || [];
  const team2       = match.teams?.[1] || [];
  const myOnT1      = myTeam === 'team1';
  const myTeamList  = myOnT1 ? team1 : team2;
  const oppTeamList = myOnT1 ? team2 : team1;
  const myScore     = myOnT1 ? team1TowerHp : team2TowerHp;
  const oppScore    = myOnT1 ? team2TowerHp : team1TowerHp;

  const myDelta   = eloDeltas?.[currentPlayer.UUID] || 0;
  const newElo    = currentPlayer.elo || 0;
  const oldElo    = Math.max(0, newElo - myDelta);
  const rankAfter = getRank(newElo);
  const rankBefore= getRank(oldElo);
  const rankTier  = getRankTier(newElo);
  const rankedUp  = rankAfter.minElo > rankBefore.minElo;
  const rankColor = rankAfter.color;

  // Build a simple breakdown from the single K-factor delta
  const breakdown = [];
  if (iWon) {
    breakdown.push({ label: 'Victory', value: myDelta > 0 ? myDelta : 0 });
    if (myDelta <= 0) breakdown.push({ label: 'Underdog correction', value: myDelta });
  } else {
    breakdown.push({ label: 'Defeat', value: myDelta < 0 ? myDelta : 0 });
    if (myDelta > 0) breakdown.push({ label: 'Strong performance', value: myDelta });
  }

  return (
    <div className={`ma-end-overlay ${iWon ? 'ma-end-overlay--win' : 'ma-end-overlay--loss'}`}>
      <div className="ma-end-scanlines" aria-hidden="true" />
      <div className="ma-end-content">

        {/* Outcome banner */}
        <div className={`ma-end-outcome ${iWon ? 'ma-end-outcome--win' : 'ma-end-outcome--loss'}`}>
          <span className="ma-end-outcome-icon">{iWon ? '▲' : '▼'}</span>
          <span className="ma-end-outcome-label">
            {iWon ? 'VICTORY' : reason === 'forfeit' ? 'FORFEIT' : 'DEFEAT'}
          </span>
        </div>

        {reason === 'time' && (
          <div className="ma-end-sub">Time expired — tower HP compared</div>
        )}

        {/* Tower HP comparison */}
        <div className="ma-end-vs">
          <div className="ma-end-vs-side ma-end-vs-mine">
            <div className="ma-end-vs-label">YOUR TEAM</div>
            <div className="ma-end-vs-score">{myScore}</div>
            <div className="ma-end-vs-sub">tower HP</div>
            <div className="ma-end-vs-players">
              {myTeamList.map((p) => (
                <span key={p.UUID} className={p.UUID === currentPlayer.UUID ? 'ma-end-vs-you' : ''}>
                  {p.username}
                </span>
              ))}
            </div>
          </div>
          <div className={`ma-end-vs-circle ${iWon ? 'ma-end-vs-circle--win' : 'ma-end-vs-circle--loss'}`}>VS</div>
          <div className="ma-end-vs-side ma-end-vs-opp">
            <div className="ma-end-vs-label">OPPOSITION</div>
            <div className="ma-end-vs-score ma-end-vs-score--opp">{oppScore}</div>
            <div className="ma-end-vs-sub">tower HP</div>
            <div className="ma-end-vs-players">
              {oppTeamList.map((p) => (
                <span key={p.UUID}>{p.username}</span>
              ))}
            </div>
          </div>
        </div>

        {/* ELO card */}
        <div className={`ma-end-elocard rank-tier-${rankTier}`} style={{ '--rank-color': rankColor }}>
          <div className="ma-end-avatar-frame">
            <ProfilePicture src={currentPlayer.profilePicture} username={currentPlayer.username} size={72} />
            <div className="ma-end-avatar-ring" style={{ borderColor: rankColor, boxShadow: `0 0 18px ${rankColor}55` }} />
            <div className="ma-end-rank-icon">{rankAfter.icon}</div>
          </div>
          <div className="ma-end-elocard-body">
            <div className="ma-end-username" style={{ color: rankColor, textShadow: `0 0 20px ${rankColor}88` }}>
              {currentPlayer.username}
            </div>
            {rankedUp && (
              <div className="ma-end-rankup">
                ✦ RANK UP — {rankAfter.group.toUpperCase()}{rankAfter.sub ? ` ${rankAfter.sub}` : ''}
              </div>
            )}
            <div className="ma-end-elo-row">
              <span className="ma-end-elo-old">{oldElo.toLocaleString()}</span>
              <span className="ma-end-elo-arrow">→</span>
              <span className="ma-end-elo-new" style={{ color: rankColor }}>
                <AnimatedElo from={oldElo} to={newElo} />
              </span>
            </div>
            <div className="ma-end-breakdown">
              {breakdown.map((item, i) => (
                <div
                  key={i}
                  className={`ma-end-bd-row ${item.value >= 0 ? 'ma-end-bd--pos' : 'ma-end-bd--neg'}`}
                  style={{ animationDelay: `${0.3 + i * 0.1}s` }}
                >
                  <span className="ma-end-bd-val">{item.value > 0 ? '+' : ''}{item.value}</span>
                  <span className="ma-end-bd-label">{item.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <button className="ma-end-return" onClick={onLeave}>
          RETURN TO LOBBY →
        </button>
      </div>
    </div>
  );
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
  const isDark   = COSMETIC_THEMES.find((t) => t.id === (currentPlayer?.activeCosmetics?.theme || 'default'))?.dark !== false;
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
    // Canvas bg: read --bg-void from the live CSS variable so light/dark themes work.
    const canvasBg = getComputedStyle(document.documentElement).getPropertyValue('--bg-void').trim() || '#0a0a14';
    ctx.fillStyle = canvasBg;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    if (!currentPlayer) return;
    const COLORS  = makeColors(isDark);
    const explored = phase === PHASE.PLACEMENT
      ? null   // full visibility during placement
      : computeLOS(mapState, teamMap, currentPlayer.UUID);

    const selKey = selectedTile ? tileKey(selectedTile.q, selectedTile.r) : '';
    const inPl   = phase === PHASE.PLACEMENT;

    // Pass 1: tiles
    for (const tile of Object.values(mapState.tiles)) {
      const { x, y } = hexToPixel(tile.q, tile.r);
      const fogged   = explored ? !explored.has(tileKey(tile.q, tile.r)) : false;
      drawHex(ctx, x, y, tile, fogged, tileKey(tile.q, tile.r) === selKey, inPl, COLORS);
    }
    // Pass 2: towers
    for (const tile of Object.values(mapState.tiles)) {
      if (!tile.isTower) continue;
      if (explored && !explored.has(tileKey(tile.q, tile.r))) continue;
      const { x, y } = hexToPixel(tile.q, tile.r);
      drawTower(ctx, x, y, tile, COLORS);
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
        drawPlayerAvatar(ctx, slot.x, slot.y, pos.hp ?? 100, teamMap[uuid], uuid === currentPlayer.UUID, slot.scale, COLORS);
      });
    }
  }, [mapState, selectedTile, phase, teamMap, currentPlayer, scale, isDark]);

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

    // ── Reset the 20% pre-owned start zones from map generation ─────
    // generateMap pre-colours team zones for readability, but actual owned
    // territory should only be a small radius around each placed tower.
    for (const key of Object.keys(tiles)) {
      if (tiles[key].owner && !tiles[key].isTower) {
        tiles[key] = { ...tiles[key], owner: null, hp: 0, maxHp: 0 };
      }
    }

    // ── Place towers and claim radius-3 starting territory ──────────
    const towerOwners = {}, playerPositions = {};
    for (const [uuid, key] of Object.entries(placedTowers)) {
      const team = teamMap[uuid];
      tiles = placeTower(tiles, key, team);
      towerOwners[key] = uuid;
      const { q: tq, r: tr } = parseKey(key);
      playerPositions[uuid] = { q: tq, r: tr, hp: 100, team };

      // Claim all grass tiles within radius 3 of this tower for its team
      for (const t of Object.values(tiles)) {
        if (t.type !== 'grass' || t.isTower) continue;
        if (hexDist(tq, tr, t.q, t.r) <= 3) {
          const tk = tileKey(t.q, t.r);
          tiles[tk] = { ...tiles[tk], owner: team, hp: TILE_HP.claimed, maxHp: TILE_HP.claimed };
        }
      }
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

    // ── Multi-tile straight-line sprint ─────────────────────────
    if (action.type === 'multi_move') {
      const totalCost = action.cost;
      if (spendable < totalCost) return;
      const singleCost = Math.ceil(getMoveCost(d) * mult);
      let { tiles, playerPositions, pointsSpent } = state;
      for (const step of action.path) {
        ({ tiles, playerPositions, pointsSpent } = applyAction(
          { type: 'move', q: step.q, r: step.r, cost: singleCost },
          tiles, playerPositions, pointsSpent, currentPlayer.UUID,
        ));
        // Auto-claim any unclaimed (neutral) tile the player passes through or lands on
        const key  = tileKey(step.q, step.r);
        const tile = tiles[key];
        if (tile && !tile.owner && tile.type === 'grass' && !tile.isTower) {
          tiles = { ...tiles, [key]: { ...tile, owner: myTeam, hp: TILE_HP.claimed, maxHp: TILE_HP.claimed } };
        }
      }
      const myP = playerPositions[currentPlayer.UUID];
      if (myP?.hp <= 0) {
        const sp = respawn(myTeam, tiles);
        if (sp) playerPositions = { ...playerPositions, [currentPlayer.UUID]: { ...myP, ...sp, hp: 100 } };
      }
      const newExp = computeLOS({ ...state, tiles, playerPositions }, teamMap, currentPlayer.UUID);
      const ns = { ...state, tiles, playerPositions, pointsSpent, exploredTiles: [...newExp] };
      setMapState(ns);
      setSpendable((s) => s - totalCost);
      setBurstSpent((b) => b + totalCost);
      setSelectedTile(null);
      const winner = checkWin(tiles);
      if (winner) conclude(ns, winner);
      return;
    }

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

    const newExp = computeLOS({ ...state, tiles, playerPositions }, teamMap, currentPlayer.UUID);
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

      const exp = computeLOS({ ...state, tiles, playerPositions }, live.teamMap, live.currentPlayerUUID);
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

  // Shared LOS set — sidebar visibility + canvas render both need it
  const exploredSet = useMemo(() => (
    mapState && currentPlayer ? computeLOS(mapState, teamMap, currentPlayer.UUID) : new Set()
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

      {phase === PHASE.COMPLETE && matchResult && (
        <MatchEndScreen
          matchResult={matchResult}
          eloDeltas={eloDeltas}
          currentPlayer={currentPlayer}
          match={match}
          myTeam={myTeam}
          onLeave={leave}
        />
      )}

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
              tiles={mapState?.tiles}
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
