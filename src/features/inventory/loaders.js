import { measureDynamicModule } from '@shared/performance/startupPerf.js';

export const loadInventory = () => measureDynamicModule(
  'inventory',
  () => import('./pages/Inventory/Inventory.jsx'),
).then((module) => module.default);
