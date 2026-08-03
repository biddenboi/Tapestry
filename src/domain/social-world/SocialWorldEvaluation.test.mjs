import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SOCIAL_WORLD_EVALUATION_MODE,
  buildSocialWorldEvaluationScenario,
  summarizeSocialWorldEvaluation,
} from './SocialWorldEvaluation.js';

const members = [
  { profileId: 'a', identity: { profileId: 'a', username: 'A' }, presence: { elapsedHere: 10, startedIGT: 5 } },
  { profileId: 'b', identity: { profileId: 'b', username: 'B' }, presence: { elapsedHere: 20, startedIGT: 4 } },
  { profileId: 'c', identity: { profileId: 'c', username: 'C' }, presence: { elapsedHere: 30, startedIGT: 3 } },
];

test('evaluation variants are deterministic and never mutate production members', () => {
  const shuffled = buildSocialWorldEvaluationScenario(members, {
    mode: SOCIAL_WORLD_EVALUATION_MODE.shuffled,
    seed: 14,
  });
  assert.deepEqual(
    shuffled.map((member) => member.identity.profileId),
    buildSocialWorldEvaluationScenario(members, { mode: 'shuffled', seed: 14 })
      .map((member) => member.identity.profileId),
  );
  assert.notDeepEqual(shuffled.map((member) => member.identity.profileId), ['a', 'b', 'c']);
  assert.deepEqual(members.map((member) => member.identity.profileId), ['a', 'b', 'c']);

  const timeless = buildSocialWorldEvaluationScenario(members, { mode: 'timeless' });
  assert.equal(timeless[0].presence.elapsedHere, null);
  assert.equal(members[0].presence.elapsedHere, 10);
});

test('recognition gate requires enough reports and a strict live win on both measures', () => {
  const observations = [
    ...Array.from({ length: 3 }, () => ({ mode: 'live', identified: true, threadRecalled: true })),
    { mode: 'shuffled', identified: true, threadRecalled: false },
    { mode: 'shuffled', identified: false, threadRecalled: false },
    { mode: 'shuffled', identified: false, threadRecalled: true },
  ];
  const result = summarizeSocialWorldEvaluation(observations);
  assert.equal(result.enoughEvidence, true);
  assert.equal(result.outperformsShuffled, true);
  assert.equal(summarizeSocialWorldEvaluation(observations.slice(0, 4)).enoughEvidence, false);
});

