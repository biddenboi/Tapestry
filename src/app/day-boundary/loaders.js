import { measureDynamicModule } from '@shared/performance/startupPerf.js';

export const loadWakePopup = () => measureDynamicModule('start-day', () => import('./DayPrompt.jsx'))
  .then((module) => module.StartDayPrompt);
export const loadEndDayConfirm = () => measureDynamicModule('end-work', () => import('./DayPrompt.jsx'))
  .then((module) => module.EndWorkPrompt);
