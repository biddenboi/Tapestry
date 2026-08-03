import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (relativePath) => readFile(new URL(relativePath, import.meta.url), 'utf8');
const [
  registry,
  runtime,
  taskCompletion,
  taskProcessors,
  taskDetail,
  persistenceRuntime,
  settings,
  events,
  matches,
  feedComposer,
  rewards,
  materializedLeaderboards,
  demoSeeder,
  practiceDojo,
  castService,
  evaluation,
  mapMigration,
  mapImporter,
] = await Promise.all([
  read('../../app/shell/GameHub/panelRegistry.js'),
  read('./components/SocialWorldShell/SocialWorldRuntime.jsx'),
  read('../tasks/domain/TaskCompletionService.js'),
  read('../tasks/domain/TaskCompletionProcessors.js'),
  read('../tasks/modals/TodoDetailModal/TodoDetailModal.jsx'),
  read('../../data/persistence/PersistenceRuntime.js'),
  read('../settings/pages/Settings/Settings.jsx'),
  read('../../domain/events/Events.js'),
  read('../../domain/matches/MatchPostMatchJobs.js'),
  read('../feed/modals/PostComposerModal/PostComposerModal.jsx'),
  read('../../domain/rewards/RewardSchedule.js'),
  read('../../domain/leaderboards/MaterializedLeaderboards.js'),
  read('../../data/persistence/services/DemoDataSeeder.js'),
  read('../matches/components/PracticeDojo/PracticeDojo.jsx'),
  read('../../data/persistence/services/SocialWorldCastService.js'),
  read('../../domain/social-world/SocialWorldEvaluation.js'),
  read('../../data/persistence/sqlite/migrations/011_events_contributions_map.js'),
  read('../../data/persistence/sqlite/EventsShadowImporter.js'),
]);

test('the semantic scene is the sole primary world implementation', () => {
  assert.match(registry, /map: '@features\/social-world\/components\/SocialWorldShell\/SocialWorldShell\.jsx'/);
  assert.doesNotMatch(registry + runtime, /world-map|WorldMap|leaflet/i);
  assert.doesNotMatch(taskCompletion, /MapHotspots|getCachedCurrentLocation|getCurrentMapRecordsThroughIGT|activeHotspot|hotspotPointMultiplier|location:/);
  assert.doesNotMatch(taskProcessors, /map-record|getCurrentLocation|improveTaskLocation/);
  assert.doesNotMatch(taskDetail, /MapPreview|MapGeometry|formatLocationLabel|item\.location/);
});

test('geographic capture, queries, settings, gyms, and hotspot rewards are absent', async () => {
  const removedSources = [
    '../../features/world-map/components/WorldMapShell/WorldMapShell.jsx',
    '../../domain/map/MapGeometry.js',
    '../../domain/map/MapGyms.js',
    '../../domain/map/MapHotspots.js',
    '../../data/persistence/services/MapQueryService.js',
    '../../shared/browser/Location.js',
  ];
  for (const source of removedSources) {
    await assert.rejects(access(new URL(source, import.meta.url)));
  }
  assert.doesNotMatch(persistenceRuntime, /MapQueryService|mapQueries/);
  assert.doesNotMatch(settings, /Map Privacy|Location Retention|Clear Location History|geolocation/i);
  assert.doesNotMatch(events + matches + feedComposer, /getCurrentLocation|navigator\.geolocation|match-map/);
  assert.doesNotMatch(rewards + taskProcessors, /hotspot|MapGyms|MapHotspots/i);
  assert.doesNotMatch(demoSeeder, /latitude|longitude|task gym|map overlay|route interpolation/i);
  assert.doesNotMatch(materializedLeaderboards + demoSeeder + taskProcessors + practiceDojo, /DojoLeaderboardSnapshots|dojoLeaderboardSnapshot:v1|dojo-participants/);
});

test('immutable migration/import compatibility remains without a geographic query surface', () => {
  assert.match(mapMigration, /CREATE VIEW event_map_points/);
  assert.match(mapMigration, /latitude REAL/);
  assert.match(mapMigration, /longitude REAL/);
  assert.match(mapImporter, /loc\.latitude, loc\.longitude/);
  assert.doesNotMatch(castService, /SocialWorldEvaluation|analytics_events|recordAnalyticsEvent|shuffled|timeless/);
  assert.doesNotMatch(evaluation, /SocialWorldCastService|SocialWorldResidencyService|social_cast_assignments/);
});
