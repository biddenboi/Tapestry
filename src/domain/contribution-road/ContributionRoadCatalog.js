import { CONTRIBUTION_PASS_REWARDS } from '@domain/constants.js';

export const CONTRIBUTION_ROAD_CATALOG_VERSION = 4;

export const ROAD_BRANCHES = Object.freeze([
  { id: 'compass', label: 'Compass', subtitle: 'Foundations & Direction', color: '#41c7ff', glyph: '✦' },
  { id: 'forge', label: 'Forge', subtitle: 'Continuity & Craft', color: '#ff9f43', glyph: '◆' },
  { id: 'chronicle', label: 'Chronicle', subtitle: 'Reflection & Discovery', color: '#b692ff', glyph: '◈' },
  { id: 'fellowship', label: 'Fellowship', subtitle: 'Community & Competition', color: '#45ddb1', glyph: '⬡' },
]);

export const ROAD_CHAPTERS = Object.freeze([
  { id: 'trailhead', label: 'Trailhead', min: 0, max: 100, cost: 0, capability: 'recognition-board' },
  { id: 'bearing', label: 'Bearing', min: 100, max: 300, cost: 50, capability: 'identity-loadouts' },
  { id: 'workshop', label: 'Workshop', min: 300, max: 750, cost: 100, capability: 'story-spotlight' },
  { id: 'voice', label: 'Voice', min: 750, max: 1500, cost: 175, capability: 'comparative-trends' },
  { id: 'deep-practice', label: 'Deep Practice', min: 1500, max: 2500, cost: 275, capability: 'expanded-identity-studio' },
  { id: 'perspective', label: 'Perspective', min: 2500, max: 4000, cost: 425, capability: 'story-constellation' },
  { id: 'stewardship', label: 'Stewardship', min: 4000, max: 6500, cost: 650, capability: 'long-range-insights' },
  { id: 'legacy', label: 'Legacy', min: 6500, max: 10000, cost: 900, capability: 'road-constellation' },
]);

export const ROAD_STAT_DEFINITIONS = Object.freeze([
  { id: 'goal-reviews', branch: 'compass', label: 'Goal reviews', thresholds: [5, 25, 100] },
  { id: 'milestones-completed', branch: 'compass', label: 'Milestones completed', thresholds: [5, 20, 50, 100] },
  { id: 'goals-completed', branch: 'compass', label: 'Finite Goals completed', thresholds: [1, 3, 10, 25] },
  { id: 'tasks-completed', branch: 'forge', label: 'Tasks completed', thresholds: [25, 100, 250, 500, 1000] },
  { id: 'focus-minutes', branch: 'forge', label: 'Verified focus minutes', thresholds: [300, 1500, 5000, 10000] },
  { id: 'rhythm-completions', branch: 'forge', label: 'Rhythm opportunities completed', thresholds: [25, 100, 500, 1000] },
  { id: 'dojo-advances', branch: 'forge', label: 'Dojo recommendations advanced', thresholds: [50, 250, 1000, 2500, 5000] },
  { id: 'substantive-entries', branch: 'chronicle', label: 'Substantive Entries', thresholds: [10, 50, 100, 250] },
  { id: 'story-additions', branch: 'chronicle', label: 'Story additions', thresholds: [10, 30, 100, 250] },
  { id: 'retrospective-actions', branch: 'chronicle', label: 'Retrospective actions', thresholds: [5, 25, 100] },
  { id: 'matches-completed', branch: 'fellowship', label: 'Matches completed', thresholds: [10, 25, 50, 100, 250, 500] },
  { id: 'pair-matches', branch: 'fellowship', label: 'Pair Matches', thresholds: [5, 25, 100, 250] },
  { id: 'shared-work-responses', branch: 'fellowship', label: 'Meaningful shared-work responses', thresholds: [5, 25, 100] },
]);

