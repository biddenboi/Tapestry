import '@shared/ui/UI.css';
import { useRef } from 'react';
import { announceSectionTraversal } from '@shared/motion/SectionTraversal.js';

export default function SectionTabs({ items, value, onChange, label = 'Sections', className = '' }) {
  const tabsRef = useRef(null);
  const selectedIndex = Math.max(0, items.findIndex((item) => (item.id ?? item.value) === value));
  const selectItem = (id, index) => {
    if (id === value) return;
    onChange(id);
    announceSectionTraversal(tabsRef.current, { fromIndex: selectedIndex, toIndex: index });
  };
  return (
    <div ref={tabsRef} className={`ui-section-tabs ${className}`} role="tablist" aria-label={label}>
      {items.map((item, index) => {
        const id = item.id ?? item.value;
        return (
          <button
            key={id}
            type="button"
            className="ui-section-tab"
            role="tab"
            aria-selected={value === id}
            onClick={() => selectItem(id, index)}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
