import { measureDynamicModule } from '@shared/performance/startupPerf.js';

export const loadInbox = () => measureDynamicModule(
  'inbox',
  () => import('./components/Inbox/Inbox.jsx'),
).then((module) => module.default);
