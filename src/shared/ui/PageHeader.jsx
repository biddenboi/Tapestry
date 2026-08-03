import '@shared/ui/UI.css';

export default function PageHeader({ eyebrow, title, description, actions, children, className = '' }) {
  return (
    <header className={`ui-page-header ${className}`}>
      <div className="ui-page-header__copy">
        {eyebrow && <span className="ui-page-header__eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
        {children}
      </div>
      {actions && <div className="ui-page-header__actions">{actions}</div>}
    </header>
  );
}
