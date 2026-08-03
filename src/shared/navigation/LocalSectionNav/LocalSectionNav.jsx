import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Icon from '@shared/icons/Icon.jsx';
import { announceSectionTraversal } from '@shared/motion/SectionTraversal.js';
import './LocalSectionNav.css';

export default function LocalSectionNav({
  items = [],
  value,
  onChange,
  label = 'Local sections',
  compact = false,
  className = '',
}) {
  const navRef = useRef(null);
  const railRef = useRef(null);
  const refs = useRef(new Map());
  const tooltipTimerRef = useRef(null);
  const [indicator, setIndicator] = useState({ left: 0, width: 0, visible: false });
  const [tooltip, setTooltip] = useState(null);
  const selectedIndex = Math.max(0, items.findIndex((item) => item.id === value));

  useEffect(() => () => {
    if (tooltipTimerRef.current) window.clearTimeout(tooltipTimerRef.current);
  }, []);

  useLayoutEffect(() => {
    const rail = railRef.current;
    const selected = items[selectedIndex];
    const target = selected ? refs.current.get(selected.id) : null;
    if (!rail || !target) return undefined;

    const update = () => setIndicator({
      left: target.offsetLeft,
      width: target.offsetWidth,
      visible: true,
    });
    update();
    const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null;
    resizeObserver?.observe(rail);
    resizeObserver?.observe(target);
    return () => resizeObserver?.disconnect();
  }, [items, selectedIndex, value]);

  const hideDescription = () => {
    if (tooltipTimerRef.current) window.clearTimeout(tooltipTimerRef.current);
    tooltipTimerRef.current = null;
    setTooltip(null);
  };

  const showDescription = (item, target) => {
    hideDescription();
    if (!(item.description || item.revealHint) || !target || !navRef.current) return;
    const targetRect = target.getBoundingClientRect();
    const navRect = navRef.current.getBoundingClientRect();
    const left = targetRect.left - navRect.left + targetRect.width / 2;
    tooltipTimerRef.current = window.setTimeout(() => {
      tooltipTimerRef.current = null;
      setTooltip({ item, left });
    }, 900);
  };

  const selectItem = (item, index) => {
    if (!item || item.id === value) return;
    onChange(item.id);
    announceSectionTraversal(navRef.current, { fromIndex: selectedIndex, toIndex: index });
  };

  const move = (event, index) => {
    let nextIndex = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (index + 1) % items.length;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (index - 1 + items.length) % items.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = items.length - 1;
    if (nextIndex == null) return;
    event.preventDefault();
    const next = items[nextIndex];
    selectItem(next, nextIndex);
    refs.current.get(next.id)?.focus();
  };

  return (
    <nav
      ref={navRef}
      className={`local-section-nav ${compact ? 'local-section-nav--compact' : ''} ${className}`}
      aria-label={label}
      data-local-section-nav
    >
      <div ref={railRef} className="local-section-nav__rail" role="tablist" aria-orientation="horizontal">
        <span
          className={`local-section-nav__indicator ${indicator.visible ? 'is-visible' : ''}`}
          style={{ '--local-indicator-x': `${indicator.left}px`, '--local-indicator-width': `${indicator.width}px` }}
          aria-hidden="true"
        />
        {items.map((item, index) => (
          <button
            key={item.id}
            ref={(node) => {
              if (node) refs.current.set(item.id, node);
              else refs.current.delete(item.id);
            }}
            id={`local-tab-${item.deepLinkKey || item.id}`}
            type="button"
            role="tab"
            aria-selected={item.id === value}
            aria-controls={`local-page-${item.deepLinkKey || item.id}`}
            tabIndex={index === selectedIndex ? 0 : -1}
            className={`local-section-nav__item ${item.silhouette ? 'is-silhouette' : ''}`}
            aria-describedby={(item.description || item.revealHint) ? `local-tab-description-${item.deepLinkKey || item.id}` : undefined}
            data-opening-trail-silhouette={item.silhouette || undefined}
            onClick={() => { hideDescription(); selectItem(item, index); }}
            onKeyDown={(event) => move(event, index)}
            onMouseEnter={(event) => showDescription(item, event.currentTarget)}
            onMouseLeave={hideDescription}
            onFocus={(event) => showDescription(item, event.currentTarget)}
            onBlur={hideDescription}
          >
            {item.icon && (
              typeof item.icon === 'string'
                ? <Icon name={item.icon} size={15} />
                : item.icon
            )}
            <span className="local-section-nav__label">{item.label}</span>
            {item.badge != null && <span className="local-section-nav__badge">{item.badge}</span>}
          </button>
        ))}
      </div>
      {items.map((item) => (item.description || item.revealHint) ? (
        <span
          key={`description-${item.id}`}
          id={`local-tab-description-${item.deepLinkKey || item.id}`}
          className="local-section-nav__sr-description"
        >
          {item.silhouette ? `${item.revealHint || 'This depth is introduced by the Opening Trail.'} You can still open it now.` : item.description}
        </span>
      ) : null)}
      {tooltip && (
        <div
          className="local-section-nav__tooltip"
          role="tooltip"
          style={{ '--local-tooltip-left': `${tooltip.left}px` }}
        >
          <strong>{tooltip.item.label}</strong>
          <span>{tooltip.item.silhouette ? `${tooltip.item.revealHint || 'This depth is introduced by the Opening Trail.'} You can still open it now.` : tooltip.item.description}</span>
        </div>
      )}
    </nav>
  );
}
