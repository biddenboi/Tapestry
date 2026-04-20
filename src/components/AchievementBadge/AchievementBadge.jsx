import './AchievementBadge.css';
import { getAchievementByKey } from '../../utils/Achievements.js';

/**
 * A small badge icon for a single achievement.
 * Used in player cards (match arena) and the profile achievement bar.
 *
 * Props:
 *   achievementKey  string | null  — the key like 'soldier_3'
 *   size            number         — pixel size (default 22)
 *   showTooltip     bool           — whether to render tooltip on hover (default true)
 *   empty           bool           — render as empty placeholder slot
 *   selected        bool           — is this slot currently selected
 *   onClick         fn             — click handler
 *   rarity          { label, color } | null
 *   progress        { value, max } | null  — for quantitative achievements
 */
export default function AchievementBadge({
  achievementKey = null,
  size = 22,
  showTooltip = true,
  empty = false,
  selected = false,
  onClick,
  rarity = null,
  progress = null,
  className = '',
}) {
  const achievement = achievementKey ? getAchievementByKey(achievementKey) : null;

  const handleClick = (e) => {
    e.stopPropagation();
    onClick?.();
  };

  if (empty || !achievement) {
    const Tag = onClick ? 'button' : 'div';
    return (
      <Tag
        className={`ach-badge ach-badge--empty ${selected ? 'ach-badge--selected' : ''} ${className}`}
        style={{ width: size, height: size }}
        onClick={onClick ? handleClick : undefined}
        aria-label="Empty achievement slot"
      >
        <span className="ach-badge-empty-icon">+</span>
      </Tag>
    );
  }

  const { icon, color, label, desc } = achievement;

  return (
    <div
      className={`ach-badge ach-badge--filled ${selected ? 'ach-badge--selected' : ''} ${onClick ? 'ach-badge--clickable' : ''} ${className}`}
      style={{ width: size, height: size, '--ach-color': color }}
      onClick={onClick ? handleClick : undefined}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') handleClick(e); } : undefined}
      aria-label={label}
    >
      {/* SVG icon */}
      <span
        className="ach-badge-icon"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: icon }}
      />

      {/* Tooltip */}
      {showTooltip && (
        <div className="ach-tooltip">
          <div className="ach-tooltip-name">{label}</div>
          {rarity && (
            <div className="ach-tooltip-rarity" style={{ color: rarity.color }}>
              {rarity.label.toUpperCase()}
            </div>
          )}
          <div className="ach-tooltip-desc">{desc}</div>
          {progress && (
            <div className="ach-tooltip-progress">
              <div className="ach-tooltip-progress-bar">
                <div
                  className="ach-tooltip-progress-fill"
                  style={{ width: `${Math.min(100, (progress.value / progress.max) * 100)}%`, background: color }}
                />
              </div>
              <span className="ach-tooltip-progress-label">
                {progress.value.toLocaleString()} / {progress.max.toLocaleString()}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
