# Breach policy trainer

Adversarial self-play trainer for the breach Neural Team Planner. Evolves
a population of policy networks by pitting them against each other in
short, headless breach matches. The champion of each run is written as a
JSON weights file the game's `NeuralTeamPlanner.js` can load directly.

## Quick start

```
cd training
node smoke.js          # 1 match, random-init policies — sanity check
node train.js          # full training run with defaults
node eval.js --challenger weights.trained.json
                       # trained NN vs the currently-shipped baseline NN
```

Drop the final `weights.trained.json` file in as
`src/modes/breach/neural/weights.default.json` and the game picks it up
on next page load.

## How it's structured

```
training/
  env.js           match simulator — imports the real game code from
                   src/ and drives it. There is NO ported game logic
                   here; resolveTick/runTurn/Bomb/rules are the ones
                   from the arena, verbatim. Zero train/deploy drift.
  rewards.js       per-tick + terminal reward function, fully documented.
                   Read the DESIGN NOTES header before tuning.
  population.js    flatten/unflatten, Gaussian mutation, uniform
                   crossover, tournament selection, elitism.
  pool.js          worker pool. Dispatches match jobs, tracks
                   utilization, handles worker crashes, shutdown.
  worker.js        per-worker entry point. Loads the engine once,
                   runs match jobs on demand.
  train.js         main loop (parallel): population setup →
                   for each generation: schedule matches →
                   pool.runMatch(…)[] in parallel → accumulate
                   fitness → select / mutate → repeat.
  eval.js          head-to-head between two neural weights files.
                   Common use: `--challenger weights.trained.json`
                   compares freshly-trained weights against the
                   currently-shipped baseline. The rule-based
                   planner has been stripped, so there is no
                   built-in reference — all comparisons are
                   between two NN policies.
  smoke.js         one-match sanity check; run this first after any
                   change to verify the wiring.
```

## Parallelism

Matches are embarrassingly parallel: independent map, independent RNG,
independent policies. `pool.js` spawns W long-lived worker threads (default
`os.cpus().length - 1`) and distributes match jobs across them. Every
generation dispatches all its matches at once; the main thread awaits via
`Promise.all` and accumulates fitness as results stream back.

**Typical throughput (8-core laptop, default CLI):**

```
⚡ spawned 7 worker(s)
⚡ warmup completed in ~300ms
gen 000  …  throughput=140/s     matches/s across all workers
gen 001  …  throughput=180/s
…
── Pool stats ────────────────────
  mean worker util:    96%        cores well-fed
  matches per worker:  29, 28, 30, 28, 29, 28, 29
```

**Controls:**

- `--workers N` — override worker count. Setting `--workers 1` recovers
  single-threaded behaviour; useful for benchmarking or debugging.
- `--noWarmup` — skip the one-shot per-worker warmup. Not recommended
  for real runs; first-generation timing will be inflated.

**Scaling hints:**

- Match throughput scales linearly with core count up until memory
  bandwidth saturates (~16 cores on typical consumer hardware).
- The main thread's serial work is O(matches_per_gen) for fitness
  bookkeeping, which is ~10µs per match — a rounding error. Don't bother
  parallelizing it.
- If the pool's match duration rises steeply with `--workers`, you're
  oversubscribing. Drop `--workers` until `mean worker util` hits ~95%+.

**Worker crash handling:** If a worker crashes mid-match (rare; usually
means an unhandled exception in a new env.js code path), the pool
rejects the in-flight promise, respawns the worker, and lets the
generation finish with one fewer active slot. The main loop sees a
rejected promise and aborts cleanly — you get a stack trace pointing
at the bad tick.

## Reward function

The full design is at the top of `rewards.js`. Short version:

