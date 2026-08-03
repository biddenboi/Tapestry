import { measureDynamicModule } from '@shared/performance/startupPerf.js';

export const loadEvents = () => measureDynamicModule(
  'events',
  () => import('./pages/Events/Events.jsx'),
).then((module) => module.default);

export const loadEndDayConfirm = () => measureDynamicModule(
  'end-day-confirm',
  () => import('./modals/EndDayConfirm/EndDayConfirm.jsx'),
).then((module) => module.default);

export const loadWakePopup = () => measureDynamicModule(
  'wake-popup',
  () => import('./modals/WakePopup/WakePopup.jsx'),
).then((module) => module.default);
