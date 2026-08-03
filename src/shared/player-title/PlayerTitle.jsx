import { getCosmeticTitle, getPlayerTitleId, titleStyleVars } from '@domain/cosmetics/Titles.js';
import '@shared/player-title/PlayerTitle.css';

export default function PlayerTitle({
  player = null,
  titleId = null,
  className = '',
  compact = false,
  as: Tag = 'div',
}) {
  const title = getCosmeticTitle(titleId || getPlayerTitleId(player));
  if (!title) return null;

  return (
    <Tag
      className={`player-title ${title.glow ? 'player-title--glow' : ''} ${compact ? 'player-title--compact' : ''} ${className}`.trim()}
      style={titleStyleVars(title)}
    >
      {title.label}
    </Tag>
  );
}
