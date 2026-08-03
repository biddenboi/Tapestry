import { useCallback, useEffect, useState } from 'react';
import { useAppContext } from '@app/hooks/useAppContext.js';
import {
  actionSessionElapsed,
  getActiveActionSession,
  pauseActionSession,
  resumeActionSession,
  takeOverActionSession,
} from '@domain/continuity/ActionSession.js';
import { DOMAIN_INVALIDATION } from '@app/context/domainRevisions.js';
import { getActiveRoutineRun } from '@domain/routines/RoutineCommands.js';

function clock(milliseconds) {
  const seconds = Math.max(0, Math.floor(Number(milliseconds || 0) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${minutes}:${String(remainder).padStart(2, '0')}`;
}

export default function ActiveStateController({ onOpen }) {
  const {
    databaseConnection,
    currentPlayer,
    domainRevisions,
    invalidateDomains,
  } = useAppContext();
  const [session, setSession] = useState(null);
  const [routine, setRoutine] = useState(null);
  const [effect, setEffect] = useState(null);
  const [, setTick] = useState(0);

  const reload = useCallback(() => {
    if (!currentPlayer?.UUID) {
      setSession(null);
      setRoutine(null);
      setEffect(null);
      return Promise.resolve();
    }
    return Promise.all([
      getActiveActionSession(databaseConnection, currentPlayer.UUID),
      getActiveRoutineRun(databaseConnection, currentPlayer.UUID),
      databaseConnection.syncRuntime?.client?.query?.({
        sql: `SELECT effect.id,effect.source_id AS sourceId,effect.ends_at AS endsAt,
                     inventory.name_snapshot AS itemName
              FROM effect_intervals effect
              LEFT JOIN effect_cancellation_receipts cancellation ON cancellation.interval_id=effect.id
              LEFT JOIN inventory_items inventory ON inventory.id=effect.source_id
              WHERE effect.player_id=? AND effect.ends_at>? AND cancellation.id IS NULL
              ORDER BY effect.ends_at LIMIT 1`,
        bind: [currentPlayer.UUID, new Date().toISOString()],
        result: 'one',
      }).catch(() => null) || Promise.resolve(null),
    ]).then(([nextSession, nextRoutine, nextEffect]) => {
      setSession(nextSession);
      setRoutine(nextRoutine);
      setEffect(nextEffect);
    });
  }, [currentPlayer?.UUID, databaseConnection]);

  useEffect(() => { void reload(); }, [
    reload,
    domainRevisions.tasks,
    domainRevisions.matches,
    domainRevisions.inventory,
    domainRevisions.eventBuffs,
  ]);
  useEffect(() => {
    const foreground = () => { if (document.visibilityState !== 'hidden') void reload(); };
    window.addEventListener('focus', foreground);
    document.addEventListener('visibilitychange', foreground);
    return () => {
      window.removeEventListener('focus', foreground);
      document.removeEventListener('visibilitychange', foreground);
    };
  }, [reload]);
  useEffect(() => {
    if ((!session || session.pausedAt) && !effect) return undefined;
    const timer = window.setInterval(() => setTick((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [effect, session]);

  if (routine) {
    const currentStep = routine.steps?.find(({ id }) => id === routine.currentStepId);
    return (
      <aside className="mobile-active-controller" aria-label="Active routine">
        <div>
          <strong>{routine.routineType === 'day' ? 'Morning routine' : 'Night routine'}</strong>
          <span>{currentStep?.label || 'Ready to finish'}</span>
        </div>
        <button type="button" className="primary" onClick={() => onOpen(routine)}>Resume</button>
      </aside>
    );
  }
  if (!session && effect) {
    return (
      <aside className="mobile-active-controller" aria-label="Active inventory effect">
        <div>
          <strong>{effect.itemName || 'Inventory effect active'}</strong>
          <span>{clock(new Date(effect.endsAt).getTime() - Date.now())} remaining</span>
        </div>
      </aside>
    );
  }
  if (!session) return null;
  const currentDeviceId = databaseConnection.syncRuntime?.device?.id || null;
  const controlledElsewhere = Boolean(
    session.controllingDeviceId
    && String(session.controllingDeviceId) !== String(currentDeviceId || ''),
  );
  const togglePause = async () => {
    if (session.pausedAt) {
      await resumeActionSession(databaseConnection, session.UUID, new Date(), { origin: 'mobile' });
    } else {
      await pauseActionSession(databaseConnection, session.UUID, new Date(), { origin: 'mobile' });
    }
    invalidateDomains(DOMAIN_INVALIDATION.taskWrite);
    await reload();
  };
  const context = session.matchUUID ? 'Match active' : session.dojoSessionUUID ? 'Dojo active' : 'Task active';
  const takeControl = async () => {
    await takeOverActionSession(databaseConnection, session.UUID, { origin: 'mobile' });
    invalidateDomains(DOMAIN_INVALIDATION.taskWrite);
    await reload();
  };
  return (
    <aside className="mobile-active-controller" aria-label="Active work session">
      <div>
        <strong>{session.targetName || 'Active task'}</strong>
        <span>{context} · {clock(actionSessionElapsed(session))}</span>
      </div>
      {controlledElsewhere ? (
        <button type="button" onClick={takeControl}>Take control</button>
      ) : (
        <button type="button" onClick={togglePause}>{session.pausedAt ? 'Resume' : 'Pause'}</button>
      )}
      <button type="button" className="primary" onClick={() => onOpen(session)}>Open</button>
    </aside>
  );
}