export const OPENING_TRAIL_STEPS = Object.freeze([
  { id: 'task-created', step: 1, label: 'Lay the first stone', milestone: 'Create the first task', reveals: ['tasks.queue'] },
  { id: 'session-outcome', step: 2, label: 'Make work visible', milestone: 'Record the first task-session outcome', reveals: ['tasks.all', 'inventory.basic', 'road'] },
  { id: 'task-depth', step: 3, label: 'Build continuity', milestone: 'Complete two tasks or resume a saved next action', reveals: ['tasks.history', 'tasks.inspector.full'] },
  { id: 'planning', step: 4, label: 'Shape what comes next', milestone: 'Create a reminder or queue three tasks', reveals: ['tasks.planning', 'reminders'] },
  { id: 'rhythm', step: 5, label: 'Find a rhythm', milestone: 'Log the first Habit or rhythm opportunity', reveals: ['events.calendar', 'events.rhythms.full'] },
  { id: 'goal', step: 6, label: 'Choose a horizon', milestone: 'Make a Goal executable or complete a milestone', reveals: ['events.goals', 'events.boundaries', 'events.reviews'] },
  { id: 'entry', step: 7, label: 'Leave a record', milestone: 'Publish the first substantive Entry', reveals: ['feed.stories', 'feed.essays', 'story.create'] },
  { id: 'resurface', step: 8, label: 'Look again', milestone: 'Meaningfully view five Feed items or complete a retrospective action', reveals: ['feed.wander', 'chronicle.resurface'] },
  { id: 'profiles', step: 9, label: 'Cross an era', milestone: 'Create a second profile or share locally between profiles', reveals: ['feed.global', 'fellows.basic'] },
  { id: 'competition', step: 10, label: 'Enter the wider field', milestone: 'Complete a Match or advance three visible Dojo recommendations', reveals: ['dojo.history', 'matches.history', 'standings', 'fellows.full', 'trends.elo'] },
]);

const CAPSTONE_COPY = Object.freeze({
  bearing: {
    compass: ['True North', 'Wayfinder Emblem', 'profile-skin-solarpunk'],
    forge: ['First Fire', 'Maker Emblem', 'profile-skin-blueprint'],
    chronicle: ['Open Book', 'Witness Emblem', 'profile-skin-editorial-noir'],
    fellowship: ['Shared Horizon', 'Kinship Emblem', 'profile-skin-frutiger-aero'],
  },
  workshop: {
    compass: ['Surveyor', 'Surveyor Emblem', 'theme-solarpunk'],
    forge: ['At the Bench', 'Artisan Emblem', 'theme-blueprint'],
    chronicle: ['Storykeeper', 'Storykeeper Emblem', 'theme-editorial-noir'],
    fellowship: ['Open Table', 'Host Emblem', 'theme-frutiger-aero'],
  },
  voice: {
    compass: ['Signal', 'Signal Emblem', 'profile-block-goal-trends'],
    forge: ['Cadence', 'Cadence Emblem', 'profile-block-contribution-trends'],
    chronicle: ['Resonance', 'Resonance Emblem', 'profile-block-story-spotlight'],
    fellowship: ['Chorus', 'Chorus Emblem', 'profile-block-fellow-trends'],
  },
  'deep-practice': {
    compass: ['Cartographer', 'Cartographer Emblem', 'identity-studio-compass'],
    forge: ['Masterwork', 'Masterwork Emblem', 'identity-studio-forge'],
    chronicle: ['Illuminator', 'Illuminator Emblem', 'identity-studio-chronicle'],
    fellowship: ['Ensemble', 'Ensemble Emblem', 'identity-studio-fellowship'],
  },
  perspective: {
    compass: ['Northstar', 'Northstar Emblem', 'theme-northstar'],
    forge: ['Atelier', 'Atelier Emblem', 'theme-atelier'],
    chronicle: ['Memory Palace', 'Memory Emblem', 'theme-memory_palace'],
    fellowship: ['Commons', 'Commons Emblem', 'theme-commons'],
  },
  stewardship: {
    compass: ['Long View', 'Long View Emblem', 'insight-saved-views'],
    forge: ['Living System', 'Systems Emblem', 'insight-range-forge'],
    chronicle: ['Archive Light', 'Archive Emblem', 'insight-range-chronicle'],
    fellowship: ['Common Ground', 'Steward Emblem', 'insight-range-fellowship'],
  },
  legacy: {
    compass: ['Pole Star', 'Pole Star Emblem', 'legacy-skin-compass'],
    forge: ['Enduring Work', 'Enduring Emblem', 'legacy-skin-forge'],
    chronicle: ['Living Memory', 'Living Memory Emblem', 'legacy-skin-chronicle'],
    fellowship: ['Constellation', 'Constellation Emblem', 'legacy-skin-fellowship'],
  },
});

