import { HYDRATION_DOMAIN as D } from '@data/db/domainHydration.js';

export const PANEL_DOMAIN_REQUIREMENTS = Object.freeze({
  map: Object.freeze([D.profiles, D.socialWorld, D.social]),
  feed: Object.freeze([D.feed, D.chronicle, D.profiles]),
  shop: Object.freeze([D.shop]),
  lobby: Object.freeze([D.leaderboards, D.socialWorld, D.social]),
  events: Object.freeze([D.eventTrackers]),
  profiles: Object.freeze([D.profileSummaries, D.presence, D.leaderboards]),
  notes: Object.freeze([D.notes]),
  inbox: Object.freeze([D.social, D.profileSummaries]),
  tasks: Object.freeze([D.tasks, D.reminders]),
  queue: Object.freeze([D.tasks, D.reminders]),
  inventory: Object.freeze([D.inventory]),
  settings: Object.freeze([D.inventory, D.profiles]),
  pass: Object.freeze([D.tasks, D.inventory, D.profiles]),
  match: Object.freeze([D.matches, D.tasks, D.profiles, D.dailyLifecycle]),
  dojo: Object.freeze([D.dojoSource, D.recommender, D.socialWorld, D.social]),
  reminders: Object.freeze([D.reminders]),
  nextMove: Object.freeze([D.nextMove]),
});

export function domainsForPanel(panelId) {
  return PANEL_DOMAIN_REQUIREMENTS[panelId] || Object.freeze([]);
}
