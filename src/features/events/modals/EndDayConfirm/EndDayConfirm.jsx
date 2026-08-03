import '@features/events/modals/EndDayConfirm/EndDayConfirm.css';
import '@features/events/modals/WakePopup/WakePopup.css';
import { useEffect, useRef, useState } from 'react';
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import { useAppContext } from '@app/hooks/useAppContext.js';
import { DOMAIN_INVALIDATION } from '@app/context/domainRevisions.js';
import {
  computeSleepDelta,
  normalizeRitualChecklist,
} from '@domain/events/Events.js';
import {
  completeDailyLifecycle,
  getDailyLifecycleAppLaunchId,
  requireDailyLifecycleProfileSelection,
  setDurableEndOfDayState,
} from '@domain/events/DailyLifecycleService.js';
import { getAchievementByKey } from '@domain/achievements/Achievements.js';
import { useInterval } from '@shared/hooks/useInterval.js';
import RitualStopwatchFlow, { RitualTimingVisual } from '@features/events/components/RitualStopwatchFlow.jsx';
import {
  completeRoutineRun,
  completeRoutineStep,
  getRoutineStepReceipts,
  localRoutineDate,
  startRoutineRun,
} from '@domain/routines/RoutineCommands.js';

const GOODNIGHT_ANIMATION_MS = 1800;

export function requestApplicationClose(targetWindow = globalThis.window) {
  if (!targetWindow) return false;
  try {
    if (targetWindow.require) {
      const electron = targetWindow.require('electron');
      const currentWindow = electron?.remote?.getCurrentWindow?.();
      if (currentWindow?.close) {
        currentWindow.close();
        return true;
      }
    }
  } catch {
    // Continue through the host-event and browser fallbacks.
  }
  try {
    const CloseEvent = targetWindow.CustomEvent || globalThis.CustomEvent;
    if (CloseEvent) {
      targetWindow.dispatchEvent(new CloseEvent('tapestry:request-close', {
        detail: { reason: 'end-of-day-complete' },
      }));
    }
  } catch {
    // A host close bridge is optional.
  }
  try {
    targetWindow.close?.();
  } catch {
    return false;
  }
  return targetWindow.closed === true;
}

