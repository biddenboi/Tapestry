import { measureDynamicModule } from '@shared/performance/startupPerf.js';

export const loadContributionPass = () => measureDynamicModule(
  'contribution-pass',
  () => import('./pages/ContributionPass/ContributionPass.jsx'),
).then((module) => module.default);
