import { measureDynamicModule } from '@shared/performance/startupPerf.js';

export const loadMatchArena = () => measureDynamicModule(
  'match-arena',
  () => import('./components/MatchArena/MatchArena.jsx'),
).then((module) => module.default);

export const loadPracticeDojo = () => measureDynamicModule(
  'practice-dojo',
  () => import('./components/PracticeDojo/PracticeDojo.jsx'),
).then((module) => module.default);

export const loadMatchDetailsModal = () => measureDynamicModule(
  'match-details-modal',
  () => import('./modals/MatchDetailsModal/MatchDetailsModal.jsx'),
).then((module) => module.default);

export const loadInsufficientPlayersModal = () => measureDynamicModule(
  'insufficient-players-modal',
  () => import('./modals/InsufficientPlayersModal/InsufficientPlayersModal.jsx'),
).then((module) => module.default);
