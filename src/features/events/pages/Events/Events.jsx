import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useAppContext } from '@app/hooks/useAppContext.js';
import {
  usePanelLifecycle,
  usePanelRequestScope,
} from '@app/panel-lifecycle/PanelLifecycleContext.jsx';
import { DOMAIN_INVALIDATION } from '@app/context/domainRevisions.js';
import { STORES } from '@domain/constants.js';
import {
  completeOneTimeHabit,
  getDateKey,
  logQuantity,
  startDurationHabit,
  stopDurationHabit,
} from '@domain/events/Events.js';
import {
  loadGoalArenaData,
  loadTrackerOverview,
} from '@domain/events/EventDomainRepository.js';
import { measureDynamicModule } from '@shared/performance/startupPerf.js';
import { HabitEditor, HabitPage } from './HabitPage.jsx';
import { buildHabitPageModel } from './HabitPageModels.js';
import {
  completeCurrentRhythmOpportunity,
  ensureRhythmForTracker,
} from '@domain/events/Rhythms.js';
import LocalSectionNav from '@shared/navigation/LocalSectionNav/LocalSectionNav.jsx';
import useOpeningTrail from '@features/opening-trail/useOpeningTrail.js';
import { useLocalSectionRoute } from '@shared/navigation/LocalSectionNav/LocalSectionRouteState.js';
import '@features/events/pages/Events/Events.css';

const EVENT_LOCAL_PAGES = Object.freeze([
  { id: 'calendar', label: 'Calendar', icon: 'calendar', deepLinkKey: 'events-calendar', capability: 'events.calendar', description: 'See today’s Habit opportunities and this week’s completion pattern.' },
  { id: 'rhythms', label: 'Habits & Rhythms', icon: 'rhythm', deepLinkKey: 'events-rhythms', description: 'Create repeatable practices, choose their cadence, and log progress.' },
  { id: 'boundaries', label: 'Day Boundaries', icon: 'sun', deepLinkKey: 'events-boundaries', capability: 'events.boundaries', description: 'Set a deliberate start and handoff for each day.' },
  { id: 'reviews', label: 'Review Schedule', icon: 'history', deepLinkKey: 'events-reviews', capability: 'events.reviews', description: 'See what needs reflection and start a focused Goal review.' },
  { id: 'goals', label: 'Goals', deepLinkKey: 'events-goals', capability: 'events.goals', description: 'Connect everyday work to finite outcomes and longer-term Areas.' },
]);

const lazyGoalView = (name) => lazy(() => measureDynamicModule(
  `events-${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`,
  () => import('@features/events/pages/Events/EventsView.jsx')
    .then((module) => ({ default: module[name] })),
));

const GoalDetail = lazyGoalView('GoalDetail');
const GoalForm = lazyGoalView('GoalForm');
const GoalArenaBoard = lazyGoalView('GoalArenaBoard');
const GoalReview = lazyGoalView('GoalReview');

function Deferred({ children }) {
  return <Suspense fallback={<div className="evt-loading">Loading workspace…</div>}>{children}</Suspense>;
}