function localDateKey(value) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatSleepDelta(deltaMs) {
  const absoluteMinutes = Math.floor(Math.abs(deltaMs) / 60000);
  const hours = Math.floor(absoluteMinutes / 60);
  const minutes = absoluteMinutes % 60;
  const direction = deltaMs < 0 ? 'early' : 'late';
  if (absoluteMinutes === 0) return 'on time';
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m ${direction}`;
  return `${minutes}m ${direction}`;
}

export default NiceModal.create(({ origin = 'desktop' } = {}) => {
  const { databaseConnection, currentPlayer, invalidateDomains, notify } = useAppContext();
  const modal = useModal();
  const [checkedItems, setCheckedItems] = useState(() => new Set());
  const [routineRun, setRoutineRun] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [submitting, setSubmitting] = useState(false);
  const [completionPhase, setCompletionPhase] = useState('checklist');
  const closeTimerRef = useRef(null);

  useInterval(() => setNow(Date.now()), modal.visible ? 1000 : null);
  useEffect(() => () => {
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
  }, []);

  const checklist = normalizeRitualChecklist(currentPlayer?.sleepChecklist);
  const deltaMs = computeSleepDelta(currentPlayer?.sleepTime || '23:00', now);
  const getSelectedChecklistItems = (source = checkedItems) => (
    checklist.filter((_, index) => source.has(index))
  );

  useEffect(() => {
    if (!modal.visible || !currentPlayer?.UUID) return undefined;
    let cancelled = false;
    const prepareRun = async () => {
      const run = await startRoutineRun(databaseConnection, {
        playerId: currentPlayer.UUID,
        routineType: 'night',
        scheduledFor: localRoutineDate(),
        steps: checklist,
        origin,
      });
      const receipts = await getRoutineStepReceipts(databaseConnection, run.id);
      if (cancelled) return;
      setRoutineRun(run);
      setCheckedItems(new Set(receipts.map(({ stepId }) => Number(String(stepId).replace('step-', '')) - 1)));
    };
    void prepareRun().catch((error) => console.warn('[EndDayConfirm] routine resume failed:', error));
    return () => { cancelled = true; };
  }, [currentPlayer?.UUID, currentPlayer?.sleepChecklist, databaseConnection, modal.visible, origin]);

  const updateCheckedItems = (next) => {
    const newlyChecked = [...next].filter((index) => !checkedItems.has(index));
    setCheckedItems(next);
    if (!routineRun || !newlyChecked.length) return;
    void Promise.all(newlyChecked.map((index) => completeRoutineStep(
      databaseConnection,
      routineRun.id,
      `step-${index + 1}`,
      { origin },
    ))).catch((error) => console.warn('[EndDayConfirm] routine step failed:', error));
  };

  const close = () => {
    modal.hide();
    modal.remove();
  };

  const handleAccept = async (finalCheckedItems = checkedItems) => {
    if (!currentPlayer || submitting) return;
    setSubmitting(true);
    try {
      const endedAt = new Date().toISOString();
      const finalChecklistItems = getSelectedChecklistItems(finalCheckedItems);
      const result = await completeDailyLifecycle({
        databaseConnection,
        player: currentPlayer,
        endedAt,
        checkedItems: finalChecklistItems,
        achievementContext: {
          onEarned: (keys) => keys.forEach((key) => {
            const achievement = getAchievementByKey(key);
            if (achievement) {
              notify({ title: 'Achievement Unlocked', message: achievement.label, kind: 'success', persist: false });
            }
          }),
        },
      });
      const activeRun = routineRun || await startRoutineRun(databaseConnection, {
        playerId: currentPlayer.UUID,
        routineType: 'night',
        scheduledFor: localRoutineDate(endedAt),
        steps: checklist,
        at: endedAt,
        origin,
      });
      await completeRoutineRun(databaseConnection, activeRun.id, { at: endedAt, origin });
      const eodDateStr = localDateKey(endedAt);
      await setDurableEndOfDayState(
        databaseConnection,
        currentPlayer.UUID,
        eodDateStr,
        'shown',
      );
      await requireDailyLifecycleProfileSelection(databaseConnection, {
        sourcePlayerUUID: currentPlayer.UUID,
        endedAt,
        eodDateStr,
        sourceLaunchId: getDailyLifecycleAppLaunchId(),
      });
      await databaseConnection.flushWrites?.();
      const daySync = databaseConnection.syncRuntime?.synchronize?.({ reason: 'mobile-day-transition' });
      if (origin === 'mobile' && daySync) {
        await Promise.race([
          Promise.resolve(daySync).catch(() => undefined),
          new Promise((resolve) => window.setTimeout(resolve, 12_000)),
        ]);
      }
      void result;
      invalidateDomains(DOMAIN_INVALIDATION.dailyLifecycleWrite);
      setCompletionPhase('goodnight');
      closeTimerRef.current = window.setTimeout(() => {
        closeTimerRef.current = null;
        const closed = requestApplicationClose();
        if (!closed) setCompletionPhase('resting');
      }, GOODNIGHT_ANIMATION_MS);
    } catch (error) {
      console.warn('[EndDayConfirm] failed to end day:', error);
      setSubmitting(false);
    }
  };

  if (!modal.visible) return null;

  if (completionPhase !== 'checklist') {
    const waitingForClose = completionPhase === 'resting';
    return (
      <div className={`confirm-overlay goodnight-overlay ${waitingForClose ? 'is-resting' : 'is-completing'}`}>
        <div className="blanker" />
        <div className="goodnight-card" role="status" aria-live="polite">
          <div className="goodnight-orbit" aria-hidden="true">
            <i />
            <span>☾</span>
          </div>
          <p className="goodnight-eyebrow">Day complete</p>
          <h1>Good night{currentPlayer?.username ? `, ${currentPlayer.username}` : ''}.</h1>
          <p>
            {waitingForClose
              ? 'Tapestry is resting. Close this window when you are ready.'
              : 'Your handoff is saved. Preparing tomorrow’s profile selection…'}
          </p>
          <div className="goodnight-checks" aria-hidden="true">
            <i>✓</i><i>✓</i><i>✓</i>
          </div>
          {waitingForClose && (
            <button type="button" className="primary" onClick={() => requestApplicationClose()}>
              Close Tapestry
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="confirm-overlay">
      <div className="blanker" onClick={submitting ? undefined : close} />
      <div className="confirm-card sleep-ritual-card">
        <div className="confirm-header sleep-ritual-header">
          <span>Sleep time</span>
          <span>Night handoff</span>
        </div>
        <div className="confirm-body">
          <p className="confirm-title">Prepare the next player.</p>
          <p className="confirm-desc">
            Your timing and completed night rituals are recorded as part of the day close.
            This check-in is optional context for continuity. It does not grant Contribution,
            multiply rewards, or change your coin balance.
          </p>
          <div className="sleep-ritual-readout">
            <span>Target <b>{currentPlayer?.sleepTime || '23:00'}</b></span>
            <span>Delta <b>{formatSleepDelta(deltaMs)}</b></span>
          </div>
          <RitualTimingVisual
            label="Sleep placement"
            target={currentPlayer?.sleepTime || '23:00'}
            deltaMs={deltaMs}
            deltaLabel={formatSleepDelta(deltaMs)}
            className="ritual-timing-visual--sleep"
          />
          {checklist.length > 0 ? (
            <RitualStopwatchFlow
              title="Night checklist"
              items={checklist}
              checkedItems={checkedItems}
              onCheckedItemsChange={updateCheckedItems}
              onFinish={handleAccept}
              now={now}
              disabled={submitting}
            />
          ) : (
            <p className="wake-note">
              No night checklist is configured. You can still record the handoff, or return without penalty.
            </p>
          )}
        </div>
        <div className="confirm-footer">
          <button onClick={close}>Return</button>
          {checklist.length === 0 && (
            <button className="primary" onClick={() => handleAccept()} disabled={submitting}>
              {submitting ? 'Ending...' : 'End day'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
});
