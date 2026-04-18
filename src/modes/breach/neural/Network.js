/**
 * Pure-JS multi-layer perceptron with a small multi-head output.
 *
 * Designed for the breach Neural Team Planner. Single dependency-free forward
 * pass that runs fine in both the browser (at game time, one forward per
 * ghost per tick) and Node (during training, millions of forwards across
 * self-play matches).
 *
 * ── Architecture ──────────────────────────────────────────────────
 *
 *   obs  →  Linear(obsDim, H1) → ReLU
 *        →  Linear(H1, H2)     → ReLU
 *        →  three output heads, all linear from H2:
 *               primary     (PRIMARY_DIM logits)   — WAIT / MOVE / SPRINT / …
 *               direction   (DIRECTION_DIM logits) — which of the 6 hex dirs
 *               sprintLen   (SPRINT_LEN_DIM logits) — sprint length bucket
 *
 * Heads are sampled independently. Invalid options are masked to -Infinity
 * before softmax so the policy never emits an action the rules would reject.
 *
 * ── Weight file format ────────────────────────────────────────────
 *
 * Canonical JSON shape (what train.js writes and the arena loads):
 *
 *   {
 *     "format": "breach-policy-v1",
 *     "arch":   { "obsDim": 112, "hidden": [128, 128],
 *                 "primaryDim": 7, "directionDim": 6, "sprintLenDim": 3 },
 *     "meta":   { "createdAt": "...", "generation": 42, ... },   // optional
 *     "weights": {
 *       "W1": [...flat row-major obsDim*H1...],    "b1": [...H1...],
 *       "W2": [...H1*H2...],                       "b2": [...H2...],
 *       "Wp": [...H2*primaryDim...],               "bp": [...primaryDim...],
 *       "Wd": [...H2*directionDim...],             "bd": [...directionDim...],
 *       "Ws": [...H2*sprintLenDim...],             "bs": [...sprintLenDim...]
 *     }
 *   }
 *
 * Flat arrays (not nested matrices) keep the file compact and make
 * mutation during training trivial (one-dimensional Gaussian perturbation).
 */

// ── Output-head dimensions ────────────────────────────────────────
//
// Kept in this file (not Constants.js) because they're tied to this net's
// output layer, not to gameplay balance. Changing these invalidates any
// previously-trained weights file — bump the `format` version if you do.

export const PRIMARY_DIM = 7;      // WAIT, MOVE, SPRINT, ATTACK, PLANT, DEFUSE, RESPAWN
export const DIRECTION_DIM = 6;    // six hex directions
export const SPRINT_LEN_DIM = 3;   // sprint lengths [2, 3, 4]

export const PRIMARY = Object.freeze({
  WAIT:    0,
  MOVE:    1,
  SPRINT:  2,
  ATTACK:  3,
  PLANT:   4,
  DEFUSE:  5,
  RESPAWN: 6,
});

export const SPRINT_LENGTHS = [2, 3, 4];

// ── Forward pass ──────────────────────────────────────────────────

function linear(input, W, b, outDim, inDim) {
  // out[i] = sum_j input[j] * W[i*inDim + j] + b[i]
  const out = new Float32Array(outDim);
  for (let i = 0; i < outDim; i += 1) {
    let s = b[i];
    const rowStart = i * inDim;
    for (let j = 0; j < inDim; j += 1) s += input[j] * W[rowStart + j];
    out[i] = s;
  }
  return out;
}

function reluInPlace(v) {
  for (let i = 0; i < v.length; i += 1) if (v[i] < 0) v[i] = 0;
  return v;
}

/**
 * Construct an inference-ready network from a weights object (JSON-loaded
 * or hand-built). Validates shapes so a bad file fails loudly rather than
 * producing silently-corrupt plans in the arena.
 */
export function buildNet(spec) {
  if (!spec || spec.format !== 'breach-policy-v1') {
    throw new Error(`Network: unsupported weights format "${spec?.format}"`);
  }
  const { arch, weights } = spec;
  if (!arch || !weights) throw new Error('Network: weights file missing arch or weights');
  const { obsDim, hidden } = arch;
  if (!Number.isInteger(obsDim) || obsDim <= 0) throw new Error('Network: bad obsDim');
  if (!Array.isArray(hidden) || hidden.length !== 2) {
    throw new Error('Network: architecture must have exactly 2 hidden layers');
  }
  const primaryDim   = arch.primaryDim   ?? PRIMARY_DIM;
  const directionDim = arch.directionDim ?? DIRECTION_DIM;
  const sprintLenDim = arch.sprintLenDim ?? SPRINT_LEN_DIM;
  const [H1, H2] = hidden;

  const need = {
    W1: obsDim * H1, b1: H1,
    W2: H1 * H2,     b2: H2,
    Wp: H2 * primaryDim,   bp: primaryDim,
    Wd: H2 * directionDim, bd: directionDim,
    Ws: H2 * sprintLenDim, bs: sprintLenDim,
  };
  for (const [k, expected] of Object.entries(need)) {
    const actual = weights[k]?.length;
    if (actual !== expected) {
      throw new Error(`Network: weights.${k} expected ${expected} floats, got ${actual}`);
    }
  }

  // Coerce to Float32Array once — much faster than plain arrays through the
  // matmul tight loop, and no per-call allocation.
  const W = Object.fromEntries(
    Object.keys(need).map((k) => [k, Float32Array.from(weights[k])]),
  );

  return {
    obsDim,
    primaryDim,
    directionDim,
    sprintLenDim,
    /**
     * Forward pass. Returns raw logits for each head — sampling / masking is
     * the caller's job (ActionDecoder.js).
     */
    forward(obs) {
      if (obs.length !== obsDim) {
        throw new Error(`Network.forward: obs dim ${obs.length} != expected ${obsDim}`);
      }
      const h1 = reluInPlace(linear(obs, W.W1, W.b1, H1, obsDim));
      const h2 = reluInPlace(linear(h1,  W.W2, W.b2, H2, H1));
      return {
        primary:   linear(h2, W.Wp, W.bp, primaryDim,   H2),
        direction: linear(h2, W.Wd, W.bd, directionDim, H2),
        sprintLen: linear(h2, W.Ws, W.bs, sprintLenDim, H2),
      };
    },
  };
}

