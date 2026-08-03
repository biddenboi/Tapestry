import '@shared/ui/UI.css';

export default function EmptyState({ icon = '·', title, description, action, className = '' }) {
  return (
    <div className={`ui-empty-state ${className}`}>
      <span className="ui-empty-state__icon" aria-hidden="true">{icon}</span>
      <strong>{title}</strong>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}
