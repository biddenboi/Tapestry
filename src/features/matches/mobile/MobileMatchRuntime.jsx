import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppContext } from '@app/hooks/useAppContext.js';
import { DOMAIN_INVALIDATION } from '@app/context/domainRevisions.js';
import { GAME_STATE, MATCH_STATUS } from '@domain/constants.js';
import { getMatchDurationMs, getMatchTeams } from '@domain/matches/MatchContracts.js';
import { buildInMemoryMatchScores, loadMatchRuntimeInput } from '@domain/matches/MatchRuntime.js';
import { patchMatchStateCommand } from '@domain/matches/MatchSyncCommands.js';
import { completeMatchPrimary } from '@domain/matches/MatchCompletionService.js';
import { launchRecommendedTask } from '@domain/tasks/TaskRecommender.js';
import { timeAsHHMMSS } from '@domain/time/Time.js';
import { useTaskSession } from '@features/tasks/context/TaskSessionProvider.jsx';
import { useMobileSurface } from '@app/mobile/MobileSurfaceContext.jsx';
import ProfileIdentity from '@shared/profile-identity/ProfileIdentity.jsx';

function remainingForMatch(match, now = Date.now()) {
  if (!match?.lockedAt || match.status !== MATCH_STATUS.active) return getMatchDurationMs(match);
  return Math.max(0, new Date(match.lockedAt).getTime() + getMatchDurationMs(match) - now);
}