// ── Sampling helpers ──────────────────────────────────────────────

/**
 * Argmax with a mask. Mask is a boolean array; a false entry means "illegal"
 * and that index is never returned. Returns the legal index with the highest
 * logit, or -1 if the mask is all-false.
 */
export function maskedArgmax(logits, mask) {
  let best = -1;
  let bestVal = -Infinity;
  for (let i = 0; i < logits.length; i += 1) {
    if (!mask[i]) continue;
    if (logits[i] > bestVal) { bestVal = logits[i]; best = i; }
  }
  return best;
}

/**
 * Stochastic masked sample via softmax with temperature. Used during
 * training for exploration; the in-game planner prefers maskedArgmax for
 * deterministic, replay-stable behaviour.
 *
 * `rng` is a [0,1) function — pass a seeded one for reproducibility.
 */
export function maskedSample(logits, mask, rng, temperature = 1.0) {
  // Stable softmax: subtract max over legal entries.
  let maxLogit = -Infinity;
  for (let i = 0; i < logits.length; i += 1) {
    if (mask[i] && logits[i] > maxLogit) maxLogit = logits[i];
  }
  if (maxLogit === -Infinity) return -1;

  const temp = Math.max(1e-6, temperature);
  const probs = new Float32Array(logits.length);
  let sum = 0;
  for (let i = 0; i < logits.length; i += 1) {
    if (!mask[i]) { probs[i] = 0; continue; }
    const p = Math.exp((logits[i] - maxLogit) / temp);
    probs[i] = p;
    sum += p;
  }
  if (sum <= 0) return -1;

  const roll = rng() * sum;
  let acc = 0;
  for (let i = 0; i < logits.length; i += 1) {
    acc += probs[i];
    if (roll < acc) return i;
  }
  // Floating-point fallthrough — return the last legal index.
  for (let i = logits.length - 1; i >= 0; i -= 1) if (mask[i]) return i;
  return -1;
}

// ── Weight-file helpers (used by both runtime and trainer) ────────

/**
 * Compute the total parameter count for a given architecture. Useful for
 * logging, for allocating mutation buffers, and for sanity-checking files.
 */
export function paramCount(arch) {
  const obsDim = arch.obsDim;
  const [H1, H2] = arch.hidden;
  const p  = arch.primaryDim   ?? PRIMARY_DIM;
  const dD = arch.directionDim ?? DIRECTION_DIM;
  const sD = arch.sprintLenDim ?? SPRINT_LEN_DIM;
  return (obsDim * H1) + H1
       + (H1 * H2)     + H2
       + (H2 * p)      + p
       + (H2 * dD)     + dD
       + (H2 * sD)     + sD;
}

/**
 * Produce a weights object initialized with small Gaussian noise (Kaiming-
 * ish scaling). Used at training time for the initial population and when
 * reseeding dead individuals. Pure function of `rng`.
 */
export function randomWeights(arch, rng = Math.random) {
  const [H1, H2] = arch.hidden;
  const obsDim = arch.obsDim;
  const primaryDim   = arch.primaryDim   ?? PRIMARY_DIM;
  const directionDim = arch.directionDim ?? DIRECTION_DIM;
  const sprintLenDim = arch.sprintLenDim ?? SPRINT_LEN_DIM;

  const gauss = () => {
    // Box–Muller.
    const u = Math.max(1e-9, rng());
    const v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const layer = (inDim, outDim) => {
    const scale = Math.sqrt(2 / inDim);   // Kaiming for ReLU.
    const W = new Array(inDim * outDim);
    for (let i = 0; i < W.length; i += 1) W[i] = gauss() * scale;
    const b = new Array(outDim).fill(0);
    return { W, b };
  };
  const l1 = layer(obsDim, H1);
  const l2 = layer(H1, H2);
  const lp = layer(H2, primaryDim);
  const ld = layer(H2, directionDim);
  const ls = layer(H2, sprintLenDim);
  return {
    format: 'breach-policy-v1',
    arch: { obsDim, hidden: [H1, H2], primaryDim, directionDim, sprintLenDim },
    weights: {
      W1: l1.W, b1: l1.b,
      W2: l2.W, b2: l2.b,
      Wp: lp.W, bp: lp.b,
      Wd: ld.W, bd: ld.b,
      Ws: ls.W, bs: ls.b,
    },
  };
}
