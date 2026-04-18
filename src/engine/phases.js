/**
 * Generic phase state machine.
 *
 * A mode declares its phase sequence and per-edge guard predicates. The engine
 * uses `transitionPhase(match, fromPhase, toPhase, descriptor)` to advance
 * phases, asserting the guard holds. Any guard failure throws — silent
 * fall-through is precisely the bug this utility exists to prevent.
 *
 * Mode descriptor shape (phase-related fields):
 *   {
 *     phases: string[],                       // ordered phase ids
 *     transitions: {
 *       [fromPhase]: {
 *         [toPhase]: (match) => true | string // true allows, string rejects
 *       }
 *     },
 *     getPhase?(match): string,               // defaults to match.phase
 *     setPhase?(match, phase): match,         // defaults to {...match, phase}
 *   }
 *
 * The `getPhase`/`setPhase` pair lets a mode store its phase anywhere in the
 * match record (e.g. breach stores at `match.breach.phase` to keep mode
 * state encapsulated in a single envelope).
 */

function defaultGetPhase(match) { return match?.phase; }
function defaultSetPhase(match, phase) { return { ...match, phase }; }

function getPhase(match, descriptor) {
  return (descriptor?.getPhase || defaultGetPhase)(match);
}

function setPhase(match, phase, descriptor) {
  return (descriptor?.setPhase || defaultSetPhase)(match, phase);
}

export function nextPhase(descriptor, current) {
  if (!descriptor?.phases) return null;
  const idx = descriptor.phases.indexOf(current);
  if (idx < 0 || idx >= descriptor.phases.length - 1) return null;
  return descriptor.phases[idx + 1];
}

/**
 * Attempt a transition. Returns the match with the new phase installed via
 * the descriptor's setPhase if the guard passes. Throws otherwise.
 * Pure — the caller persists.
 */
export function transitionPhase(match, fromPhase, toPhase, descriptor) {
  if (!match) throw new Error('transitionPhase: match is required');
  const current = getPhase(match, descriptor);
  if (current !== fromPhase) {
    throw new Error(
      `transitionPhase: expected current phase "${fromPhase}", got "${current}"`,
    );
  }
  const edges = descriptor?.transitions?.[fromPhase];
  const guard = edges?.[toPhase];
  if (!guard) {
    throw new Error(`transitionPhase: no edge declared from "${fromPhase}" to "${toPhase}"`);
  }
  const result = guard(match);
  if (result !== true) {
    const detail = typeof result === 'string' ? `: ${result}` : '';
    throw new Error(`transitionPhase: guard rejected "${fromPhase}" → "${toPhase}"${detail}`);
  }
  return setPhase(match, toPhase, descriptor);
}

export function canTransition(match, fromPhase, toPhase, descriptor) {
  if (!match) return { ok: false, reason: 'no match' };
  const current = getPhase(match, descriptor);
  if (current !== fromPhase) return { ok: false, reason: `not in phase ${fromPhase}` };
  const guard = descriptor?.transitions?.[fromPhase]?.[toPhase];
  if (!guard) return { ok: false, reason: 'no such edge' };
  const result = guard(match);
  if (result === true) return { ok: true };
  return { ok: false, reason: typeof result === 'string' ? result : 'guard rejected' };
}
