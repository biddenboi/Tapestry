import { measureDynamicModule } from '@shared/performance/startupPerf.js';

export const loadFeed = () => measureDynamicModule(
  'feed',
  () => import('./pages/FeedPage/FeedPage.jsx'),
).then((module) => module.default);
