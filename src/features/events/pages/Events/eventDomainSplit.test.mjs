import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (relative) => readFile(new URL(relative, import.meta.url), 'utf8');
const [eventsPage, panelRequirements, hydration, repository, contribution, worldModels] = await Promise.all([
  read('./Events.jsx'),
  read('../../../../app/data-source/panelDomainRequirements.js'),
  read('../../../../data/db/domainHydration.js'),
  read('../../../../domain/events/EventDomainRepository.js'),
  read('../../../../domain/contribution/Contribution.js'),
  read('./EventsWorldModels.js'),
]);

test('Events initial hydration uses one unified tracker domain', () => {
  assert.match(panelRequirements, /events:\s*Object\.freeze\(\[D\.eventTrackers\]\)/);
  assert.match(hydration, /eventTrackers: 'eventTrackers'/);
  assert.doesNotMatch(`${panelRequirements}\n${hydration}`, /eventHabits|eventQuantities/);
  const overview = repository.split('export async function loadTrackerOverview')[1].split('export async function loadGoalArenaData')[0];
  assert.doesNotMatch(overview, /STORES\.project|STORES\.contribution|getPlayersAtIGT/);
  assert.match(repository, /TRACKER_TYPES = new Set\(\['one_time', 'quantity', 'duration'\]\)/);
});

test('Goals stay lazy while the habit page is loaded directly', () => {
  assert.match(eventsPage, /import \{ HabitEditor, HabitPage \} from '\.\/HabitPage\.jsx'/);
  assert.match(eventsPage, /import\('@features\/events\/pages\/Events\/EventsView\.jsx'\)/);
  assert.match(eventsPage, /const GoalArenaBoard = lazyGoalView\('GoalArenaBoard'\)/);
  assert.match(eventsPage, /ensureDomainLoaded\(\['goals', 'competitiveArenas', 'profiles'\]\)/);
  assert.doesNotMatch(eventsPage, /HabitCircuit|EventsWorldShell|DetailView|StylePage/);
});

test('Goals loading remains stable across clock ticks and has a retry state', () => {
  assert.match(eventsPage, /timestampRef\.current = timestamp/);
  assert.match(repository, /getRepository\('goals'\)\.getOverview/);
  assert.doesNotMatch(eventsPage, /loadArenas[\s\S]*?\], \[.*timestamp/);
  assert.match(eventsPage, /Goals could not load\./);
  assert.match(eventsPage, /loadArenas\(\)\.catch/);
});

test('goal-tier evaluation stays centralized', () => {
  assert.match(contribution, /@domain\/goals\/GoalTiers\.js/);
  assert.match(worldModels, /@domain\/goals\/GoalTiers\.js/);
  assert.doesNotMatch(worldModels, /buildHabitStationModel|buildHabitCircuitModel/);
});
