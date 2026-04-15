import './SessionResults.css';
import { useEffect, useState, useContext } from 'react';
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import TaskCreationMenu from '../TaskCreationMenu/TaskCreationMenu.jsx';
import { MINUTE } from '../../utils/Constants.js';
import { getSessionMultiplier, getGaussianCurvePoints } from '../../utils/Helpers/Tasks.js';
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

// ── Gaussian curve SVG visualization ────────────────────
function GaussianCurve({ duration, estimatedDurationMs }) {
    const W = 440, H = 90;
    const padL = 36, padR = 12, padT = 8, padB = 24;
    const innerW = W - padL - padR;
    const innerH = H - padT - padB;

    const curvePoints = getGaussianCurvePoints(estimatedDurationMs, 300);
    const maxX = estimatedDurationMs * 2.4;

    const toSvgX = (x) => padL + (x / maxX) * innerW;
    const toSvgY = (y) => padT + innerH - y * innerH;

    const polyline = curvePoints.map(p => `${toSvgX(p.x)},${toSvgY(p.y)}`).join(' ');

    // Area fill path
    const areaPath = [
        `M ${padL} ${padT + innerH}`,
        ...curvePoints.map(p => `L ${toSvgX(p.x)} ${toSvgY(p.y)}`),
        `L ${padL + innerW} ${padT + innerH}`,
        'Z',
    ].join(' ');

    // Clamp marker to visible range
    const clampedDuration = Math.min(duration, maxX);
    const markerX = toSvgX(clampedDuration);
    const markerMultiplier = getSessionMultiplier(duration, estimatedDurationMs);
    const markerY = toSvgY(markerMultiplier);

    // Efficiency color
    const ratio = estimatedDurationMs > 0 ? duration / estimatedDurationMs : 1;
    const markerColor = ratio <= 1.1 ? 'var(--green)' : ratio <= 1.35 ? 'var(--gold)' : 'var(--red)';

    // X-axis labels (0, 0.5μ, μ, 1.5μ, 2μ)
    const xLabels = [0, 0.5, 1, 1.5, 2].map(r => ({
        x: toSvgX(r * estimatedDurationMs),
        label: r === 1 ? 'target' : `${r}×`,
    }));

    return (
        <div className="gaussian-wrap">
            <div className="gaussian-label">SESSION CURVE</div>
            <svg
                viewBox={`0 0 ${W} ${H}`}
                className="gaussian-svg"
                aria-label="Session multiplier curve"
            >
                <defs>
                    <linearGradient id="curveGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.25" />
                        <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.02" />
                    </linearGradient>
                    <clipPath id="curveClip">
                        <rect x={padL} y={padT} width={innerW} height={innerH} />
                    </clipPath>
                </defs>

                {/* Grid lines */}
                {[0.25, 0.5, 0.75, 1].map(y => (
                    <line
                        key={y}
                        x1={padL} x2={padL + innerW}
                        y1={toSvgY(y)} y2={toSvgY(y)}
                        stroke="var(--border-subtle)"
                        strokeWidth="0.5"
                        strokeDasharray="3,3"
                    />
                ))}

                {/* Estimated duration line */}
                <line
                    x1={toSvgX(estimatedDurationMs)} x2={toSvgX(estimatedDurationMs)}
                    y1={padT} y2={padT + innerH}
                    stroke="var(--accent-dim)"
                    strokeWidth="1"
                    strokeDasharray="4,3"
                />

                {/* Area fill */}
                <path d={areaPath} fill="url(#curveGrad)" clipPath="url(#curveClip)" />

                {/* Curve line */}
                <polyline
                    points={polyline}
                    fill="none"
                    stroke="var(--accent-bright)"
                    strokeWidth="1.5"
                    clipPath="url(#curveClip)"
                />

                {/* Marker vertical line */}
                <line
                    x1={markerX} x2={markerX}
                    y1={padT} y2={padT + innerH}
                    stroke={markerColor}
                    strokeWidth="1.5"
                    opacity="0.8"
                />

                {/* Marker dot */}
                <circle
                    cx={markerX}
                    cy={markerY}
                    r="4"
                    fill={markerColor}
                    stroke="var(--bg-card)"
                    strokeWidth="1.5"
                />

                {/* Multiplier annotation */}
                <text
                    x={Math.min(markerX + 6, W - 50)}
                    y={Math.max(markerY - 6, padT + 10)}
                    fill={markerColor}
                    fontSize="9"
                    fontFamily="JetBrains Mono, monospace"
                    fontWeight="600"
                >
                    {(markerMultiplier).toFixed(2)}×
                </text>

                {/* Y-axis label */}
                <text x="2" y={toSvgY(1)} fill="var(--text-dim)" fontSize="7" fontFamily="Rajdhani, sans-serif" dominantBaseline="middle">1.0</text>
                <text x="2" y={toSvgY(0.5)} fill="var(--text-dim)" fontSize="7" fontFamily="Rajdhani, sans-serif" dominantBaseline="middle">0.5</text>

                {/* X-axis labels */}
                {xLabels.map(({ x, label }) => (
                    <text
                        key={label}
                        x={x}
                        y={H - 4}
                        fill={label === 'target' ? 'var(--accent-bright)' : 'var(--text-dim)'}
                        fontSize="7.5"
                        fontFamily="Rajdhani, sans-serif"
                        fontWeight={label === 'target' ? '700' : '400'}
                        textAnchor="middle"
                    >
                        {label}
                    </text>
                ))}

                {/* Axes */}
                <line x1={padL} y1={padT + innerH} x2={padL + innerW} y2={padT + innerH}
                    stroke="var(--border)" strokeWidth="0.5" />
            </svg>
        </div>
    );
}

