import { prettyPrintDate } from '@domain/time/Time.js';
import {
  dojoBoundaryLabel,
  recommendationEvidenceLabel,
} from './usePracticeDojoController.js';

function emptyMessage(generationState) {
  if (generationState === 'empty') return 'No open tasks.';
  if (generationState === 'error') return 'Recommendation unavailable.';
  if (generationState === 'paused') return 'No eligible task is currently available.';
  if (generationState === 'scoring') return 'Scoring your first recommendation…';
  if (generationState === 'resolving-feedback') return 'Saving your response…';
  return 'Preparing your first recommendation…';
}

export default function DojoRecommendationFeed({ controller, compact = false }) {
  const {
    activeTask,
    feedScrollerRef,
    generationState,
    handleAddTask,
    handleFeedKeyDown,
    handleFeedScroll,
    handleFeedTouchMove,
    handleFeedTouchStart,
    handleFeedWheel,
    handlePlayRecommendation,
    handleRetryRecommendation,
    inTask,
    modelStateLabel,
    recommendationFeed,
    resetFeedTouch,
    taskHistory,
  } = controller;

  return (
    <div className={`dojo-recommendation-surface${compact ? ' is-compact' : ''}`}>
      {inTask ? (
        <div className="dojo-current-task">
          <div className="dct-label">ACTIVE TASK</div>
          <div className="dct-name">{activeTask.name}</div>
          {!compact && activeTask.reasonToSelect && <div className="dct-reason">{activeTask.reasonToSelect}</div>}
          {!compact && <div className="dct-hint">The room stays open while this task continues in the session dock.</div>}
        </div>
      ) : (
        <div className="dojo-feed">
          {!compact && <div className="dojo-feed-head">
            <div>
              <span className="dojo-feed-kicker">GET NEXT</span>
              <strong>Algorithm recommendations</strong>
            </div>
            <div className="dojo-feed-status" data-state={generationState}>
              <span>{recommendationFeed.length} generated</span>
              <strong>{modelStateLabel}</strong>
            </div>
          </div>}
          <div
            className="dojo-feed-scroller"
            ref={feedScrollerRef}
            onScroll={handleFeedScroll}
            onWheel={handleFeedWheel}
            onTouchStart={handleFeedTouchStart}
            onTouchMove={handleFeedTouchMove}
            onTouchEnd={resetFeedTouch}
            onTouchCancel={resetFeedTouch}
            onKeyDown={handleFeedKeyDown}
            tabIndex={0}
            aria-label="Task recommendations. Scroll past the final task to generate another."
          >
            {recommendationFeed.map((item, index) => {
              const todo = item.todo;
              const suggested = todo.recommendation?.suggestedMinutes || todo.estimatedDuration || 25;
              const reasons = [
                ...(todo.recommendation?.supportingReasons || []),
                todo.recommendation?.primaryReason,
              ].filter(Boolean).slice(0, 4);
              const evidenceLabel = recommendationEvidenceLabel(item.recommendation);
              const origin = todo.projectName || todo.goalName || todo.category || 'Tasks';
              return (
                <article key={item.id} className="dojo-feed-card" data-feed-index={index} data-card-id={item.id}>
                  <div className="dojo-feed-card-top">
                    <div className="dojo-feed-rank">
                      <span>{String(index + 1).padStart(2, '0')}</span>
                      <strong>GET NEXT</strong>
                    </div>
                    <button
                      type="button"
                      className="dojo-feed-play primary"
                      onClick={() => handlePlayRecommendation(item, index)}
                      aria-label={`Start ${todo.name}`}
                    >
                      ▶
                    </button>
                  </div>
                  <h2>{todo.name}</h2>
                  {!compact && <div className="dojo-feed-origin">{origin}</div>}
                  {!compact && <div className="dojo-feed-meta">
                    <span>{suggested}m session</span>
                    <span>due {prettyPrintDate(todo.dueDate)}</span>
                    <span>{evidenceLabel}</span>
                  </div>}
                  {!compact && reasons.length > 0 && (
                    <div className="dojo-feed-reasons">
                      {reasons.map((reason) => <span key={`${item.id}-${reason}`}>{reason}</span>)}
                    </div>
                  )}
                  {!compact && todo.recommendation?.expectedWorkloadImpact && (
                    <p className="dojo-feed-impact">{todo.recommendation.expectedWorkloadImpact}</p>
                  )}
                </article>
              );
            })}
            {recommendationFeed.length === 0 && (
              <div className="dojo-feed-empty">
                <strong>{emptyMessage(generationState)}</strong>
                {!compact && generationState === 'empty' && (
                  <button className="primary" onClick={handleAddTask}>+ ADD A TASK</button>
                )}
                {generationState === 'error' && (
                  <button className="primary" onClick={handleRetryRecommendation}>RETRY</button>
                )}
              </div>
            )}
          </div>
          {!compact && recommendationFeed.length > 0 && (
            <div className="dojo-feed-boundary" data-state={generationState} role="status">
              <span>{dojoBoundaryLabel(generationState)}</span>
            </div>
          )}
        </div>
      )}

      {!compact && taskHistory.length > 0 && (
        <div className="dojo-history">
          <div className="dojo-history-label">COMPLETED THIS SESSION</div>
          {taskHistory.map((task) => (
            <div key={task.UUID} className="dojo-history-row">
              <span className="dhr-name">{task.name}</span>
              <span className="dhr-pts">+{task.points ?? 0}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
