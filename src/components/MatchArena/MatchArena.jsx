import { useContext, useState, useEffect, useCallback, useRef } from 'react';
import NiceModal from '@ebay/nice-modal-react';
import { AppContext } from '../../App.jsx';
import { GAME_STATE, STORES, MATCH_STATUS, HOUR } from '../../utils/Constants.js';
import TaskCreationMenu from '../../Modals/TaskCreationMenu/TaskCreationMenu.jsx';
import TaskPreviewMenu from '../../Modals/TaskPreviewMenu/TaskPreviewMenu.jsx';
import ProfilePicture from '../ProfilePicture/ProfilePicture.jsx';
import { getGhostScore, getGhostActivity } from '../../utils/Helpers/Match.js';
import { getNextTodo, getWeights } from '../../utils/Helpers/Tasks.js';
import { timeAsHHMMSS } from '../../utils/Helpers/Time.js';
import { getRankLabel, getRankGlow } from '../../utils/Helpers/Rank.js';
import './MatchArena.css';

function useMatchTimer(match) {
  const [remaining, setRemaining] = useState(null);
  const [elapsed, setElapsed] = useState(0);

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

/* ── Player node in the arena field ─────────────────────── */
function ArenaPlayerNode({ player, score, isCurrentPlayer, isActive, side, elapsedRatio }) {
  const activity = player.isGenerated || !isCurrentPlayer
    ? getGhostActivity(player, elapsedRatio)
    : null;
  const rankLabel = getRankLabel(player.elo || 0);
  const glow = getRankGlow(player.elo || 0, 10);

  return (
    <div className={`apn ${isCurrentPlayer ? 'apn-self' : ''} ${isActive ? 'apn-active' : ''} apn-${side}`}>
      <div className="apn-avatar-wrap" style={isCurrentPlayer ? { boxShadow: glow } : {}}>
        <ProfilePicture src={player.profilePicture} username={player.username} size={48} />
        {isActive && <div className="apn-pulse-ring" />}
      </div>
      <div className="apn-info">
        <div className="apn-name-row">
          <span className="apn-name">{player.username}</span>
          {isCurrentPlayer && <span className="apn-tag apn-tag-you">YOU</span>}
          {player.isGenerated && <span className="apn-tag apn-tag-ghost">GHOST</span>}
        </div>
        <div className="apn-rank">{rankLabel}</div>
        <div className="apn-score">{score.toLocaleString()} <span className="apn-pts">pts</span></div>
        {activity && <div className="apn-activity">→ {activity}</div>}
      </div>
    </div>
  );
}

/* ── SVG connector lines ─────────────────────────────────── */
function ArenaConnector({ team1Pct, containerRef }) {
  /* Fixed viewBox layout matching the CSS grid proportions */
  const W = 1000, H = 520;
  const leftX = 230, rightX = 770, centerX = 500, centerY = 260;
  const playerYs = [90, 260, 430];

  const myColor   = 'var(--accent-bright)';
  const oppColor  = 'var(--red)';
  const myOpacity = Math.max(0.25, team1Pct / 100);
  const opOpacity = Math.max(0.25, (100 - team1Pct) / 100);

  /* The gradient "winner" control: shift the midpoint of each line */
  const midFrac = team1Pct / 100; /* 0–1 how far left team "owns" */

  return (
    <svg
      className="arena-connector-svg"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        {playerYs.map((y, i) => (
          <linearGradient key={`gl${i}`} id={`gl${i}`} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={myColor} stopOpacity={myOpacity} />
            <stop offset="100%" stopColor={myColor} stopOpacity={myOpacity * 0.2} />
          </linearGradient>
        ))}
        {playerYs.map((y, i) => (
          <linearGradient key={`gr${i}`} id={`gr${i}`} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={oppColor} stopOpacity={opOpacity * 0.2} />
            <stop offset="100%" stopColor={oppColor} stopOpacity={opOpacity} />
          </linearGradient>
        ))}
      </defs>

      {/* Left lines */}
      {playerYs.map((y, i) => (
        <line
          key={`l${i}`}
          x1={leftX} y1={y}
          x2={centerX} y2={centerY}
          stroke={`url(#gl${i})`}
          strokeWidth="1.5"
        />
      ))}

      {/* Right lines */}
      {playerYs.map((y, i) => (
        <line
          key={`r${i}`}
          x1={centerX} y1={centerY}
          x2={rightX} y2={y}
          stroke={`url(#gr${i})`}
          strokeWidth="1.5"
        />
      ))}

      {/* Center diamond outline */}
      <polygon
        points={`${centerX},${centerY - 52} ${centerX + 52},${centerY} ${centerX},${centerY + 52} ${centerX - 52},${centerY}`}
        fill="none"
        stroke="var(--border)"
        strokeWidth="1"
      />
    </svg>
  );
}

/* ── Center score display ────────────────────────────────── */
function CenterNode({ team1Total, team2Total, myOnTeam1 }) {
  const grand = team1Total + team2Total;
  const myPct = grand > 0 ? Math.round((myOnTeam1 ? team1Total : team2Total) / grand * 100) : 50;
  const isLeading = myPct > 50;

  return (
    <div className="arena-center-node">
      <div className={`acn-pct ${isLeading ? 'acn-lead' : 'acn-trail'}`}>
        {myPct}<span className="acn-pct-sym">%</span>
      </div>
      <div className="acn-label">{isLeading ? 'in the lead' : 'behind'}</div>
      <div className="acn-bar">
        <div
          className="acn-bar-fill"
          style={{ width: `${myOnTeam1 ? (grand > 0 ? (team1Total / grand * 100) : 50) : (grand > 0 ? (team2Total / grand * 100) : 50)}%` }}
        />
      </div>
    </div>
  );
}

export default function MatchArena() {
  const {
    databaseConnection,
    timestamp,
    currentPlayer,
    refreshApp,
    gameState: [, setGameState],
    activeMatch: [activeMatch, setActiveMatch],
    activeTask: [activeTask, setActiveTask],
    openPanel,
  } = useContext(AppContext);

  const { remaining, elapsed } = useMatchTimer(activeMatch);
  const [scores, setScores] = useState({});
  const [nextTodo, setNextTodo] = useState(null);
  const [isConcluding, setIsConcluding] = useState(false);
  const containerRef = useRef(null);

  const elapsedRatio = activeMatch
    ? Math.min(1, elapsed / (Number(activeMatch.duration || 1) * HOUR))
    : 0;

  const buildScores = useCallback(async () => {
    if (!activeMatch || !currentPlayer) return null;
    const nextScores = {};
    const allPlayers = [...(activeMatch.teams?.[0] || []), ...(activeMatch.teams?.[1] || [])];

    for (const player of allPlayers) {
      if (player.UUID === currentPlayer.UUID) continue;
      nextScores[player.UUID] = getGhostScore(player, activeMatch.createdAt, activeMatch.duration);
    }

    const tasks = await databaseConnection.getStoreFromRange(STORES.task, activeMatch.createdAt, new Date().toISOString());
    nextScores[currentPlayer.UUID] = tasks
      .filter((task) => task.parent === currentPlayer.UUID)
      .reduce((sum, task) => sum + Number(task.points || 0), 0);

    return nextScores;
  }, [activeMatch, currentPlayer, databaseConnection]);

  const refreshScores = useCallback(async () => {
    const nextScores = await buildScores();
    if (!nextScores) return;
    setScores(nextScores);
    const todos = await databaseConnection.getAll(STORES.todo);
    setNextTodo(getNextTodo(todos, getWeights(todos)));
  }, [buildScores, databaseConnection]);

  useEffect(() => { refreshScores(); }, [refreshScores, timestamp]);

  const concludeMatch = useCallback(async (forcedLoss = false) => {
    if (!activeMatch || !currentPlayer || isConcluding || activeMatch.status !== MATCH_STATUS.active) return;
    setIsConcluding(true);
    try {
      const finalScores = await buildScores();
      if (!finalScores) return;
      setScores(finalScores);

      const team1 = activeMatch.teams?.[0] || [];
      const team2 = activeMatch.teams?.[1] || [];
      const myOnTeam1 = team1.some((p) => p.UUID === currentPlayer.UUID);
      const team1Total = team1.reduce((s, p) => s + Number(finalScores[p.UUID] || 0), 0);
      const team2Total = team2.reduce((s, p) => s + Number(finalScores[p.UUID] || 0), 0);

      let winner = team1Total >= team2Total ? 1 : 2;
      if (forcedLoss) winner = myOnTeam1 ? 2 : 1;
      const iWon = (winner === 1 && myOnTeam1) || (winner === 2 && !myOnTeam1);
      const eloChange = iWon ? 25 : -20;

      /* Update current player ELO */
      const player = await databaseConnection.getCurrentPlayer();
      await databaseConnection.add(STORES.player, {
        ...player,
        elo: Math.max(0, Number(player.elo || 0) + eloChange),
      });

      /* Update ghost players that are real player records */
      const allRealPlayers = await databaseConnection.getAllPlayers();
      const allTeamMembers = [...team1, ...team2];
      for (const ghost of allTeamMembers) {
        if (ghost.UUID === currentPlayer.UUID) continue;
        if (String(ghost.UUID).startsWith('ghost-')) continue;
        const realPlayer = allRealPlayers.find((rp) => rp.UUID === ghost.UUID);
        if (!realPlayer) continue;
        const ghostOnTeam1 = team1.some((p) => p.UUID === ghost.UUID);
        const ghostWon = (winner === 1 && ghostOnTeam1) || (winner === 2 && !ghostOnTeam1);
        await databaseConnection.add(STORES.player, {
          ...realPlayer,
          elo: Math.max(0, Number(realPlayer.elo || 0) + (ghostWon ? 25 : -20)),
        });
      }

      const updatedMatch = {
        ...activeMatch,
        status: MATCH_STATUS.complete,
        result: { winner, team1Total, team2Total, iWon, eloChange, concludedAt: new Date().toISOString() },
      };
      await databaseConnection.add(STORES.match, updatedMatch);
      setActiveMatch(updatedMatch);
      refreshApp();
    } finally {
      setIsConcluding(false);
    }
  }, [activeMatch, currentPlayer, isConcluding, buildScores, databaseConnection, refreshApp, setActiveMatch]);

  useEffect(() => {
    if (!activeMatch || activeMatch.status !== MATCH_STATUS.active) return;
    if (remaining === null) return;
    if (remaining === 0) concludeMatch(false);
  }, [remaining, activeMatch, concludeMatch]);

  const handleForfeit = async () => {
    if (activeTask.createdAt) return;
    if (!window.confirm('Forfeit match? You will lose ELO.')) return;
    await concludeMatch(true);
  };

  const handleExitCompleted = () => {
    setActiveMatch(null);
    setGameState(GAME_STATE.idle);
    refreshApp();
  };

  const handleGetNext = async () => {
    if (!nextTodo) return;
    setActiveTask({ ...nextTodo, originalDuration: Number(nextTodo.estimatedDuration || 0) });
    await databaseConnection.remove(STORES.todo, nextTodo.UUID);
    refreshApp();
    NiceModal.show(TaskPreviewMenu);
  };

  if (!activeMatch) return null;

  const team1 = activeMatch.teams?.[0] || [];
  const team2 = activeMatch.teams?.[1] || [];
  const t1Total = team1.reduce((s, p) => s + Number(scores[p.UUID] || 0), 0);
  const t2Total = team2.reduce((s, p) => s + Number(scores[p.UUID] || 0), 0);
  const grand   = t1Total + t2Total;
  const team1Pct = grand > 0 ? Math.round(t1Total / grand * 100) : 50;
  const inTask   = !!activeTask.createdAt;
  const myOnT1   = team1.some((p) => p.UUID === currentPlayer?.UUID);
  const matchEnded = activeMatch.status !== MATCH_STATUS.active;
  const iWon = matchEnded && activeMatch.result?.iWon;

  return (
    <div className={`match-arena ${matchEnded ? 'arena-ended' : ''}`}>
      <div className="arena-scanlines" aria-hidden="true" />

      {/* ── Header ─────────────────────────────────────────── */}
      <div className="arena-header">
        <div className="arena-header-left">
          <div className="arena-status-dot" />
          <span className="arena-eyebrow">{matchEnded ? 'MATCH COMPLETE' : 'MATCH IN PROGRESS'}</span>
          <span className="arena-duration-badge">{activeMatch.duration}H MATCH</span>
        </div>

        <div className="arena-timer-wrap">
          {matchEnded ? (
            <span className={`arena-result-label ${iWon ? 'result-win' : 'result-loss'}`}>
              {iWon ? '▲ VICTORY' : '▼ DEFEAT'}
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
              <button className="primary" onClick={handleGetNext} disabled={!nextTodo || inTask}>↑ NEXT</button>
              <button className="danger" onClick={handleForfeit} disabled={inTask || isConcluding}>FORFEIT</button>
            </>
          ) : (
            <button className="primary" onClick={handleExitCompleted}>RETURN TO LOBBY →</button>
          )}
        </div>
      </div>

      {/* ── Team score totals bar ────────────────────────────── */}
      <div className="arena-score-bar">
        <span className={`asb-total ${myOnT1 ? 'asb-my' : 'asb-opp'}`}>{t1Total.toLocaleString()}</span>
        <div className="asb-track">
          <div className="asb-fill" style={{ width: `${team1Pct}%` }} />
          <div className="asb-midmark" />
        </div>
        <span className={`asb-total ${!myOnT1 ? 'asb-my' : 'asb-opp'}`}>{t2Total.toLocaleString()}</span>
      </div>

      {/* ── Field: oval gestalt layout ────────────────────────── */}
      <div className="arena-field" ref={containerRef}>
        {/* SVG connection lines underneath players */}
        <ArenaConnector team1Pct={team1Pct} containerRef={containerRef} />

        {/* Left team */}
        <div className="arena-side arena-side--left">
          <div className="arena-side-label">YOUR TEAM</div>
          {team1.map((player) => (
            <ArenaPlayerNode
              key={player.UUID}
              player={player}
              score={Number(scores[player.UUID] || 0)}
              isCurrentPlayer={player.UUID === currentPlayer?.UUID}
              isActive={player.UUID === currentPlayer?.UUID && inTask}
              side="left"
              elapsedRatio={elapsedRatio}
            />
          ))}
        </div>

        {/* Center */}
        <div className="arena-field-center">
          <CenterNode team1Total={t1Total} team2Total={t2Total} myOnTeam1={myOnT1} />
          {inTask && (
            <div className="arena-in-session-badge">
              <div className="arena-session-dot" />
              SESSION ACTIVE
            </div>
          )}
        </div>

        {/* Right team */}
        <div className="arena-side arena-side--right">
          <div className="arena-side-label arena-side-label--right">OPPOSITION</div>
          {team2.map((player) => (
            <ArenaPlayerNode
              key={player.UUID}
              player={player}
              score={Number(scores[player.UUID] || 0)}
              isCurrentPlayer={player.UUID === currentPlayer?.UUID}
              isActive={false}
              side="right"
              elapsedRatio={elapsedRatio}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
