import MetricCard from '@shared/ui/MetricCard.jsx';
import '@shared/ui/UI.css';

export default function StatStrip({ items = [], className = '' }) {
  return (
    <div className={`ui-stat-strip ${className}`} style={{ '--stat-count': Math.min(items.length || 1, 6) }}>
      {items.map((item) => <MetricCard key={item.label} {...item} />)}
    </div>
  );
}
