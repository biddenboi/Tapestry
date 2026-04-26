import '../EndDayConfirm/EndDayConfirm.css';
import './WakePopup.css';
import { useContext, useEffect, useRef, useState } from 'react';
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import { AppContext } from '../../App.jsx';
import { STORES } from '../../utils/Constants.js';
import {
  startDay,
  applyWakeTimeBuff,
  computeWakeDelta,
  computeWakeTimeMultiplier,
} from '../../utils/Helpers/Events.js';
import { getWakeDateForDate } from '../../utils/Helpers/Time.js';

const wakeKey = (uuid, dateStr) => `tapestry_wake_pending_${uuid}_${dateStr}`;
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

export default NiceModal.create(() => {
  const { databaseConnection, currentPlayer, refreshApp } = useContext(AppContext);
  const modal = useModal();
  const [submitting, setSubmitting] = useState(false);
  const [now, setNow] = useState(Date.now());
  const fireRef = useRef(false);

  // Tick the lateness counter every second.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // The moment we open, mark this wake as pending so a reload still shows us.
  useEffect(() => {
    if (!currentPlayer?.UUID) return;
    const key = wakeKey(currentPlayer.UUID, todayDateStr());
    if (localStorage.getItem(key) !== 'shown') {
      localStorage.setItem(key, 'shown');
    }
  }, [currentPlayer]);

  if (!modal.visible || !currentPlayer) return null;

  const wakeTime = currentPlayer.wakeTime || '07:00';
  const targetDate = getWakeDateForDate(wakeTime, new Date());
  const deltaMs = computeWakeDelta(wakeTime, now);
  const projectedMultiplier = computeWakeTimeMultiplier(deltaMs);

  const handleEnterDay = async () => {
    if (fireRef.current) return;
    fireRef.current = true;
    setSubmitting(true);
    try {
      const confirmedAt = Date.now();
      const player = await databaseConnection.getCurrentPlayer();
      if (!player) {
        modal.remove();
        refreshApp();
        return;
      }

      const finalDelta = computeWakeDelta(player.wakeTime || wakeTime, confirmedAt);

      // Stamp the wake-confirm timestamp on the player record FIRST so the
      // first-match calculator can read it later.
      const updatedPlayer = {
        ...player,
        wakeConfirmedAt: new Date(confirmedAt).toISOString(),
      };
      await databaseConnection.add(STORES.player, updatedPlayer);

      // Now fire the day boundary + the wake-time buff.
      await startDay(databaseConnection, updatedPlayer);
      await applyWakeTimeBuff(databaseConnection, updatedPlayer, finalDelta);

      // Clear the reload-resilience key.
      localStorage.removeItem(wakeKey(player.UUID, todayDateStr()));

      modal.remove();
      refreshApp();
    } catch (err) {
      // If anything fails, allow another attempt.
      fireRef.current = false;
      setSubmitting(false);
      console.warn('[WakePopup] enter-day failed:', err);
    }
  };

  return (
    <div className="confirm-overlay">
      <div className="blanker" />
      <div className="wake-card">
        <div className="wake-header">
          <span>WAKE PROTOCOL</span>
          <span className="wake-header-stamp">DAY START</span>
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

          <div className="wake-buff-row">
            <span className="wake-buff-label">Wake-time buff if confirmed now</span>
            <span className="wake-buff-val">{projectedMultiplier.toFixed(3)}×</span>
          </div>

          <p className="wake-note">
            Confirming records your wake delta and starts the IGT day. Your buff is locked in
            the moment you tap below.
          </p>
        </div>

        <div className="wake-footer">
          <button className="primary wake-confirm" onClick={handleEnterDay} disabled={submitting}>
            {submitting ? 'STARTING…' : 'ENTER DAY →'}
          </button>
        </div>
      </div>
    </div>
  );
});

// Static helper so other modules can construct the same key without
// re-implementing the format.
export const getWakePendingStorageKey = wakeKey;
export const getTodayDateStr = todayDateStr;