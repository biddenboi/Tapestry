import { measureDynamicModule } from '@shared/performance/startupPerf.js';

export const loadRankProgressModal = () => measureDynamicModule(
  'rank-progress-modal',
  () => import('./modals/RankProgressModal/RankProgressModal.jsx'),
).then((module) => module.default);
