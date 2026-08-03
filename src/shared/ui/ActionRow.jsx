import '@shared/ui/UI.css';

export default function ActionRow({ children, className = '' }) {
  return <div className={`ui-action-row ${className}`}>{children}</div>;
}
