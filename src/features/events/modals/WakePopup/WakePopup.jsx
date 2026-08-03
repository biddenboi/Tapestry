import '@features/events/modals/EndDayConfirm/EndDayConfirm.css';
import '@features/events/modals/WakePopup/WakePopup.css';
import { useEffect, useRef, useState } from 'react';
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import { useAppContext } from '@app/hooks/useAppContext.js';
import { DOMAIN_INVALIDATION } from '@app/context/domainRevisions.js';
import {
  computeWakeDelta,
  normalizeRitualChecklist,
} from '@domain/events/Events.js';
import {
  completeDailyLifecycleLaunch,
  enterDailyLifecycle,
  getDurableWakeState,
  getWakeCompletedStorageKey as wakeCompletedKey,
  getWakePendingStorageKey as wakeKey,
  setDurableWakeState,
} from '@domain/events/DailyLifecycleService.js';
import { useInterval } from '@shared/hooks/useInterval.js';
import RitualStopwatchFlow, { RitualTimingVisual } from '@features/events/components/RitualStopwatchFlow.jsx';
import {
  completeRoutineRun,
  completeRoutineStep,
  getRoutineStepReceipts,
  localRoutineDate,
  startRoutineRun,
} from '@domain/routines/RoutineCommands.js';

const todayDateStr = (date = new Date()) => {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function formatWakeDelta(deltaMs) {
  if (Math.abs(deltaMs) < 1000) return 'on time';
  const abs = Math.abs(deltaMs);
  const totalSec = Math.floor(abs / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  const label = deltaMs < 0 ? 'early' : 'late';
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m ${label}`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, '0')}s ${label}`;
  return `${seconds}s ${label}`;
}

export default NiceModal.create(({ lifecycleFlowId = '', origin = 'desktop' }) => {
  const { databaseConnection, currentPlayer, invalidateDomains } = useAppContext();
  const modal = useModal();
  const [submitting, setSubmitting] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [checkedItems, setCheckedItems] = useState(() => new Set());
  const [routineRun, setRoutineRun] = useState(null);
  const fireRef = useRef(false);

  // Tick the lateness counter while visible; catch up immediately on return.
  useInterval(() => setNow(Date.now()), modal.visible ? 1000 : null);

  // Mark the prompt as shown for diagnostics/reload recovery. A shown prompt
  // is no longer terminal; only a completed day suppresses future wake checks.
  useEffect(() => {
    if (!currentPlayer?.UUID) return;
    let cancelled = false;
    const persistPrompt = async () => {
      const dateStr = todayDateStr();
      const state = await getDurableWakeState(
        databaseConnection,
        currentPlayer.UUID,
        dateStr,
      );
      if (cancelled) return;
      if (state === 'completed' && !lifecycleFlowId) {
        modal.remove();
        return;
      }
      if (!state) {
        await setDurableWakeState(
          databaseConnection,
          currentPlayer.UUID,
          dateStr,
          'shown',
        );
      }
    };
    persistPrompt().catch((error) => console.warn('[WakePopup] prompt state failed:', error));
    return () => { cancelled = true; };
  }, [currentPlayer, databaseConnection, lifecycleFlowId, modal]);

  useEffect(() => {
    if (!modal.visible || !currentPlayer?.UUID) return undefined;
    let cancelled = false;
    const prepareRun = async () => {
      const run = await startRoutineRun(databaseConnection, {
        playerId: currentPlayer.UUID,
        routineType: 'day',
        scheduledFor: localRoutineDate(),
        steps: normalizeRitualChecklist(currentPlayer.wakeChecklist),
        origin,
      });
      const receipts = await getRoutineStepReceipts(databaseConnection, run.id);
      if (cancelled) return;
      setRoutineRun(run);
      setCheckedItems(new Set(receipts.map(({ stepId }) => Number(String(stepId).replace('step-', '')) - 1)));
    };
    void prepareRun().catch((error) => console.warn('[WakePopup] routine resume failed:', error));
    return () => { cancelled = true; };
  }, [currentPlayer?.UUID, currentPlayer?.wakeChecklist, databaseConnection, modal.visible, origin]);

  if (!modal.visible || !currentPlayer) return null;

  const wakeTime = currentPlayer.wakeTime || '07:00';
  const checklist = normalizeRitualChecklist(currentPlayer.wakeChecklist);
  const deltaMs = computeWakeDelta(wakeTime, now);
  const getSelectedChecklistItems = (source = checkedItems) => (
    checklist.filter((_, index) => source.has(index))
  );
  const updateCheckedItems = (next) => {
    const newlyChecked = [...next].filter((index) => !checkedItems.has(index));
    setCheckedItems(next);
    if (!routineRun || !newlyChecked.length) return;
    void Promise.all(newlyChecked.map((index) => completeRoutineStep(
      databaseConnection,
      routineRun.id,
      `step-${index + 1}`,
      { origin },
    ))).then(() => startRoutineRun(databaseConnection, {
      playerId: currentPlayer.UUID,
      routineType: 'day',
      scheduledFor: routineRun.scheduledFor,
      steps: checklist,
      origin,
    })).then(setRoutineRun).catch((error) => console.warn('[WakePopup] routine step failed:', error));
  };

  const handleEnterDay = async (finalCheckedItems = checkedItems) => {
    if (fireRef.current || submitting) return;
    const dateStr = todayDateStr();
    const wakeState = await getDurableWakeState(
      databaseConnection,
      currentPlayer.UUID,
      dateStr,
    );
    if (wakeState === 'completed' && !lifecycleFlowId) {
      modal.remove();
      return;
    }

    fireRef.current = true;
    await setDurableWakeState(
      databaseConnection,
      currentPlayer.UUID,
      dateStr,
      'submitting',
    );
    setSubmitting(true);
    try {
      const confirmedAt = Date.now();
      const finalChecklistItems = getSelectedChecklistItems(finalCheckedItems);
      const result = await enterDailyLifecycle({
        databaseConnection,
        player: currentPlayer,
        confirmedAt,
        checkedItems: finalChecklistItems,
      });
      if (!result) {
        throw new Error('The selected profile could not enter the day.');
      }
      const activeRun = routineRun || await startRoutineRun(databaseConnection, {
        playerId: currentPlayer.UUID,
        routineType: 'day',
        scheduledFor: localRoutineDate(confirmedAt),
        steps: checklist,
        at: confirmedAt,
        origin,
      });
      await completeRoutineRun(databaseConnection, activeRun.id, { at: confirmedAt, origin });
      if (lifecycleFlowId) {
        await completeDailyLifecycleLaunch(databaseConnection, {
          flowId: lifecycleFlowId,
          selectedPlayerUUID: currentPlayer.UUID,
        });
      }
      void result;

      await databaseConnection.flushWrites?.();
      modal.remove();
      invalidateDomains(DOMAIN_INVALIDATION.dailyLifecycleWrite);
    } catch (err) {
      // If anything fails, allow another attempt.
      fireRef.current = false;
      await setDurableWakeState(
        databaseConnection,
        currentPlayer.UUID,
        dateStr,
        'shown',
      ).catch(() => undefined);
      setSubmitting(false);
      console.warn('[WakePopup] enter-day failed:', err);
    }
  };

  return (
    <div className="confirm-overlay">
      <div className="blanker" />
      <div className="wake-card">
        <div className="wake-header">
          <span>Wake check-in</span>
          <span className="wake-header-stamp">Day start</span>
        </div>

        <div className="wake-body">
          <p className="wake-eyebrow">Welcome back{currentPlayer?.username ? `, ${currentPlayer.username}` : ''}</p>
          <p className="wake-title">A new day is ready.</p>

          <div className="wake-grid">
            <div className="wake-grid-cell">
              <span className="wake-cell-label">Target</span>
              <span className="wake-cell-val">{wakeTime}</span>
            </div>
            <div className="wake-grid-cell">
              <span className="wake-cell-label">Now</span>
              <span className="wake-cell-val">
                {new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}
              </span>
            </div>
            <div className="wake-grid-cell wake-grid-cell--wide">
              <span className="wake-cell-label">Delta</span>
              <span className="wake-cell-val wake-cell-val--delta">{formatWakeDelta(deltaMs)}</span>
            </div>
          </div>

          <RitualTimingVisual
            label="Wake placement"
            target={wakeTime}
            deltaMs={deltaMs}
            deltaLabel={formatWakeDelta(deltaMs)}
          />

          {checklist.length > 0 && (
            <RitualStopwatchFlow
              title="Morning checklist"
              items={checklist}
              checkedItems={checkedItems}
              onCheckedItemsChange={updateCheckedItems}
              onFinish={handleEnterDay}
              now={now}
              disabled={submitting}
            />
          )}

          <div className="wake-buff-row">
            <span className="wake-buff-label">Context only</span>
            <span className="wake-buff-val">No reward multiplier</span>
          </div>

          {checklist.length === 0 && (
            <p className="wake-note">
              No morning checklist is configured. This optional check-in records timing only.
            </p>
          )}
        </div>

        {checklist.length === 0 && (
          <div className="wake-footer">
            <button className="primary wake-confirm" onClick={() => handleEnterDay()} disabled={submitting}>
              {submitting ? 'Starting...' : 'Enter day'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
});

// Static helper so other modules can construct the same key without
// re-implementing the format.
export const getWakePendingStorageKey = wakeKey;
export const getWakeCompletedStorageKey = wakeCompletedKey;
export const getTodayDateStr = todayDateStr;
