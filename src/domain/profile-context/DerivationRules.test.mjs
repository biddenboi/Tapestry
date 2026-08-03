import assert from 'node:assert/strict';
import test from 'node:test';
import { DAY, HOUR } from '../constants.js';
import { buildContextSuggestions, deriveProfileContextFacts } from './DerivationRules.js';

test('derivation publishes bounded facts and never copies exact deadline titles into suggestions', () => {
  const cursor = 30 * DAY;
  const now = new Date('2026-07-27T12:00:00.000Z');
  const facts = deriveProfileContextFacts({
    viewerIGT: cursor,
    now,
    todos: [
      { UUID: 'secret-deadline', name: 'Private medical appointment', dueInGameTimestamp: cursor + HOUR },
      { UUID: 'later', name: 'Beyond horizon', dueInGameTimestamp: cursor + (80 * HOUR) },
    ],
    tasks: [
      { UUID: 'done-1', completedAt: now.toISOString(), completedInGameTimestamp: cursor - HOUR, projectId: 'new' },
      { UUID: 'done-2', completedAt: now.toISOString(), completedInGameTimestamp: cursor - (2 * HOUR), projectId: 'new' },
      { UUID: 'old', completedAt: now.toISOString(), completedInGameTimestamp: cursor - (10 * DAY), projectId: 'old' },
    ],
    actionSessions: [{
      UUID: 'blocked',
      outcome: 'blocked',
      updatedAt: new Date(now.getTime() - (50 * HOUR)).toISOString(),
    }],
    projects: [
      { UUID: 'new', name: 'Public launch' },
      { UUID: 'old', name: 'Research phase' },
    ],
  });
  assert.equal(facts.deadlineCount72h, 1);
  assert.equal(facts.meaningfulCompletionCount7d, 2);
  assert.equal(facts.persistentBlockerCount, 1);
  const suggestions = buildContextSuggestions(facts, { now });
  assert.equal(suggestions.length, 3);
  assert.equal(suggestions.some((entry) => entry.text.includes('Private medical appointment')), false);
  assert.equal(suggestions[0].text, '1 commitment in the next 72 hours');
  const nextSuggestion = buildContextSuggestions(facts, {
    existingKeys: new Set(suggestions.map((entry) => entry.key)),
    now,
  });
  assert.equal(nextSuggestion.length, 1);
  assert.match(nextSuggestion[0].key, /^focus-shift:/);
});
