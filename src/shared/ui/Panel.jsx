import '@shared/ui/UI.css';

export function PanelHeader({ eyebrow, title, description, actions, className = '' }) {
  return (
    <header className={`ui-panel-header ${className}`}>
      <div>
        {eyebrow && <span className="ui-panel-header__eyebrow">{eyebrow}</span>}
        <h3>{title}</h3>
        {description && <p>{description}</p>}
      </div>
      {actions}
    </header>
  );
}

export default function Panel({ children, accent, variant = 'raised', className = '', ...props }) {
  return (
    <section
      className={`ui-panel ui-panel--${variant} ${className}`}
      style={accent ? { '--panel-accent': accent } : undefined}
      {...props}
    >
      {children}
    </section>
  );
}
