/**
 * Breach map templates.
 *
 * Each template hand-authors corridor-based arena geometry:
 *
 *   {
 *     id, label,
 *     mountainStamps:        stamp regions (rect or blob),
 *     corridorSkeleton:      explicitly-open lanes carved over mountains,
 *     candidateSiteAnchors:  pre-validated bomb-site candidates,
 *     spawnZones:            { attacker: [...], defender: [...] },
 *   }
 *
 * Anchor positions have been verified offline to satisfy spec §3.2 constraints
 * with the values in Constants.js (MIN_SITE_SPACING=12, MIN_SPAWN_SITE_DIST=8,
 * MAX_SPAWN_SITE_DIST=22). Adding a new template requires the same offline
 * verification — if the constraint solver falls back at runtime, the template
 * is misauthored.
 */

// ── Helpers for authoring ─────────────────────────────────────────

function line(q0, r0, q1, r1) {
  const steps = Math.max(Math.abs(q1 - q0), Math.abs(r1 - r0)) + 1;
  const out = [];
  for (let i = 0; i < steps; i += 1) {
    const t = steps === 1 ? 0 : i / (steps - 1);
    out.push({ q: Math.round(q0 + (q1 - q0) * t), r: Math.round(r0 + (r1 - r0) * t) });
  }
  return out;
}

// ── Quarry: vertical triangle of sites, central spine ────────────
// Anchors verified:
//   A(18,4)  B(22,16)  C(18,28)
//   pairwise hex-dist: 12, 12, 24  (all ≥ 12)
//   attacker(4,16) distances: 20, 18, 20  (all in [8, 22])
//   defender(54,16) distances: 42, 32, 42  (all ≥ 8)

const QUARRY = {
  id: 'quarry',
  label: 'Quarry',
  mountainStamps: [
    { kind: 'rect', q0: 10, r0: 8,  q1: 15, r1: 12 },
    { kind: 'rect', q0: 10, r0: 20, q1: 15, r1: 24 },
    { kind: 'rect', q0: 26, r0: 8,  q1: 31, r1: 12 },
    { kind: 'rect', q0: 26, r0: 20, q1: 31, r1: 24 },
    { kind: 'rect', q0: 36, r0: 2,  q1: 52, r1: 11 },
    { kind: 'rect', q0: 36, r0: 21, q1: 52, r1: 29 },
    { kind: 'blob', q: 30, r: 16, radius: 2 },
  ],
  corridorSkeleton: [
    { path: line(3,  16, 56, 16) },  // central lane
    { path: line(10, 4,  36, 4)  },  // upper lane
    { path: line(10, 28, 36, 28) },  // lower lane
    { path: line(18, 4,  18, 28) },  // vertical through A and C
    { path: line(22, 4,  22, 28) },  // vertical through B
    { path: line(36, 4,  36, 28) },  // right spine
    { path: line(44, 4,  44, 28) },
  ],
  candidateSiteAnchors: [
    { q: 18, r: 4  },
    { q: 22, r: 16 },
    { q: 18, r: 28 },
    // Spares the solver can consider if primary triple fails a per-map check:
    { q: 22, r: 4  },
    { q: 18, r: 16 },
    { q: 22, r: 28 },
  ],
  spawnZones: {
    attacker: [
      { q: 3, r: 14 }, { q: 3, r: 15 }, { q: 3, r: 16 }, { q: 3, r: 17 }, { q: 3, r: 18 },
      { q: 5, r: 15 }, { q: 5, r: 16 }, { q: 5, r: 17 },
    ],
    defender: [
      { q: 55, r: 14 }, { q: 55, r: 15 }, { q: 55, r: 16 }, { q: 55, r: 17 }, { q: 55, r: 18 },
      { q: 53, r: 15 }, { q: 53, r: 16 }, { q: 53, r: 17 },
    ],
  },
};

// ── Foundry: tighter corridors, slightly different anchor pattern ─
// Anchors verified:
//   A(16,6)  B(24,16)  C(16,26)
//   pairwise: 13, 20, 13  (all ≥ 12)
//   attacker(4,16): 17, 18, 17  (all in [8, 22])
//   defender(54,16): 44, 31, 44  (all ≥ 8)

const FOUNDRY = {
  id: 'foundry',
  label: 'Foundry',
  mountainStamps: [
    { kind: 'rect', q0: 9,  r0: 10, q1: 13, r1: 13 },
    { kind: 'rect', q0: 9,  r0: 19, q1: 13, r1: 22 },
    { kind: 'rect', q0: 19, r0: 10, q1: 22, r1: 13 },
    { kind: 'rect', q0: 19, r0: 19, q1: 22, r1: 22 },
    { kind: 'rect', q0: 28, r0: 2,  q1: 52, r1: 9  },
    { kind: 'rect', q0: 28, r0: 23, q1: 52, r1: 30 },
    { kind: 'blob', q: 30, r: 16, radius: 3 },
  ],
  corridorSkeleton: [
    { path: line(3,  15, 56, 15) },  // central upper lane
    { path: line(3,  17, 56, 17) },  // central lower lane (double-wide)
    { path: line(7,  6,  28, 6)  },
    { path: line(7,  26, 28, 26) },
    { path: line(16, 6,  16, 26) },  // vertical through A and C
    { path: line(24, 6,  24, 26) },  // vertical through B
    { path: line(36, 4,  36, 28) },
    { path: line(48, 4,  48, 28) },
  ],
  candidateSiteAnchors: [
    { q: 16, r: 6  },
    { q: 24, r: 16 },
    { q: 16, r: 26 },
    // Spares:
    { q: 24, r: 6  },
    { q: 16, r: 16 },
    { q: 24, r: 26 },
  ],
  spawnZones: {
    attacker: [
      { q: 3, r: 14 }, { q: 3, r: 15 }, { q: 3, r: 16 }, { q: 3, r: 17 }, { q: 3, r: 18 },
      { q: 5, r: 15 }, { q: 5, r: 16 }, { q: 5, r: 17 },
    ],
    defender: [
      { q: 55, r: 14 }, { q: 55, r: 15 }, { q: 55, r: 16 }, { q: 55, r: 17 }, { q: 55, r: 18 },
      { q: 53, r: 15 }, { q: 53, r: 16 }, { q: 53, r: 17 },
    ],
  },
};

export const TEMPLATES = [QUARRY, FOUNDRY];

export function templateById(id) {
  return TEMPLATES.find((t) => t.id === id) || TEMPLATES[0];
}
