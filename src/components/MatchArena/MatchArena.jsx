import { useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import NiceModal from '@ebay/nice-modal-react';
import { AppContext } from '../../App.jsx';
import { GAME_STATE, STORES, MATCH_STATUS, HOUR, THEME_ACCENT_COLORS } from '../../utils/Constants.js';
import TaskCreationMenu from '../../Modals/TaskCreationMenu/TaskCreationMenu.jsx';
import TaskPreviewMenu from '../../Modals/TaskPreviewMenu/TaskPreviewMenu.jsx';
import ProfilePicture from '../ProfilePicture/ProfilePicture.jsx';
import { getGhostScore, getGhostActivity, hydrateMatchTeams } from '../../utils/Helpers/Match.js';
import { getNextTodo } from '../../utils/Helpers/Tasks.js';
import { timeAsHHMMSS } from '../../utils/Helpers/Time.js';
import { getRank, getRankLabel, getRankClass, getRankGroupFloor } from '../../utils/Helpers/Rank.js';
import { checkMatchAchievements, getAchievementByKey } from '../../utils/Achievements.js';
import AchievementBadge from '../AchievementBadge/AchievementBadge.jsx';
import { RankIcon } from '../Icons/RankIcon.jsx';
import './MatchArena.css';

/* ── Timer hook ──────────────────────────────────────────── */
function useMatchTimer(match) {
  const [remaining, setRemaining] = useState(null);
  const [elapsed, setElapsed]     = useState(0);

  useEffect(() => {
    if (!match) { setRemaining(null); setElapsed(0); return undefined; }
    const endMs   = new Date(match.createdAt).getTime() + Number(match.duration || 0) * HOUR;
    const startMs = new Date(match.createdAt).getTime();
    const tick = () => {
      const now = Date.now();
      setRemaining(Math.max(0, endMs - now));
      setElapsed(Math.max(0, Math.min(now - startMs, endMs - startMs)));
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [match]);

  return { remaining, elapsed };
}

/* ── Banner style helper ─────────────────────────────────── */
function getBannerStyle(cardBanner) {
  if (!cardBanner) return null;
  if (cardBanner.type === 'gradient') return { background: cardBanner.value };
  if (cardBanner.type === 'color')    return { background: cardBanner.value };
  if (cardBanner.type === 'image')    return { backgroundImage: `url(${cardBanner.value})`, backgroundSize: 'cover', backgroundPosition: 'center' };
  return null;
}

/* ── Elo computation ─────────────────────────────────────── */
/**
 * Pure function — computes elo change and breakdown for every player.
 * Winners:  +20 base + round(pct * 25) contribution [+ 5 overwhelm if diff > 300]
 * Losers:   -20 base + round(pct * 15) recompensation
 * Underdog: +round(20 * pct) if player is the lowest rank and everyone else is 150+ elo higher
 */
function computeEloChanges(teams, scores, forcedLoserTeamIdx = null) {
  const allPlayers = [...teams[0], ...teams[1]];
  const t1Total = teams[0].reduce((s, p) => s + Number(scores[p.UUID] || 0), 0);
  const t2Total = teams[1].reduce((s, p) => s + Number(scores[p.UUID] || 0), 0);
  const grandTotal = t1Total + t2Total;

  let winnerTeamIdx = t1Total >= t2Total ? 0 : 1;
  if (forcedLoserTeamIdx !== null) winnerTeamIdx = forcedLoserTeamIdx === 0 ? 1 : 0;

  const overwhelm = Math.abs(t1Total - t2Total) > 300;

  // Underdog: lowest elo player, only if ALL others are 150+ elo above them
  const sortedByElo = [...allPlayers].sort((a, b) => (a.elo || 0) - (b.elo || 0));
  const lowestPlayer = sortedByElo[0];
  const lowestElo = lowestPlayer ? (lowestPlayer.elo || 0) : 0;
  const allOthers150Plus = lowestPlayer && allPlayers
    .filter(p => p.UUID !== lowestPlayer.UUID)
    .every(p => (p.elo || 0) - lowestElo >= 150);
  const underdogUUID = allOthers150Plus ? lowestPlayer.UUID : null;

  const changes = {};

  for (let ti = 0; ti < 2; ti++) {
    const isWinnerTeam = ti === winnerTeamIdx;
    for (const player of teams[ti]) {
      const pts = Number(scores[player.UUID] || 0);
      const pct = grandTotal > 0 ? pts / grandTotal : 0;
      const pctDisplay = Math.round(pct * 100);

      const breakdown = [];
      let change;

      if (isWinnerTeam) {
        const contribBonus = Math.round(pct * 25);
        change = 20 + contribBonus;
        breakdown.push({ label: 'Win', value: +20 });
        if (contribBonus > 0) breakdown.push({ label: `Contribution (${pctDisplay}%)`, value: +contribBonus });
        if (overwhelm) { change += 5; breakdown.push({ label: 'Overwhelm bonus', value: +5 }); }
      } else {
        const recomp = Math.round(pct * 15);
        change = -20 + recomp;
        breakdown.push({ label: 'Loss', value: -20 });
        if (recomp > 0) breakdown.push({ label: `Contribution (${pctDisplay}%)`, value: +recomp });
      }

      if (player.UUID === underdogUUID) {
        const underdogBonus = Math.round(20 * pct);
        if (underdogBonus > 0) { change += underdogBonus; breakdown.push({ label: 'Underdog bonus', value: +underdogBonus }); }
      }

      changes[player.UUID] = { change, breakdown, isWinner: isWinnerTeam };
    }
  }

  return { changes, winnerTeamIdx, t1Total, t2Total };
}

/* ── Rank tier: drives visual intensity ──────────────────── */
function getRankTier(elo = 0) {
  const group = getRank(elo).group;
  if (group === 'Radiant')                         return 'apex';
  if (group === 'Immortal')                        return 'elite';
  if (group === 'Ascendant')                       return 'high';
  if (group === 'Diamond' || group === 'Platinum') return 'mid';
  if (group === 'Gold'    || group === 'Silver')   return 'low';
  return 'base';
}

/* ── Animated ELO counter ────────────────────────────────── */
function AnimatedElo({ from, to, duration = 1800 }) {
  const [display, setDisplay] = useState(from);
  useEffect(() => {
    const start = performance.now();
    const diff  = to - from;
    const frame = (now) => {
      const t    = Math.min(1, (now - start) / duration);
      const ease = 1 - Math.pow(1 - t, 3); // ease-out cubic
      setDisplay(Math.round(from + diff * ease));
      if (t < 1) requestAnimationFrame(frame);
    };
    const id = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(id);
  }, [from, to, duration]);
  return <>{display.toLocaleString()}</>;
}

/* ── Match End Screen overlay ────────────────────────────── */
function MatchEndScreen({ match, currentPlayer, onReturn }) {
  const result   = match.result || {};
  const team1    = match.teams?.[0] || [];
  const team2    = match.teams?.[1] || [];
  // Use String coercion to match concludeMatch logic
  const myOnT1   = team1.some(p => String(p.UUID) === String(currentPlayer?.UUID));
  // Derive outcome from stored value; if undefined/null fall back to score comparison
  const myTeamScoreRaw  = myOnT1 ? result.team1Total : result.team2Total;
  const oppTeamScoreRaw = myOnT1 ? result.team2Total : result.team1Total;
  const iWon     = result.iWon ?? (myTeamScoreRaw >= oppTeamScoreRaw);
  const myTeam       = myOnT1 ? team1 : team2;
  const oppTeam      = myOnT1 ? team2 : team1;
  const myTeamScore  = myTeamScoreRaw;
  const oppTeamScore = oppTeamScoreRaw;

  const oldElo   = result.oldElo   ?? (Number(currentPlayer?.elo || 0) - (result.eloChange || 0));
  const newElo   = result.newElo   ?? Number(currentPlayer?.elo || 0);
  const breakdown = result.eloBreakdown || [];

  const rankBefore = getRank(oldElo);
  const rankAfter  = getRank(newElo);
  const rankedUp   = rankAfter.minElo > rankBefore.minElo;
  const rankColor  = rankAfter.color;

  return (
    <div className={`end-screen ${iWon ? 'end-screen-win' : 'end-screen-loss'}`}>
      <div className="end-screen-scanlines" aria-hidden="true" />
      <div className="end-screen-content">

        {/* Outcome banner */}
        <div className={`end-outcome-banner ${iWon ? 'eob-win' : 'eob-loss'}`}>
          <span className="eob-icon">{iWon ? '▲' : '▼'}</span>
          <span className="eob-label">
            {iWon ? 'VICTORY' : (result.wasForfeited ? 'FORFEIT' : 'DEFEAT')}
          </span>
        </div>

        {/* Team score breakdown */}
        <div className="end-score-vs">
          <div className="esv-side esv-mine">
            <div className="esv-team-label">YOUR TEAM</div>
            <div className="esv-score">{(myTeamScore || 0).toLocaleString()}</div>
            <div className="esv-players">
              {myTeam.map(p => (
                <span key={p.UUID} className={`esv-player ${p.UUID === currentPlayer?.UUID ? 'esv-player-you' : ''}`}>
                  {p.username || 'Unknown'}
                </span>
              ))}
            </div>
          </div>

          <div className={`esv-vs-circle ${iWon ? 'esv-circle-win' : 'esv-circle-loss'}`}>VS</div>

          <div className="esv-side esv-opp">
            <div className="esv-team-label">OPPOSITION</div>
            <div className="esv-score esv-score-opp">{(oppTeamScore || 0).toLocaleString()}</div>
            <div className="esv-players">
              {oppTeam.map(p => (
                <span key={p.UUID} className="esv-player">{p.username || 'Unknown'}</span>
              ))}
            </div>
          </div>
        </div>

        {/* Player ELO card */}
        <div className={`end-player-card rank-tier-${getRankTier(newElo)}`} style={{ '--rank-color': rankColor }}>
          <div className="epc-avatar-frame">
            <ProfilePicture src={currentPlayer?.profilePicture} username={currentPlayer?.username} size={72} />
            <div className="epc-avatar-ring" style={{ borderColor: rankColor, boxShadow: `0 0 18px ${rankColor}66` }} />
            <div className="epc-rank-icon"><RankIcon group={rankAfter.group} sub={rankAfter.sub} size={22} /></div>
          </div>

          <div className="epc-body">
            <div className="epc-username" style={{ color: rankColor, textShadow: `0 0 24px ${rankColor}99` }}>
              {currentPlayer?.username}
            </div>

            {rankedUp && (
              <div className="epc-rankup">
                ✦ RANK UP — {rankAfter.group.toUpperCase()}{rankAfter.sub ? ` ${rankAfter.sub}` : ''}
              </div>
            )}

            <div className="epc-elo-transition">
              <span className="epc-elo-old">{oldElo.toLocaleString()}</span>
              <span className="epc-elo-arrow">→</span>
              <span className="epc-elo-new" style={{ color: rankColor }}>
                <AnimatedElo from={oldElo} to={newElo} />
              </span>
            </div>

            <div className="epc-breakdown">
              {breakdown.map((item, i) => (
                <div
                  key={i}
                  className={`epc-bd-row ${item.value >= 0 ? 'bd-positive' : 'bd-negative'}`}
                  style={{ animationDelay: `${0.35 + i * 0.08}s` }}
                >
                  <span className="bd-value">{item.value > 0 ? '+' : ''}{item.value}</span>
                  <span className="bd-label">{item.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <button className="primary end-return-btn" onClick={onReturn}>
          RETURN TO LOBBY →
        </button>
      </div>
    </div>
  );
}

/* ── Player node ─────────────────────────────────────────── */
function ArenaPlayerNode({ player, score, isCurrentPlayer, isActive, side, elapsedRatio, currentTaskName }) {
  const rank       = getRank(player.elo || 0);
  const rankLabel  = getRankLabel(player.elo || 0);
  const rankTier   = getRankTier(player.elo || 0);
  const accentColor = THEME_ACCENT_COLORS[player.playerTheme || 'default'] || '#4da3ff';
  const bannerStyle = getBannerStyle(player.cardBanner);

  // Outer glow scales with rank tier
  const glowAlpha = { base: 0, low: 0.18, mid: 0.35, high: 0.55, elite: 0.72, apex: 0.9 }[rankTier];
  const cardGlow  = glowAlpha > 0
    ? `0 0 ${8 + glowAlpha * 22}px ${rank.glow}`
    : undefined;

  const activity = isCurrentPlayer
    ? (currentTaskName || null)
    : getGhostActivity(player, elapsedRatio);

  return (
    <div
      className={`apn apn-${side} rank-tier-${rankTier} ${isCurrentPlayer ? 'apn-self' : ''} ${isActive ? 'apn-active' : ''}`}
      style={{
        '--apn-accent': accentColor,
        '--rank-color': rank.color,
        '--rank-glow':  rank.glow,
        ...(cardGlow ? { boxShadow: cardGlow } : {}),
        ...(bannerStyle || {}),
      }}
    >
      {bannerStyle && <div className="apn-banner-overlay" />}
      <div className="apn-avatar-wrap">
        <ProfilePicture src={player.profilePicture} username={player.username || '?'} size={48} />
        {isActive && <div className="apn-pulse-ring" />}
      </div>
      <div className="apn-info">
        <div className="apn-name-row">
          <span
            className="apn-name"
            style={{
              color: rank.color,
              textShadow: glowAlpha > 0.3 ? `0 0 10px ${rank.glow}` : undefined,
            }}
          >
            {player.username || 'Unknown'}
          </span>
          {isCurrentPlayer && <span className="apn-tag apn-tag-you">YOU</span>}
          {player.isGenerated && <span className="apn-tag apn-tag-ghost">GHOST</span>}
        </div>
        {/* Achievement badges */}
        {(() => {
          const slots = player.selectedAchievements || [];
          const badges = slots.filter(Boolean);
          if (!badges.length) return null;
          return (
            <div className={`apn-achievements apn-achievements--${side}`}>
              {badges.map((key) => (
                <AchievementBadge
                  key={key}
                  achievementKey={key}
                  size={18}
                  showTooltip={false}
                />
              ))}
            </div>
          );
        })()}
        <div className={`apn-rank rank-${getRankClass(player.elo || 0)}`}>
          <RankIcon group={rank.group} sub={rank.sub} size={16} /> {rankLabel}
        </div>
        <div className="apn-score">{score.toLocaleString()} <span className="apn-pts">pts</span></div>
        {activity && <div className="apn-activity">→ {activity}</div>}
      </div>
    </div>
  );
}

/* ── SVG connector lines ─────────────────────────────────── */
function ArenaConnector({ team1Pct }) {
  const W = 1000, H = 520;
  const leftX = 230, rightX = 770, centerX = 500, centerY = 260;
  const playerYs  = [90, 260, 430];
  const myOpacity  = Math.max(0.2, team1Pct / 100);
  const oppOpacity = Math.max(0.2, (100 - team1Pct) / 100);

  return (
    <svg className="arena-connector-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      <defs>
        {playerYs.map((y, i) => (
          <linearGradient key={`gl${i}`} id={`gl${i}`} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#4da3ff" stopOpacity={myOpacity} />
            <stop offset="100%" stopColor="#4da3ff" stopOpacity={myOpacity * 0.15} />
          </linearGradient>
        ))}
        {playerYs.map((y, i) => (
          <linearGradient key={`gr${i}`} id={`gr${i}`} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#ff3d57" stopOpacity={oppOpacity * 0.15} />
            <stop offset="100%" stopColor="#ff3d57" stopOpacity={oppOpacity} />
          </linearGradient>
        ))}
      </defs>
      {playerYs.map((y, i) => (
        <line key={`l${i}`} x1={leftX} y1={y} x2={centerX} y2={centerY} stroke={`url(#gl${i})`} strokeWidth="1.5" />
      ))}
      {playerYs.map((y, i) => (
        <line key={`r${i}`} x1={centerX} y1={centerY} x2={rightX} y2={y} stroke={`url(#gr${i})`} strokeWidth="1.5" />
      ))}
      <polygon
        points={`${centerX},${centerY-52} ${centerX+52},${centerY} ${centerX},${centerY+52} ${centerX-52},${centerY}`}
        fill="none" stroke="rgba(77,163,255,0.2)" strokeWidth="1"
      />
    </svg>
  );
}

/* ── Center score diamond ─────────────────────────────────── */
function CenterNode({ team1Total, team2Total, myOnTeam1 }) {
  const grand   = team1Total + team2Total;
  const myTotal = myOnTeam1 ? team1Total : team2Total;
  const myPct   = grand > 0 ? Math.round(myTotal / grand * 100) : 50;
  const isLeading = myPct > 50;

  return (
    <div className="arena-center-node">
      <div className={`acn-pct ${isLeading ? 'acn-lead' : 'acn-trail'}`}>
        {myPct}<span className="acn-pct-sym">%</span>
      </div>
      <div className="acn-label">{isLeading ? 'in the lead' : 'behind'}</div>
      <div className="acn-bar">
        <div className="acn-bar-blue" style={{ width: `${myPct}%` }} />
        <div className="acn-bar-red" />
      </div>
      <div className="acn-score-split">
        <span className="acn-team-score acn-mine">{myTotal.toLocaleString()}</span>
        <span className="acn-vs">vs</span>
        <span className="acn-team-score acn-opp">{(grand - myTotal).toLocaleString()}</span>
      </div>
    </div>
  );
}

/* ── VS Screen ───────────────────────────────────────────── */
function VsScreen({ match, currentPlayer, onDismiss }) {
  const [dismissing, setDismissing] = useState(false);
  const onDismissRef = useRef(onDismiss);

  useEffect(() => {
    // Trigger the outro earlier so the slide-out has room to play before unmount
    const fadeTimer  = setTimeout(() => setDismissing(true), 4200);
    const closeTimer = setTimeout(() => onDismissRef.current?.(), 5300);
    return () => { clearTimeout(fadeTimer); clearTimeout(closeTimer); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const team1   = match.teams?.[0] || [];
  const team2   = match.teams?.[1] || [];
  const myOnT1  = team1.some((p) => String(p.UUID) === String(currentPlayer?.UUID));
  const myTeam  = myOnT1 ? team1 : team2;
  const oppTeam = myOnT1 ? team2 : team1;

  const renderPlayer = (player, side) => {
    const rank       = getRank(player.elo || 0);
    const rankLabel  = getRankLabel(player.elo || 0);
    const rankTier   = getRankTier(player.elo || 0);
    const rankClass  = getRankClass(player.elo || 0);
    const isMe       = String(player.UUID) === String(currentPlayer?.UUID);
    const accentColor = THEME_ACCENT_COLORS[player.playerTheme || 'default'] || '#4da3ff';
    const bannerStyle = getBannerStyle(player.cardBanner);
    const badges     = (player.selectedAchievements || []).filter(Boolean);

    const glowAlpha  = { base: 0, low: 0.18, mid: 0.35, high: 0.55, elite: 0.72, apex: 0.9 }[rankTier];
    const cardGlow   = glowAlpha > 0
      ? `0 0 ${8 + glowAlpha * 22}px ${rank.glow}`
      : undefined;

    return (
      <div
        key={player.UUID}
        className={`vs-player vs-player--${side} rank-tier-${rankTier}${isMe ? ' vs-player--self' : ''}`}
        style={{
          '--apn-accent': accentColor,
          '--rank-color': rank.color,
          '--rank-glow':  rank.glow,
          ...(cardGlow ? { boxShadow: cardGlow } : {}),
          ...(bannerStyle || {}),
        }}
      >
        {bannerStyle && <div className="vs-player-banner-overlay" />}
        <div className="vs-player-avatar">
          <ProfilePicture src={player.profilePicture} username={player.username || '?'} size={56} />
        </div>
        <div className="vs-player-info">
          <div className="vs-player-name-row">
            <span
              className="vs-player-name"
              style={{
                color: rank.color,
                textShadow: glowAlpha > 0.3 ? `0 0 10px ${rank.glow}` : undefined,
              }}
            >
              {player.username || 'Unknown'}
            </span>
            {isMe && <span className="vs-player-tag">YOU</span>}
          </div>
          {badges.length > 0 && (
            <div className={`vs-player-achievements vs-player-achievements--${side}`}>
              {badges.map((key) => (
                <AchievementBadge key={key} achievementKey={key} size={16} showTooltip={false} />
              ))}
            </div>
          )}
          <div className={`vs-player-rank rank-${rankClass}`}>
            <RankIcon group={rank.group} sub={rank.sub} size={16} /> {rankLabel}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className={`vs-screen${dismissing ? ' vs-screen--dismissing' : ''}`}>
      <div className="vs-screen-scanlines" aria-hidden="true" />
      <div className="vs-content">
        <div className="vs-team vs-team--left">
          <div className="vs-team-label">Your Team</div>
          {myTeam.map((p) => renderPlayer(p, 'left'))}
        </div>
        <div className="vs-centre">
          <div className="vs-badge">VS</div>
          <div className="vs-match-badge">{match.duration}H</div>
        </div>
        <div className="vs-team vs-team--right">
          <div className="vs-team-label">Opposition</div>
          {oppTeam.map((p) => renderPlayer(p, 'right'))}
        </div>
      </div>
    </div>
  );
}
/* ── Main component ──────────────────────────────────────── */
export default function MatchArena() {
  const {
    databaseConnection, timestamp, currentPlayer, refreshApp, notify,
    gameState: [, setGameState],
    activeMatch: [activeMatch, setActiveMatch],
    activeTask:  [activeTask, setActiveTask],
    openPanel,
  } = useContext(AppContext);

  const { remaining, elapsed } = useMatchTimer(activeMatch);
  const [scores, setScores]               = useState({});
  const [nextTodo, setNextTodo]           = useState(null);
  const [isConcluding, setIsConcluding]   = useState(false);
  const [showEndScreen, setShowEndScreen] = useState(false);
  const [allPlayers, setAllPlayers]       = useState([]);
  // Only show VS screen if the match was created very recently (brand new, not a resume)
  const [showVsScreen, setShowVsScreen]   = useState(() => {
    if (!activeMatch || activeMatch.status !== MATCH_STATUS.active) return false;
    const ageMs = Date.now() - new Date(activeMatch.createdAt).getTime();
    return ageMs < 8000;
  });

  // Pull the live player store once per refresh so stripped team snapshots
  // (from data-only imports) can fall back to current identity fields.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const all = await databaseConnection.getAllPlayers();
      if (!cancelled) setAllPlayers(all);
    })();
    return () => { cancelled = true; };
  }, [databaseConnection, timestamp]);

  const playersByUUID = useMemo(
    () => Object.fromEntries((allPlayers || []).map((p) => [p.UUID, p])),
    [allPlayers]
  );

  // Display-side view of the match with team snapshots self-healed against
  // the live player store. All writes still target `activeMatch`.
  const displayMatch = useMemo(
    () => (activeMatch ? hydrateMatchTeams(activeMatch, playersByUUID) : null),
    [activeMatch, playersByUUID]
  );

  const elapsedRatio = activeMatch
    ? Math.min(1, elapsed / (Number(activeMatch.duration || 1) * HOUR))
    : 0;

  const buildScores = useCallback(async () => {
    if (!activeMatch || !currentPlayer) return null;
    const next = {};
    const all  = [...(activeMatch.teams?.[0] || []), ...(activeMatch.teams?.[1] || [])];
    for (const p of all) {
      if (p.UUID === currentPlayer.UUID) continue;
      next[p.UUID] = getGhostScore(p, activeMatch.createdAt, activeMatch.duration);
    }
    const tasks = await databaseConnection.getStoreFromRange(STORES.task, activeMatch.createdAt, new Date().toISOString());
    next[currentPlayer.UUID] = tasks
      .filter((t) => t.parent === currentPlayer.UUID)
      .reduce((s, t) => s + Number(t.points || 0), 0);
    return next;
  }, [activeMatch, currentPlayer, databaseConnection]);

  const refreshScores = useCallback(async () => {
    const next = await buildScores();
    if (!next) return;
    setScores(next);
    const todos = await databaseConnection.getAll(STORES.todo);
    setNextTodo(getNextTodo(todos));
  }, [buildScores, databaseConnection]);

  useEffect(() => { refreshScores(); }, [refreshScores, timestamp]);

  // Auto-show endscreen when match completes (give arena a beat to render first)
  useEffect(() => {
    if (activeMatch?.status === MATCH_STATUS.complete) {
      const timer = setTimeout(() => setShowEndScreen(true), 600);
      return () => clearTimeout(timer);
    }
  }, [activeMatch?.status]);

  const concludeMatch = useCallback(async (forcedLoss = false) => {
    if (!activeMatch || !currentPlayer || isConcluding || activeMatch.status !== MATCH_STATUS.active) return;
    setIsConcluding(true);
    try {
      const finalScores = await buildScores();
      if (!finalScores) return;
      setScores(finalScores);

      const team1 = activeMatch.teams?.[0] || [];
      const team2 = activeMatch.teams?.[1] || [];

      // Player is always placed on teams[0] at match creation (see Lobby.jsx).
      // Use String coercion for the UUID comparison to guard against number/string type drift.
      const myOnTeam1 = team1.some((p) => String(p.UUID) === String(currentPlayer.UUID));

      const forcedLoserTeamIdx = forcedLoss ? (myOnTeam1 ? 0 : 1) : null;
      const { changes, winnerTeamIdx, t1Total, t2Total } =
        computeEloChanges([team1, team2], finalScores, forcedLoserTeamIdx);

      // iWon: did the current player's team win?
      // Since player is always on team1, this simplifies — but we keep the general form
      // in case that ever changes, and cross-check with myOnTeam1.
      const iWon = myOnTeam1
        ? winnerTeamIdx === 0
        : winnerTeamIdx === 1;
      const myChange = changes[currentPlayer.UUID];

      // Apply elo to current player, respecting the rank-group floor
      const player = await databaseConnection.getCurrentPlayer();
      const oldElo = Math.max(0, Number(player.elo || 0));
      const floor  = getRankGroupFloor(oldElo);
      const newElo = Math.max(floor, oldElo + (myChange?.change || 0));
      await databaseConnection.add(STORES.player, { ...player, elo: newElo });

      // Apply elo to real ghost players (skip synthesised ghosts), with their own floor
      const allReal = await databaseConnection.getAllPlayers();
      for (const ghost of [...team1, ...team2]) {
        if (String(ghost.UUID) === String(currentPlayer.UUID)) continue;
        if (String(ghost.UUID).startsWith('ghost-')) continue;
        const rp = allReal.find((r) => String(r.UUID) === String(ghost.UUID));
        if (!rp) continue;
        const gc = changes[ghost.UUID];
        const ghostOldElo = Math.max(0, Number(rp.elo || 0));
        const ghostFloor  = getRankGroupFloor(ghostOldElo);
        await databaseConnection.add(STORES.player, {
          ...rp,
          elo: Math.max(ghostFloor, ghostOldElo + (gc?.change || 0)),
        });
      }

      const updated = {
        ...activeMatch,
        status: MATCH_STATUS.complete,
        result: {
          winner: winnerTeamIdx + 1,
          team1Total: t1Total,
          team2Total: t2Total,
          iWon,
          eloChange:    newElo - oldElo,
          eloBreakdown: myChange?.breakdown || [],
          oldElo,
          newElo,
          wasForfeited: forcedLoss,
          concludedAt: new Date().toISOString(),
        },
      };
      await databaseConnection.add(STORES.match, updated);
      setActiveMatch(updated);

      // Check for newly earned achievements
      const freshPlayer = await databaseConnection.getCurrentPlayer();
      if (freshPlayer) {
        const newlyEarned = await checkMatchAchievements(freshPlayer, updated, databaseConnection);
        for (const key of newlyEarned) {
          const a = getAchievementByKey(key);
          if (a) notify({ title: 'Achievement Unlocked', message: a.label, kind: 'success', persist: false });
        }
      }

      refreshApp();
    } finally {
      setIsConcluding(false);
    }
  }, [activeMatch, currentPlayer, isConcluding, buildScores, databaseConnection, refreshApp, setActiveMatch, notify]);

  useEffect(() => {
    if (!activeMatch || activeMatch.status !== MATCH_STATUS.active || remaining === null) return;
    if (remaining === 0) concludeMatch(false);
  }, [remaining, activeMatch, concludeMatch]);

  if (!activeMatch) return null;

  // Use hydrated snapshots for all display-layer reads. Writes still go
  // through activeMatch to keep the canonical record authoritative.
  const displaySource = displayMatch || activeMatch;
  const team1      = displaySource.teams?.[0] || [];
  const team2      = displaySource.teams?.[1] || [];
  const t1Total    = team1.reduce((s, p) => s + Number(scores[p.UUID] || 0), 0);
  const t2Total    = team2.reduce((s, p) => s + Number(scores[p.UUID] || 0), 0);
  const grand      = t1Total + t2Total;
  const team1Pct   = grand > 0 ? Math.round(t1Total / grand * 100) : 50;
  const inTask     = !!activeTask.createdAt;
  const myOnT1     = team1.some((p) => p.UUID === currentPlayer?.UUID);
  const matchEnded = activeMatch.status !== MATCH_STATUS.active;
  const iWon       = matchEnded && activeMatch.result?.iWon;
  const currentTaskName = inTask ? (activeTask.name || null) : null;

  const handleReturn = () => {
    setShowEndScreen(false);
    setActiveMatch(null);
    setGameState(GAME_STATE.idle);
    refreshApp();
  };

  return (
    <div className={`match-arena ${matchEnded ? 'arena-ended' : ''}`}>
      <div className="arena-scanlines" aria-hidden="true" />

      {/* Header */}
      <div className="arena-header">
        <div className="arena-header-left">
          <div className="arena-status-dot" />
          <span className="arena-eyebrow">{matchEnded ? 'MATCH COMPLETE' : 'MATCH IN PROGRESS'}</span>
          <span className="arena-duration-badge">{activeMatch.duration}H MATCH</span>
        </div>
        <div className="arena-timer-wrap">
          {matchEnded ? (
            <span className={`arena-result-label ${iWon ? 'result-win' : 'result-loss'}`}>
              {iWon ? '▲ VICTORY' : (activeMatch.result?.wasForfeited ? '▼ FORFEIT' : '▼ DEFEAT')}
              {activeMatch.result?.eloChange != null && (
                <span className="result-elo">
                  {activeMatch.result.eloChange > 0 ? '+' : ''}{activeMatch.result.eloChange} ELO
                </span>
              )}
            </span>
          ) : (
            <>
              <span className="arena-timer-label">TIME LEFT</span>
              <span className="arena-timer">{timeAsHHMMSS(remaining || 0)}</span>
            </>
          )}
        </div>
        <div className="arena-header-right">
          {!matchEnded ? (
            <>
              <button onClick={() => NiceModal.show(TaskCreationMenu)}>+ TASK</button>
              <button onClick={() => openPanel('tasks')}>QUEUE</button>
              <button className="primary" onClick={async () => {
                if (!nextTodo || inTask) return;
                setActiveTask({ ...nextTodo, originalDuration: Number(nextTodo.estimatedDuration || 0) });
                await databaseConnection.remove(STORES.todo, nextTodo.UUID);
                refreshApp();
                NiceModal.show(TaskPreviewMenu);
              }} disabled={!nextTodo || inTask}>↑ NEXT</button>
              <button className="danger" onClick={async () => {
                if (inTask || isConcluding) return;
                if (!window.confirm('Forfeit match? You will lose ELO.')) return;
                await concludeMatch(true);
              }} disabled={inTask || isConcluding}>FORFEIT</button>
            </>
          ) : (
            <button className="primary" onClick={() => setShowEndScreen(true)}>
              VIEW RESULTS
            </button>
          )}
        </div>
      </div>

      {/* Score bar */}
      <div className="arena-score-bar">
        <span className={`asb-total ${myOnT1 ? 'asb-my' : 'asb-opp'}`}>{t1Total.toLocaleString()}</span>
        <div className="asb-track">
          <div className="asb-fill-blue" style={{ width: `${team1Pct}%` }} />
          <div className="asb-fill-red" />
        </div>
        <span className={`asb-total ${!myOnT1 ? 'asb-my' : 'asb-opp'}`}>{t2Total.toLocaleString()}</span>
      </div>

      {/* Field */}
      <div className="arena-field">
        <ArenaConnector team1Pct={team1Pct} />

        <div className="arena-side arena-side--left">
          <div className="arena-side-label">YOUR TEAM</div>
          {team1.map((player) => {
            const isMe = player.UUID === currentPlayer?.UUID;
            const enriched = isMe ? {
              ...player,
              cardBanner:  currentPlayer?.activeCosmetics?.cardBanner  ?? player.cardBanner  ?? null,
              playerTheme: currentPlayer?.activeCosmetics?.theme        ?? player.playerTheme ?? 'default',
            } : player;
            return (
              <ArenaPlayerNode key={player.UUID} player={enriched} score={Number(scores[player.UUID] || 0)}
                isCurrentPlayer={isMe} isActive={isMe && inTask}
                side="left" elapsedRatio={elapsedRatio}
                currentTaskName={isMe ? currentTaskName : null}
              />
            );
          })}
        </div>

        <div className="arena-field-center">
          <CenterNode team1Total={t1Total} team2Total={t2Total} myOnTeam1={myOnT1} />
          {inTask && (
            <div className="arena-in-session-badge">
              <div className="arena-session-dot" />
              {currentTaskName ? currentTaskName.slice(0, 20) : 'SESSION ACTIVE'}
            </div>
          )}
        </div>

        <div className="arena-side arena-side--right">
          <div className="arena-side-label arena-side-label--right">OPPOSITION</div>
          {team2.map((player) => (
            <ArenaPlayerNode key={player.UUID} player={player} score={Number(scores[player.UUID] || 0)}
              isCurrentPlayer={player.UUID === currentPlayer?.UUID}
              isActive={false}
              side="right" elapsedRatio={elapsedRatio}
              currentTaskName={null}
            />
          ))}
        </div>
      </div>

      {/* VS screen overlay — shown on match entry */}
      {showVsScreen && activeMatch.status === MATCH_STATUS.active && (
        <VsScreen
          match={displaySource}
          currentPlayer={currentPlayer}
          onDismiss={() => setShowVsScreen(false)}
        />
      )}

      {/* End screen overlay */}
      {showEndScreen && matchEnded && (
        <MatchEndScreen match={displaySource} currentPlayer={currentPlayer} onReturn={handleReturn} />
      )}
    </div>
  );
}