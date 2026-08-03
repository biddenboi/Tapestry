/**
 * RankIcon — custom SVG icon for each rank group with optional sub-tier dots.
 * Usage: <RankIcon group="Diamond" sub="II" size={20} />
 *
 * group: Iron | Bronze | Silver | Gold | Platinum | Diamond | Ascendant | Immortal | Radiant
 * sub:   'I' | 'II' | 'III' | '' (Radiant has no sub)
 */

const RANK_COLORS = {
  Iron:      '#8892a0',
  Bronze:    '#c87941',
  Silver:    '#c0c8d8',
  Gold:      '#d4a017',
  Platinum:  '#22d3ee',
  Diamond:   '#60a5fa',
  Ascendant: '#00d68f',
  Immortal:  '#f43f5e',
  Radiant:   '#fde047',
};

const SUB_OPACITY = { I: 0.6, II: 0.8, III: 1.0, '': 1.0 };
const SUB_DOTS    = { I: 1,   II: 2,   III: 3,   '': 0 };

function RankShape({ group, color }) {
  switch (group) {
    case 'Iron':
      return (
        <>
          <polygon points="5,17 3,10 6,4 11,3 15,6 17,13 14,18 8,18" />
          <polygon points="5,17 3,10 6,4 11,3 15,6 17,13 14,18 8,18" fill={color} opacity="0.12" stroke="none" />
          <line x1="6" y1="4" x2="8" y2="9" />
          <line x1="8" y1="9" x2="13" y2="7" />
        </>
      );
    case 'Bronze':
      return (
        <>
          <path d="M10 2 L17 5 L17 13 L10 19 L3 13 L3 5 Z" />
          <path d="M10 2 L17 5 L17 13 L10 19 L3 13 L3 5 Z" fill={color} opacity="0.12" stroke="none" />
          <line x1="7" y1="10" x2="13" y2="10" opacity="0.6" />
        </>
      );
    case 'Silver':
      return (
        <>
          <polygon points="10,2 18,10 10,18 2,10" />
          <polygon points="10,5.5 14.5,10 10,14.5 5.5,10" fill={color} opacity="0.15" stroke="none" />
        </>
      );
    case 'Gold':
      return (
        <>
          <polygon points="10,2 18,10 10,18 2,10" />
          <polygon points="10,4.5 15.5,10 10,15.5 4.5,10" fill={color} opacity="0.22" stroke="none" />
          <polygon points="10,4.5 15.5,10 10,15.5 4.5,10" />
          <polygon points="10,8 12,10 10,12 8,10" fill={color} opacity="0.7" stroke="none" />
        </>
      );
    case 'Platinum':
      return (
        <>
          <polygon points="10,1.5 17,5.75 17,14.25 10,18.5 3,14.25 3,5.75" />
          <polygon points="10,1.5 17,5.75 17,14.25 10,18.5 3,14.25 3,5.75" fill={color} opacity="0.1" stroke="none" />
          <polygon points="10,5 14.5,7.5 14.5,12.5 10,15 5.5,12.5 5.5,7.5" fill={color} opacity="0.14" stroke="none" />
          <polygon points="10,5 14.5,7.5 14.5,12.5 10,15 5.5,12.5 5.5,7.5" />
          <circle cx="10" cy="10" r="2" fill={color} opacity="0.4" stroke="none" />
        </>
      );
    case 'Diamond':
      return (
        <>
          <polygon points="10,2 16,6 16,14 10,18 4,14 4,6" />
          <line x1="4" y1="6" x2="10" y2="10" />
          <line x1="16" y1="6" x2="10" y2="10" />
          <line x1="10" y1="2" x2="10" y2="10" />
          <line x1="10" y1="10" x2="4" y2="14" />
          <line x1="10" y1="10" x2="16" y2="14" />
          <line x1="10" y1="10" x2="10" y2="18" />
          <polygon points="4,6 16,6 10,10" fill={color} opacity="0.28" stroke="none" />
          <circle cx="10" cy="10" r="1.5" fill={color} opacity="0.5" stroke="none" />
        </>
      );
    case 'Ascendant':
      return (
        <>
          <path d="M10 2 L16 9 L13 8 L13 17 L7 17 L7 8 L4 9 Z" />
          <path d="M10 2 L16 9 L13 8 L13 17 L7 17 L7 8 L4 9 Z" fill={color} opacity="0.18" stroke="none" />
          <line x1="3" y1="13" x2="7" y2="11" opacity="0.5" />
          <line x1="17" y1="13" x2="13" y2="11" opacity="0.5" />
          <line x1="2" y1="10" x2="7" y2="9" opacity="0.35" />
          <line x1="18" y1="10" x2="13" y2="9" opacity="0.35" />
          <circle cx="10" cy="11" r="1.5" fill={color} opacity="0.5" stroke="none" />
        </>
      );
    case 'Immortal':
      return (
        <>
          <path d="M10 18 C5 16 3.5 11 5.5 7.5 C6.5 5.5 8 4.5 9 6.5 C9 4 10.5 1.5 12 3 C14.5 5 15.5 8 14.5 11 C14 13 13 15 10 18 Z" />
          <path d="M10 18 C5 16 3.5 11 5.5 7.5 C6.5 5.5 8 4.5 9 6.5 C9 4 10.5 1.5 12 3 C14.5 5 15.5 8 14.5 11 C14 13 13 15 10 18 Z" fill={color} opacity="0.18" stroke="none" />
          <path d="M10 15 C8 13.5 7.5 11 9 9 C9.5 10 10 11 10 12 C10.5 11 11 9 12 8.5 C13 10 12.5 13 10 15 Z" fill={color} opacity="0.4" stroke="none" />
          <circle cx="10" cy="12" r="1.5" fill={color} opacity="0.6" stroke="none" />
        </>
      );
    case 'Radiant':
      return (
        <>
          <polygon points="10,1 11.6,8.4 19,10 11.6,11.6 10,19 8.4,11.6 1,10 8.4,8.4" />
          <polygon points="10,1 11.6,8.4 19,10 11.6,11.6 10,19 8.4,11.6 1,10 8.4,8.4" fill={color} opacity="0.15" stroke="none" />
          <polygon points="10,5.5 14.5,10 10,14.5 5.5,10" fill={color} opacity="0.2" stroke="none" />
          <polygon points="10,5.5 14.5,10 10,14.5 5.5,10" />
          <circle cx="10" cy="10" r="2.2" fill={color} opacity="0.85" stroke="none" />
        </>
      );
    default:
      return null;
  }
}

