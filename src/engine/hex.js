/**
 * Engine-level hex math.
 *
 * Thin re-export over the existing helpers in utils/Helpers/MapGen.js so modes
 * can import from `engine/hex` without reaching into the conquest mode's helper
 * file. The canonical implementation still lives in MapGen.js; a future pass
 * can relocate the source without changing any import site.
 *
 * Also hosts `getStraightLinePath`, lifted out of TileActionPopup.jsx so it's
 * reusable from any mode that needs multi-hex straight movement (sprint).
 */

export {
  tileKey,
  parseKey,
  hexToPixel,
  pixelToHex,
  hexDist,
  getNeighbors,
  inBounds,
  hexCorners,
  MAP_COLS,
  MAP_ROWS,
  HEX_SIZE,
  CANVAS_W,
  CANVAS_H,
  CANVAS_PAD,
} from '../utils/Helpers/MapGen.js';

// ── Straight-line path (cube coordinates) ───────────────────────────

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
 * away, returns the ordered path [{q,r}…] from step 1 through N (destination
 * included, source excluded).
 * Returns null for adjacent tiles or non-collinear targets.
 */
export function getStraightLinePath(sq, sr, tq, tr) {
  const a = offsetToCube(sq, sr);
  const b = offsetToCube(tq, tr);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  if (dx === 0 && dz === 0) return null;

  const DIRS = [
    [1, -1, 0], [1, 0, -1], [0, 1, -1],
    [-1, 1, 0], [-1, 0, 1], [0, -1, 1],
  ];

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
    for (let i = 1; i <= N; i += 1) {
      path.push(cubeToOffset(a.x + ddx * i, a.z + ddz * i));
    }
    return path;
  }
  return null;
}

// ── Deterministic seeded RNG ────────────────────────────────────────

/**
 * Mulberry-style 32-bit PRNG. Stable for a given seed, suitable for map
 * generation and any other reproducible sampling a mode needs. Matches the
 * shape of MapGen.js's internal seededRNG so maps stay byte-identical across
 * modes that share terrain math.
 */
export function seededRNG(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) | 0;
    return (s >>> 0) / 4294967296;
  };
}