const CHAPTER_GATES = Object.freeze({
  bearing: {
    compass: { kind: 'any', gates: [{ kind: 'stat', stat: 'goal-reviews', value: 5 }, { kind: 'stat', stat: 'goals-completed', value: 1 }] },
    forge: { kind: 'any', gates: [{ kind: 'stat', stat: 'tasks-completed', value: 25 }, { kind: 'stat', stat: 'focus-minutes', value: 300 }] },
    chronicle: { kind: 'stat', stat: 'substantive-entries', value: 10 },
    fellowship: { kind: 'any', gates: [{ kind: 'stat', stat: 'matches-completed', value: 10 }, { kind: 'stat', stat: 'shared-work-responses', value: 5 }] },
  },
  workshop: {
    compass: { kind: 'stat', stat: 'milestones-completed', value: 20 },
    forge: { kind: 'any', gates: [{ kind: 'stat', stat: 'tasks-completed', value: 100 }, { kind: 'stat', stat: 'dojo-advances', value: 250 }] },
    chronicle: { kind: 'any', gates: [{ kind: 'stat', stat: 'story-additions', value: 30 }, { kind: 'stat', stat: 'retrospective-actions', value: 25 }] },
    fellowship: { kind: 'stat', stat: 'matches-completed', value: 25 },
  },
  voice: {
    compass: { kind: 'stat', stat: 'goal-reviews', value: 25 },
    forge: {
      kind: 'all',
      gates: [
        { kind: 'achievement', achievementId: 'focused_work' },
        {
          kind: 'any',
          gates: [
            { kind: 'stat', stat: 'tasks-completed', value: 100 },
            { kind: 'stat', stat: 'dojo-advances', value: 1000 },
          ],
        },
      ],
    },
    chronicle: { kind: 'stat', stat: 'substantive-entries', value: 50 },
    fellowship: { kind: 'any', gates: [{ kind: 'stat', stat: 'pair-matches', value: 25 }, { kind: 'stat', stat: 'matches-completed', value: 50 }] },
  },
  'deep-practice': {
    compass: { kind: 'stat', stat: 'goals-completed', value: 10 },
    forge: { kind: 'all', gates: [{ kind: 'stat', stat: 'focus-minutes', value: 5000 }, { kind: 'stat', stat: 'tasks-completed', value: 500 }] },
    chronicle: { kind: 'stat', stat: 'story-additions', value: 100 },
    fellowship: { kind: 'stat', stat: 'matches-completed', value: 100 },
  },
  perspective: {
    compass: { kind: 'stat', stat: 'milestones-completed', value: 50 },
    forge: { kind: 'stat', stat: 'dojo-advances', value: 2500 },
    chronicle: { kind: 'stat', stat: 'substantive-entries', value: 100 },
    fellowship: { kind: 'stat', stat: 'pair-matches', value: 100 },
  },
  stewardship: {
    compass: { kind: 'stat', stat: 'goal-reviews', value: 100 },
    forge: { kind: 'stat', stat: 'tasks-completed', value: 1000 },
    chronicle: { kind: 'stat', stat: 'retrospective-actions', value: 100 },
    fellowship: { kind: 'stat', stat: 'matches-completed', value: 250 },
  },
  legacy: {
    compass: { kind: 'stat', stat: 'goals-completed', value: 25 },
    forge: { kind: 'stat', stat: 'dojo-advances', value: 5000 },
    chronicle: { kind: 'stat', stat: 'story-additions', value: 250 },
    fellowship: { kind: 'stat', stat: 'matches-completed', value: 500 },
  },
});

