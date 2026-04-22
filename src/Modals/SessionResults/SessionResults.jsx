import './SessionResults.css';
import { useEffect, useState } from 'react';
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import { msToPoints } from '../../utils/Helpers/Time.js';
import TaskCreationMenu from '../TaskCreationMenu/TaskCreationMenu.jsx';

function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function useCountUp(target, duration = 1200, delay = 0) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    let start = null;
    let raf;
    const timeout = setTimeout(() => {
      const step = (timestamp) => {
        if (!start) start = timestamp;
        const progress = Math.min((timestamp - start) / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        setValue(Math.floor(eased * target));
        if (progress < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    }, delay);
    return () => {
      clearTimeout(timeout);
      cancelAnimationFrame(raf);
    };
  }, [target, duration, delay]);
  return value;
}

export default NiceModal.create(({ duration, tokens, showTaskCreation }) => {
  const modal = useModal();
  const points = Math.floor(msToPoints(duration));
  const animatedPoints = useCountUp(points, 1000, 300);
  const animatedTokens = useCountUp(tokens, 800, 600);

  const handleConfirm = () => {
    modal.hide();
    modal.remove();
    if (showTaskCreation) {
      requestAnimationFrame(() => NiceModal.show(TaskCreationMenu));
    }
  };

  if (!modal.visible) return null;

  return (
    <div className="session-results">
      <div className="blanker" />
      <div className="results-card">
        <div className="results-header">
          <span className="results-eyebrow">SESSION COMPLETE</span>
          <h1 className="results-title">Results</h1>
        </div>

        <div className="results-duration">
          <span className="dur-val">{formatDuration(duration)}</span>
        </div>

        <div className="results-stats">
          <div className="stat-block stat-points">
            <span className="stat-val">{animatedPoints.toLocaleString()}</span>
            <span className="stat-lbl">Points</span>
          </div>
          <div className="stat-sep" />
          <div className="stat-block stat-tokens">
            <span className="stat-val">◈ {animatedTokens.toLocaleString()}</span>
            <span className="stat-lbl">Tokens</span>
          </div>
        </div>

        <div className="results-footer">
          <button className="primary" onClick={handleConfirm}>CONFIRM</button>
        </div>
      </div>
    </div>
  );
});
