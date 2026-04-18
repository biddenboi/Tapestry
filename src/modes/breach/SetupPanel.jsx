import { useMemo } from 'react';
import {
  validatePlaceStructure,
  validateSetSpawn,
  STRUCTURE_SPECS,
} from './rules.js';
import {
  DEFENDER_SETUP_BUDGET,
  SETUP_PHASE_CAP_MS,
} from './Constants.js';

/**
 * Setup-phase interaction panel for the human player.
 *
 * Responsibilities:
 *   - Show remaining setup budget (defenders only — attackers have none).
 *   - Show the structures this player has already committed.
 *   - Given the currently-selected tile (clicked on the arena canvas),
 *     surface valid actions: PLACE (choose wall/mine/reinforced_wall),
 *     REMOVE (refund an own structure), or SET SPAWN (pick a spawn tile).
 *   - READY button commits the player; the arena transitions to live when
 *     everyone is ready or the cap expires.
 *
 * Pure UI — all validation is delegated to rules.js. The arena owns
 * state mutation and persistence; this component only fires `on*` callbacks.
 *
 * Props:
 *   tile:            { q, r } | null         // currently-selected tile
 *   self:            { uuid, side, budgetRemaining, spawnTile, structures, ready }
 *   state:           { tiles, sites, structures, spawnZones }
 *   phaseTimeLeftMs: number                   // countdown to auto-commit
 *   onPlace:         (placement) => void
 *   onRemove:        (tileKey)    => void
 *   onSetSpawn:      (tile)       => void
 *   onReady:         ()           => void
 *   onClose:         ()           => void    // dismiss the panel
 */
export default function SetupPanel({
  tile, self, state, phaseTimeLeftMs,
  onPlace, onRemove, onSetSpawn, onReady, onClose,
}) {
  const ctx = useMemo(() => ({
    tiles: state.tiles,
    sites: state.sites,
    structures: state.structures || {},
    spawnZones: state.spawnZones,
    actor: { uuid: self.uuid, side: self.side },
    budgetRemaining: self.budgetRemaining,
  }), [state, self]);

  const tileActions = useMemo(() => {
    if (!tile) return null;
    const out = {
      spawn: validateSetSpawn(tile, ctx),
      placements: [],
      ownStructure: null,
    };
    // Structure the player placed on this tile (for REMOVE / refund).
    const key = `${tile.q},${tile.r}`;
    const existing = state.structures?.[key];
    if (existing && self.structures?.some((s) => s.at.q === tile.q && s.at.r === tile.r)) {
      out.ownStructure = existing;
    }
    // Placement validators — only for defenders on empty tiles.
    if (self.side === 'defender' && !existing) {
      for (const kind of ['wall', 'reinforced_wall', 'mine']) {
        const v = validatePlaceStructure({ kind, at: tile }, ctx);
        out.placements.push({ kind, v });
      }
    }
    return out;
  }, [tile, state, self, ctx]);

  const timeSec = Math.max(0, Math.ceil(phaseTimeLeftMs / 1000));
  const timeM = Math.floor(timeSec / 60);
  const timeS = timeSec % 60;

  return (
    <div className="breach-setup-panel">
      <div className="bsp-header">
        <span className="bsp-title">SETUP — {self.side.toUpperCase()}</span>
        <span className="bsp-timer">{`${timeM}:${String(timeS).padStart(2, '0')}`}</span>
        <button className="bsp-close" onClick={onClose} title="Minimize">–</button>
      </div>

      {self.side === 'defender' && (
        <div className="bsp-budget">
          <span className="bsp-budget-label">BUDGET</span>
          <div className="bsp-budget-bar">
            <div
              className="bsp-budget-fill"
              style={{ width: `${(self.budgetRemaining / DEFENDER_SETUP_BUDGET) * 100}%` }}
            />
          </div>
          <span className="bsp-budget-value">
            {self.budgetRemaining}/{DEFENDER_SETUP_BUDGET}
          </span>
        </div>
      )}

      <div className="bsp-status">
        <div className="bsp-status-row">
          <span className="bsp-status-label">SPAWN</span>
          <span className="bsp-status-value">
            {self.spawnTile ? `(${self.spawnTile.q},${self.spawnTile.r})` : '— unset —'}
          </span>
        </div>
        {self.side === 'defender' && (
          <div className="bsp-status-row">
            <span className="bsp-status-label">PLACED</span>
            <span className="bsp-status-value">
              {(self.structures?.length || 0)} structure{(self.structures?.length || 0) === 1 ? '' : 's'}
            </span>
          </div>
        )}
      </div>

      {tile && tileActions && (
        <div className="bsp-tile-actions">
          <div className="bsp-tile-header">
            TILE ({tile.q},{tile.r})
          </div>

          {/* Spawn */}
          <button
            className={`bsp-btn ${tileActions.spawn.ok ? '' : 'bsp-btn--disabled'}`}
            disabled={!tileActions.spawn.ok}
            onClick={() => tileActions.spawn.ok && onSetSpawn(tile)}
          >
            SET SPAWN {tileActions.spawn.ok ? '' : `— ${tileActions.spawn.reason}`}
          </button>

          {/* Own structure on this tile → remove/refund */}
          {tileActions.ownStructure && (
            <button
              className="bsp-btn bsp-btn--remove"
              onClick={() => onRemove(`${tile.q},${tile.r}`)}
            >
              REMOVE {tileActions.ownStructure.kind.toUpperCase()}
              {` (+${STRUCTURE_SPECS[tileActions.ownStructure.kind].cost}pt)`}
            </button>
          )}

          {/* Placements */}
          {tileActions.placements.map(({ kind, v }) => (
            <button
              key={kind}
              className={`bsp-btn ${v.ok ? '' : 'bsp-btn--disabled'}`}
              disabled={!v.ok}
              onClick={() => v.ok && onPlace({ kind, at: tile })}
            >
              PLACE {kind.toUpperCase().replace('_', ' ')}
              {v.ok ? ` (-${v.cost}pt)` : ` — ${v.reason}`}
            </button>
          ))}
        </div>
      )}

      <div className="bsp-footer">
        <button
          className={`bsp-ready ${self.ready ? 'bsp-ready--done' : ''} ${self.spawnTile ? '' : 'bsp-ready--blocked'}`}
          disabled={!self.spawnTile || self.ready}
          onClick={onReady}
        >
          {self.ready ? '✓ READY'
            : !self.spawnTile ? 'SET SPAWN FIRST'
            : 'READY ▶'}
        </button>
      </div>
    </div>
  );
}

export { SETUP_PHASE_CAP_MS };