export const ACHIEVEMENT_PACK_UNLOCK_MODE = Object.freeze({
  earnedOnly: 'earned-only',
  contributionOnly: 'contribution-only',
  earnedAndContribution: 'earned-and-contribution',
  earnedOrContribution: 'earned-or-contribution',
  free: 'free',
});

const PACK_NODE_META = new Map([
  ['bearing:compass', { packId: 'first-weave', x: 240, y: 82, parentIds: ['trailhead'], unlockMode: 'earned-only', conflictIds: ['bearing:fellowship'] }],
  ['bearing:forge', { packId: 'first-weave', x: 230, y: 205, parentIds: ['trailhead'], unlockMode: 'contribution-only', conflictIds: ['bearing:chronicle'] }],
  ['bearing:chronicle', { packId: 'first-weave', x: 245, y: 335, parentIds: ['trailhead'], unlockMode: 'earned-or-contribution', conflictIds: ['bearing:forge'] }],
  ['bearing:fellowship', { packId: 'first-weave', x: 225, y: 462, parentIds: ['trailhead'], unlockMode: 'earned-and-contribution', conflictIds: ['bearing:compass'] }],
  ['workshop:compass', { packId: 'first-weave', x: 468, y: 94, parentIds: ['bearing:compass', 'bearing:fellowship'], unlockMode: 'earned-and-contribution', conflictIds: [] }],
  ['workshop:forge', { packId: 'first-weave', x: 485, y: 223, parentIds: ['bearing:forge', 'bearing:fellowship'], unlockMode: 'earned-or-contribution', conflictIds: [] }],
  ['workshop:chronicle', { packId: 'first-weave', x: 462, y: 352, parentIds: ['bearing:forge', 'bearing:chronicle'], unlockMode: 'earned-only', conflictIds: [] }],
  ['workshop:fellowship', { packId: 'first-weave', x: 480, y: 475, parentIds: ['bearing:chronicle', 'bearing:fellowship'], unlockMode: 'contribution-only', conflictIds: [] }],
  ['voice:compass', { packId: 'first-weave', x: 735, y: 78, parentIds: ['workshop:compass'], unlockMode: 'earned-only', conflictIds: ['voice:fellowship'] }],
  ['voice:forge', { packId: 'first-weave', x: 720, y: 212, parentIds: ['workshop:compass', 'workshop:forge'], unlockMode: 'earned-and-contribution', conflictIds: ['voice:chronicle'] }],
  ['voice:chronicle', { packId: 'first-weave', x: 748, y: 350, parentIds: ['workshop:forge', 'workshop:chronicle', 'workshop:fellowship'], unlockMode: 'earned-or-contribution', conflictIds: ['voice:forge'] }],
  ['voice:fellowship', { packId: 'first-weave', x: 725, y: 486, parentIds: ['workshop:chronicle', 'workshop:fellowship'], unlockMode: 'contribution-only', conflictIds: ['voice:compass'] }],

  ['deep-practice:compass', { packId: 'long-horizon', x: 218, y: 82, parentIds: ['pack:long-horizon'], unlockMode: 'earned-and-contribution', conflictIds: ['deep-practice:fellowship'] }],
  ['deep-practice:forge', { packId: 'long-horizon', x: 235, y: 205, parentIds: ['pack:long-horizon'], unlockMode: 'earned-and-contribution', conflictIds: ['deep-practice:chronicle'] }],
  ['deep-practice:chronicle', { packId: 'long-horizon', x: 215, y: 335, parentIds: ['pack:long-horizon'], unlockMode: 'earned-or-contribution', conflictIds: ['deep-practice:forge'] }],
  ['deep-practice:fellowship', { packId: 'long-horizon', x: 242, y: 462, parentIds: ['pack:long-horizon'], unlockMode: 'contribution-only', conflictIds: ['deep-practice:compass'] }],
  ['perspective:compass', { packId: 'long-horizon', x: 428, y: 92, parentIds: ['deep-practice:compass'], unlockMode: 'earned-only', conflictIds: ['perspective:fellowship'] }],
  ['perspective:forge', { packId: 'long-horizon', x: 446, y: 218, parentIds: ['deep-practice:compass', 'deep-practice:forge'], unlockMode: 'earned-or-contribution', conflictIds: ['perspective:chronicle'] }],
  ['perspective:chronicle', { packId: 'long-horizon', x: 425, y: 350, parentIds: ['deep-practice:forge', 'deep-practice:chronicle', 'deep-practice:fellowship'], unlockMode: 'earned-and-contribution', conflictIds: ['perspective:forge'] }],
  ['perspective:fellowship', { packId: 'long-horizon', x: 450, y: 478, parentIds: ['deep-practice:chronicle', 'deep-practice:fellowship'], unlockMode: 'contribution-only', conflictIds: ['perspective:compass'] }],
  ['stewardship:compass', { packId: 'long-horizon', x: 635, y: 80, parentIds: ['perspective:compass'], unlockMode: 'earned-and-contribution', conflictIds: ['stewardship:fellowship'] }],
  ['stewardship:forge', { packId: 'long-horizon', x: 655, y: 216, parentIds: ['perspective:compass', 'perspective:forge'], unlockMode: 'earned-or-contribution', conflictIds: ['stewardship:chronicle'] }],
  ['stewardship:chronicle', { packId: 'long-horizon', x: 630, y: 346, parentIds: ['perspective:forge', 'perspective:chronicle', 'perspective:fellowship'], unlockMode: 'earned-only', conflictIds: ['stewardship:forge'] }],
  ['stewardship:fellowship', { packId: 'long-horizon', x: 660, y: 480, parentIds: ['perspective:chronicle', 'perspective:fellowship'], unlockMode: 'contribution-only', conflictIds: ['stewardship:compass'] }],
  ['legacy:compass', { packId: 'long-horizon', x: 848, y: 88, parentIds: ['stewardship:compass'], unlockMode: 'earned-and-contribution', conflictIds: ['legacy:fellowship'] }],
  ['legacy:forge', { packId: 'long-horizon', x: 865, y: 220, parentIds: ['stewardship:compass', 'stewardship:forge'], unlockMode: 'earned-or-contribution', conflictIds: ['legacy:chronicle'] }],
  ['legacy:chronicle', { packId: 'long-horizon', x: 842, y: 350, parentIds: ['stewardship:forge', 'stewardship:chronicle', 'stewardship:fellowship'], unlockMode: 'earned-only', conflictIds: ['legacy:forge'] }],
  ['legacy:fellowship', { packId: 'long-horizon', x: 870, y: 482, parentIds: ['stewardship:chronicle', 'stewardship:fellowship'], unlockMode: 'contribution-only', conflictIds: ['legacy:compass'] }],
]);

