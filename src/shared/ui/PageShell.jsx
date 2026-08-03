import '@shared/ui/UI.css';

export default function PageShell({ children, accent, className = '', style, ...props }) {
  return (
    <div
      className={`ui-page-shell ${className}`}
      style={{ ...(accent ? { '--page-accent': accent } : {}), ...style }}
      {...props}
    >
      <div className="ui-page-shell__inner">{children}</div>
    </div>
  );
}
