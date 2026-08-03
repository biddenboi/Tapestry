import '@shared/ui/UI.css';

const COLORS = {
  success: 'var(--color-success)',
  warning: 'var(--color-warning)',
  danger: 'var(--color-danger)',
  task: 'var(--color-task)',
  event: 'var(--color-event)',
  match: 'var(--color-match)',
  shop: 'var(--color-shop)',
  feed: 'var(--color-feed)',
};

export default function StatusBadge({ children, tone = 'task', color, className = '' }) {
  return (
    <span
      className={`ui-status-badge ${className}`}
      style={{ '--badge-color': color || COLORS[tone] || tone }}
    >
      {children}
    </span>
  );
}
