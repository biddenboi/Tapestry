import { measureDynamicModule } from '@shared/performance/startupPerf.js';

export const loadQuickNotes = () => measureDynamicModule(
  'quick-notes',
  () => import('./modals/QuickNotes/QuickNotes.jsx'),
).then((module) => module.default);
