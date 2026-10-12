import { measureDynamicModule } from '@shared/performance/startupPerf.js';

export const loadGate = () => measureDynamicModule(
  'gate',
  () => import('./components/Gate/Gate.jsx'),
).then((module) => module.default);
