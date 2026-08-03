import '@shared/ui/UI.css';
import useProgressiveList from '@shared/ui/useProgressiveList.js';

export default function TimelineList({ items = [], empty, className = '', renderItem }) {
  const { visibleItems, sentinelRef, hasMore } = useProgressiveList(items, 20);
  if (!items.length) return empty || null;
  return (
    <ol className={`ui-timeline ${className}`}>
      {visibleItems.map((item, index) => (
        <li
          key={item.id || item.UUID || `${item.title}-${index}`}
          className="ui-timeline__item"
          style={item.color ? { '--timeline-color': item.color } : undefined}
        >
          <time className="ui-timeline__time">{item.time}</time>
          <div className="ui-timeline__content">
            {renderItem ? renderItem(item, index) : (
              <>
                <strong>{item.title}</strong>
                {item.description && <p>{item.description}</p>}
                {item.meta && <small>{item.meta}</small>}
              </>
            )}
          </div>
        </li>
      ))}
      {hasMore && <li ref={sentinelRef} className="ui-timeline__sentinel">Loading more.</li>}
    </ol>
  );
}