function wait(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function GoalsHeader({ onCreate, onReview }) {
  return (
    <header className="evt-world-header goals-world-header">
      <div className="goals-world-header__inner">
        <div className="goals-world-header__identity">
          <span className="goals-world-header__glyph" aria-hidden="true">◆</span>
          <div className="evt-world-heading">
            <span className="evt-world-eyebrow">Life roadmap</span>
            <h1>Goals</h1>
            <p>Track finite outcomes here. Keep ongoing responsibilities in Areas and reflective writing in Stories.</p>
          </div>
        </div>
        <div className="habit-page-actions">
          <button type="button" onClick={onReview}>Review goals</button>
          <button type="button" className="primary" onClick={onCreate}>New goal</button>
        </div>
      </div>
    </header>
  );
}

function EventCalendarPage({ model, onEdit, onOpenRhythms }) {
  return (
    <section className="event-local-page event-local-page--calendar" aria-labelledby="event-calendar-title">
      <header className="event-local-page__header">
        <div className="event-local-page__identity">
          <span className="event-local-page__glyph" aria-hidden="true">▦</span>
          <div>
            <span className="event-local-page__eyebrow">Schedule</span>
            <h1 id="event-calendar-title">Calendar</h1>
            <p>See today’s opportunities and the rhythm taking shape across the week.</p>
          </div>
        </div>
        <button type="button" onClick={onOpenRhythms}>Manage habits</button>
      </header>
      <div className="event-calendar-grid">
        <article className="event-calendar-day event-calendar-day--today">
          <div className="event-local-card__heading">
            <div>
              <strong>Today</strong>
              <p>Open a Habit to log it or adjust its rhythm.</p>
            </div>
            <b>{model.active.length} open · {model.completed.length} done</b>
          </div>
          {model.cards.map((card) => (
            <button
              key={card.id}
              type="button"
              style={{ '--event-item-accent': card.accentColor || '#4da3ff' }}
              onClick={() => onEdit(card.event)}
            >
              <i className={card.complete ? 'is-complete' : ''} aria-hidden="true">{card.complete ? '✓' : '○'}</i>
              <span>
                <strong>{card.name}</strong>
                <small>{card.rhythmLabel.replace('Rhythm · ', '')}</small>
              </span>
              <b>{card.complete ? 'Done' : 'Open'}</b>
            </button>
          ))}
          {!model.cards.length && (
            <div className="event-local-empty">
              <strong>No Habits are scheduled today.</strong>
              <button type="button" onClick={onOpenRhythms}>Create or schedule a Habit</button>
            </div>
          )}
        </article>
        <article className="event-calendar-week">
          <div className="event-local-card__heading">
            <div>
              <strong>This week</strong>
              <p>Each number is the count of Habits logged on that day.</p>
            </div>
          </div>
          <div className="event-calendar-week__days" aria-label="Seven day activity">
            {Array.from({ length: 7 }, (_, offset) => {
              const date = new Date();
              date.setDate(date.getDate() - (6 - offset));
              const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
              const count = model.cards.reduce(
                (total, card) => total + (card.series.some((point) => point.key === key && point.value > 0) ? 1 : 0),
                0,
              );
              return (
                <span
                  key={key}
                  className={`${count ? 'has-activity' : ''} ${offset === 6 ? 'is-today' : ''}`.trim()}
                  style={{ '--activity-level': Math.min(1, count / Math.max(1, model.cards.length)) }}
                >
                  <i>{date.toLocaleDateString(undefined, { weekday: 'narrow' })}</i>
                  <b>{count}</b>
                  <small>{offset === 6 ? 'Today' : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</small>
                </span>
              );
            })}
          </div>
        </article>
      </div>
    </section>
  );
}

function DayBoundariesPage({ player, records, onOpenSettings }) {
  const lifecycle = records
    .filter((record) => ['wake', 'end_work', 'sleep'].includes(record?.type))
    .slice()
    .sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')))
    .slice(0, 12);
  return (
    <section className="event-local-page event-local-page--boundaries" aria-labelledby="event-boundaries-title">
      <header className="event-local-page__header">
        <div className="event-local-page__identity">
          <span className="event-local-page__glyph" aria-hidden="true">☀</span>
          <div>
            <span className="event-local-page__eyebrow">Daily lifecycle</span>
            <h1 id="event-boundaries-title">Day Boundaries</h1>
            <p>Give the day a deliberate opening and a clean place to stop.</p>
          </div>
        </div>
        <button type="button" onClick={onOpenSettings}>Edit schedule</button>
      </header>
      <div className="event-boundary-grid">
        <article className="event-boundary-card event-boundary-card--arrival">
          <span className="event-boundary-step">01</span>
          <span className="event-boundary-symbol" aria-hidden="true">☀</span>
          <div><small>Start of day</small><h2>Arrival</h2></div>
          <strong>{player?.wakeTime || 'Not scheduled'}</strong>
          <p>{Array.isArray(player?.wakeChecklist) && player.wakeChecklist.length
            ? `${player.wakeChecklist.length} optional context prompts`
            : 'Add a short checklist to decide what matters before work begins.'}</p>
        </article>
        <article className="event-boundary-card event-boundary-card--handoff">
          <span className="event-boundary-step">02</span>
          <span className="event-boundary-symbol" aria-hidden="true">☾</span>
          <div><small>End of day</small><h2>Handoff</h2></div>
          <strong>{player?.sleepTime || 'Not scheduled'}</strong>
          <p>{Array.isArray(player?.sleepChecklist) && player.sleepChecklist.length
            ? `${player.sleepChecklist.length} optional reflection prompts`
            : 'Add reflection prompts to capture loose ends and choose tomorrow’s return point.'}</p>
        </article>
      </div>
      <div className="event-boundary-history">
        <div className="event-local-card__heading">
          <div><strong>Recent boundaries</strong><p>A simple record of when you opened or closed a day.</p></div>
        </div>
        {lifecycle.map((record) => (
          <div key={record.UUID} className={`is-${record.type}`}>
            <span className="event-boundary-history__mark" aria-hidden="true">{record.type === 'wake' ? '↑' : '↓'}</span>
            <strong>{record.type === 'end_work' ? 'Handoff' : record.type === 'wake' ? 'Arrival' : 'Sleep'}</strong>
            <time>{new Date(record.createdAt).toLocaleString()}</time>
          </div>
        ))}
        {!lifecycle.length && <p>No boundary records yet.</p>}
      </div>
    </section>
  );
}

function ReviewSchedulePage({ model, onOpenGoal, onStartReview, onOpenGoals, onOpenChronicle }) {
  const activeGoals = model?.activeGoals || [];
  const due = activeGoals.filter((card) => card.review?.due || card.reviewDue || card.goal?.reviewDue);
  return (
    <section className="event-local-page event-local-page--reviews" aria-labelledby="event-reviews-title">
      <header className="event-local-page__header">
        <div className="event-local-page__identity">
          <span className="event-local-page__glyph" aria-hidden="true">↻</span>
          <div>
            <span className="event-local-page__eyebrow">Planning rhythm</span>
            <h1 id="event-reviews-title">Review Schedule</h1>
            <p>Pause at useful intervals, notice what changed, and choose what comes next.</p>
          </div>
        </div>
        <button type="button" className="primary" disabled={!model} onClick={onStartReview}>Start Goal review</button>
      </header>
      <div className="event-review-summary">
        <article className="event-review-summary__card event-review-summary__card--goals">
          <span className="event-review-summary__icon" aria-hidden="true">✓</span>
          <span className="event-review-summary__value">{due.length}</span>
          <h2>Goal check-ins</h2>
          <p>Confirm what changed, name blockers, and choose the next move.</p>
          <button type="button" disabled={!model} onClick={onStartReview}>Review now</button>
        </article>
        <article className="event-review-summary__card event-review-summary__card--weekly">
          <span className="event-review-summary__icon" aria-hidden="true">↻</span>
          <span className="event-review-summary__value">Weekly</span>
          <h2>Planning reset</h2>
          <p>Scan the whole roadmap before deciding what deserves focus.</p>
          <button type="button" onClick={onOpenGoals}>Open Goals</button>
        </article>
        <article className="event-review-summary__card event-review-summary__card--chronicle">
          <span className="event-review-summary__icon" aria-hidden="true">≡</span>
          <span className="event-review-summary__value">Available</span>
          <h2>Chronicle revisit</h2>
          <p>Return to your own writing and surface ideas that still matter.</p>
          <button type="button" onClick={onOpenChronicle}>Open your writing</button>
        </article>
      </div>
      <div className="event-review-list">
        <div className="event-local-card__heading">
          <div>
            <strong>{due.length ? 'Due for review' : 'Active Goals'}</strong>
            <p>{due.length ? 'These Goals need a fresh status.' : 'Everything is on schedule; open any Goal for context.'}</p>
          </div>
        </div>
        {(due.length ? due : activeGoals).slice(0, 6).map((card) => (
          <button
            key={card.goal.UUID}
            type="button"
            className={card.review?.due || card.reviewDue || card.goal?.reviewDue ? 'is-due' : 'is-on-schedule'}
            style={{ '--event-item-accent': card.goal.accentColor || '#a78bfa' }}
            onClick={() => onOpenGoal(card.goal.UUID)}
          >
            <span>{card.goal.title || card.goal.name}</span>
            <small>{card.review?.due || card.reviewDue || card.goal?.reviewDue ? 'Review due' : 'On schedule'}</small>
          </button>
        ))}
        {model && !activeGoals.length && <p>No active Goal reviews.</p>}
      </div>
    </section>
  );
}

export default function Events() {
  const {
    databaseConnection,
    currentPlayer,
    domainRevisions,
    invalidateDomains,
    emitRewardEvent,
    ensureDomainLoaded,
    timestamp,
    routeIntent,
    consumeRouteIntent,
    reportLocalSubpage,
    openPanel,
  } = useAppContext();
  const { canLoad } = usePanelLifecycle();
  const beginPanelRequest = usePanelRequestScope();
  const openingTrail = useOpeningTrail();
  const eventNavItems = useMemo(() => EVENT_LOCAL_PAGES.map((item) => ({
    ...item,
    silhouette: Boolean(item.capability && !openingTrail.isRevealed(item.capability)),
    revealHint: item.capability ? `The Opening Trail introduces ${item.label} after the related rhythm or Goal milestone.` : null,
  })), [openingTrail.revealed]);
  const [trackers, setTrackers] = useState([]);
  const [allLogs, setAllLogs] = useState([]);
  const [boundaryRecords, setBoundaryRecords] = useState([]);
  const [goals, setGoals] = useState([]);
  const [arenaModel, setArenaModel] = useState(null);
  const [arenaLoading, setArenaLoading] = useState(false);
  const [arenaError, setArenaError] = useState(null);
  const [mode, setMode] = useState({ view: 'habits' });
  const [busyIds, setBusyIds] = useState(() => new Set());
  const [celebratingIds, setCelebratingIds] = useState(() => new Set());
  const [clockMs, setClockMs] = useState(() => new Date(timestamp).getTime());
  const arenaRequestRef = useRef(0);
  const timestampRef = useRef(timestamp);
  timestampRef.current = timestamp;
  const {
    activePageId: eventPageId,
    selectPage: selectEventPage,
  } = useLocalSectionRoute({
    sectionId: 'events',
    pages: EVENT_LOCAL_PAGES,
    profileUUID: currentPlayer?.UUID,
    databaseConnection,
    routeIntent: routeIntent?.panel === 'events' ? routeIntent : null,
    defaultPageId: 'calendar',
    onIntentConsumed: consumeRouteIntent,
    onPageChange: reportLocalSubpage,
  });

  const loadTrackers = useCallback(async (request = null) => {
    if (!currentPlayer?.UUID) return;
    const [overview, eventRecords] = await Promise.all([
      loadTrackerOverview(databaseConnection, currentPlayer),
      databaseConnection.getAll(STORES.event),
    ]);
    if (request && !request.isCurrent()) return;
    setTrackers(overview.trackers);
    setAllLogs(overview.logs);
    setBoundaryRecords(eventRecords.filter((record) => record.parent === currentPlayer.UUID));
  }, [currentPlayer, databaseConnection]);

  useEffect(() => {
    if (!canLoad) return undefined;
    const request = beginPanelRequest();
    loadTrackers(request)
      .catch((error) => console.warn('[Events] tracker load failed:', error))
      .finally(request.finish);
    return request.cancel;
  }, [
    beginPanelRequest,
    canLoad,
    domainRevisions.eventTrackers,
    domainRevisions.reminders,
    domainRevisions.tasks,
    loadTrackers,
  ]);

  useEffect(() => {
    const next = new Date(timestamp).getTime();
    if (Number.isFinite(next)) setClockMs(next);
  }, [timestamp]);

  const logsByEvent = useMemo(() => {
    const map = {};
    for (const log of allLogs) (map[log.eventUUID] ||= []).push(log);
    return map;
  }, [allLogs]);

  const todayKey = useMemo(() => getDateKey(new Date(clockMs)), [clockMs]);
  const habitModel = useMemo(() => buildHabitPageModel({
    events: trackers,
    logsByEvent,
    todayKey,
    nowMs: clockMs,
  }), [clockMs, logsByEvent, todayKey, trackers]);

  useEffect(() => {
    if (!canLoad || habitModel.summary.running === 0) return undefined;
    const timeout = window.setTimeout(() => setClockMs(Date.now()), 1000);
    return () => window.clearTimeout(timeout);
  }, [canLoad, clockMs, habitModel.summary.running]);

  const loadArenas = useCallback(async () => {
    if (!currentPlayer?.UUID) return null;
    const requestId = arenaRequestRef.current + 1;
    arenaRequestRef.current = requestId;
    setArenaLoading(true);
    setArenaError(null);
    try {
      await ensureDomainLoaded(['goals', 'competitiveArenas', 'profiles']);
      const data = await loadGoalArenaData(databaseConnection, currentPlayer);
      if (arenaRequestRef.current !== requestId) return null;
      setGoals([
        ...data.activeGoals,
        ...data.pausedGoals,
        ...data.completedGoals,
      ].map((card) => card.goal));
      setArenaModel(data);
      return data;
    } catch (error) {
      if (arenaRequestRef.current === requestId) setArenaError(error);
      throw error;
    } finally {
      if (arenaRequestRef.current === requestId) setArenaLoading(false);
    }
  }, [currentPlayer, databaseConnection, ensureDomainLoaded]);

  const goalMode = ['reviews', 'goals'].includes(eventPageId) || mode.view === 'goals' || mode.view.startsWith('goal-');
  useEffect(() => {
    if (!canLoad || !goalMode) return undefined;
    let cancelled = false;
    loadArenas().catch((error) => {
      if (!cancelled) console.warn('[Events] goal load failed:', error);
    });
    return () => {
      cancelled = true;
      arenaRequestRef.current += 1;
    };
  }, [canLoad, domainRevisions.goals, domainRevisions.competitiveArenas, goalMode, loadArenas]);

  const refreshArenas = useCallback(async () => {
    invalidateDomains(DOMAIN_INVALIDATION.goalWrite);
    return loadArenas();
  }, [invalidateDomains, loadArenas]);

  const markBusy = (id, busy) => setBusyIds((current) => {
    const next = new Set(current);
    if (busy) next.add(id); else next.delete(id);
    return next;
  });

  const celebrate = async (id) => {
    setCelebratingIds((current) => new Set(current).add(id));
    await wait(360);
  };

  const finishCelebration = (id) => {
    window.setTimeout(() => setCelebratingIds((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    }), 800);
  };

  const runTrackerAction = useCallback(async (card, action, completesToday = false, rewardEntries = null) => {
    if (!card || busyIds.has(card.id)) return;
    markBusy(card.id, true);
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
      }
      const rewards = rewardEntries?.(result);
      if (rewards?.length) emitRewardEvent?.(rewards, { source: card.type });
      if (completesToday) await celebrate(card.id);
      invalidateDomains(DOMAIN_INVALIDATION.eventAnalyticsWrite);
      await loadTrackers();
      if (completesToday) finishCelebration(card.id);
    } finally {
      markBusy(card.id, false);
    }
  }, [busyIds, currentPlayer, databaseConnection, emitRewardEvent, invalidateDomains, loadTrackers]);

  const completeOneTime = (card) => runTrackerAction(
    card,
    () => completeOneTimeHabit(databaseConnection, currentPlayer, card.event),
    true,
    (result) => [
      { label: 'Habit complete', kind: 'event' },
      result.contribution ? { amount: result.contribution.value, unit: 'contribution', kind: 'contribution' } : null,
    ].filter(Boolean),
  );

  const addQuantity = (card, amount) => runTrackerAction(
    card,
    () => logQuantity(databaseConnection, currentPlayer, card.event, amount),
    card.todayTotal + amount >= card.target,
    (result) => [
      { label: `+${amount.toLocaleString()} ${card.unit}`, kind: 'event' },
      result.contribution ? { amount: result.contribution.value, unit: 'contribution', kind: 'contribution' } : null,
    ].filter(Boolean),
  );

  const toggleDuration = (card) => runTrackerAction(
    card,
    () => card.isRunning
      ? stopDurationHabit(databaseConnection, currentPlayer, card.event)
      : startDurationHabit(databaseConnection, currentPlayer, card.event),
    card.isRunning && card.todayTotal >= card.target,
    (result) => result.contribution ? [
      { label: 'Duration logged', kind: 'event' },
      { amount: result.contribution.value, unit: 'contribution', kind: 'contribution' },
    ] : null,
  );

  const saveTracker = async (record) => {
    await databaseConnection.add(STORES.customEvent, record);
    await ensureRhythmForTracker(databaseConnection, currentPlayer, record);
    invalidateDomains(DOMAIN_INVALIDATION.eventDefinitionWrite);
    await loadTrackers();
    setMode({ view: 'habits' });
  };

  const deleteTracker = async (tracker) => {
    const [eventLogs, eventBuffs] = await Promise.all([
      databaseConnection.getEventLogsForEvent(tracker.UUID),
      databaseConnection.getAll(STORES.eventBuff),
    ]);
    for (const log of eventLogs) await databaseConnection.remove(STORES.eventLog, log.UUID);
    for (const buff of eventBuffs.filter((entry) => entry.eventUUID === tracker.UUID)) {
      await databaseConnection.remove(STORES.eventBuff, buff.UUID);
    }
    await databaseConnection.remove(STORES.customEvent, tracker.UUID);
    invalidateDomains(DOMAIN_INVALIDATION.eventDefinitionWrite);
    await loadTrackers();
    setMode({ view: 'habits' });
  };

  const closeEditor = () => {
    if (mode.view === 'goal-edit') setMode({ view: 'goal-detail', uuid: mode.uuid });
    else setMode({ view: mode.view.startsWith('goal-') ? 'goals' : 'habits' });
  };

  let editorOverlay = null;
  if (mode.view === 'habit-create' || mode.view === 'habit-edit') {
    const tracker = mode.view === 'habit-edit' ? trackers.find((entry) => entry.UUID === mode.uuid) : null;
    editorOverlay = (
      <HabitEditor
        tracker={tracker}
        logs={tracker ? logsByEvent[tracker.UUID] || [] : []}
        currentPlayer={currentPlayer}
        onCancel={() => setMode({ view: 'habits' })}
        onSave={saveTracker}
        onDelete={deleteTracker}
      />
    );
  }

  if (mode.view === 'goal-create' || mode.view === 'goal-edit') {
    editorOverlay = (
      <Deferred>
        <GoalForm
          goal={mode.view === 'goal-edit' ? goals.find((entry) => entry.UUID === mode.uuid) : null}
          databaseConnection={databaseConnection}
          currentPlayer={currentPlayer}
          onCancel={closeEditor}
          onSave={async (goalUUID) => {
            await refreshArenas();
            setMode({ view: 'goal-detail', uuid: goalUUID });
          }}
        />
      </Deferred>
    );
  }

  if (mode.view === 'goal-detail') {
    const goal = goals.find((entry) => entry.UUID === mode.uuid);
    if (!goal) return <div className="evt-loading">Loading goal…</div>;
    return (
      <Deferred>
        <GoalDetail
          goal={goal}
          currentPlayer={currentPlayer}
          databaseConnection={databaseConnection}
          onBack={() => setMode({ view: 'goals' })}
          onEdit={() => setMode({ view: 'goal-edit', uuid: goal.UUID })}
          onChanged={refreshArenas}
        />
      </Deferred>
    );
  }

  if (mode.view === 'goal-review') {
    if (!arenaModel) return <div className="evt-loading">Loading Goal review…</div>;
    return (
      <Deferred>
        <GoalReview
          model={arenaModel}
          databaseConnection={databaseConnection}
          currentPlayer={currentPlayer}
          onOpen={(goalUUID) => setMode({ view: 'goal-detail', uuid: goalUUID })}
          onDone={() => setMode({ view: 'goals' })}
          onChanged={refreshArenas}
        />
      </Deferred>
    );
  }

  const goalCollection = (
    <div className="goals-collection-page">
      <GoalsHeader
        onCreate={() => setMode({ view: 'goal-create' })}
        onReview={() => setMode({ view: 'goal-review' })}
      />
      {!arenaModel ? (
        arenaError ? (
          <div className="evt-loading evt-loading--error" role="alert">
            <strong>Goals could not load.</strong>
            <span>{String(arenaError?.message || arenaError)}</span>
            <button type="button" disabled={arenaLoading} onClick={() => loadArenas().catch(() => {})}>
              {arenaLoading ? 'Retrying…' : 'Retry'}
            </button>
          </div>
        ) : <div className="evt-loading">Loading goals…</div>
      ) : (
        <Deferred>
          <GoalArenaBoard
            model={arenaModel}
            databaseConnection={databaseConnection}
            currentPlayer={currentPlayer}
            onOpen={(goalUUID) => setMode({ view: 'goal-detail', uuid: goalUUID })}
            onCreate={() => setMode({ view: 'goal-create' })}
            onReview={() => setMode({ view: 'goal-review' })}
            onRefresh={refreshArenas}
          />
        </Deferred>
      )}
    </div>
  );

  const rhythmsPage = (
    <HabitPage
      model={habitModel}
      onCreate={() => setMode({ view: 'habit-create' })}
      onOpenGoals={() => {
        selectEventPage('goals');
        setMode({ view: 'habits' });
      }}
      onEdit={(tracker) => setMode({ view: 'habit-edit', uuid: tracker.UUID })}
      onComplete={completeOneTime}
      onLogQuantity={addQuantity}
      onToggleDuration={toggleDuration}
      busyIds={busyIds}
      celebratingIds={celebratingIds}
    />
  );
  let page = rhythmsPage;
  if (mode.view === 'goals' || eventPageId === 'goals') page = goalCollection;
  else if (eventPageId === 'calendar') {
    page = (
      <EventCalendarPage
        model={habitModel}
        onEdit={(tracker) => setMode({ view: 'habit-edit', uuid: tracker.UUID })}
        onOpenRhythms={() => selectEventPage('rhythms')}
      />
    );
  } else if (eventPageId === 'boundaries') {
    page = <DayBoundariesPage player={currentPlayer} records={boundaryRecords} onOpenSettings={() => openPanel('settings')} />;
  } else if (eventPageId === 'reviews') {
    page = (
      <ReviewSchedulePage
        model={arenaModel}
        onOpenGoal={(goalUUID) => setMode({ view: 'goal-detail', uuid: goalUUID })}
        onStartReview={() => setMode({ view: 'goal-review' })}
        onOpenGoals={() => selectEventPage('goals')}
        onOpenChronicle={() => openPanel('feed')}
      />
    );
  }

  return (
    <>
      <div className={editorOverlay ? 'evt-page evt-page--backgrounded' : 'evt-page'}>
        <LocalSectionNav
          items={eventNavItems}
          value={eventPageId}
          onChange={(nextPage) => {
            selectEventPage(nextPage);
            setMode({ view: 'habits' });
          }}
          label="Events sections"
        />
        {page}
      </div>
      {editorOverlay && (
        <div className="evt-editor-layer" onMouseDown={closeEditor}>
          <div className="evt-editor-capsule" onMouseDown={(event) => event.stopPropagation()}>{editorOverlay}</div>
        </div>
      )}
    </>
  );
}
