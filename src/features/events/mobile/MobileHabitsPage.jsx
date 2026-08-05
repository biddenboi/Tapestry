import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppContext } from '@app/hooks/useAppContext.js';
import { DOMAIN_INVALIDATION } from '@app/context/domainRevisions.js';
import { STORES } from '@domain/constants.js';
import {
  completeOneTimeHabit,
  getDateKey,
  logQuantity,
  startDurationHabit,
  stopDurationHabit,
} from '@domain/events/Events.js';
import { loadTrackerOverview } from '@domain/events/EventDomainRepository.js';
import {
  completeCurrentRhythmOpportunity,
  ensureRhythmForTracker,
} from '@domain/events/Rhythms.js';
import { HabitEditor, HabitPage } from '@features/events/pages/Events/HabitPage.jsx';
import { buildHabitPageModel } from '@features/events/pages/Events/HabitPageModels.js';
import MobileGoalsPage from '@features/goals/mobile/MobileGoalsPage.jsx';
import '@features/events/pages/Events/styles/Habits.page.css';

function goalsRouteActive() {
  return typeof window !== 'undefined' && /^#\/m\/goals(?:\/|$)/.test(window.location.hash);
}

function changeMobileRoute(route, { replace = false } = {}) {
  if (typeof window === 'undefined') return;
  window.history[replace ? 'replaceState' : 'pushState'](
    { tapestryMobileTab: 'habits' },
    '',
    `${window.location.pathname}${window.location.search}#/m/${route}`,
  );
  window.dispatchEvent(new CustomEvent('tapestry:mobile-route-change', {
    detail: { route, tab: 'habits' },
  }));
}

