import { useEffect } from 'react';
import { timeAsHHMMSS } from '@domain/time/Time.js';
import usePracticeDojoController from '@features/matches/components/PracticeDojo/usePracticeDojoController.js';
import DojoRecommendationFeed from '@features/matches/components/PracticeDojo/DojoRecommendationFeed.jsx';
import { useMobileSurface } from '@app/mobile/MobileSurfaceContext.jsx';
import '@features/matches/components/PracticeDojo/PracticeDojo.css';

export default function MobileDojoRuntime({ onBack }) {
  const { openSurface } = useMobileSurface();
  const controller = usePracticeDojoController({
    presentTask: (task) => openSurface('task-actions', { task }),
  });
  const exit = async () => {
    await controller.handleExitDojo();
    onBack?.();
  };

  useEffect(() => {
    const onLeave = () => { void controller.handleExitDojo(); };
    window.addEventListener('tapestry:mobile-arena-leave', onLeave);
    return () => window.removeEventListener('tapestry:mobile-arena-leave', onLeave);
  }, [controller.handleExitDojo]);

  return (
    <section className="mobile-competition-runtime mobile-dojo-runtime" aria-labelledby="mobile-dojo-title">
      <header className="mobile-runtime-header">
        <button type="button" onClick={exit}>← More</button>
        <div><h1 id="mobile-dojo-title">Dojo</h1></div>
        <strong>{timeAsHHMMSS(controller.elapsed)}</strong>
      </header>

      <div className="mobile-dojo-feed-shell">
        <DojoRecommendationFeed controller={controller} compact />
      </div>
    </section>
  );
}
