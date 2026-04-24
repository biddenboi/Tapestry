/**
 * AchievementIcon — custom SVG icon per achievement group.
 * Usage: <AchievementIcon id="soldier" size={32} color="#a78bfa" />
 *
 * id matches ACHIEVEMENT_GROUPS[n].id from Achievements.js:
 * king_of_the_hill | overkill | underdog | contributor | soldier |
 * peace | legacy | basket | hobbyist | scholar | long_game | town | savant
 */

function KingOfTheHill({ color }) {
  return (
    <>
      <polyline points="2,16 10,4 18,16" />
      <line x1="3.5" y1="16" x2="16.5" y2="16" />
      <path d="M7 10 L7 7 L9 9 L10 6.5 L11 9 L13 7 L13 10 Z" fill={color} opacity="0.3" />
      <path d="M7 10 L7 7 L9 9 L10 6.5 L11 9 L13 7 L13 10" />
      <circle cx="7.5" cy="6.5" r="0.8" fill={color} stroke="none" />
      <circle cx="10" cy="6" r="0.8" fill={color} stroke="none" />
      <circle cx="12.5" cy="6.5" r="0.8" fill={color} stroke="none" />
      <line x1="6" y1="10" x2="14" y2="10" />
    </>
  );
}

function Overkill({ color }) {
  return (
    <>
      <circle cx="10" cy="10" r="8" />
      <circle cx="10" cy="10" r="5" />
      <circle cx="10" cy="10" r="2" fill={color} opacity="0.25" stroke="none" />
      <line x1="3" y1="3" x2="17" y2="17" strokeWidth="2.2" />
      <line x1="2" y1="7" x2="5" y2="7" opacity="0.5" />
      <line x1="2" y1="10" x2="4" y2="10" opacity="0.35" />
      <line x1="2" y1="13" x2="5" y2="13" opacity="0.5" />
    </>
  );
}

function Underdog({ color }) {
  return (
    <>
      <line x1="2" y1="13" x2="18" y2="13" strokeWidth="1.8" />
      <circle cx="10" cy="16.5" r="1.5" fill={color} opacity="0.4" strokeWidth="1" />
      <line x1="10" y1="11" x2="10" y2="3" />
      <polyline points="7,6 10,3 13,6" />
      <line x1="7" y1="9" x2="7" y2="12" opacity="0.35" strokeDasharray="1.5 1.5" />
      <line x1="13" y1="9" x2="13" y2="12" opacity="0.35" strokeDasharray="1.5 1.5" />
      <path d="M8,13 L9,11.5 L11,14.5 L12,13" strokeWidth="1" opacity="0.7" />
    </>
  );
}

function Contributor({ color }) {
  return (
    <>
      <circle cx="10" cy="2.5" r="1.5" fill={color} opacity="0.4" stroke="none" />
      <circle cx="17" cy="7" r="1.5" fill={color} opacity="0.4" stroke="none" />
      <circle cx="17" cy="13" r="1.5" fill={color} opacity="0.4" stroke="none" />
      <circle cx="10" cy="17.5" r="1.5" fill={color} opacity="0.4" stroke="none" />
      <circle cx="3" cy="13" r="1.5" fill={color} opacity="0.4" stroke="none" />
      <circle cx="3" cy="7" r="1.5" fill={color} opacity="0.4" stroke="none" />
      <circle cx="10" cy="10" r="3" fill={color} opacity="0.22" />
      <circle cx="10" cy="10" r="3" />
      <line x1="10" y1="4" x2="10" y2="7" />
      <line x1="15.7" y1="7.8" x2="12.8" y2="8.8" />
      <line x1="15.7" y1="12.2" x2="12.8" y2="11.2" />
      <line x1="10" y1="16" x2="10" y2="13" />
      <line x1="4.3" y1="12.2" x2="7.2" y2="11.2" />
      <line x1="4.3" y1="7.8" x2="7.2" y2="8.8" />
      <circle cx="10" cy="10" r="5" opacity="0.2" strokeDasharray="2 2" />
    </>
  );
}