export default function MobileHabitsPage() {
  const {
    databaseConnection,
    currentPlayer,
    domainRevisions,
    ensureDomainLoaded,
    invalidateDomains,
  } = useAppContext();
  const [trackers, setTrackers] = useState([]);
  const [logs, setLogs] = useState([]);
  const [clockMs, setClockMs] = useState(Date.now());
  const [editor, setEditor] = useState(null);
  const [busyIds, setBusyIds] = useState(() => new Set());
  const [celebratingIds, setCelebratingIds] = useState(() => new Set());
  const [showGoals, setShowGoals] = useState(goalsRouteActive);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!currentPlayer?.UUID) return;
    setLoading(true);
    setError('');
    try {
      await ensureDomainLoaded?.(['eventTrackers', 'eventAnalytics']);
      const overview = await loadTrackerOverview(databaseConnection, currentPlayer);
      setTrackers(overview.trackers);
      setLogs(overview.logs);
      setClockMs(Date.now());
    } catch (loadError) {
      setError(loadError?.message || 'Events could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [currentPlayer, databaseConnection, ensureDomainLoaded]);

  useEffect(() => {
    void load();
  }, [domainRevisions.eventAnalytics, domainRevisions.eventTrackers, load]);

  useEffect(() => {
    const onPopState = () => setShowGoals(goalsRouteActive());
    window.addEventListener('popstate', onPopState);
    window.addEventListener('tapestry:mobile-route-change', onPopState);
    return () => {
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('tapestry:mobile-route-change', onPopState);
    };
  }, []);

  const logsByEvent = useMemo(() => {
    const grouped = {};
    for (const log of logs) (grouped[log.eventUUID] ||= []).push(log);
    return grouped;
  }, [logs]);
  const model = useMemo(() => buildHabitPageModel({
    events: trackers,
    logsByEvent,
    todayKey: getDateKey(new Date(clockMs)),
    nowMs: clockMs,
  }), [clockMs, logsByEvent, trackers]);

  useEffect(() => {
    if (!model.summary.running) return undefined;
    const timer = window.setTimeout(() => setClockMs(Date.now()), 1000);
    return () => window.clearTimeout(timer);
  }, [clockMs, model.summary.running]);

  const markBusy = (id, busy) => setBusyIds((current) => {
    const next = new Set(current);
    if (busy) next.add(id); else next.delete(id);
    return next;
  });

  const celebrate = (id) => {
    setCelebratingIds((current) => new Set(current).add(id));
    window.setTimeout(() => setCelebratingIds((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    }), 900);
  };

  const runAction = async (card, action, completesToday = false) => {
    if (!card || busyIds.has(card.id)) return;
    markBusy(card.id, true);
    setError('');
    try {
      const result = await action();
      if (!result) return;
      if (completesToday) {
        await completeCurrentRhythmOpportunity(
          databaseConnection,
          currentPlayer,
          card.event,
          result.log?.UUID || result.UUID || `habit-evidence:${card.id}:${Date.now()}`,
        );
        celebrate(card.id);
      }
      invalidateDomains(DOMAIN_INVALIDATION.eventAnalyticsWrite);
      databaseConnection.syncRuntime?.scheduleSync?.('mobile-habit-action');
      await load();
    } catch (actionError) {
      setError(actionError?.message || 'That Event update could not be saved.');
    } finally {
      markBusy(card.id, false);
    }
  };

  const saveTracker = async (record) => {
    await databaseConnection.add(STORES.customEvent, record);
    await ensureRhythmForTracker(databaseConnection, currentPlayer, record);
    invalidateDomains(DOMAIN_INVALIDATION.eventDefinitionWrite);
    databaseConnection.syncRuntime?.scheduleSync?.('mobile-habit-saved');
    setEditor(null);
    await load();
  };

  const deleteTracker = async (tracker) => {
    const [eventLogs, eventBuffs] = await Promise.all([
      databaseConnection.getEventLogsForEvent(tracker.UUID),
      databaseConnection.getAll(STORES.eventBuff),
    ]);
    for (const log of eventLogs) {
      // eslint-disable-next-line no-await-in-loop
      await databaseConnection.remove(STORES.eventLog, log.UUID);
    }
    for (const buff of eventBuffs.filter((entry) => entry.eventUUID === tracker.UUID)) {
      // eslint-disable-next-line no-await-in-loop
      await databaseConnection.remove(STORES.eventBuff, buff.UUID);
    }
    await databaseConnection.remove(STORES.customEvent, tracker.UUID);
    invalidateDomains(DOMAIN_INVALIDATION.eventDefinitionWrite);
    databaseConnection.syncRuntime?.scheduleSync?.('mobile-habit-deleted');
    setEditor(null);
    await load();
  };

  const openGoals = () => {
    setShowGoals(true);
    changeMobileRoute('goals');
  };
  const closeGoals = () => {
    setShowGoals(false);
    changeMobileRoute('habits', { replace: true });
  };

  if (showGoals) {
    return <MobileGoalsPage onBackToHabits={closeGoals} />;
  }

  const editingTracker = editor?.UUID
    ? trackers.find((tracker) => tracker.UUID === editor.UUID) || editor
    : null;

  return (
    <section className="mobile-habits-page">
      <HabitPage
        model={model}
        onCreate={() => setEditor({ mode: 'create' })}
        onOpenGoals={openGoals}
        onEdit={(tracker) => setEditor(tracker)}
        onComplete={(card) => runAction(
          card,
          () => completeOneTimeHabit(databaseConnection, currentPlayer, card.event),
          true,
        )}
        onLogQuantity={(card, amount) => runAction(
          card,
          () => logQuantity(databaseConnection, currentPlayer, card.event, amount),
          card.todayTotal + amount >= card.target,
        )}
        onToggleDuration={(card) => runAction(
          card,
          () => card.isRunning
            ? stopDurationHabit(databaseConnection, currentPlayer, card.event)
            : startDurationHabit(databaseConnection, currentPlayer, card.event),
          card.isRunning && card.todayTotal >= card.target,
        )}
        busyIds={busyIds}
        celebratingIds={celebratingIds}
      />
      {loading && !model.cards.length && <div className="mobile-feature-loading mobile-habit-loading">Loading Events…</div>}
      {error && <div className="mobile-page-error mobile-habit-error" role="alert">{error}</div>}
      {editor && (
        <div className="mobile-habit-editor-layer">
          <HabitEditor
            tracker={editingTracker}
            logs={editingTracker ? logsByEvent[editingTracker.UUID] || [] : []}
            currentPlayer={currentPlayer}
            onCancel={() => setEditor(null)}
            onSave={saveTracker}
            onDelete={deleteTracker}
          />
        </div>
      )}
    </section>
  );
}