function rewardFor(chapterId, branchId, copy) {
  const [title, emblem, feature] = copy;
  const rewards = [
    { id: `${chapterId}-${branchId}-emblem`, type: 'cosmetic_road_emblem', label: emblem },
    { id: `${chapterId}-${branchId}-title`, type: 'cosmetic_title', label: title },
  ];
  if (feature.startsWith('theme-')) {
    const setId = feature.slice(6);
    rewards.push({ id: setId.replaceAll('-', '_'), type: 'cosmetic_theme', label: `${title} app and profile theme` });
    rewards.push({ id: `preset-pack:${setId}`, type: 'cosmetic_preset_pack', label: `${title} appearance set` });
  } else if (feature.startsWith('profile-skin-')) {
    const setId = feature.slice('profile-skin-'.length);
    rewards.push({ id: `preset-pack:${setId}`, type: 'cosmetic_preset_pack', label: `${title} profile appearance set` });
  }
  else if (feature.startsWith('profile-block-')) rewards.push({ id: feature, type: 'cosmetic_profile_block', label: title });
  else rewards.push({ id: feature, type: 'capability', label: title });
  return rewards;
}

const capstoneNodes = ROAD_CHAPTERS.slice(1).flatMap((chapter, chapterIndex) => (
  ROAD_BRANCHES.map((branch, branchIndex) => {
    const copy = CAPSTONE_COPY[chapter.id][branch.id];
    const authored = PACK_NODE_META.get(`${chapter.id}:${branch.id}`);
    return Object.freeze({
      id: `${chapter.id}:${branch.id}`,
      chapterId: chapter.id,
      branchId: branch.id,
      kind: 'capstone',
      label: copy[0],
      description: `${branch.label}'s signature path through ${chapter.label}.`,
      x: authored.x,
      y: authored.y,
      packId: authored.packId,
      parentIds: authored.parentIds,
      parentMode: 'any',
      unlockMode: authored.unlockMode,
      conflictIds: authored.conflictIds,
      activityGate: CHAPTER_GATES[chapter.id][branch.id],
      cost: ['earned-only', 'free'].includes(authored.unlockMode) ? 0 : chapter.cost,
      exclusiveGroup: chapter.id,
      gate: {
        kind: 'all',
        gates: [
          { kind: 'contribution', value: chapter.min },
          ...(chapterIndex === 0 ? [] : [{ kind: 'chapter', chapterId: ROAD_CHAPTERS[chapterIndex].id }]),
          CHAPTER_GATES[chapter.id][branch.id],
        ],
      },
      rewards: rewardFor(chapter.id, branch.id, copy),
    });
  })
));

