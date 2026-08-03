import { lazy, Suspense } from 'react';
import { usePanelLifecycle } from '@app/panel-lifecycle/PanelLifecycleContext.jsx';
import { measureDynamicModule } from '@shared/performance/startupPerf.js';
import SocialWorldStaticShell from './SocialWorldStaticShell.jsx';

const SocialWorldRuntime = lazy(() => measureDynamicModule(
  'social-world-runtime',
  () => import('./SocialWorldRuntime.jsx'),
));

export default function SocialWorldShell({ deferHeavyWork = false }) {
  const { isActive } = usePanelLifecycle();
  const runtimeActive = isActive && !deferHeavyWork;
  if (!runtimeActive) return <SocialWorldStaticShell />;
  return (
    <Suspense fallback={<SocialWorldStaticShell />}>
      <SocialWorldRuntime />
    </Suspense>
  );
}
