const SQRT3 = Math.sqrt(3);

export const MAP_COLS = 60;
export const MAP_ROWS = 32;
export const HEX_SIZE = 12;
export const CANVAS_PAD = 18;
export const TEAM1_ZONE_END = Math.floor(MAP_COLS * 0.2);    // cols 0–9
export const TEAM2_ZONE_START = Math.ceil(MAP_COLS * 0.8);   // cols 42–51

export const CANVAS_W = Math.ceil((MAP_COLS + 0.5) * HEX_SIZE * SQRT3 + CANVAS_PAD * 2);
export const CANVAS_H = Math.ceil((MAP_ROWS - 1) * HEX_SIZE * 1.5 + HEX_SIZE * 2 + CANVAS_PAD * 2);

export const TILE_HP = { unclaimed: 50, claimed: 60, tower: 100 };
export const TILE_DAMAGE = { claim: 20, enemy: 20, tower: 25 };
export const REINFORCE_MULT = [1, 1.5, 2.5, 4];

// ── Coordinate helpers ───────────────────────────────────────────

export function tileKey(q, r) { return `${q},${r}`; }
export function parseKey(k) { const [q, r] = k.split(',').map(Number); return { q, r }; }

export function hexToPixel(q, r) {
  return {
    x: HEX_SIZE * SQRT3 * (q + 0.5 * (r & 1)) + CANVAS_PAD,
    y: HEX_SIZE * 1.5 * r + CANVAS_PAD,
  };
}

export function pixelToHex(px, py) {
  const x = px - CANVAS_PAD;
  const y = py - CANVAS_PAD;
  const qf = (SQRT3 / 3 * x - y / 3) / HEX_SIZE;
  const rf = (2 / 3 * y) / HEX_SIZE;
  const sf = -qf - rf;
  let rq = Math.round(qf), rr = Math.round(rf), rs = Math.round(sf);
  const dq = Math.abs(rq - qf), dr = Math.abs(rr - rf), ds = Math.abs(rs - sf);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return { q: rq + (rr - (rr & 1)) / 2, r: rr };
}

export function hexDist(q1, r1, q2, r2) {
  const ax = q1 - (r1 - (r1 & 1)) / 2, az = r1;
  const bx = q2 - (r2 - (r2 & 1)) / 2, bz = r2;
  const dx = ax - bx, dz = az - bz, dy = (-ax - az) - (-bx - bz);
  return (Math.abs(dx) + Math.abs(dy) + Math.abs(dz)) / 2;
}

export function getNeighbors(q, r) {
  return (r & 1
    ? [[1, 0], [1, -1], [0, -1], [-1, 0], [0, 1], [1, 1]]
    : [[1, 0], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1]]
  ).map(([dq, dr]) => ({ q: q + dq, r: r + dr }));
}

export function inBounds(q, r) {
  return q >= 0 && q < MAP_COLS && r >= 0 && r < MAP_ROWS;
}

export function hexCorners(cx, cy, size = HEX_SIZE) {
  return Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i - Math.PI / 6;
    return [cx + size * Math.cos(a), cy + size * Math.sin(a)];
  });
}

// ── Map generation ───────────────────────────────────────────────

function seededRNG(seed) {
  let s = seed >>> 0;
  return () => {
    s = Math.imul(1664525, s) + 1013904223 | 0;
    return (s >>> 0) / 4294967296;
  };
}

function buildMountainGrid(rng) {
  const density = 0.18;
  const grid = Array.from({ length: MAP_ROWS }, (_, r) =>
    Array.from({ length: MAP_COLS }, (_, q) =>
      q >= TEAM1_ZONE_END && q < TEAM2_ZONE_START ? rng() < density : false
    )
  );

  for (let iter = 0; iter < 2; iter++) {
    const next = grid.map((row) => [...row]);
    for (let r = 0; r < MAP_ROWS; r++) {
      for (let q = 0; q < MAP_COLS; q++) {
        if (q < TEAM1_ZONE_END || q >= TEAM2_ZONE_START) { next[r][q] = false; continue; }
        let n = 0;
        for (let dr = -1; dr <= 1; dr++)
          for (let dq = -1; dq <= 1; dq++)
            if ((dr || dq) && r + dr >= 0 && r + dr < MAP_ROWS && q + dq >= 0 && q + dq < MAP_COLS)
              n += grid[r + dr][q + dq] ? 1 : 0;
        next[r][q] = n >= 5 ? true : n <= 2 ? false : grid[r][q];
      }
    }
    for (let r = 0; r < MAP_ROWS; r++)
      for (let q = 0; q < MAP_COLS; q++) grid[r][q] = next[r][q];
  }
  return grid;
}

function ensurePercolation(grid) {
  const vis = Array.from({ length: MAP_ROWS }, () => new Uint8Array(MAP_COLS));
  const par = Array.from({ length: MAP_ROWS }, () => new Array(MAP_COLS).fill(null));
  const queue = [];

  for (let r = 0; r < MAP_ROWS; r++) {
    if (!grid[r][0]) { vis[r][0] = 1; queue.push([r, 0]); }
  }

  let end = null;
  while (queue.length && !end) {
    const [r, c] = queue.shift();
    if (c === MAP_COLS - 1) { end = [r, c]; break; }
    for (const [nr, nc] of [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]) {
      if (nr >= 0 && nr < MAP_ROWS && nc >= 0 && nc < MAP_COLS && !vis[nr][nc] && !grid[nr][nc]) {
        vis[nr][nc] = 1; par[nr][nc] = [r, c]; queue.push([nr, nc]);
      }
    }
  }
  if (end) return;

  // No path exists — carve one via BFS ignoring mountains
  const vis2 = Array.from({ length: MAP_ROWS }, () => new Uint8Array(MAP_COLS));
  const par2 = Array.from({ length: MAP_ROWS }, () => new Array(MAP_COLS).fill(null));
  const sr = Math.floor(MAP_ROWS / 2);
  vis2[sr][0] = 1;
  const q2 = [[sr, 0]];
  let end2 = null;
  while (q2.length && !end2) {
    const [r, c] = q2.shift();
    if (c === MAP_COLS - 1) { end2 = [r, c]; break; }
    for (const [nr, nc] of [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]) {
      if (nr >= 0 && nr < MAP_ROWS && nc >= 0 && nc < MAP_COLS && !vis2[nr][nc]) {
        vis2[nr][nc] = 1; par2[nr][nc] = [r, c]; q2.push([nr, nc]);
      }
    }
  }
  if (!end2) return;
  let [r, c] = end2;
  while (par2[r][c]) { grid[r][c] = false; [r, c] = par2[r][c]; }
  grid[r][c] = false;
}

export function generateMap(seed) {
  const rng = seededRNG(seed);
  const mGrid = buildMountainGrid(rng);
  ensurePercolation(mGrid);

  const tiles = {};
  for (let r = 0; r < MAP_ROWS; r++) {
    for (let q = 0; q < MAP_COLS; q++) {
      const isMtn = mGrid[r][q];
      const owner = !isMtn && q < TEAM1_ZONE_END ? 'team1'
        : !isMtn && q >= TEAM2_ZONE_START ? 'team2'
        : null;
      tiles[tileKey(q, r)] = {
        q, r,
        type: isMtn ? 'mountain' : 'grass',
        owner,
        hp: isMtn ? 0 : owner ? TILE_HP.claimed : 0,
        maxHp: isMtn ? 0 : owner ? TILE_HP.claimed : 0,
        reinforceTier: 0,
        isTower: false,
      };
    }
  }
  return tiles;
}
