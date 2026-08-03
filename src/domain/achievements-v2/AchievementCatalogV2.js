export const ACHIEVEMENT_V2_VERSION = 2;

export const ACHIEVEMENT_V2_CATEGORY = Object.freeze({
  foundations: 'Foundations',
  continuity: 'Continuity',
  direction: 'Direction',
  craft: 'Craft',
  reflection: 'Reflection',
  community: 'Community',
  competition: 'Competition',
  legacy: 'Legacy',
  discovery: 'Discovery',
});

const definition = ({
  id,
  category,
  title,
  description,
  evidenceRuleId,
  progressRuleId = null,
  permanence = 'permanent',
  visibility = 'selectable',
  secret = false,
  stages = [1],
  reward = null,
}) => Object.freeze({
  id,
  version: ACHIEVEMENT_V2_VERSION,
  category,
  title,
  description,
  permanence,
  visibility,
  secret,
  evidenceRuleId,
  progressRuleId,
  stages: Object.freeze(stages),
  reward,
});

export const ACHIEVEMENT_DEFINITIONS_V2 = Object.freeze([
  definition({
    id: 'first_movement', category: 'foundations', title: 'First Movement',
    description: 'Recorded an honest session outcome, whether completed, progressed, blocked, or stopped with context.',
    evidenceRuleId: 'session-outcome-recorded',
  }),
  definition({
    id: 'clear_next_step', category: 'foundations', title: 'Clear Next Step',
    description: 'Returned to a saved next action and turned it into meaningful progress.',
    evidenceRuleId: 'saved-next-action-progressed', progressRuleId: 'successful-continuations', stages: [1, 10, 50],
  }),
  definition({
    id: 'evidence_trail', category: 'foundations', title: 'Evidence Trail',
    description: 'Built durable evidence across different kinds of work and life activity.',
    evidenceRuleId: 'multi-domain-evidence', progressRuleId: 'evidence-domain-count', stages: [2, 3, 5],
  }),
  definition({
    id: 'return_path', category: 'continuity', title: 'Return Path',
    description: 'Returned after a meaningful interruption and made progress without rewarding the absence itself.',
    evidenceRuleId: 'interrupted-work-resumed', progressRuleId: 'successful-returns', stages: [1, 10, 25],
  }),
  definition({
    id: 'thread_keeper', category: 'continuity', title: 'Thread Keeper',
    description: 'Repeatedly preserved useful next steps and resumed them later.',
    evidenceRuleId: 'preserved-thread-resumed', progressRuleId: 'preserved-threads', stages: [3, 15, 50],
  }),
  definition({
    id: 'recovery', category: 'continuity', title: 'Recovery',
    description: 'Resolved work that had previously ended blocked or stopped.',
    evidenceRuleId: 'blocked-session-resolved', progressRuleId: 'resolved-interruptions', stages: [1, 10, 50],
  }),
  definition({
    id: 'rhythm', category: 'continuity', title: 'Rhythm',
    description: 'Maintained reliable intended opportunities across review periods without a strict streak.',
    evidenceRuleId: 'opportunity-reliability', progressRuleId: 'reliable-review-periods', stages: [2, 6, 12],
  }),
  definition({
    id: 'wayfinder', category: 'direction', title: 'Wayfinder',
    description: 'Clarified a broad Goal into a finish condition, milestone, and executable next action.',
    evidenceRuleId: 'goal-made-executable',
  }),
  definition({
    id: 'course_correction', category: 'direction', title: 'Course Correction',
    description: 'Made a substantive Goal revision that later restored useful direction.',
    evidenceRuleId: 'useful-goal-revision', progressRuleId: 'useful-goal-revisions', stages: [1, 5, 15],
  }),
  definition({
    id: 'milestone_maker', category: 'direction', title: 'Milestone Maker',
    description: 'Completed meaningful Goal stages with preserved evidence.',
    evidenceRuleId: 'milestone-completed', progressRuleId: 'completed-milestones', stages: [1, 5, 20],
  }),
  definition({
    id: 'goal_finisher', category: 'direction', title: 'Goal Finisher',
    description: 'Completed a finite Goal with a defined finish condition and completion evidence.',
    evidenceRuleId: 'finite-goal-completed', progressRuleId: 'completed-finite-goals', stages: [1, 3, 10],
  }),
  definition({
    id: 'early_groundwork', category: 'direction', title: 'Early Groundwork',
    description: 'Made meaningful progress on important work well before a trustworthy deadline.',
    evidenceRuleId: 'bounded-early-progress',
  }),
  definition({
    id: 'focused_work', category: 'craft', title: 'Focused Work',
    description: 'Completed trustworthy focused work with a meaningful recorded outcome.',
    evidenceRuleId: 'trustworthy-focus-outcome', progressRuleId: 'best-focus-minutes', stages: [45, 90, 180],
  }),
  definition({
    id: 'difficult_start', category: 'craft', title: 'Difficult Start',
    description: 'Started and progressed work whose resistance evidence existed before the session.',
    evidenceRuleId: 'predated-resistance-progressed',
  }),
  definition({
    id: 'long_work', category: 'craft', title: 'Long Work',
    description: 'Carried one evolving task through several meaningful sessions to completion or formal resolution.',
    evidenceRuleId: 'multi-session-task-resolved',
  }),
  definition({
    id: 'unblocked', category: 'craft', title: 'Unblocked',
    description: 'Resolved a recorded blocker and restored movement.',
    evidenceRuleId: 'recorded-blocker-resolved', progressRuleId: 'resolved-blockers', stages: [1, 10, 50],
  }),
  definition({
    id: 'builder', category: 'craft', title: 'Builder',
    description: 'Completed substantial project work spanning several tasks and a milestone.',
    evidenceRuleId: 'substantial-project-evidence',
  }),
  definition({
    id: 'first_record', category: 'reflection', title: 'First Record',
    description: 'Authored the first substantive Chronicle Entry.',
    evidenceRuleId: 'authored-chronicle-entry', reward: null,
  }),
  definition({
    id: 'story_arc', category: 'reflection', title: 'Story Arc',
    description: 'Developed a Story across distinct occurrence dates and preserved its shape over time.',
    evidenceRuleId: 'story-across-dates', progressRuleId: 'story-entry-span', stages: [3, 7, 12],
  }),
  definition({
    id: 'essayist', category: 'reflection', title: 'Essayist',
    description: 'Authored a deliberately structured Essay using headings or long-form organization.',
    evidenceRuleId: 'structured-essay',
  }),
  definition({
    id: 'looking_back', category: 'reflection', title: 'Looking Back',
    description: 'Wrote back to a historical moment or added a later reflection.',
    evidenceRuleId: 'retrospective-dialogue',
  }),
  definition({
    id: 'carry_forward', category: 'reflection', title: 'Carry Forward',
    description: 'Carried a historical insight into present action and later used it.',
    evidenceRuleId: 'historical-insight-used',
  }),
  definition({
    id: 'context_keeper', category: 'reflection', title: 'Context Keeper',
    description: 'Connected authored reflection to verified Daybook context without duplicating it.',
    evidenceRuleId: 'reflection-daybook-context',
  }),
  definition({
    id: 'witness', category: 'community', title: 'Witness',
    description: 'Left one meaningful semantic response connected to another Fellow’s context or Chronicle.',
    evidenceRuleId: 'meaningful-semantic-response',
  }),
  definition({
    id: 'pair_bond', category: 'community', title: 'Pair Bond',
    description: 'Completed a sustained series of Pair Matches with the same teammate.',
    evidenceRuleId: 'same-pair-completions', progressRuleId: 'same-teammate-matches', stages: [3, 10, 25],
  }),
  definition({
    id: 'balanced_pair', category: 'community', title: 'Balanced Pair',
    description: 'Both teammates made meaningful contributions to a strong Pair performance.',
    evidenceRuleId: 'balanced-team-contribution',
  }),
  definition({
    id: 'rally', category: 'community', title: 'Rally',
    description: 'Recovered as a team from a meaningful deficit without assigning a carry.',
    evidenceRuleId: 'team-recovery',
  }),
  definition({
    id: 'fellowship', category: 'community', title: 'Fellowship',
    description: 'Built meaningful shared work with several distinct Fellows over time.',
    evidenceRuleId: 'distinct-shared-work', progressRuleId: 'shared-work-fellows', stages: [2, 5, 10],
  }),
  definition({
    id: 'first_rated_match', category: 'competition', title: 'First Rated Match',
    description: 'Settled the first fixed-ruleset Pair Match successfully.',
    evidenceRuleId: 'fixed-pair-settled',
  }),
  definition({
    id: 'underdog', category: 'competition', title: 'Underdog',
    description: 'Won when the fixed rating model gave the team a meaningfully lower expected outcome.',
    evidenceRuleId: 'team-expected-outcome-upset',
  }),
  definition({
    id: 'clutch', category: 'competition', title: 'Clutch',
    description: 'Won a genuinely narrow Pair Match under the observed score distribution.',
    evidenceRuleId: 'narrow-pair-win',
  }),
  definition({
    id: 'comeback', category: 'competition', title: 'Comeback',
    description: 'Moved from a meaningful team deficit to victory.',
    evidenceRuleId: 'deficit-to-victory',
  }),
  definition({
    id: 'rivalry', category: 'competition', title: 'Rivalry',
    description: 'Reached a mutual repeated series after both profiles opted into rivalry framing.',
    evidenceRuleId: 'mutual-rivalry-series',
  }),
  definition({
    id: 'climber', category: 'competition', title: 'Climber',
    description: 'Reached a new permanent highest rank.',
    evidenceRuleId: 'highest-rank-reached', progressRuleId: 'highest-elo', stages: [600, 1200, 1800, 2400, 3000],
  }),
  definition({
    id: 'summit', category: 'competition', title: 'Summit',
    description: 'Once reached the visible top neighborhood. Current position remains a Record.',
    evidenceRuleId: 'top-neighborhood-reached',
  }),
  definition({
    id: 'landmark', category: 'legacy', title: 'Landmark',
    description: 'Completed a major Goal that created a permanent World landmark.',
    evidenceRuleId: 'goal-created-landmark',
  }),
  definition({
    id: 'era_keeper', category: 'legacy', title: 'Era Keeper',
    description: 'Preserved a meaningful Era with history, Chronicle context, and a clear transition.',
    evidenceRuleId: 'meaningful-era-transition',
  }),
  definition({
    id: 'living_archive', category: 'legacy', title: 'Living Archive',
    description: 'Built an interconnected body of Stories, milestones, and later reflections.',
    evidenceRuleId: 'interconnected-history',
  }),
  definition({
    id: 'shared_history', category: 'legacy', title: 'Shared History',
    description: 'Created a durable shared historical trace through repeated collaboration.',
    evidenceRuleId: 'durable-shared-trace',
  }),
  definition({
    id: 'unusual_theme', category: 'discovery', title: 'Another Lens',
    description: 'Explored a visually unusual theme without functional access being gated.',
    evidenceRuleId: 'distinct-theme-used', secret: true,
  }),
  definition({
    id: 'old_story_closed', category: 'discovery', title: 'Closed Loop',
    description: 'Returned to an old unfinished Story and gave it a meaningful ending.',
    evidenceRuleId: 'old-story-completed', secret: true,
  }),
]);

export const ACHIEVEMENT_V2_BY_ID = new Map(
  ACHIEVEMENT_DEFINITIONS_V2.map((entry) => [entry.id, entry]),
);

export const RETIRED_ACHIEVEMENT_GROUPS = Object.freeze(new Set([
  'king_of_the_hill', 'overkill', 'contributor', 'soldier', 'peace', 'legacy',
  'basket', 'hobbyist', 'scholar', 'long_game', 'momentum', 'grinder', 'scorer',
  'deep_work', 'consistency', 'event_runner', 'treasurer', 'signature', 'town', 'savant',
]));

export function activeAchievementDefinitions(category = null) {
  return ACHIEVEMENT_DEFINITIONS_V2.filter((entry) => !category || entry.category === category);
}

export function stageKey(achievementId, stageIndex = 0) {
  const definitionValue = ACHIEVEMENT_V2_BY_ID.get(achievementId);
  const threshold = definitionValue?.stages?.[stageIndex];
  return `${achievementId}@${ACHIEVEMENT_V2_VERSION}:${threshold ?? 1}`;
}

