import '@shared/ui/UI.css';

export default function Toolbar({ start, end, children, className = '' }) {
  return (
    <div className={`ui-toolbar ${className}`}>
      <div className="ui-toolbar__group">{start || children}</div>
      {end && <div className="ui-toolbar__group">{end}</div>}
    </div>
  );
}
