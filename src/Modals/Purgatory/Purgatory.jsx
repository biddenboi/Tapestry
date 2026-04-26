import '../EndDayConfirm/EndDayConfirm.css';
import './Purgatory.css';
import { useContext, useEffect, useRef } from 'react';
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import { AppContext } from '../../App.jsx';
import Timer from '../../components/Timer/Timer.jsx';
import { MINUTE } from '../../utils/Constants.js';
import { getMsUntilWakeTime } from '../../utils/Helpers/Time.js';
import WakePopup from '../WakePopup/WakePopup.jsx';

/**
 * Purgatory: the holding cell between sleep and wake. Counts down to the
 * player's set wakeTime (NOT midnight). When the timer expires, hands off
 * to WakePopup — the user must click ENTER DAY there to officially start
 * the new IGT day. Purgatory itself never calls startDay() any more.
 */
export default NiceModal.create(() => {
  const { currentPlayer, refreshApp } = useContext(AppContext);
  const modal = useModal();
  const handedOffRef = useRef(false);

  // Snapshot countdown anchors at mount so the Timer doesn't shift while open.
  const wakeTime = currentPlayer?.wakeTime || '07:00';
  const timerStartRef = useRef(Date.now());
  const timerDurationMinutesRef = useRef(getMsUntilWakeTime(wakeTime) / MINUTE);

  // Tick: when wake time has actually arrived, dismiss Purgatory and open
  // WakePopup. This is the sole bridge between "asleep" and "awake".
  useEffect(() => {
    if (!modal.visible) return undefined;
    const tick = () => {
      if (handedOffRef.current) return;
      if (getMsUntilWakeTime(wakeTime) <= 1000) {
        handedOffRef.current = true;
        modal.remove();
        NiceModal.show(WakePopup);
        refreshApp();
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [modal, refreshApp, wakeTime]);

  if (!modal.visible) return null;

  return (
    <div className="confirm-overlay">
      <div className="blanker" />
      <div className="purgatory-card">
        <div className="purgatory-header">PURGATORY</div>
        <div className="purgatory-body">
          <p className="purgatory-title">You Are in Purgatory</p>
          <p className="purgatory-sub">Rest up — the new day begins at {wakeTime}.</p>
          <Timer
            showPoints={false}
            startTime={timerStartRef.current}
            duration={timerDurationMinutesRef.current}
          />
        </div>
      </div>
    </div>
  );
});