function Soldier({ color }) {
  return (
    <>
      <path d="M10 2 L17 5 L17 12 L10 18 L3 12 L3 5 Z" />
      <path d="M10 2 L17 5 L17 12 L10 18 L3 12 L3 5 Z" fill={color} opacity="0.1" stroke="none" />
      <line x1="7" y1="7" x2="7" y2="12" />
      <line x1="9" y1="7" x2="9" y2="12" />
      <line x1="11" y1="7" x2="11" y2="12" />
      <line x1="13" y1="7" x2="13" y2="12" />
      <line x1="6" y1="12" x2="14" y2="7" strokeWidth="1.6" />
      <polygon points="10,3.5 10.7,5.5 12.8,5.5 11.2,6.7 11.8,8.7 10,7.5 8.2,8.7 8.8,6.7 7.2,5.5 9.3,5.5"
        fill={color} opacity="0.6" stroke="none" />
    </>
  );
}

function Peace({ color }) {
  return (
    <>
      <polygon points="10,2 18,10 10,18 2,10" />
      <polygon points="10,5 15,10 10,15 5,10" />
      <polygon points="10,8 12,10 10,12 8,10" fill={color} opacity="0.25" stroke="none" />
      <circle cx="10" cy="10" r="1.2" fill={color} stroke="none" />
    </>
  );
}

function Legacy({ color }) {
  return (
    <>
      <path d="M4 3 L13 3 L16 6 L16 18 L4 18 Z" />
      <path d="M4 3 L13 3 L16 6 L16 18 L4 18 Z" fill={color} opacity="0.08" stroke="none" />
      <polyline points="13,3 13,6 16,6" strokeWidth="1" />
      <line x1="7" y1="9" x2="13" y2="9" />
      <line x1="7" y1="11.5" x2="13" y2="11.5" />
      <line x1="7" y1="14" x2="11" y2="14" />
      <path d="M11 5 L14.5 3.5 L15 5 L12 7 Z" fill={color} opacity="0.5" stroke="none" />
      <line x1="11" y1="5" x2="12" y2="7" strokeWidth="1.4" />
      <line x1="4" y1="3" x2="4" y2="18" strokeWidth="2" />
      <circle cx="10" cy="16" r="2.5" />
      <circle cx="10" cy="16" r="1" fill={color} opacity="0.5" stroke="none" />
    </>
  );
}

function Basket({ color }) {
  return (
    <>
      <path d="M3 8 L17 8 L15 17 L5 17 Z" />
      <path d="M3 8 L17 8 L15 17 L5 17 Z" fill={color} opacity="0.1" stroke="none" />
      <line x1="8" y1="8" x2="7" y2="17" opacity="0.5" />
      <line x1="12" y1="8" x2="13" y2="17" opacity="0.5" />
      <path d="M6 8 C6 4 14 4 14 8" />
      <polygon points="7,7.5 8.5,5.5 10,7.5 8.5,9.5" fill={color} opacity="0.4" stroke={color} strokeWidth="1" />
      <polygon points="10,6.5 11.5,4.5 13,6.5 11.5,8.5" fill={color} opacity="0.6" stroke={color} strokeWidth="1" />
      <polygon points="12.5,7.5 14,5.5 15.5,7.5 14,9.5" fill={color} opacity="0.3" stroke={color} strokeWidth="1" />
    </>
  );
}

function Hobbyist({ color }) {
  return (
    <>
      <rect x="2" y="2" width="5" height="5" fill={color} opacity="0.3" stroke="none" />
      <rect x="7.5" y="2" width="5" height="5" fill={color} opacity="0.15" stroke="none" />
      <rect x="13" y="2" width="5" height="5" fill={color} opacity="0.45" stroke="none" />
      <rect x="2" y="7.5" width="5" height="5" fill={color} opacity="0.2" stroke="none" />
      <rect x="7.5" y="7.5" width="5" height="5" fill={color} opacity="0.5" stroke="none" />
      <rect x="13" y="7.5" width="5" height="5" fill={color} opacity="0.1" stroke="none" />
      <rect x="2" y="13" width="5" height="5" fill={color} opacity="0.4" stroke="none" />
      <rect x="7.5" y="13" width="5" height="5" fill={color} opacity="0.2" stroke="none" />
      <rect x="13" y="13" width="5" height="5" strokeDasharray="2 1" opacity="0.6" />
      <line x1="2" y1="7.5" x2="18" y2="7.5" opacity="0.3" />
      <line x1="2" y1="13" x2="18" y2="13" opacity="0.3" />
      <line x1="7.5" y1="2" x2="7.5" y2="18" opacity="0.3" />
      <line x1="13" y1="2" x2="13" y2="18" opacity="0.3" />
    </>
  );
}

