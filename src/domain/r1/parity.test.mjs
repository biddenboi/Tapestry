import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { R1State } from '@domain/r1/state.js';
import { decideWith } from '@domain/r1/decide.js';
function same(actual, expected, path) {
  if (typeof expected === 'number') assert.ok(Math.abs(actual - expected) <= 1e-6 * (1 + Math.max(Math.abs(actual), Math.abs(expected))), `${path}: ${actual} != ${expected}`);
  else if (Array.isArray(expected)) { assert.equal(actual.length, expected.length, `${path}.length`); expected.forEach((v, i) => same(actual[i], v, `${path}[${i}]`)); }
  else if (expected && typeof expected === 'object') { assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), path); for (const key of Object.keys(expected)) same(actual[key], expected[key], `${path}.${key}`); }
  else assert.equal(actual, expected, path);
}
for (const filename of ['r1_traces.json', 'm2_traces.json', 'r1_habit_traces.json']) {
  test(`R1 parity: every decision field in ${filename}`, async () => {
    const fixture = JSON.parse(await readFile(new URL(`../../../docs/r1/reference/crates/lot-r1/tests/fixtures/${filename}`, import.meta.url)));
    let count = 0;
    for (const c of fixture.cases) {
      const habits = filename === 'r1_habit_traces.json';
      const m = new R1State({ s: c.s, policy: c.policy || 'r1', shiftStart: false, habitPacing: habits, habitExtraOnce: habits }, { rewards: c.rewards, rest: c.rest });
      let applied = 0;
      for (const st of c.decisions) {
        while (applied < st.after) m.apply(c.events[applied++]);
        same(decideWith(m, st.now, st.omega ?? null), st.decision, `${c.family}/${c.seed}/${c.policy} at ${st.now}`); count++;
      }
      while (applied < c.events.length) m.apply(c.events[applied++]);
      if (c.missed) same(m.missed, c.missed, `${c.family} missed`);
    }
    assert.ok(count > 1000);
  });
}
