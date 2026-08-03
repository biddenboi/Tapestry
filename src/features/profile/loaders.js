import { measureDynamicModule } from '@shared/performance/startupPerf.js';

export const loadProfile = () => measureDynamicModule(
  'profile',
  () => import('./pages/Profile/Profile.jsx'),
).then((module) => module.default);

export const loadBanModal = () => measureDynamicModule(
  'ban-modal',
  () => import('./modals/BanModal/BanModal.jsx'),
).then((module) => module.default);

export const loadProfileSwitcher = () => measureDynamicModule(
  'profile-switcher',
  () => import('./modals/ProfileSwitcher/ProfileSwitcher.jsx'),
).then((module) => module.default);
