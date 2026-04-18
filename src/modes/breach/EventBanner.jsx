import { useEffect } from 'react';

/**
 * Full-width slide-in banner for breach's dramatic moments (spec §A.6).
 *
 * Variants:
 *   - 'plant'    — "BOMB PLANTED AT SITE X", red/team-accent, ~2s
 *   - 'defuse'   — "BOMB DEFUSED AT SITE X", green/team-accent, ~1.5s
 *   - 'explode'  — "SITE X TAKEN" / "SITE X LOST", 2s
 *   - 'final5'   — "FINAL 5 MINUTES · FINAL PUSH / HOLD THE LINE", ~3s
 *
 * Appending ` · CLUTCH` to the subtitle is the spec's §A.6.5 clutch
 * recognizer — the caller decides whether to set `clutch: true`.
 *
 * Props:
 *   variant, siteId?, subtitle?, clutch?, durationMs?, onDismiss?
 *   isMyTeam?    — drives the banner accent color (own-team theme vs threat red)
 *   actorLabel?  — displayed on the left edge (username or short tag)
 *
 * Auto-dismisses itself via setTimeout unless `durationMs` is 0.
 */
export default function EventBanner({
  variant,
  siteId,
  subtitle,
  actorLabel,
  clutch,
  isMyTeam,
  durationMs,
  onDismiss,
}) {
  const effectiveDuration = durationMs ?? DEFAULT_DURATIONS[variant] ?? 2000;

  useEffect(() => {
    if (!effectiveDuration) return undefined;
    const id = window.setTimeout(() => onDismiss?.(), effectiveDuration);
    return () => window.clearTimeout(id);
  }, [variant, siteId, subtitle, effectiveDuration, onDismiss]);

  const title = buildTitle(variant, siteId, isMyTeam);
  const sub = [subtitle, clutch ? 'CLUTCH' : null].filter(Boolean).join(' · ');

  return (
    <div
      className={
        'breach-event-banner'
        + ` be-${variant}`
        + (isMyTeam === true ? ' be-friendly'
           : isMyTeam === false ? ' be-enemy' : '')
        + (clutch ? ' be-clutch' : '')
      }
      role="status"
      aria-live="polite"
    >
      <div className="be-inner">
        {actorLabel && <span className="be-actor">{actorLabel}</span>}
        {siteId && <span className="be-site">{siteId}</span>}
        <span className="be-title">{title}</span>
        {sub && <span className="be-sub">{sub}</span>}
      </div>
    </div>
  );
}

const DEFAULT_DURATIONS = {
  plant: 2000,
  defuse: 1800,
  explode: 2200,
  final5: 3000,
};

function buildTitle(variant, siteId, isMyTeam) {
  switch (variant) {
    case 'plant':   return `BOMB PLANTED AT SITE ${siteId}`;
    case 'defuse':  return `BOMB DEFUSED AT SITE ${siteId}`;
    case 'explode': return isMyTeam === true ? `SITE ${siteId} TAKEN`
                        : isMyTeam === false ? `SITE ${siteId} LOST`
                        : `SITE ${siteId} EXPLODED`;
    case 'final5':  return 'FINAL 5 MINUTES';
    default:        return '';
  }
}
