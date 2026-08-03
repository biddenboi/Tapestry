import { useEffect, useRef, useState } from 'react';
import { Icon } from '@shared/icons/Icon.jsx';

const FINISH_ANIMATION_MS = 560;
const TIMING_WINDOW_MS = 30 * 60 * 1000;

function formatStopwatch(ms = 0) {
  const totalSeconds = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function RitualTimingVisual({
  deltaMs = 0,
  label = 'Timing',
  target = 'Target',
  deltaLabel = '',
  className = '',
}) {
  const safeDelta = Number.isFinite(Number(deltaMs)) ? Number(deltaMs) : 0;
  const bounded = Math.max(-1, Math.min(1, safeDelta / TIMING_WINDOW_MS));
  const position = 50 + bounded * 42;
  const timingClass = Math.abs(safeDelta) < 60000 ? 'is-on-time' : safeDelta < 0 ? 'is-early' : 'is-late';

  return (
    <div
      className={`ritual-timing-visual ${timingClass} ${className}`.trim()}
      style={{ '--ritual-timing-position': `${position}%` }}
    >
      <div className="ritual-timing-copy">
        <span>{label}</span>
        <strong>{deltaLabel}</strong>
      </div>
      <div className="ritual-timing-track" aria-hidden="true">
        <span>Early</span>
        <b>{target}</b>
        <span>Late</span>
        <i />
      </div>
    </div>
  );
}

export default function RitualStopwatchFlow({
  title,
  items = [],
  checkedItems,
  onCheckedItemsChange,
  onFinish,
  now,
  disabled = false,
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [startedAt, setStartedAt] = useState(null);
  const [finishing, setFinishing] = useState(false);
  const timerRef = useRef(null);
  const safeItems = Array.isArray(items) ? items : [];
  const currentItem = safeItems[activeIndex] || null;
  const running = startedAt != null;
  const elapsedMs = running ? Math.max(0, Number(now || Date.now()) - startedAt) : 0;

  useEffect(() => () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
  }, []);

  useEffect(() => {
    setActiveIndex(0);
    setStartedAt(null);
    setFinishing(false);
  }, [safeItems.length]);

  useEffect(() => {
    if (running || finishing) return;
    const firstUnchecked = safeItems.findIndex((_, index) => !checkedItems.has(index));
    if (firstUnchecked >= 0 && checkedItems.has(activeIndex)) setActiveIndex(firstUnchecked);
  }, [activeIndex, checkedItems, finishing, running, safeItems]);

  const finishOrAdvance = (nextCheckedItems = checkedItems) => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (activeIndex >= safeItems.length - 1) {
      onFinish?.(nextCheckedItems);
      return;
    }
    setActiveIndex((index) => Math.min(index + 1, safeItems.length - 1));
    setStartedAt(null);
    setFinishing(false);
  };

  const start = () => {
    if (disabled || finishing || running) return;
    setStartedAt(Date.now());
  };

  const skip = () => {
    if (disabled || finishing) return;
    finishOrAdvance(checkedItems);
  };

  const check = () => {
    if (disabled || finishing || !running) return;
    const next = new Set(checkedItems);
    next.add(activeIndex);
    onCheckedItemsChange?.(next);
    setStartedAt(null);
    setFinishing(true);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      finishOrAdvance(next);
    }, FINISH_ANIMATION_MS);
  };

  if (!safeItems.length || !currentItem) return null;

  return (
    <div className={`ritual-flow ${running ? 'is-running' : ''} ${finishing ? 'is-finishing' : ''}`}>
      <div className="ritual-flow-head">
        <span>{title}</span>
        <b>{activeIndex + 1}/{safeItems.length}</b>
      </div>

      <div className="ritual-flow-stopwatch" aria-live="polite">
        <Icon name="timer" size={22} />
        <strong>{formatStopwatch(elapsedMs)}</strong>
      </div>

      <div className="ritual-flow-item">
        <span>Current item</span>
        <strong>{currentItem}</strong>
      </div>

      <div className="ritual-flow-actions">
        {running ? (
          <button
            type="button"
            className="primary ritual-flow-action ritual-flow-action--check"
            onClick={check}
            disabled={disabled || finishing}
            aria-label="Complete checklist item"
          >
            <Icon name="check" size={18} />
            <span>Check</span>
          </button>
        ) : (
          <>
            <button
              type="button"
              className="primary ritual-flow-action"
              onClick={start}
              disabled={disabled || finishing}
              aria-label="Start checklist timer"
            >
              <Icon name="play" size={18} />
              <span>Start</span>
            </button>
            <button
              type="button"
              className="ritual-flow-action"
              onClick={skip}
              disabled={disabled || finishing}
              aria-label="Skip checklist item"
            >
              <Icon name="arrowRight" size={18} />
              <span>Skip</span>
            </button>
          </>
        )}
      </div>

      <div className="ritual-flow-progress" aria-hidden="true">
        {safeItems.map((item, index) => (
          <i
            key={`${item}-${index}`}
            className={[
              index === activeIndex ? 'is-active' : '',
              checkedItems.has(index) ? 'is-checked' : '',
              index < activeIndex && !checkedItems.has(index) ? 'is-skipped' : '',
            ].filter(Boolean).join(' ')}
          />
        ))}
      </div>
    </div>
  );
}
