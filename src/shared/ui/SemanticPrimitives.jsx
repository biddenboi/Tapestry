import './UI.css';

function classes(...values) {
  return values.filter(Boolean).join(' ');
}

export function Surface({ as: Tag = 'section', className = '', tone = 'neutral', children, ...props }) {
  return <Tag className={classes('ui-surface', `ui-surface--${tone}`, className)} {...props}>{children}</Tag>;
}

export function Button({ variant = 'default', className = '', children, ...props }) {
  return <button type="button" className={classes('ui-button', `ui-button--${variant}`, className)} {...props}>{children}</button>;
}

export function IconButton({ label, close = false, className = '', children, ...props }) {
  return (
    <button
      type="button"
      className={classes('ui-icon-button', close && 'ui-close-button', className)}
      aria-label={label}
      {...props}
    >
      {children}
    </button>
  );
}

export function Progress({ value = 0, max = 100, label, className = '' }) {
  const safeMax = Math.max(1, Number(max) || 100);
  const safeValue = Math.max(0, Math.min(safeMax, Number(value) || 0));
  return (
    <div className={classes('ui-progress', className)} role="progressbar" aria-label={label} aria-valuemin="0" aria-valuemax={safeMax} aria-valuenow={safeValue}>
      <i style={{ '--ui-progress-value': `${(safeValue / safeMax) * 100}%` }} />
    </div>
  );
}

export function Menu({ as: Tag = 'div', className = '', children, ...props }) {
  return <Tag className={classes('ui-menu', className)} role="menu" {...props}>{children}</Tag>;
}

export function Tooltip({ children, text }) {
  return <span className="ui-tooltip" data-tooltip={text}>{children}</span>;
}
