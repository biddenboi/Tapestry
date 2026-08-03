import { timeAsHHMMSS } from '@domain/time/Time.js';
import usePracticeDojoController from '@features/matches/components/PracticeDojo/usePracticeDojoController.js';
import { useMobileSurface } from '@app/mobile/MobileSurfaceContext.jsx';

function dojoEmptyLabel(state) {
  if (state === 'empty') return 'No open workspace tasks.';
  if (state === 'error') return 'The next recommendation could not be scored.';
  if (state === 'paused') return 'No eligible next task is available.';
  return 'Preparing a recommendation…';
}

export default function MobileDojoRuntime({ onBack }) {
  const { openSurface } = useMobileSurface();
  const controller = usePracticeDojoController({
    presentTask: (task) => openSurface('task-actions', { task }),
  });
  const addTask = () => openSurface('task-composer', {});
  const exit = async () => {
    await controller.handleExitDojo();
    onBack?.();
  };

  return (
    <section className="mobile-competition-runtime mobile-dojo-runtime" aria-labelledby="mobile-dojo-title">
      <header className="mobile-runtime-header">
        <button type="button" onClick={exit} disabled={controller.inTask}>← More</button>
        <div><span>Practice mode</span><h1 id="mobile-dojo-title">Dojo</h1></div>
        <strong>{timeAsHHMMSS(controller.elapsed)}</strong>
      </header>
      <div className="mobile-runtime-stats">
        <span>Session points<strong>{controller.sessionPoints.toLocaleString()}</strong></span>
        <span>Open tasks<strong>{controller.todoCount.toLocaleString()}</strong></span>
      </div>

      {controller.inTask ? (
        <article className="mobile-runtime-active-card">
          <span>Active Dojo task</span>
          <h2>{controller.activeTask.name}</h2>
          <p>{controller.activeTask.reasonToSelect || 'This task remains pinned to the current Dojo session.'}</p>
        </article>
      ) : (
        <div
          className="mobile-dojo-recommendations"
          data-generation-state={controller.generationState}
          ref={controller.feedScrollerRef}
          onScroll={controller.handleFeedScroll}
          onWheel={controller.handleFeedWheel}
          onTouchStart={controller.handleFeedTouchStart}
          onTouchMove={controller.handleFeedTouchMove}
          onTouchEnd={controller.resetFeedTouch}
          onTouchCancel={controller.resetFeedTouch}
          onKeyDown={controller.handleFeedKeyDown}
          tabIndex={0}
          aria-label="Dojo task recommendations"
        >
          {controller.recommendationFeed.map((item, index) => (
            <article key={item.id} data-feed-index={index} data-card-id={item.id}>
              <header><span>Recommendation {index + 1}</span><b>{item.todo.recommendation?.suggestedMinutes || item.todo.estimatedDuration || 25} min</b></header>
              <h2>{item.todo.name}</h2>
              <p>{item.todo.recommendation?.primaryReason || item.todo.reasonToSelect || 'A useful next action for this session.'}</p>
              <button type="button" className="primary" onClick={() => controller.handlePlayRecommendation(item, index)}>Review and start</button>
            </article>
          ))}
          {!controller.recommendationFeed.length && (
            <div className="mobile-runtime-empty" role="status">
              <strong>{dojoEmptyLabel(controller.generationState)}</strong>
              {controller.generationState === 'empty' && <button type="button" onClick={addTask}>Add a task</button>}
              {controller.generationState === 'error' && <button type="button" onClick={controller.handleRetryRecommendation}>Retry</button>}
            </div>
          )}
        </div>
      )}

      {controller.taskHistory.length > 0 && (
        <section className="mobile-runtime-history">
          <h2>Completed this session</h2>
          {controller.taskHistory.map((task) => <div key={task.UUID}><span>{task.name}</span><strong>+{Number(task.points || 0)}</strong></div>)}
        </section>
      )}
      <footer className="mobile-runtime-actions">
        <button type="button" onClick={addTask} disabled={controller.inTask}>Add task</button>
        <button type="button" className="danger" onClick={exit} disabled={controller.inTask}>Exit Dojo</button>
      </footer>
    </section>
  );
}
