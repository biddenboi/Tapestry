import { useContext, useState, useEffect, useCallback } from 'react';
import NiceModal from '@ebay/nice-modal-react';
import { AppContext } from '../../App.jsx';
import { GAME_STATE, STORES, MATCH_STATUS, HOUR } from '../../utils/Constants.js';
import TaskCreationMenu from '../../Modals/TaskCreationMenu/TaskCreationMenu.jsx';
import TaskPreviewMenu from '../../Modals/TaskPreviewMenu/TaskPreviewMenu.jsx';
import ProfilePicture from '../ProfilePicture/ProfilePicture.jsx';
import { getGhostScore } from '../../utils/Helpers/Match.js';
import { getNextTodo, getWeights } from '../../utils/Helpers/Tasks.js';
import { timeAsHHMMSS } from '../../utils/Helpers/Time.js';
import './MatchArena.css';

function useMatchTimer(match) {
  const [remaining, setRemaining] = useState(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!match) {
      setRemaining(null);
      setElapsed(0);
      return undefined;
    }
    const endMs = new Date(match.createdAt).getTime() + Number(match.duration || 0) * HOUR;
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

function PlayerCard({ player, score, isCurrentPlayer, isActive }) {
  return (
    <div className={`arena-player-card ${isCurrentPlayer ? 'apc-self' : ''} ${isActive ? 'apc-active' : ''}`}>
      <ProfilePicture src={player.profilePicture} username={player.username} size={52} className="apc-avatar" />
      <div className="apc-info">
        <div className="apc-name">
          {player.username}
          {player.isGenerated && <span className="apc-ghost-tag">GHOST</span>}
          {isCurrentPlayer && <span className="apc-you-tag">YOU</span>}
        </div>
        <div className="apc-score">
          <span className="apc-score-val">{score.toLocaleString()}</span>
          <span className="apc-score-lbl">pts</span>
        </div>
      </div>
      {isActive && <div className="apc-active-indicator" title="In session" />}
    </div>
  );
}

function TeamColumn({ players, scores, currentPlayerUUID, inTask, side }) {
  const total = players.reduce((sum, player) => sum + Number(scores[player.UUID] || 0), 0);
  return (
    <div className={`arena-team arena-team--${side}`}>
      <div className="arena-team-header">
        <span className="arena-team-label">{side === 'left' ? 'YOUR TEAM' : 'OPPOSITION'}</span>
        <span className="arena-team-total">{total.toLocaleString()}</span>
      </div>
      <div className="arena-team-players">
        {players.map((player) => (
          <PlayerCard
            key={player.UUID}
            player={player}
            score={Number(scores[player.UUID] || 0)}
            isCurrentPlayer={player.UUID === currentPlayerUUID}
            isActive={player.UUID === currentPlayerUUID && inTask}
          />
        ))}
      </div>
    </div>
  );
}

function TugBar({ team1Total, team2Total }) {
  const grand = team1Total + team2Total;
  const pct = grand > 0 ? Math.round((team1Total / grand) * 100) : 50;
  const winning = pct > 50 ? 'left' : pct < 50 ? 'right' : null;

  return (
    <div className="tug-bar-wrap">
      <div className="tug-bar-track">
        <div className={`tug-bar-fill ${winning === 'left' ? 'fill-win' : winning === 'right' ? 'fill-lose' : ''}`} style={{ width: `${pct}%` }} />
        <div className="tug-bar-midline" />
      </div>
      <div className="tug-bar-pct">
        <span className={pct >= 50 ? 'pct-win' : 'pct-dim'}>{pct}%</span>
        <span className="tug-divider">|</span>
        <span className={pct < 50 ? 'pct-win' : 'pct-dim'}>{100 - pct}%</span>
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

  const { remaining } = useMatchTimer(activeMatch);
  const [scores, setScores] = useState({});
  const [nextTodo, setNextTodo] = useState(null);
  const [isConcluding, setIsConcluding] = useState(false);

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

  useEffect(() => {
    refreshScores();
  }, [refreshScores, timestamp]);

  const concludeMatch = useCallback(async (forcedLoss = false) => {
    if (!activeMatch || !currentPlayer || isConcluding || activeMatch.status !== MATCH_STATUS.active) return;
    setIsConcluding(true);
    try {
      const finalScores = await buildScores();
      if (!finalScores) return;
      setScores(finalScores);

      const team1 = activeMatch.teams?.[0] || [];
      const team2 = activeMatch.teams?.[1] || [];
      const myOnTeam1 = team1.some((player) => player.UUID === currentPlayer.UUID);
      const team1Total = team1.reduce((sum, player) => sum + Number(finalScores[player.UUID] || 0), 0);
      const team2Total = team2.reduce((sum, player) => sum + Number(finalScores[player.UUID] || 0), 0);

      let winner = team1Total >= team2Total ? 1 : 2;
      if (forcedLoss) winner = myOnTeam1 ? 2 : 1;
      const iWon = (winner === 1 && myOnTeam1) || (winner === 2 && !myOnTeam1);
      const eloChange = iWon ? 25 : -20;

      const player = await databaseConnection.getCurrentPlayer();
      await databaseConnection.add(STORES.player, {
        ...player,
        elo: Math.max(0, Number(player.elo || 0) + eloChange),
      });

      const updatedMatch = {
        ...activeMatch,
        status: MATCH_STATUS.complete,
        result: {
          winner,
          team1Total,
          team2Total,
          iWon,
          eloChange,
          concludedAt: new Date().toISOString(),
        },
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
  const t1Total = team1.reduce((sum, player) => sum + Number(scores[player.UUID] || 0), 0);
  const t2Total = team2.reduce((sum, player) => sum + Number(scores[player.UUID] || 0), 0);
  const inTask = !!activeTask.createdAt;
  const myOnT1 = team1.some((player) => player.UUID === currentPlayer?.UUID);
  const matchEnded = activeMatch.status !== MATCH_STATUS.active;
  const iWon = matchEnded && activeMatch.result?.iWon;

  return (
    <div className={`match-arena ${matchEnded ? 'arena-ended' : ''}`}>
      <div className="arena-bg" aria-hidden="true" />
      <div className="arena-header">
        <div className="arena-header-left">
          <span className="arena-eyebrow">{matchEnded ? 'MATCH COMPLETE' : 'MATCH IN PROGRESS'}</span>
          <span className="arena-duration-badge">{activeMatch.duration}h MATCH</span>
        </div>

        <div className="arena-timer-wrap">
          {matchEnded ? (
            <span className={`arena-result-label ${iWon ? 'result-win' : 'result-loss'}`}>
              {iWon ? '⬆ VICTORY' : '⬇ DEFEAT'}
              {activeMatch.result?.eloChange != null && (
                <span className="result-elo">{activeMatch.result.eloChange > 0 ? '+' : ''}{activeMatch.result.eloChange} ELO</span>
              )}
            </span>
          ) : (
            <>
              <span className="arena-timer-label">REMAINING</span>
              <span className="arena-timer">{timeAsHHMMSS(remaining || 0)}</span>
            </>
          )}
        </div>

        <div className="arena-header-right">
          {!matchEnded ? (
            <>
              <button onClick={() => NiceModal.show(TaskCreationMenu)}>+ TASK</button>
              <button onClick={() => openPanel('tasks')}>QUEUE</button>
              <button className="primary" onClick={handleGetNext} disabled={!nextTodo || inTask}>↑ NEXT TASK</button>
              <button className="danger" onClick={handleForfeit} disabled={inTask || isConcluding}>FORFEIT</button>
            </>
          ) : (
            <button className="primary" onClick={handleExitCompleted}>RETURN TO LOBBY →</button>
          )}
        </div>
      </div>

      <div className="arena-body">
        <TeamColumn players={team1} scores={scores} currentPlayerUUID={currentPlayer?.UUID} inTask={inTask} side="left" />
        <div className="arena-center">
          <TugBar team1Total={t1Total} team2Total={t2Total} />
          <div className="arena-center-scores">
            <span className={`acs-total ${myOnT1 ? 'acs-highlight' : ''}`}>{t1Total.toLocaleString()}</span>
            <span className="acs-sep">vs</span>
            <span className={`acs-total ${!myOnT1 ? 'acs-highlight' : ''}`}>{t2Total.toLocaleString()}</span>
          </div>
          {inTask && (
            <div className="arena-active-badge">
              <span>⬤ SESSION ACTIVE</span>
            </div>
          )}
        </div>
        <TeamColumn players={team2} scores={scores} currentPlayerUUID={currentPlayer?.UUID} inTask={false} side="right" />
      </div>
    </div>
  );
}
