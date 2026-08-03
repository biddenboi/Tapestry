import { measureDynamicModule } from '@shared/performance/startupPerf.js';

export const loadShop = () => measureDynamicModule(
  'shop',
  () => import('./pages/Shop/Shop.jsx'),
).then((module) => module.default);
