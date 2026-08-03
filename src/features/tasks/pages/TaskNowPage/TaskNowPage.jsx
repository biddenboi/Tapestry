export default function TaskNowPage({ recommendation, onStart, onInspect, children }) {
  return (
    <section className="task-now-page" aria-labelledby="task-now-title">
      <div className="task-now-focus">
        <div>
          <span className="todo-panel-title" id="task-now-title">Current move</span>
          <strong>{recommendation?.name || 'Choose a task to begin'}</strong>
          <p>{recommendation?.reasonToSelect || 'Open the task below to review its details, then decide whether now is the right time.'}</p>
        </div>
        {recommendation && (
          <div className="task-now-focus__actions">
            <button type="button" onClick={() => onInspect(recommendation)}>Review details</button>
            <button type="button" className="primary" onClick={() => onStart(recommendation)}>
              Start {recommendation.estimatedDuration ? `${recommendation.estimatedDuration}m` : ''}
            </button>
          </div>
        )}
      </div>
      {!recommendation && (
        <div className="task-now-choice">
          <div className="task-now-choice__heading">
            <strong>First available task</strong>
            <span>Click the row for details. The circle completes it.</span>
          </div>
          {children}
        </div>
      )}
    </section>
  );
}
