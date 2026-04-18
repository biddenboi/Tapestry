/**
 * Persistent kill/event feed, top-right of the arena (spec §A.4.5).
 *
 * Format per row:
 *   [actor]  [icon]  [target-or-site-label]
 *
 * Icons (Unicode, no external assets):
 *   kill     ✕
 *   attack   ⚔
 *   plant    ◉
 *   defuse   ✓
 *   explode  ◎
 *   mine     ⋈
 *   breach   ⌬
 *
 * Rows have a `createdAtWallMs` timestamp; older rows fade out and are
 * dropped from the list after FEED_LIFETIME_MS. The cap of 4 visible rows is
 * enforced by the caller (arena) via sliced state — this component renders
 * whatever it's given.
 *
 * Suppressed during a task session per spec §A.2. The caller passes
 * `suppress={true}` when the user is in a task session; the feed buffer is
 * still updated but nothing renders. (Full "While You Were Working" replay
 * at session end is A.3 — deferred.)
 */
export default function KillFeed({ entries, suppress, labels }) {
  if (suppress) return null;
  const visible = (entries || []).slice(0, 4);
  if (visible.length === 0) return null;

  return (
    <div className="breach-killfeed" aria-live="polite">
      {visible.map((e) => (
        <div
          key={e.id}
          className={`kf-row kf-${e.kind} ${e.isMyTeam === true ? 'kf-friendly' : e.isMyTeam === false ? 'kf-enemy' : ''}`}
        >
          <span className="kf-actor">{shortLabel(labels, e.actor)}</span>
          <span className={`kf-icon kf-icon-${e.kind}`}>{ICONS[e.kind] || '·'}</span>
          <span className="kf-target">
            {e.siteId ? `SITE ${e.siteId}` : shortLabel(labels, e.target) || '—'}
          </span>
          {e.clutch && <span className="kf-clutch">CLUTCH</span>}
        </div>
      ))}
    </div>
  );
}

const ICONS = Object.freeze({
  kill:    '✕',
  attack:  '⚔',
  plant:   '◉',
  defuse:  '✓',
  explode: '◎',
  mine:    '⋈',
  breach:  '⌬',
});

function shortLabel(labels, uuid) {
  if (!uuid) return '';
  const name = labels?.[uuid];
  if (!name) return uuid.slice(0, 6);
  return name.length > 12 ? `${name.slice(0, 11)}…` : name;
}
