-- Desktop performs Task Recommender v12 training. Mobile receives only the
-- portable model/settings records with the `ml-model` type; the rest of the
-- desktop app-settings database remains outside the bounded mobile mirror.

alter table public.mobile_reference_records
  drop constraint if exists mobile_reference_type;

alter table public.mobile_reference_records
  add constraint mobile_reference_type check(record_type in (
    'profile','active-profile-state','mobile-working-set-manifest',
    'task','completed-task','task-completion-event','task-completion-receipt','reminder',
    'goal','goal-area','goal-milestone','goal-update','goal-link','goal-participant','goal-contribution',
    'action-plan','action-session','handoff','match','match-score-event','reward-provenance',
    'world-consequence-receipt','shop-catalog','inventory','transaction','journal','journal-comment',
    'chronicle-entry-metadata','chronicle-entry-revision','chronicle-entry-access',
    'chronicle-story','chronicle-story-entry','chronicle-entry-link','chronicle-reaction',
    'event','custom-event','event-log','event-buff','rhythm-definition','rhythm-opportunity',
    'achievement-event','achievement-state','achievement-receipt','friendship','notification',
    'routine-run','routine-step-receipt','effect-interval','effect-cancellation','ml-model'
  ));