export default function MobileMatchRuntime({ onBack }) {
  const {
    databaseConnection,
    currentPlayer,
    updateCurrentPlayer,
    domainRevisions,
    invalidateDomains,
    activeMatch: [activeMatch, setActiveMatch],
    activeTask: [activeTask],
    gameState: [, setGameState],
  } = useAppContext();
  const { finalizeMatchBoundary } = useTaskSession();
  const { openSurface } = useMobileSurface();
  const [runtime, setRuntime] = useState({ scores: {}, todos: [], taskHistory: [], scoreEvents: [] });
  const [remaining, setRemaining] = useState(() => remainingForMatch(activeMatch));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const concludingRef = useRef(false);

  const teams = useMemo(() => getMatchTeams(activeMatch), [activeMatch]);
  const reload = useCallback(async () => {
    if (!activeMatch?.UUID || !currentPlayer?.UUID) return;
    setRuntime(await loadMatchRuntimeInput(databaseConnection, activeMatch, currentPlayer.UUID));
  }, [activeMatch, currentPlayer?.UUID, databaseConnection]);

  useEffect(() => { void reload(); }, [reload, domainRevisions.tasks, domainRevisions.matches]);
  useEffect(() => {
    if (activeMatch?.status !== MATCH_STATUS.active) {
      setRemaining(remainingForMatch(activeMatch));
      return undefined;
    }
    const tick = () => setRemaining(remainingForMatch(activeMatch));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [activeMatch]);

  const scores = useMemo(() => buildInMemoryMatchScores({
    match: activeMatch,
    currentPlayerUUID: currentPlayer?.UUID,
    taskHistory: runtime.taskHistory,
    scoreEvents: runtime.scoreEvents,
    now: Date.now(),
  }), [activeMatch, currentPlayer?.UUID, remaining, runtime.scoreEvents, runtime.taskHistory]);
  const totals = teams.map((team) => team.reduce((sum, player) => sum + Number(scores[player.UUID] || 0), 0));
  const currentTeamIndex = teams.findIndex((team) => team.some((player) => String(player.UUID) === String(currentPlayer?.UUID)));

  const savePatch = async (patch, operationId = null) => {
    const updated = await patchMatchStateCommand(databaseConnection, activeMatch, patch, {
      operationId,
      origin: 'mobile',
    });
    setActiveMatch(updated);
    invalidateDomains(DOMAIN_INVALIDATION.matchWrite);
    return updated;
  };

  const applyPendingPatch = async (patch, operationId = null, afterSave = null) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await savePatch(patch, operationId);
      afterSave?.();
    } catch (patchError) {
      setError(patchError?.message || 'The shared Match state could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const conclude = useCallback(async (forcedLoss = false) => {
    if (!activeMatch || activeMatch.status !== MATCH_STATUS.active || concludingRef.current) return;
    concludingRef.current = true;
    setBusy(true);
    setError('');
    try {
      const concludedAt = new Date().toISOString();
      const boundary = await finalizeMatchBoundary(activeMatch, concludedAt);
      const scoreEvents = boundary?.scoreEvent
        && !runtime.scoreEvents.some((event) => event.UUID === boundary.scoreEvent.UUID)
        ? [...runtime.scoreEvents, boundary.scoreEvent]
        : runtime.scoreEvents;
      const finalScores = buildInMemoryMatchScores({
        match: activeMatch,
        currentPlayerUUID: currentPlayer.UUID,
        taskHistory: runtime.taskHistory,
        scoreEvents,
        now: Date.now(),
      });
      const completedTasks = runtime.taskHistory.filter((task) => (
        String(task.parent) === String(currentPlayer.UUID)
        && String(task.completedAt || '') >= String(activeMatch.lockedAt || activeMatch.createdAt || '')
        && String(task.completedAt || '') <= concludedAt
      ));
      const result = await completeMatchPrimary({
        databaseConnection,
        match: activeMatch,
        currentPlayer,
        finalScores,
        forcedLoss,
        concludedAt,
        completedTasks,
        scoreEvents,
        origin: 'mobile',
      });
      if (!result) throw new Error('The Match result was not saved.');
      setActiveMatch(result.match);
      updateCurrentPlayer(result.player);
      invalidateDomains(DOMAIN_INVALIDATION.matchWrite);
      databaseConnection.syncRuntime?.scheduleSync?.('mobile-match-complete');
      void import('@domain/matches/MatchPostMatchJobs.js')
        .then(({ queuePostMatchJobs }) => queuePostMatchJobs(databaseConnection, result.match))
        .catch((postMatchError) => console.warn('[Mobile Match] post-match processing will retry.', postMatchError));
    } catch (matchError) {
      setError(matchError?.message || 'The Match could not be completed.');
    } finally {
      concludingRef.current = false;
      setBusy(false);
    }
  }, [activeMatch, currentPlayer, databaseConnection, finalizeMatchBoundary, invalidateDomains, runtime.scoreEvents, runtime.taskHistory, setActiveMatch, updateCurrentPlayer]);

  useEffect(() => {
    if (activeMatch?.status === MATCH_STATUS.active && remaining === 0) void conclude(false);
  }, [activeMatch?.status, conclude, remaining]);

  const startNext = async () => {
    if (busy || activeTask?.createdAt) return;
    setBusy(true);
    setError('');
    try {
      const launched = await launchRecommendedTask(databaseConnection, currentPlayer, {
        todos: runtime.todos,
        history: runtime.taskHistory,
        source: 'match',
        mode: 'normal',
        observationSessionUUID: activeMatch.UUID,
      });
      if (!launched?.task) throw new Error('No open workspace task is eligible right now.');
      openSurface('task-actions', { task: launched.task, onChanged: reload });
    } catch (launchError) {
      setError(launchError?.message || 'The next Match task could not be selected.');
    } finally {
      setBusy(false);
    }
  };

  if (!activeMatch) return <div className="mobile-runtime-empty">The synced Match is still loading.</div>;
  if (activeMatch.status === MATCH_STATUS.complete) {
    const won = Boolean(activeMatch.result?.iWon);
    return (
      <section className="mobile-competition-runtime mobile-match-runtime">
        <header className="mobile-runtime-header"><button type="button" onClick={onBack}>← More</button><div><span>Match complete</span><h1>{won ? 'Victory' : 'Match recap'}</h1></div><strong>{Number(activeMatch.result?.eloChange || 0) >= 0 ? '+' : ''}{Number(activeMatch.result?.eloChange || 0)} Elo</strong></header>
        <div className="mobile-match-scoreboard"><strong>{Number(activeMatch.result?.team1Total || 0).toLocaleString()}</strong><span>Final</span><strong>{Number(activeMatch.result?.team2Total || 0).toLocaleString()}</strong></div>
        <button type="button" className="primary mobile-runtime-return" onClick={() => { setActiveMatch(null); setGameState(GAME_STATE.idle); onBack?.(); }}>Return to More</button>
      </section>
    );
  }

  if (activeMatch.status === MATCH_STATUS.pending) {
    const ready = activeMatch.phase === 'ready';
    const participantUUIDs = teams.flat().map((player) => player.UUID);
    const advance = () => {
      if (!ready) return applyPendingPatch({ phase: 'ready' });
      const lockedAt = new Date().toISOString();
      return applyPendingPatch({
        status: MATCH_STATUS.active,
        phase: 'work',
        lockedAt,
        readyParticipantUUIDs: participantUUIDs,
        readyState: Object.fromEntries(participantUUIDs.map((participantUUID) => [
          participantUUID,
          { ready: true, readyAt: lockedAt },
        ])),
      }, `match-lock:${activeMatch.UUID}`);
    };
    const leaveQueue = () => applyPendingPatch(
      { status: 'cancelled', phase: 'cancelled' },
      null,
      () => {
        setActiveMatch(null);
        setGameState(GAME_STATE.idle);
        onBack?.();
      },
    );
    return (
      <section className="mobile-competition-runtime mobile-match-runtime">
        <header className="mobile-runtime-header"><button type="button" onClick={onBack}>← More</button><div><span>Shared queue</span><h1>Match</h1></div><strong>{ready ? 'Ready check' : 'Team reveal'}</strong></header>
        <div className="mobile-match-roster">{teams.map((team, index) => <section key={`team-${index}`}><h2>{index === currentTeamIndex ? 'Your team' : 'Opponents'}</h2>{team.map((player) => <ProfileIdentity key={player.UUID} player={player} compact avatarSize={38} />)}</section>)}</div>
        <div className="mobile-runtime-actions">
          <button type="button" disabled={busy} onClick={leaveQueue}>Leave queue</button>
          <button type="button" className="primary" disabled={busy} onClick={advance}>{busy ? 'Saving…' : ready ? 'Ready · Start' : 'Continue'}</button>
        </div>
        {error && <div className="mobile-page-error" role="alert">{error}</div>}
      </section>
    );
  }

  return (
    <section className="mobile-competition-runtime mobile-match-runtime" aria-labelledby="mobile-match-title">
      <header className="mobile-runtime-header"><button type="button" onClick={onBack}>← More</button><div><span>Live shared session</span><h1 id="mobile-match-title">Match</h1></div><strong>{timeAsHHMMSS(remaining)}</strong></header>
      <div className="mobile-match-scoreboard"><strong>{Number(totals[0] || 0).toLocaleString()}</strong><span>VS</span><strong>{Number(totals[1] || 0).toLocaleString()}</strong></div>
      <div className="mobile-match-roster mobile-match-roster--compact">{teams.map((team, index) => <section key={`active-team-${index}`}><h2>{index === currentTeamIndex ? 'Your team' : 'Opponents'}</h2>{team.map((player) => <div key={player.UUID}><ProfileIdentity player={player} compact avatarOnly avatarSize={32} /><span>{player.username || player.name}</span><strong>{Number(scores[player.UUID] || 0).toLocaleString()}</strong></div>)}</section>)}</div>
      {activeTask?.createdAt && <article className="mobile-runtime-active-card"><span>Match work in progress</span><h2>{activeTask.name}</h2><p>The shared Action Session keeps this work pinned to the Match on phone and desktop.</p></article>}
      <div className="mobile-runtime-actions">
        <button type="button" onClick={() => openSurface('task-composer', {})} disabled={busy || Boolean(activeTask?.createdAt)}>Add task</button>
        <button type="button" className="primary" onClick={startNext} disabled={busy || Boolean(activeTask?.createdAt)}>{busy ? 'Finding…' : 'Start next'}</button>
      </div>
      <button type="button" className="mobile-match-forfeit" disabled={busy} onClick={() => { if (window.confirm('Forfeit this Match? The result and Elo change will sync to desktop.')) void conclude(true); }}>Forfeit Match</button>
      {error && <div className="mobile-page-error" role="alert">{error}</div>}
    </section>
  );
}
