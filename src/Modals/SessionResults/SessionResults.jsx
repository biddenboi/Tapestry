import './SessionResults.css'
import { useEffect, useState, useContext } from 'react'
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import TaskCreationMenu from '../TaskCreationMenu/TaskCreationMenu.jsx';
import { MINUTE } from '../../utils/Constants.js';
import { getSessionMultiplier } from '../../utils/Helpers/Tasks.js';
import { msToPoints } from '../../utils/Helpers/Time.js';
import { AppContext } from '../../App.jsx';

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
        return () => { clearTimeout(timeout); cancelAnimationFrame(raf); };
    }, [target, duration, delay]);
    return value;
}

export default NiceModal.create(({ duration, tokens, sessionDuration, showTaskCreation }) => {

    const modal = useModal();

    const sessionDurationMs = sessionDuration * MINUTE;
    const multiplier = getSessionMultiplier(duration, sessionDurationMs);
    const points = Math.floor(msToPoints(duration) * multiplier);
    const maxPoints = msToPoints(sessionDurationMs); // points at multiplier = 1
    const pointDiff = points - maxPoints;

    const ratio = sessionDurationMs > 0 ? duration / sessionDurationMs : 1;
    const percentOfEstimate = Math.round(ratio * 100);

    const animatedPoints = useCountUp(points, 1000, 300);
    const animatedTokens = useCountUp(tokens, 800, 600);
    const animatedMultiplier = useCountUp(Math.round(multiplier * 100), 900, 450);
    const [activeTask, setActiveTask] = useContext(AppContext).activeTask;

    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === "ArrowRight") {
                handleConfirm()
            }
        };
        
        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    }, [activeTask]);

    const getEfficiencyLabel = () => {
        if (ratio <= 0.75) return { label: 'Way Ahead', className: 'efficiency-great' };
        if (ratio <= 0.95) return { label: 'Ahead of Schedule', className: 'efficiency-great' };
        if (ratio <= 1.1)  return { label: 'On Target', className: 'efficiency-good' };
        if (ratio <= 1.35) return { label: 'Ran Over', className: 'efficiency-warn' };
        return { label: 'Far Over', className: 'efficiency-bad' };
    };

    const efficiency = getEfficiencyLabel();

    const handleConfirm = () => {
        modal.hide();
        modal.remove();
        if (showTaskCreation) {
            NiceModal.show(TaskCreationMenu);
        }
    };

    return modal.visible ? (
        <div className="session-results">
            <div className="blanker" />
            <div className="results-card">

                <div className="results-header">
                    <span className="results-label">Session Complete</span>
                    <h1 className="results-title">Results</h1>
                </div>

                <div className="results-duration">
                    <span className="duration-value">{formatDuration(duration)}</span>
                    <span className="duration-sub">
                        vs. {formatDuration(sessionDurationMs)} estimated &nbsp;·&nbsp;
                        <span className={efficiency.className}>{efficiency.label} ({percentOfEstimate}%)</span>
                    </span>
                </div>

                <div className="results-stats">
                    <div className="stat-block stat-points">
                        <span className="stat-value">{animatedPoints.toLocaleString()}</span>
                        <span className="stat-label">Points Earned</span>
                    </div>

                    <div className="stat-divider" />

                    <div className="stat-block stat-tokens">
                        <span className="stat-value">{animatedTokens.toLocaleString()}</span>
                        <span className="stat-label">Tokens</span>
                    </div>

                    <div className="stat-divider" />

                    <div className="stat-block stat-multiplier">
                        <span className="stat-value">{(animatedMultiplier / 100).toFixed(2)}×</span>
                        <span className="stat-label">Multiplier</span>
                    </div>
                </div>

                <div className="results-breakdown">
                    <div className="breakdown-row">
                        <span className="breakdown-key">Peak possible</span>
                        <span className="breakdown-val">{maxPoints.toLocaleString()} pts</span>
                    </div>
                    <div className="breakdown-row">
                        <span className="breakdown-key">Difference</span>
                        <span className={`breakdown-val ${pointDiff >= 0 ? 'diff-pos' : 'diff-neg'}`}>
                            {pointDiff >= 0 ? '+' : ''}{pointDiff.toLocaleString()} pts
                        </span>
                    </div>
                </div>
            </div>
        </div>
    ) : "";
});