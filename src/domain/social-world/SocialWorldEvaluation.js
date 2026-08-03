export const SOCIAL_WORLD_EVALUATION_VERSION = 1;

export const SOCIAL_WORLD_EVALUATION_MODE = Object.freeze({
  live: 'live',
  shuffled: 'shuffled',
  timeless: 'timeless',
});

export const SOCIAL_WORLD_ANALYTICS_EVENT = Object.freeze({
  sceneViewed: 'social_scene_viewed',
  profileDrawerOpened: 'social_profile_drawer_opened',
  changeViewed: 'social_change_viewed',
  profileIdentified: 'social_profile_identified',
  threadRecalled: 'social_thread_recalled',
  attainabilityReported: 'social_attainability_reported',
  belongingReported: 'social_belonging_reported',
});

export const SOCIAL_WORLD_REPORT_PROMPTS = Object.freeze([
  Object.freeze({
    key: 'identified',
    eventName: SOCIAL_WORLD_ANALYTICS_EVENT.profileIdentified,
    label: 'Did you recognize this profile?',
  }),
  Object.freeze({
    key: 'threadRecalled',
    eventName: SOCIAL_WORLD_ANALYTICS_EVENT.threadRecalled,
    label: 'Could you recall their current thread?',
  }),
  Object.freeze({
    key: 'attainable',
    eventName: SOCIAL_WORLD_ANALYTICS_EVENT.attainabilityReported,
    label: 'Does their progress feel attainable?',
  }),
  Object.freeze({
    key: 'belonging',
    eventName: SOCIAL_WORLD_ANALYTICS_EVENT.belongingReported,
    label: 'Do they feel part of this world?',
  }),
]);

function seededUnit(seed) {
  let value = Math.trunc(Number(seed) || 1) >>> 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  return (value >>> 0) / 0x100000000;
}

function shuffledIndexes(length, seed) {
  const indexes = Array.from({ length }, (_, index) => index);
  for (let index = indexes.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(seededUnit((Number(seed) || 1) + index * 2654435761) * (index + 1));
    [indexes[index], indexes[swap]] = [indexes[swap], indexes[index]];
  }
  if (indexes.length > 1 && indexes.every((value, index) => value === index)) {
    indexes.push(indexes.shift());
  }
  return indexes;
}

function timelessPresence(presence = {}) {
  return Object.freeze({
    ...presence,
    elapsedHere: null,
    activeElapsed: null,
    startedIGT: null,
    endedIGT: null,
    lastActiveIGT: null,
    presentation: presence.presentation ? Object.freeze({
      ...presence.presentation,
      secondary: null,
    }) : null,
  });
}

/**
 * Produces evaluation-only presentation variants. This module is deliberately
 * independent of residency and cast selection, so a baseline can never alter
 * who appears in the production scene.
 */
export function buildSocialWorldEvaluationScenario(members = [], {
  mode = SOCIAL_WORLD_EVALUATION_MODE.live,
  seed = 1,
} = {}) {
  const source = (members || []).map((member) => ({ ...member }));
  if (mode === SOCIAL_WORLD_EVALUATION_MODE.live) {
    return Object.freeze(source.map((member) => Object.freeze(member)));
  }
  if (mode === SOCIAL_WORLD_EVALUATION_MODE.timeless) {
    return Object.freeze(source.map((member) => Object.freeze({
      ...member,
      presence: timelessPresence(member.presence),
    })));
  }
  if (mode !== SOCIAL_WORLD_EVALUATION_MODE.shuffled) {
    throw new Error(`Unknown social-world evaluation mode: ${mode}`);
  }
  const indexes = shuffledIndexes(source.length, seed);
  return Object.freeze(source.map((member, index) => Object.freeze({
    ...member,
    identity: source[indexes[index]]?.identity || member.identity,
    evaluationSubjectProfileId: member.profileId,
  })));
}

function rate(rows, field) {
  const eligible = rows.filter((row) => typeof row?.[field] === 'boolean');
  if (!eligible.length) return null;
  return eligible.filter((row) => row[field]).length / eligible.length;
}

export function summarizeSocialWorldEvaluation(observations = [], { minimumPerMode = 3 } = {}) {
  const rows = (observations || []).filter((row) => (
    Object.values(SOCIAL_WORLD_EVALUATION_MODE).includes(row?.mode)
  ));
  const byMode = Object.fromEntries(Object.values(SOCIAL_WORLD_EVALUATION_MODE).map((mode) => {
    const modeRows = rows.filter((row) => row.mode === mode);
    return [mode, Object.freeze({
      count: modeRows.length,
      identificationRate: rate(modeRows, 'identified'),
      threadRecallRate: rate(modeRows, 'threadRecalled'),
    })];
  }));
  const live = byMode.live;
  const shuffled = byMode.shuffled;
  const enoughEvidence = live.count >= minimumPerMode && shuffled.count >= minimumPerMode;
  const outperformsShuffled = enoughEvidence
    && live.identificationRate != null
    && shuffled.identificationRate != null
    && live.threadRecallRate != null
    && shuffled.threadRecallRate != null
    && live.identificationRate > shuffled.identificationRate
    && live.threadRecallRate > shuffled.threadRecallRate;
  return Object.freeze({
    version: SOCIAL_WORLD_EVALUATION_VERSION,
    byMode: Object.freeze(byMode),
    enoughEvidence,
    outperformsShuffled,
  });
}

