import '@shared/ui/UI.css';

export default function MetricCard({ value, label, children, className = '' }) {
  return (
    <div className={`ui-metric-card ${className}`}>
      <strong>{value}</strong>
      <span>{label}</span>
      {children}
    </div>
  );
}
