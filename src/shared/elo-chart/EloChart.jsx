import '@shared/elo-chart/EloChart.css';
import { useEffect, useId, useMemo, useRef, useState } from 'react';

const DAY = 86_400_000;
const DEFAULT_SPANS = [
  ['today', 'Today'],
  ['week', 'Week'],
  ['month', 'Month'],
  ['quarter', 'Quarter'],
  ['all', 'All'],
];

const CUTOFFS = {
  week: 7 * DAY,
  '7d': 7 * DAY,
  month: 30 * DAY,
  '30d': 30 * DAY,
  quarter: 90 * DAY,
};

const COMPARISON_COLORS = ['#00d68f', '#ffb800', '#a78bfa', '#22d3ee', '#fb7185', '#60a5fa'];

function comparisonColor(profile, index) {
  if (COMPARISON_COLORS[index]) return COMPARISON_COLORS[index];
  let hash = 2166136261;
  for (const character of String(profile?.UUID || profile?.username || index)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `hsl(${Math.abs(hash) % 360} 72% 62%)`;
}

export function formatEloChartIGT(value) {
  const safe = Math.max(0, Number(value) || 0);
  const day = Math.floor(safe / DAY) + 1;
  const remainder = safe % DAY;
  const hours = Math.floor(remainder / 3_600_000);
  const minutes = Math.floor((remainder % 3_600_000) / 60_000);
  return `D${day} ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function projectEloChartSpan(data, {
  span = 'all',
  viewerIGT = Infinity,
  timeBasis = 'wall',
  wallNow = null,
} = {}) {
  const requestedBoundary = timeBasis === 'igt'
    ? Number(viewerIGT)
    : Number.isFinite(Number(wallNow)) ? Number(wallNow) : Date.now();
  const boundary = Number.isFinite(requestedBoundary) ? Math.max(0, requestedBoundary) : Infinity;
  const visible = (data || [])
    .filter((point) => Number.isFinite(Number(point?.t)) && Number.isFinite(Number(point?.elo)))
    .map((point) => ({ ...point, t: Number(point.t), elo: Number(point.elo) }))
    .filter((point) => point.t <= boundary)
    .sort((left, right) => left.t - right.t);
  if (!visible.length) return { points: [], resultCount: 0, boundary, cutoff: 0 };

  let cutoff = 0;
  if (span === 'today') {
    cutoff = timeBasis === 'igt'
      ? Math.floor(boundary / DAY) * DAY
      : boundary - DAY;
  } else if (CUTOFFS[span]) {
    cutoff = boundary - CUTOFFS[span];
  }
  cutoff = Math.max(0, cutoff);

  const inPeriod = span === 'all'
    ? visible
    : visible.filter((point) => point.t >= cutoff);
  const prior = span === 'all'
    ? null
    : visible.filter((point) => point.t < cutoff).at(-1) || null;
  let points = prior
    ? [{ ...prior, t: cutoff, baseline: true, carried: true }, ...inPeriod]
    : inPeriod;
  const explicitResults = inPeriod.filter((point) => !point.baseline);
  const resultCount = explicitResults.length || (
    !inPeriod.some((point) => point.baseline) && inPeriod.length > 1
      ? inPeriod.length - 1
      : 0
  );

  if (['week', '7d', 'month', '30d', 'quarter'].includes(span) && points.length > 2) {
    const baseline = points.find((point) => point.baseline) || null;
    const dayMap = new Map();
    for (const point of points) dayMap.set(Math.floor(point.t / DAY), point);
    points = [...dayMap.values()].sort((left, right) => left.t - right.t);
    if (baseline && !points.some((point) => point.baseline)) points.unshift(baseline);
  }

  return { points, resultCount, boundary, cutoff };
}

export default function EloChart({
  data,
  comparisonRatings = [],
  viewerIGT = Infinity,
  timeBasis = 'wall',
  spans = DEFAULT_SPANS,
  initialSpan = 'all',
  seriesLabel = 'You',
  emptyMessage = 'Play matches to build your ELO history.',
  className = '',
}) {
  const [span, setSpan] = useState(initialSpan);
  const chartFrameRef = useRef(null);
  const [chartSize, setChartSize] = useState({ width: 640, height: 230 });
  const uid = useId().replace(/:/g, '');
  const areaId = `eloGrad-${uid}`;
  const lineId = `eloLine-${uid}`;
  const projected = useMemo(() => projectEloChartSpan(data, {
    span,
    viewerIGT,
    timeBasis,
  }), [data, span, timeBasis, viewerIGT]);
  const displayData = projected.points;
  const comparisonSeries = useMemo(() => comparisonRatings
    .map((profile, index) => {
      const comparison = projectEloChartSpan(profile.eloHistory || [], {
        span,
        viewerIGT,
        timeBasis,
      });
      return {
        ...profile,
        color: comparisonColor(profile, index),
        points: comparison.points,
        resultCount: comparison.resultCount,
      };
    })
    .filter((profile) => profile.points.length >= 2 && profile.resultCount > 0), [
      comparisonRatings,
      span,
      timeBasis,
      viewerIGT,
    ]);
  const renderedPointCount = displayData.length
    + comparisonSeries.reduce((total, profile) => total + profile.points.length, 0);

  useEffect(() => {
    if (displayData.length < 2 || projected.resultCount === 0) return undefined;
    let cancelled = false;
    const updateSize = () => {
      if (cancelled || !chartFrameRef.current) return;
      const rect = chartFrameRef.current.getBoundingClientRect();
      const next = {
        width: Math.max(360, Math.round(rect.width || 640)),
        height: Math.max(180, Math.round(rect.height || 230)),
      };
      setChartSize((previous) => (
        previous.width === next.width && previous.height === next.height ? previous : next
      ));
    };
    updateSize();
    const rafId = window.requestAnimationFrame(updateSize);
    const settleTimers = [80, 260, 600].map((delay) => window.setTimeout(updateSize, delay));
    const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateSize) : null;
    if (chartFrameRef.current) resizeObserver?.observe(chartFrameRef.current);
    window.addEventListener('resize', updateSize);
    window.visualViewport?.addEventListener?.('resize', updateSize);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(rafId);
      settleTimers.forEach((timer) => window.clearTimeout(timer));
      resizeObserver?.disconnect();
      window.removeEventListener('resize', updateSize);
      window.visualViewport?.removeEventListener?.('resize', updateSize);
    };
  }, [projected.resultCount, renderedPointCount]);

  const spanTabs = (
    <div className="elo-span-tabs">
      {spans.map(([id, label]) => (
        <button
          key={id}
          type="button"
          className={`elo-span-btn ${span === id ? 'active' : ''}`}
          onClick={() => setSpan(id)}
        >
          {label}
        </button>
      ))}
    </div>
  );

  if (!data?.length) {
    return (
      <div className={`elo-chart-empty ${className}`.trim()}>
        <span className="elo-empty-icon">◈</span>
        <span>{emptyMessage}</span>
      </div>
    );
  }

  if (displayData.length < 2 || projected.resultCount === 0) {
    return (
      <div className={`elo-chart-wrap ${className}`.trim()}>
        {spanTabs}
        <div className="elo-chart-empty">
          <span className="elo-empty-icon">◈</span>
          <span>No rated competitions in this period.</span>
        </div>
      </div>
    );
  }

  const W = chartSize.width;
  const H = chartSize.height;
  const PAD = { top: 18, right: 20, bottom: 34, left: 54 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const allPoints = [displayData, ...comparisonSeries.map((profile) => profile.points)].flat();
  const elos = allPoints.map((point) => point.elo);
  const eloSpread = Math.max(Math.max(...elos) - Math.min(...elos), 100);
  const minElo = Math.max(0, Math.min(...elos) - eloSpread * 0.4);
  const maxElo = Math.max(...elos) + eloSpread * 0.4;
  const minT = Math.min(...allPoints.map((point) => point.t));
  const maxT = Math.max(...allPoints.map((point) => point.t));
  const toX = (t) => PAD.left + ((t - minT) / (maxT - minT || 1)) * plotW;
  const toY = (elo) => PAD.top + plotH - ((elo - minElo) / (maxElo - minElo || 1)) * plotH;
  const pathFor = (points) => points.map((point, index) => `${index === 0 ? 'M' : 'L'}${toX(point.t).toFixed(1)},${toY(point.elo).toFixed(1)}`).join(' ');
  const linePath = pathFor(displayData);
  const areaPath = `${linePath} L${toX(displayData.at(-1).t).toFixed(1)},${(PAD.top + plotH).toFixed(1)} L${toX(displayData[0].t).toFixed(1)},${(PAD.top + plotH).toFixed(1)} Z`;
  const yTicks = [Math.round(minElo), Math.round((minElo + maxElo) / 2), Math.round(maxElo)];
  const formatTime = (value) => timeBasis === 'igt'
    ? formatEloChartIGT(value)
    : new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  return (
    <div className={`elo-chart-wrap ${className}`.trim()}>
      {spanTabs}
      <div className="elo-series-legend" aria-label="ELO graph series">
          <span aria-label={`Current player: ${seriesLabel}`}><i className="is-current" />{seriesLabel}</span>
          {comparisonSeries.map((profile) => (
            <span key={profile.UUID}><i style={{ background: profile.color }} />{profile.username}<b>{Math.round(profile.points.at(-1).elo)}</b></span>
          ))}
      </div>
      <div className="elo-chart-frame" ref={chartFrameRef}>
        <svg viewBox={`0 0 ${W} ${H}`} className="elo-chart-svg" preserveAspectRatio="xMidYMid meet">
          <defs>
            <linearGradient id={areaId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.22" />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
            </linearGradient>
            <linearGradient id={lineId} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.4" />
              <stop offset="100%" stopColor="var(--accent-bright)" stopOpacity="1" />
            </linearGradient>
          </defs>
          {yTicks.map((tick) => (
            <line key={tick} x1={PAD.left} y1={toY(tick)} x2={W - PAD.right} y2={toY(tick)} stroke="var(--border-subtle)" strokeWidth="1" />
          ))}
          {comparisonSeries.map((profile) => {
            const comparisonPath = pathFor(profile.points);
            const comparisonArea = `${comparisonPath} L${toX(profile.points.at(-1).t).toFixed(1)},${(PAD.top + plotH).toFixed(1)} L${toX(profile.points[0].t).toFixed(1)},${(PAD.top + plotH).toFixed(1)} Z`;
            return (
              <g key={profile.UUID} className="elo-comparison-series">
                <path d={comparisonArea} fill={profile.color} opacity="0.055" />
                <path d={comparisonPath} fill="none" stroke={profile.color} strokeWidth="1.8" strokeLinejoin="round" opacity="0.92" />
                {profile.points.map((point, index) => (
                  <circle
                    key={`${profile.UUID}-${point.t}-${index}`}
                    cx={toX(point.t)}
                    cy={toY(point.elo)}
                    r={index === profile.points.length - 1 ? 3.2 : 2}
                    fill={profile.color}
                    stroke="var(--bg-void)"
                    strokeWidth="1"
                  />
                ))}
              </g>
            );
          })}
          <path d={areaPath} fill={`url(#${areaId})`} />
          <path d={linePath} fill="none" stroke={`url(#${lineId})`} strokeWidth="2" strokeLinejoin="round" />
          {displayData.map((point, index) => (
            <circle
              key={`${point.t}-${index}`}
              cx={toX(point.t)}
              cy={toY(point.elo)}
              r={index === displayData.length - 1 ? 4 : 2.5}
              fill={index === displayData.length - 1 ? 'var(--accent-bright)' : 'var(--accent)'}
              stroke={index === displayData.length - 1 ? 'var(--bg-void)' : 'none'}
              strokeWidth="1.5"
            />
          ))}
          {yTicks.map((tick) => (
            <text key={tick} x={PAD.left - 5} y={toY(tick) + 4} fontSize="9" fill="var(--text-dim)" textAnchor="end">{tick}</text>
          ))}
          {[displayData[0], displayData.at(-1)].map((point, index) => (
            <text key={`${point.t}-${index}`} x={toX(point.t)} y={H - 4} fontSize="9" fill="var(--text-dim)" textAnchor={index === 0 ? 'start' : 'end'}>
              {formatTime(point.t)}
            </text>
          ))}
        </svg>
      </div>
    </div>
  );
}