const statNodes = ROAD_STAT_DEFINITIONS.flatMap((stat, branchIndex) => (
  stat.thresholds.map((threshold, index) => Object.freeze({
    id: `stat:${stat.id}:${threshold}`,
    chapterId: ROAD_CHAPTERS[Math.min(index + 1, ROAD_CHAPTERS.length - 1)].id,
    branchId: stat.branch,
    kind: 'stat',
    label: `${stat.label}: ${threshold.toLocaleString()}`,
    x: index * 260 + 300,
    y: ROAD_BRANCHES.findIndex((branch) => branch.id === stat.branch) * 220 + 160 + branchIndex * 8,
    gate: { kind: 'stat', stat: stat.id, value: threshold },
    rewards: [],
  }))
));

const evidenceNodes = Object.freeze([
  ['first_movement', 'First Movement', 'bearing', 'forge'],
  ['wayfinder', 'Wayfinder', 'bearing', 'compass'],
  ['first_record', 'First Record', 'workshop', 'chronicle'],
  ['first_rated_match', 'First Rated Match', 'workshop', 'fellowship'],
  ['focused_work', 'Focused Work', 'voice', 'forge'],
  ['looking_back', 'Looking Back', 'voice', 'chronicle'],
  ['milestone_maker', 'Milestone Maker', 'deep-practice', 'compass'],
  ['pair_bond', 'Pair Bond', 'deep-practice', 'fellowship'],
].map(([achievementId, label, chapterId, branchId], index) => Object.freeze({
  id: `achievement:${achievementId}`,
  chapterId,
  branchId,
  kind: 'achievement',
  label,
  description: 'An evolving evidence badge. Stages deepen its frame and can qualify later gates.',
  x: 420 + index * 230,
  y: ROAD_BRANCHES.findIndex((branch) => branch.id === branchId) * 220 + 105,
  gate: { kind: 'achievement', achievementId },
  rewards: [{ id: `evidence-badge:${achievementId}`, type: 'evidence_badge', label: `${label} badge` }],
})));

