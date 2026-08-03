import { measureDynamicModule } from '@shared/performance/startupPerf.js';

export const loadFeed = () => measureDynamicModule(
  'feed',
  () => import('./components/Feed/Feed.jsx'),
).then((module) => module.default);