/**
 * @param {string}  group     - Rank group name (Iron, Bronze, … Radiant)
 * @param {string}  sub       - Sub-tier: 'I' | 'II' | 'III' | '' for Radiant
 * @param {number}  size      - Icon size in px (default 20)
 * @param {boolean} showDots  - Show sub-tier diamond pips below icon (default false)
 * @param {string}  className
 */
export function RankIcon({ group, sub = '', size = 20, showDots = false, className = '' }) {
  const color   = RANK_COLORS[group] || 'currentColor';
  const opacity = SUB_OPACITY[sub]   ?? 1;
  const dots    = SUB_DOTS[sub]      ?? 0;

  return (
    <span
      className={className}
      style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}
    >
      <svg
        viewBox="0 0 20 20"
        width={size}
        height={size}
        fill="none"
        stroke={color}
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={opacity}
        aria-hidden="true"
      >
        <RankShape group={group} color={color} />
      </svg>
      {showDots && dots > 0 && (
        <span style={{ display: 'flex', gap: 3 }}>
          {Array.from({ length: dots }).map((_, i) => (
            <span
              key={i}
              style={{
                display: 'inline-block',
                width: 4,
                height: 4,
                clipPath: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)',
                background: color,
              }}
            />
          ))}
        </span>
      )}
    </span>
  );
}

export default RankIcon;
