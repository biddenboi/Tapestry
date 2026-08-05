export const EVENT_TERMINOLOGY = Object.freeze({
  navigation: Object.freeze({
    label: 'Events',
    title: 'Events, goals, and daily schedule',
  }),
  types: Object.freeze({
    oneTime: 'One time',
    quantity: 'Quantity',
    duration: 'Duration',
    special: 'Daily schedule',
    tracker: 'Tracker',
  }),
  headings: Object.freeze({
    habits: 'Events',
    goals: 'Goals',
    dailyTracking: 'Daily tracking',
    sharedProgress: 'Shared progress',
    activeEffects: 'Active Effects',
    scheduledEffects: 'Scheduled Effects',
    contributionTrend: 'Contribution Trend',
    contributionLeaders: 'Goal Leaders',
    contributionHistory: 'Contribution History',
  }),
  descriptions: Object.freeze({
    habits: 'Complete events, log quantities, and track focused time.',
    goals: 'Track contribution toward shared goals.',
  }),
  actions: Object.freeze({
    createTracker: 'Create event',
    createGoal: 'Create goal',
    openGoal: 'Open goal',
    completeGoal: 'Complete goal',
  }),
  status: Object.freeze({
    activeGoal: 'ACTIVE GOAL',
    archivedGoal: 'ARCHIVED GOAL',
  }),
  empty: Object.freeze({
    trackers: 'No events yet.',
    goals: 'No goals yet.',
    activity: 'No activity has been logged this week.',
    effects: 'No active effects yet. Complete an event or log a quantity to activate one.',
  }),
});

export function countLabel(count, singular, plural = `${singular}s`) {
  return `${Number(count || 0)} ${Number(count) === 1 ? singular : plural}`;
}
