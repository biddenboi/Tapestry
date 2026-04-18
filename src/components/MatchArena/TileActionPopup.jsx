import './TileActionPopup.css';

// ── Cube-coordinate helpers ────────────────────────────────────────────────────

function offsetToCube(q, r) {
  const x = q - (r - (r & 1)) / 2;
  return { x, y: -x - r, z: r };
}
function cubeToOffset(x, z) {
  const r = z;
  return { q: x + (r - (r & 1)) / 2, r };
}

/**
 * If (tq,tr) lies on a straight hex axis from (sq,sr) and is more than 1 step
 * away, returns the ordered path [{q,r}…] from step 1 through N.
 * Returns null for adjacent tiles or non-collinear targets.
 */
function getStraightLinePath(sq, sr, tq, tr) {
  const a = offsetToCube(sq, sr), b = offsetToCube(tq, tr);
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  if (dx === 0 && dz === 0) return null;

  const DIRS = [[1,-1,0],[1,0,-1],[0,1,-1],[-1,1,0],[-1,0,1],[0,-1,1]];
  for (const [ddx, ddy, ddz] of DIRS) {
    const Nx = ddx !== 0 ? dx / ddx : null;
    const Ny = ddy !== 0 ? dy / ddy : null;
    const Nz = ddz !== 0 ? dz / ddz : null;
    const vals = [Nx, Ny, Nz].filter((v) => v !== null);
    if (!vals.length) continue;
    const N = vals[0];
    if (!Number.isInteger(N) || N <= 1) continue;
    if (vals.some((v) => v !== N)) continue;
    if (dx !== ddx * N || dy !== ddy * N || dz !== ddz * N) continue;

    const path = [];
    for (let i = 1; i <= N; i++) path.push(cubeToOffset(a.x + ddx * i, a.z + ddz * i));
    return path;
  }
  return null;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function TileActionPopup({
  tile, tiles, playerOnTile, currentPosition, currentTeam,
  spendable, burstSpent, durationHours,
  onAction, onClose, style,
}) {
  if (!tile) return null;

  const d    = durationHours / 4;
  const mult = burstSpent < 60 ? 1 : burstSpent < 120 ? 1.2 : burstSpent < 200 ? 1.5 : 2;

  const scaledCost = (base) => Math.max(1, Math.round(base * d));
  const cost       = (base) => Math.ceil(scaledCost(base) * mult);
  const canAfford  = (c)    => spendable >= c;

  const isAdjacent = currentPosition &&
    !(tile.q === currentPosition.q && tile.r === currentPosition.r) &&
    Math.abs(tile.q - currentPosition.q) <= 1 &&
    Math.abs(tile.r - currentPosition.r) <= 1;

  const isCurrentTile = currentPosition &&
    tile.q === currentPosition.q && tile.r === currentPosition.r;

  // ── Sprint: straight-line path through non-enemy, non-mountain tiles ──
  const sprintPath = currentPosition && !isAdjacent && !isCurrentTile
    ? getStraightLinePath(currentPosition.q, currentPosition.r, tile.q, tile.r)
    : null;

  const enemyTeam = currentTeam === 'team1' ? 'team2' : 'team1';

  // Valid if every tile on the path is passable (not mountain, not enemy-owned, not a tower)
  const validSprintPath = sprintPath && tiles
    ? sprintPath.every((step) => {
        const t = tiles[`${step.q},${step.r}`];
        return t && t.type !== 'mountain' && t.owner !== enemyTeam && !t.isTower;
      })
      ? sprintPath
      : null
    : null;

  const sprintCost = validSprintPath ? cost(4) * validSprintPath.length : 0;

  const ownerLabel = !tile.owner ? 'Unclaimed'
    : tile.owner === currentTeam ? 'Friendly' : 'Enemy';

  const hpPct   = tile.maxHp > 0 ? tile.hp / tile.maxHp : 0;
  const hpColor = hpPct > 0.5 ? '#22c55e' : hpPct > 0.25 ? '#f59e0b' : '#ef4444';

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

      <div className="tap-header">
        <span className={`tap-owner tap-owner--${tile.owner || 'none'}`}>{ownerLabel}</span>
        {tile.isTower      && <span className="tap-tower-badge">⬡ TOWER</span>}
        {tile.reinforceTier > 0 && <span className="tap-reinforce-badge">T{tile.reinforceTier}</span>}
      </div>

      {tile.type === 'mountain' ? (
        <div className="tap-mountain">⛰ Impassable</div>
      ) : (
        <>
          {tile.maxHp > 0 && (
            <div className="tap-hp-row">
              <span className="tap-hp-label">HP</span>
              <div className="tap-hp-track">
                <div className="tap-hp-fill" style={{ width: `${hpPct * 100}%`, background: hpColor }} />
              </div>
              <span className="tap-hp-num">{tile.hp}/{tile.maxHp}</span>
            </div>
          )}

          <div className="tap-actions">
            {/* Standard adjacent move */}
            {isAdjacent && tile.owner === currentTeam && !tile.isTower &&
              btn('Move Here', { type: 'move', q: tile.q, r: tile.r }, 4)}

            {/* Straight-line sprint — traverse N non-enemy tiles in one action */}
            {validSprintPath && tile.owner !== enemyTeam && !tile.isTower && (
              <button
                className={`tap-action tap-action--sprint ${canAfford(sprintCost) ? '' : 'tap-action--disabled'}`}
                onClick={() => canAfford(sprintCost) && onAction({
                  type:  'multi_move',
                  path:  validSprintPath,
                  q:     tile.q,
                  r:     tile.r,
                  cost:  sprintCost,
                })}
                disabled={!canAfford(sprintCost)}
              >
                <span className="tap-action-label">
                  ⚡ Sprint ({validSprintPath.length} tiles)
                </span>
                <span className="tap-action-cost" style={{ color: canAfford(sprintCost) ? '#a78bfa' : '#555' }}>
                  {sprintCost} pts{mult > 1 ? ` ×${mult}` : ''}
                </span>
              </button>
            )}

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
                type: 'attack_player', q: tile.q, r: tile.r,
                targetUUID: playerOnTile.UUID,
              }, 15)}
          </div>

          {mult > 1 && (
            <div className="tap-burst-warn">
              ⚡ Burst ×{mult} active — complete a task to reset
            </div>
          )}

          {!isAdjacent && !isCurrentTile && !validSprintPath && (
            <div className="tap-no-action">
              {sprintPath
                ? 'Path blocked — tiles must be friendly & unobstructed'
                : 'Move closer to interact'}
            </div>
          )}
        </>
      )}
    </div>
  );
}