const interfaceRevealNodes = OPENING_TRAIL_STEPS.map((step, index) => Object.freeze({
  id: `interface-reveal:${step.step}`,
  chapterId: index < 5 ? 'trailhead' : 'bearing',
  branchId: ROAD_BRANCHES[index % ROAD_BRANCHES.length].id,
  kind: 'interface-reveal',
  label: `Trail ${step.step}`,
  description: `${step.milestone}. This reveals presentation depth without restricting data access.`,
  x: 170 + index * 92,
  y: 70 + (index % 4) * 220,
  gate: { kind: 'interface-reveal', step: step.step },
  rewards: step.reveals.map((id) => ({ id, type: 'interface_reveal', label: id.replaceAll('.', ' · ') })),
}));

const capabilityNodes = ROAD_CHAPTERS.slice(1).map((chapter, index) => Object.freeze({
  id: `capability:${chapter.capability}`,
  chapterId: chapter.id,
  branchId: null,
  kind: 'capability',
  label: chapter.capability.replaceAll('-', ' '),
  description: `The general ${chapter.label} capability, granted when its chapter commits.`,
  x: 470 + index * 350,
  y: 42,
  gate: { kind: 'chapter', chapterId: chapter.id },
  rewards: [{ id: chapter.capability, type: 'capability', label: chapter.capability.replaceAll('-', ' ') }],
}));

function chapterForContributionThreshold(threshold) {
  return [...ROAD_CHAPTERS].reverse().find((chapter) => threshold >= chapter.min)?.id || 'trailhead';
}

const classicRewardNodes = CONTRIBUTION_PASS_REWARDS.map((reward) => Object.freeze({
  id: `classic-reward:${reward.id}`,
  legacyRewardId: reward.id,
  chapterId: chapterForContributionThreshold(reward.threshold),
  branchId: null,
  kind: 'classic-reward',
  label: reward.label,
  description: reward.description,
  cost: 0,
  threshold: reward.threshold,
  gate: { kind: 'contribution', value: reward.threshold },
  rewards: (reward.items || []).map((item) => ({ id: item.id, type: item.type, label: item.label })),
}));

const secretNodes = Object.freeze([
  Object.freeze({
    id: 'secret:living-archive', chapterId: 'legacy', branchId: 'chronicle', kind: 'secret',
    label: 'Living Archive', description: 'A secret recognition revealed by preserving a living archive.',
    x: 2690, y: 710, visibility: 'hidden',
    gate: { kind: 'achievement', achievementId: 'living_archive' },
    rewards: [{ id: 'living-archive-secret', type: 'storytelling_variant', label: 'Living Archive constellation' }],
  }),
]);

export const CONTRIBUTION_ROAD_NODES = Object.freeze([
  Object.freeze({ id: 'trailhead', packId: 'first-weave', chapterId: 'trailhead', branchId: null, kind: 'pack-root', label: 'Trailhead', description: 'The first knot in your authored path.', x: 42, y: 278, parentIds: [], parentMode: 'all', unlockMode: 'free', conflictIds: [], automatic: true, cost: 0, gate: null, activityGate: null, rewards: [] }),
  Object.freeze({ id: 'pack:long-horizon', packId: 'long-horizon', chapterId: 'deep-practice', branchId: null, kind: 'pack-root', label: 'Long Horizon', description: 'A permanent board for deeper practice and stewardship.', x: 42, y: 278, parentIds: [], parentMode: 'all', unlockMode: 'free', conflictIds: [], automatic: true, cost: 0, gate: null, activityGate: null, rewards: [] }),
  ...capstoneNodes,
  ...statNodes,
  ...evidenceNodes,
  ...interfaceRevealNodes,
  ...capabilityNodes,
  ...classicRewardNodes,
  ...secretNodes,
]);