function Scholar({ color }) {
  return (
    <>
      <rect x="3" y="13" width="14" height="3.5" fill={color} opacity="0.15" stroke="none" />
      <rect x="3" y="13" width="14" height="3.5" />
      <rect x="4.5" y="10" width="11" height="3.5" fill={color} opacity="0.1" stroke="none" />
      <rect x="4.5" y="10" width="11" height="3.5" />
      <polygon points="10,3 18,7 10,11 2,7" fill={color} opacity="0.2" stroke="none" />
      <polygon points="10,3 18,7 10,11 2,7" />
      <line x1="18" y1="7" x2="18" y2="11" />
      <line x1="18" y1="11" x2="16" y2="13" />
      <circle cx="16" cy="13.5" r="1" fill={color} opacity="0.6" stroke="none" />
      <line x1="7" y1="6" x2="10" y2="5" opacity="0.5" />
    </>
  );
}

function LongGame({ color }) {
  return (
    <>
      <path d="M4 2 L16 2 L16 3 L12 8.5 L12 11.5 L16 17 L16 18 L4 18 L4 17 L8 11.5 L8 8.5 L4 3 Z" />
      <path d="M4 2 L16 2 L16 3 L12 8.5 L12 11.5 L16 17 L16 18 L4 18 L4 17 L8 11.5 L8 8.5 L4 3 Z"
        fill={color} opacity="0.07" stroke="none" />
      <path d="M5 17 L15 17 L12.5 13 L7.5 13 Z" fill={color} opacity="0.3" stroke="none" />
      <line x1="10" y1="9.5" x2="10" y2="10.5" strokeWidth="2" opacity="0.5" />
      <line x1="4" y1="3" x2="16" y2="3" />
      <line x1="4" y1="17" x2="16" y2="17" />
    </>
  );
}

function Town({ color }) {
  return (
    <>
      <polygon points="5,4 7,5.2 7,7.5 5,8.7 3,7.5 3,5.2" opacity="0.6" />
      <path d="M2 13 L2 11 L4 10 L6 10 L8 11 L8 13" opacity="0.6" />
      <polygon points="15,4 17,5.2 17,7.5 15,8.7 13,7.5 13,5.2" opacity="0.6" />
      <path d="M12 13 L12 11 L14 10 L16 10 L18 11 L18 13" opacity="0.6" />
      <polygon points="10,2 12.5,3.5 12.5,6.5 10,8 7.5,6.5 7.5,3.5" fill={color} opacity="0.2" stroke="none" />
      <polygon points="10,2 12.5,3.5 12.5,6.5 10,8 7.5,6.5 7.5,3.5" />
      <path d="M6 18 L6 15 L9 13 L11 13 L14 15 L14 18" />
      <line x1="6" y1="18" x2="14" y2="18" />
    </>
  );
}

function Savant({ color }) {
  return (
    <>
      <polygon points="10,1.5 11.5,8.5 18.5,10 11.5,11.5 10,18.5 8.5,11.5 1.5,10 8.5,8.5"
        fill={color} opacity="0.15" stroke="none" />
      <polygon points="10,1.5 11.5,8.5 18.5,10 11.5,11.5 10,18.5 8.5,11.5 1.5,10 8.5,8.5" />
      <polygon points="10,5.5 13,10 10,14.5 7,10" fill={color} opacity="0.3" stroke="none" />
      <circle cx="10" cy="10" r="2" fill={color} opacity="0.8" stroke="none" />
      <path d="M8,5 L8,3 L9.5,4.5 L10,2 L10.5,4.5 L12,3 L12,5" strokeWidth="1.4" />
    </>
  );
}

const SHAPES = {
  king_of_the_hill: KingOfTheHill,
  overkill:         Overkill,
  underdog:         Underdog,
  contributor:      Contributor,
  soldier:          Soldier,
  peace:            Peace,
  legacy:           Legacy,
  basket:           Basket,
  hobbyist:         Hobbyist,
  scholar:          Scholar,
  long_game:        LongGame,
  town:             Town,
  savant:           Savant,
};

/**
 * @param {string} id     - Achievement group id
 * @param {number} size   - px size (default 32)
 * @param {string} color  - stroke/fill color (default 'currentColor')
 */
export function AchievementIcon({ id, size = 32, color = 'currentColor', className = '' }) {
  const Shape = SHAPES[id];
  if (!Shape) return null;
  return (
    <svg
      viewBox="0 0 20 20"
      width={size}
      height={size}
      fill="none"
      stroke={color}
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <Shape color={color} />
    </svg>
  );
}

export default AchievementIcon;
