import { useMemo } from 'react';
import {
  hexDist,
  tileKey,
  getStraightLinePath,
} from '../../engine/hex.js';
import {
  validateMove,
  validateSprint,
  validateAttackPlayer,
  validateRespawn,
  validatePlant,
  validateDefuse,
} from './rules.js';

/**
 * Contextual popup shown when the human clicks a tile.
 *
 * Legal actions per spec §3.3 turn structure: (optional movement) + (optional
 * non-movement). This popup surfaces:
 *   - Move        (adjacent empty tile)
 *   - Sprint      (straight-line path, all tiles passable)
 *   - Attack      (enemy player on clicked tile, adjacent)
 *   - Plant       (attacker standing on an idle site tile)
 *   - Defuse      (defender standing on or adjacent to an armed site with
 *                  an unconsumed response window)
 *   - Respawn     (dead; only path back in)
 *
 * Breach-wall is deferred (no structures placed until setup phase lands).
 *
 * Props:
 *   tile:           { q, r }
 *   state:          { tiles, structures, positions, sites, armedBombs }
 *   self:           { uuid, side, position, points, alive, hp }
 *   teamSideByUUID, style, onAction, onClose
 */
export default function BreachActionPopup({
  tile, state, self, teamSideByUUID, style, onAction, onClose,
}) {
  const ctx = useMemo(() => ({
    tiles: state.tiles,
    structures: state.structures || {},
    positions: state.positions,
    sites: state.sites,
    armedBombs: state.armedBombs || {},
    teamSideByUUID,
    actor: {
      uuid: self.uuid,
      position: self.position,
      side: self.side,
      points: self.points,
      alive: self.alive,
      hp: self.hp,
    },
  }), [state, self, teamSideByUUID]);

  if (!tile) return null;

  const distance = hexDist(self.position.q, self.position.r, tile.q, tile.r);
  const clickedKey = tileKey(tile.q, tile.r);

  // Enemy on clicked tile?
  const enemyOnTile = Object.entries(state.positions || {}).find(([uuid, pos]) => {
    if (uuid === self.uuid) return false;
    const side = teamSideByUUID[uuid];
    return side && side !== self.side
      && pos.alive !== false
      && tileKey(pos.q, pos.r) === clickedKey;
  });

  // Which site (if any) does the clicked tile correspond to? Used for PLANT
  // (must be AT the site tile). DEFUSE considers every armed site against
  // the defender's current position — not the clicked tile.
  const siteAtClicked = Object.values(state.sites || {}).find(
    (s) => s && s.position.q === tile.q && s.position.r === tile.r,
  );

  const options = [];

  if (!self.alive) {
    const v = validateRespawn(ctx);
    options.push({
      label: v.ok ? `RESPAWN (${v.costPoints}pt)` : `RESPAWN — ${v.reason}`,
      enabled: v.ok,
      run: () => onAction({ kind: 'respawn' }),
    });
  } else {
    // Move (adjacent)
    if (distance === 1) {
      const v = validateMove(tile, ctx);
      options.push({
        label: v.ok ? `MOVE (${v.costPoints}pt)` : `MOVE — ${v.reason}`,
        enabled: v.ok,
        run: () => onAction({ kind: 'move', to: { q: tile.q, r: tile.r } }),
      });
    }

    // Sprint (straight line, ≥2 hexes away)
    if (distance > 1) {
      const path = getStraightLinePath(self.position.q, self.position.r, tile.q, tile.r);
      if (path) {
        const v = validateSprint(path, ctx);
        options.push({
          label: v.ok ? `SPRINT ${path.length}h (${v.costPoints}pt)` : `SPRINT — ${v.reason}`,
          enabled: v.ok,
          run: () => onAction({ kind: 'sprint', path }),
        });
      }
    }

    // Attack enemy on clicked tile (adjacent only)
    if (enemyOnTile) {
      const [targetUUID] = enemyOnTile;
      const v = validateAttackPlayer(targetUUID, ctx);
      options.push({
        label: v.ok ? `ATTACK (${v.costPoints}pt)` : `ATTACK — ${v.reason}`,
        enabled: v.ok,
        run: () => onAction({ kind: 'attack', targetUUID }),
      });
    }

    // Plant — attacker on the clicked tile AND clicked tile is an idle site.
    if (siteAtClicked && self.side === 'attacker' && siteAtClicked.state === 'idle') {
      const v = validatePlant(siteAtClicked.id, ctx);
      options.push({
        label: v.ok ? `PLANT ${siteAtClicked.id} (${v.costPoints}pt)` : `PLANT ${siteAtClicked.id} — ${v.reason}`,
        enabled: v.ok,
        run: () => onAction({ kind: 'plant', site: siteAtClicked.id }),
      });
    }

    // Defuse — surface every armed site that self is on or adjacent to,
    // regardless of which tile was clicked. Helps when multiple are live.
    if (self.side === 'defender') {
      for (const site of Object.values(state.sites || {})) {
        if (!site || site.state !== 'armed') continue;
        if (!state.armedBombs?.[site.id]) continue;
        const d = hexDist(self.position.q, self.position.r, site.position.q, site.position.r);
        if (d > 1) continue;
        const v = validateDefuse(site.id, ctx);
        options.push({
          label: v.ok
            ? `DEFUSE ${site.id} (${v.costPoints}pt)`
            : `DEFUSE ${site.id} — ${v.reason}`,
          enabled: v.ok,
          run: () => onAction({ kind: 'defuse', site: site.id }),
        });
      }
    }
  }

  options.push({ label: 'CANCEL', enabled: true, run: () => onClose() });

  return (
    <div className="breach-action-popup" style={style}>
      <div className="bap-header">
        ({tile.q},{tile.r}) · d={distance}
        {siteAtClicked && ` · SITE ${siteAtClicked.id} [${siteAtClicked.state}]`}
      </div>
      {options.map((opt, i) => (
        <button
          key={i}
          className={`bap-btn ${opt.enabled ? '' : 'bap-btn--disabled'}`}
          disabled={!opt.enabled}
          onClick={() => { if (opt.enabled) opt.run(); }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