export const ACHIEVEMENT_PACKS = Object.freeze([
  Object.freeze({
    packId: 'first-weave',
    name: 'First Weave',
    subtitle: 'Choose how direction becomes craft and voice.',
    themeArt: 'linear-gradient(135deg, #123b4c, #1e5b55 48%, #c98a3d)',
    rootNodeId: 'trailhead',
    chapterIds: ['trailhead', 'bearing', 'workshop', 'voice'],
    headlineRewards: ['True North', 'At the Bench', 'Storykeeper', 'Chorus'],
    nodeIds: CONTRIBUTION_ROAD_NODES.filter((node) => node.packId === 'first-weave').map((node) => node.id),
  }),
  Object.freeze({
    packId: 'long-horizon',
    name: 'Long Horizon',
    subtitle: 'Shape deep practice into perspective, stewardship, and legacy.',
    themeArt: 'linear-gradient(135deg, #241b4b, #394f7d 50%, #8f6a4f)',
    rootNodeId: 'pack:long-horizon',
    chapterIds: ['deep-practice', 'perspective', 'stewardship', 'legacy'],
    headlineRewards: ['Cartographer', 'Northstar', 'Archive Light', 'Constellation'],
    nodeIds: CONTRIBUTION_ROAD_NODES.filter((node) => node.packId === 'long-horizon').map((node) => node.id),
  }),
]);

export function getAchievementPack(packId) {
  return ACHIEVEMENT_PACKS.find((pack) => pack.packId === packId) || null;
}

export function validateAchievementPackCatalog(packs = ACHIEVEMENT_PACKS, nodes = CONTRIBUTION_ROAD_NODES) {
  const errors = [];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (const pack of packs) {
    const packNodes = pack.nodeIds.map((id) => byId.get(id)).filter(Boolean);
    const packIds = new Set(pack.nodeIds);
    for (const id of pack.nodeIds) if (!byId.has(id)) errors.push(`${pack.packId}: missing node ${id}`);
    for (const node of packNodes) {
      for (const parentId of node.parentIds || []) {
        if (!packIds.has(parentId)) errors.push(`${node.id}: missing parent ${parentId}`);
      }
      for (const conflictId of node.conflictIds || []) {
        const conflict = byId.get(conflictId);
        if (!conflict || !(conflict.conflictIds || []).includes(node.id)) errors.push(`${node.id}: asymmetric conflict ${conflictId}`);
      }
      for (const reward of node.rewards || []) if (!reward?.id || !reward?.type) errors.push(`${node.id}: invalid reward`);
    }
    const visiting = new Set();
    const visited = new Set();
    const visit = (id) => {
      if (visiting.has(id)) { errors.push(`${pack.packId}: cycle at ${id}`); return; }
      if (visited.has(id)) return;
      visiting.add(id);
      for (const parentId of byId.get(id)?.parentIds || []) visit(parentId);
      visiting.delete(id);
      visited.add(id);
    };
    pack.nodeIds.forEach(visit);
    const reachable = new Set(packIds.has(pack.rootNodeId) ? [pack.rootNodeId] : []);
    let added = true;
    while (added) {
      added = false;
      for (const node of packNodes) {
        if (reachable.has(node.id)) continue;
        const parents = node.parentIds || [];
        const connected = node.parentMode === 'all'
          ? parents.length > 0 && parents.every((id) => reachable.has(id))
          : parents.some((id) => reachable.has(id));
        if (connected) { reachable.add(node.id); added = true; }
      }
    }
    for (const id of pack.nodeIds) if (!reachable.has(id)) errors.push(`${pack.packId}: unreachable node ${id}`);
  }
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

export const CONTRIBUTION_ROAD_CATALOG = Object.freeze({
  version: CONTRIBUTION_ROAD_CATALOG_VERSION,
  branches: ROAD_BRANCHES,
  chapters: ROAD_CHAPTERS,
  stats: ROAD_STAT_DEFINITIONS,
  openingTrail: OPENING_TRAIL_STEPS,
  nodes: CONTRIBUTION_ROAD_NODES,
  packs: ACHIEVEMENT_PACKS,
});

export function getRoadChapter(chapterId) {
  return ROAD_CHAPTERS.find((chapter) => chapter.id === chapterId) || null;
}

export function getRoadNode(nodeId) {
  return CONTRIBUTION_ROAD_NODES.find((node) => node.id === nodeId) || null;
}
