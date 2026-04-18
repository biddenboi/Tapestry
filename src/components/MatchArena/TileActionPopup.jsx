import './TileActionPopup.css';

export default function TileActionPopup({
  tile, playerOnTile, currentPosition, currentTeam, match,
  spendable, burstSpent, durationHours,
  onAction, onClose, style,
}) {
  if (!tile) return null;

  const d = durationHours / 4;
  const scaled = (base) => Math.max(1, Math.round(base * d));
  const mult = burstSpent < 60 ? 1 : burstSpent < 120 ? 1.2 : burstSpent < 200 ? 1.5 : 2;
  const cost = (base) => Math.ceil(scaled(base) * mult);

  const isAdjacent = tile.q !== undefined && currentPosition &&
    Math.abs(tile.q - currentPosition.q) <= 1 &&
    Math.abs(tile.r - currentPosition.r) <= 1 &&
    !(tile.q === currentPosition.q && tile.r === currentPosition.r);

  const isCurrentTile = currentPosition &&
    tile.q === currentPosition.q && tile.r === currentPosition.r;

  const ownerLabel = !tile.owner ? 'Unclaimed'
    : tile.owner === currentTeam ? 'Friendly' : 'Enemy';

  const hpPct = tile.maxHp > 0 ? tile.hp / tile.maxHp : 0;
  const hpColor = hpPct > 0.5 ? '#22c55e' : hpPct > 0.25 ? '#f59e0b' : '#ef4444';

  const canAfford = (c) => spendable >= c;

  const btn = (label, action, baseCost, disabled = false) => {
    const c = cost(baseCost);
    const affordable = canAfford(c) && !disabled;
    return (
      <button
        key={label}
        className={`tap-action ${!affordable ? 'tap-action--disabled' : ''}`}
        onClick={() => affordable && onAction(action)}
        disabled={!affordable}
      >
        <span className="tap-action-label">{label}</span>
        <span className="tap-action-cost" style={{ color: affordable ? '#a78bfa' : '#555' }}>
          {c} pts{mult > 1 ? ` ×${mult}` : ''}
        </span>
      </button>
    );
  };

  return (
    <div className="tap-popup" style={style}>
      <button className="tap-close" onClick={onClose}>✕</button>

      {/* Tile info */}
      <div className="tap-header">
        <span className={`tap-owner tap-owner--${tile.owner || 'none'}`}>{ownerLabel}</span>
        {tile.isTower && <span className="tap-tower-badge">⬡ TOWER</span>}
        {tile.reinforceTier > 0 && (
          <span className="tap-reinforce-badge">T{tile.reinforceTier}</span>
        )}
      </div>

      {tile.type === 'mountain' ? (
        <div className="tap-mountain">⛰ Impassable</div>
      ) : (
        <>
          {/* HP bar */}
          {tile.maxHp > 0 && (
            <div className="tap-hp-row">
              <span className="tap-hp-label">HP</span>
              <div className="tap-hp-track">
                <div className="tap-hp-fill" style={{ width: `${hpPct * 100}%`, background: hpColor }} />
              </div>
              <span className="tap-hp-num">{tile.hp}/{tile.maxHp}</span>
            </div>
          )}

          {/* Actions */}
          <div className="tap-actions">
            {/* Move */}
            {isAdjacent && tile.owner === currentTeam && !tile.isTower &&
              btn('Move Here', { type: 'move', q: tile.q, r: tile.r }, 4)}

            {/* Claim unclaimed */}
            {isAdjacent && !tile.owner &&
              btn('Claim', { type: 'claim', q: tile.q, r: tile.r }, 15)}

            {/* Attack enemy tile */}
            {isAdjacent && tile.owner && tile.owner !== currentTeam && !tile.isTower &&
              btn('Attack', { type: 'attack_tile', q: tile.q, r: tile.r }, 20)}

            {/* Attack enemy tower */}
            {isAdjacent && tile.isTower && tile.owner !== currentTeam &&
              btn('Attack Tower', { type: 'attack_tower', q: tile.q, r: tile.r }, 25)}

            {/* Reinforce */}
            {(isCurrentTile || (isAdjacent && tile.owner === currentTeam)) && tile.reinforceTier < 3 && (
              <>
                {tile.reinforceTier < 1 && btn('Reinforce T1', { type: 'reinforce', q: tile.q, r: tile.r, tier: 1 }, 20)}
                {tile.reinforceTier === 1 && btn('Reinforce T2', { type: 'reinforce', q: tile.q, r: tile.r, tier: 2 }, 50)}
                {tile.reinforceTier === 2 && btn('Reinforce T3', { type: 'reinforce', q: tile.q, r: tile.r, tier: 3 }, 100)}
              </>
            )}

            {/* Attack enemy player on tile */}
            {playerOnTile && playerOnTile.team !== currentTeam && isAdjacent &&
              btn('Attack Player', {
                type: 'attack_player',
                q: tile.q, r: tile.r,
                targetUUID: playerOnTile.UUID,
              }, 15)}
          </div>

          {/* Burst warning */}
          {mult > 1 && (
            <div className="tap-burst-warn">
              ⚡ Burst ×{mult} active — complete a task to reset
            </div>
          )}

          {/* No actions notice */}
          {!isAdjacent && !isCurrentTile && (
            <div className="tap-no-action">Move closer to interact</div>
          )}
        </>
      )}
    </div>
  );
}
