import '@shared/ui/UI.css';

export default function EntityCard({ children, color, className = '', ...props }) {
  return (
    <div
      className={`ui-entity-card ${className}`}
      style={color ? { '--entity-color': color } : undefined}
      {...props}
    >
      {children}
    </div>
  );
}