export default NiceModal.create(({ duration, tokens, sessionDuration, showTaskCreation }) => {
    const modal = useModal();
    const [activeTask, setActiveTask] = useContext(AppContext).activeTask;

    const sessionDurationMs = sessionDuration * MINUTE;
    const multiplier = getSessionMultiplier(duration, sessionDurationMs);
    const points = Math.floor(msToPoints(duration) * multiplier);
    const maxPoints = msToPoints(sessionDurationMs);
    const pointDiff = points - maxPoints;

    const ratio = sessionDurationMs > 0 ? duration / sessionDurationMs : 1;
    const percentOfEstimate = Math.round(ratio * 100);

    const animatedPoints = useCountUp(points, 1000, 300);
    const animatedTokens = useCountUp(tokens, 800, 600);
    const animatedMultiplier = useCountUp(Math.round(multiplier * 100), 900, 450);

    const getEfficiencyLabel = () => {
        if (ratio <= 0.75) return { label: 'Way Ahead', className: 'eff-great' };
        if (ratio <= 0.95) return { label: 'Ahead', className: 'eff-great' };
        if (ratio <= 1.1)  return { label: 'On Target', className: 'eff-good' };
        if (ratio <= 1.35) return { label: 'Ran Over', className: 'eff-warn' };
        return { label: 'Far Over', className: 'eff-bad' };
    };

    const efficiency = getEfficiencyLabel();

    const handleConfirm = () => {
        modal.hide();
        modal.remove();
        if (showTaskCreation) NiceModal.show(TaskCreationMenu);
    };

    return modal.visible ? (
        <div className="session-results">
            <div className="blanker" />
            <div className="results-card">

                <div className="results-header">
                    <span className="results-eyebrow">SESSION COMPLETE</span>
                    <h1 className="results-title">Results</h1>
                </div>

                <div className="results-duration">
                    <span className="dur-val">{formatDuration(duration)}</span>
                    <span className="dur-sub">
                        est. {formatDuration(sessionDurationMs)}&nbsp;·&nbsp;
                        <span className={efficiency.className}>
                            {efficiency.label} ({percentOfEstimate}%)
                        </span>
                    </span>
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
                    <div className="stat-sep" />
                    <div className="stat-block stat-mult">
                        <span className="stat-val">{(animatedMultiplier / 100).toFixed(2)}×</span>
                        <span className="stat-lbl">Multiplier</span>
                    </div>
                </div>

                <GaussianCurve duration={duration} estimatedDurationMs={sessionDurationMs} />

                <div className="results-breakdown">
                    <div className="bk-row">
                        <span className="bk-key">Peak possible</span>
                        <span className="bk-val">{maxPoints.toLocaleString()} pts</span>
                    </div>
                    <div className="bk-row">
                        <span className="bk-key">Difference</span>
                        <span className={`bk-val ${pointDiff >= 0 ? 'diff-pos' : 'diff-neg'}`}>
                            {pointDiff >= 0 ? '+' : ''}{pointDiff.toLocaleString()} pts
                        </span>
                    </div>
                </div>

                <button className="results-confirm primary" onClick={handleConfirm}>
                    CONTINUE →
                </button>
            </div>
        </div>
    ) : null;
});