| Term                              | Magnitude      | Purpose                                          |
|-----------------------------------|---------------:|--------------------------------------------------|
| Match win / loss                  | ±100           | Dominates fitness — the thing we actually want.  |
| Site won / lost                   | ±25            | Differentiate 6–0 blowouts from 4–2 squeakers.   |
| Self plant / defuse               | +8             | Atomic strategic events.                         |
| Teammate plant / defuse assist    | +2             | Credit-share so supporters learn to coordinate.  |
| Kill / death                      | +3 / −2        | Disruption bonus; death barely penalized so net isn't cowardly. |
| Damage dealt / taken per HP       | +0.08 / −0.04  | Fine-grained trade credit.                       |
| Attacker hex closer / further to site | +0.10 / −0.05 | Potential-based shaping toward objective.    |
| Defender within 3 hex of idle site | +0.15 / tick  | Coverage reward, not clustering.                 |
| Unspent points above 150          | −0.00005 / tick| Light nudge against hoarding.                    |
| Rejected action (resolver failure) | −0.5          | Safety net; should be rare if masks work.        |

**Why not pure sparse reward (just +100/−100)?** Because a match is a
100+ decision sequence and in the first generations every policy is
noise. Without shaping, random-init fitness is pure noise and evolution
has no gradient to climb. Shaping gives dense learning signal early,
and the terminal component dominates once policies start actually
completing site-rounds.

**Why evolutionary, not PPO/REINFORCE?** Zero DL framework dependency,
trivially parallel across matches (no parameter server), no KL/advantage
bookkeeping. Trades ~10x sample efficiency for operational simplicity.
For a 33K-parameter MLP trained on 50,000+ matches, the extra samples
cost less than the engineering overhead of a gradient-based pipeline.

## CLI reference

```
--generations N          how many generations to run (default 30)
--population N           population size (default 24)
--matchesPerGen N        matches played per generation TOTAL
                         (default 60). Each individual plays roughly
                         (matchesPerGen × 2 / population) matches.
--elite N                elitism slot count (default 4). Top-N
                         pass through unchanged; without this, any
                         bad mutation can throw away hard-won progress.
--mutationRate F         fraction of weights perturbed (default 0.1)
--mutationSigma F        perturbation std-dev (default 0.05)
--tournamentK N          tournament selection size (default 4)
--sampleTemp F           exploration temperature during training (0.8).
                         At deploy time the planner uses argmax —
                         this only affects training matches.
--workers N              worker thread count (default: CPU - 1)
--noWarmup               skip per-worker warmup (bench only)
--seed N                 RNG seed (default: time-based)
--out PATH               champion weights output path
--bestEveryGen           also write per-generation checkpoints
```

## Guidance for real runs

- **Initial exploration:** `--generations 50 --population 32
  --matchesPerGen 160`. About 15 minutes on a laptop. Produces weights
  that play coherently (push sites, attempt plants, anchor defenders).
- **Tuned weights for shipping:** `--generations 200 --population 48
  --matchesPerGen 300`. 2–4 hours overnight. Eval a challenger from this
  run against your current `weights.default.json` and ship if the
  verdict is "challenger beats baseline".
- **Research sweeps:** run several in parallel with different `--seed`
  and `--mutationSigma`. Evolutionary trainers are variance-y; averaging
  across seeds gives a much cleaner progress curve.

## Extending

- **New observation features:** add to `src/modes/breach/neural/Observation.js`,
  increment `OBS_DIM`, change `format` in Network.js, retrain from scratch.
  Old weights files can no longer be loaded — intentional; shape mismatch
  throws.
- **New action primitives** (e.g. a `breach_wall` head): add to
  `PRIMARY` enum in `Network.js`, extend `ActionDecoder.buildMask`,
  extend `ActionDecoder.decodeAction`. Both training and runtime pick
  up the new head automatically once the format version is bumped.
- **New reward terms:** add to `REWARDS` in `rewards.js`, apply in
  `computeTickRewards` or `computeTerminalRewards`. No other file
  knows the reward function — by design.
- **Larger net:** change `--hidden` (currently hard-coded to `[128, 128]`;
  easy to make a CLI flag). The inference path in `Network.js` is
  agnostic to layer count — you'd need to generalize the layer loop,
  which is ~5 lines.
