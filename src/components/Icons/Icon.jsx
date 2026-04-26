/**
 * Icon — custom SVG icons for Tapestry nav and UI.
 * Usage: <Icon name="hub" size={20} color="currentColor" />
 *
 * Names: hub, tasks, chat, feed, shop, inventory, journal, profile,
 *        settings, notes, inbox, timer, bell, check, add, close, trophy, events
 */

const PATHS = {
  hub: (
    <>
      <polygon points="10,1 17.5,5.5 17.5,14.5 10,19 2.5,14.5 2.5,5.5" />
      <circle cx="10" cy="10" r="2.5" fill="currentColor" opacity="0.7" stroke="none" />
      <line x1="10" y1="4.5" x2="10" y2="7.5" />
      <line x1="15" y1="7.4" x2="12.4" y2="8.8" />
      <line x1="15" y1="12.6" x2="12.4" y2="11.2" />
      <line x1="10" y1="15.5" x2="10" y2="12.5" />
      <line x1="5" y1="12.6" x2="7.6" y2="11.2" />
      <line x1="5" y1="7.4" x2="7.6" y2="8.8" />
    </>
  ),
  tasks: (
    <>
      <path d="M2 2 L14 2 L18 6 L18 18 L2 18 Z" />
      <polyline points="14,2 14,6 18,6" strokeWidth="1" />
      <polyline points="5,8 6.5,9.5 9,7" strokeWidth="1.5" />
      <line x1="11" y1="8" x2="16" y2="8" />
      <line x1="5" y1="12" x2="16" y2="12" />
      <line x1="5" y1="15.5" x2="13" y2="15.5" />
    </>
  ),
  chat: (
    <>
      <path d="M2 2 L18 2 L18 13 L8 13 L5 18 L5 13 L2 13 Z" />
      <circle cx="6.5" cy="7.5" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="10" cy="7.5" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="13.5" cy="7.5" r="1.1" fill="currentColor" stroke="none" />
    </>
  ),
  feed: (
    <>
      <rect x="2" y="3" width="2.5" height="14" fill="currentColor" opacity="0.4" stroke="none" />
      <line x1="7" y1="5" x2="18" y2="5" />
      <line x1="7" y1="8.5" x2="15" y2="8.5" />
      <line x1="7" y1="12" x2="18" y2="12" />
      <line x1="7" y1="15.5" x2="13" y2="15.5" />
    </>
  ),
  shop: (
    <>
      <polygon points="10,1.5 17,5.75 17,14.25 10,18.5 3,14.25 3,5.75" />
      <line x1="10" y1="1.5" x2="10" y2="10" />
      <line x1="3" y1="5.75" x2="10" y2="10" />
      <line x1="17" y1="5.75" x2="10" y2="10" />
      <line x1="10" y1="10" x2="3" y2="14.25" strokeWidth="0.8" opacity="0.5" />
      <line x1="10" y1="10" x2="17" y2="14.25" strokeWidth="0.8" opacity="0.5" />
      <line x1="10" y1="10" x2="10" y2="18.5" strokeWidth="0.8" opacity="0.5" />
    </>
  ),
  inventory: (
    <>
      <path d="M2 5 L14 5 L18 9 L18 18 L2 18 Z" />
      <polyline points="14,5 14,9 18,9" strokeWidth="1" />
      <line x1="10" y1="5" x2="10" y2="18" />
      <line x1="2" y1="11.5" x2="18" y2="11.5" />
      <rect x="7" y="2" width="6" height="3" />
    </>
  ),
  journal: (
    <>
      <path d="M2 2 L10 2 L10 18 L2 18 Z" />
      <path d="M10 2 L18 2 L18 18 L10 18 Z" />
      <line x1="10" y1="2" x2="10" y2="18" strokeWidth="2" />
      <line x1="4" y1="6" x2="8" y2="6" />
      <line x1="4" y1="9" x2="8" y2="9" />
      <line x1="4" y1="12" x2="8" y2="12" />
      <path d="M12 16 L15 7 L17 9 L14 17 Z" fill="currentColor" opacity="0.5" />
      <line x1="15" y1="7" x2="16" y2="6" strokeWidth="1.6" />
    </>
  ),
  profile: (
    <>
      <polygon points="10,1.5 13.5,4 13.5,8.5 10,11 6.5,8.5 6.5,4" />
      <path d="M4 18 L4 14.5 L7 12 L13 12 L16 14.5 L16 18" />
      <line x1="4" y1="18" x2="16" y2="18" />
    </>
  ),
  settings: (
    <>
      <circle cx="10" cy="10" r="2.8" />
      <path d="M10 1.5 L11.2 4 L10 4.8 L8.8 4 Z" fill="currentColor" opacity="0.6" />
      <path d="M15.6 3.9 L14.8 6.5 L13.6 6 L13.5 4.7 Z" fill="currentColor" opacity="0.6" />
      <path d="M18.5 9 L16 10 L15.2 9 L16 7.8 Z" fill="currentColor" opacity="0.6" />
      <path d="M16.1 14.4 L13.5 13.4 L14 12.2 L15.3 12.2 Z" fill="currentColor" opacity="0.6" />
      <path d="M10 18.5 L8.8 16 L10 15.2 L11.2 16 Z" fill="currentColor" opacity="0.6" />
      <path d="M4.4 16.1 L5.2 13.5 L6.4 14 L6.5 15.3 Z" fill="currentColor" opacity="0.6" />
      <path d="M1.5 11 L4 10 L4.8 11 L4 12.2 Z" fill="currentColor" opacity="0.6" />
      <path d="M3.9 4.4 L6.5 5.4 L6 6.6 L4.7 6.5 Z" fill="currentColor" opacity="0.6" />
    </>
  ),
  notes: (
    <>
      <path d="M5 15 L12 4 L16 6 L9 17 Z" />
      <path d="M5 15 L3 17 L5 17 L5 15" fill="currentColor" opacity="0.5" stroke="none" />
      <line x1="11" y1="5.5" x2="15" y2="7.5" />
      <line x1="13" y1="3.5" x2="16.5" y2="5.5" strokeWidth="2.2" />
    </>
  ),
  inbox: (
    <>
      <path d="M2 5 L16 5 L18 7 L18 17 L2 17 Z" />
      <polyline points="16,5 16,7 18,7" strokeWidth="1" />
      <polyline points="2,5 10,12 18,5" />
    </>
  ),
  timer: (
    <>
      <circle cx="10" cy="11" r="7.5" />
      <line x1="10" y1="11" x2="10" y2="7" />
      <line x1="10" y1="11" x2="13.5" y2="13" />
      <line x1="8" y1="2" x2="12" y2="2" />
      <line x1="10" y1="2" x2="10" y2="3.5" />
    </>
  ),
  bell: (
    <>
      <path d="M10 2 C6 2 5 5 5 8 L5 13 L3 15 L17 15 L15 13 L15 8 C15 5 14 2 10 2 Z" />
      <path d="M8 15 C8 16.5 9 17.5 10 17.5 C11 17.5 12 16.5 12 15" />
    </>
  ),
  check: (
    <>
      <circle cx="10" cy="10" r="8" />
      <polyline points="7,10 9.5,12.5 13.5,7.5" strokeWidth="1.6" />
    </>
  ),
  add: (
    <>
      <line x1="10" y1="2" x2="10" y2="18" />
      <line x1="2" y1="10" x2="18" y2="10" />
      <path d="M10 2 L12 4 L10 4 L8 4 L10 2 Z" fill="currentColor" opacity="0.4" stroke="none" />
    </>
  ),
  close: (
    <>
      <line x1="3" y1="3" x2="17" y2="17" />
      <line x1="17" y1="3" x2="3" y2="17" />
    </>
  ),
  trophy: (
    <>
      <path d="M6 2 L14 2 L14 9 C14 12.5 12 14 10 14 C8 14 6 12.5 6 9 Z" />
      <path d="M6 4 L3 4 L3 7 C3 9 4.5 10 6 10" />
      <path d="M14 4 L17 4 L17 7 C17 9 15.5 10 14 10" />
      <line x1="10" y1="14" x2="10" y2="17" />
      <line x1="6" y1="17" x2="14" y2="17" />
      <line x1="7" y1="19" x2="13" y2="19" />
    </>
  ),
  events: (
    <>
      {/* Hex frame echoing the hub icon — establishes 'system' status */}
      <polygon points="10,1.5 17,5.75 17,14.25 10,18.5 3,14.25 3,5.75" />
      {/* Bolt: angular zig from upper-right shoulder to lower-left tip */}
      <path d="M11.5 4.5 L7 10.5 L9.5 10.5 L8 15.5 L13 9 L10.5 9 Z" fill="currentColor" stroke="none" opacity="0.85" />
      <path d="M11.5 4.5 L7 10.5 L9.5 10.5 L8 15.5 L13 9 L10.5 9 Z" />
    </>
  ),
};

export function Icon({ name, size = 20, color = 'currentColor', className = '', style = {} }) {
  const content = PATHS[name];
  if (!content) return null;
  return (
    <svg
      viewBox="0 0 20 20"
      width={size}
      height={size}
      fill="none"
      stroke={color}
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden="true"
    >
      {content}
    </svg>
  );
}

export default Icon;