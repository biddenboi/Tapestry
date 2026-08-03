import { useMemo, useState } from 'react';
import { buildSuggestionExplanation } from '../../services/SuggestionExplanationService.js';
import ActiveTaskMove from './ActiveTaskMove.jsx';
import NextMoveAlternatives from './NextMoveAlternatives.jsx';
import NextMoveCorrectionMenu from './NextMoveCorrectionMenu.jsx';
import NextMoveExplanation from './NextMoveExplanation.jsx';
import TaskClarification from '../TaskClarification/TaskClarification.jsx';
import DayOrientation from '../DayOrientation/DayOrientation.jsx';

const PRIMARY_LABEL = {
  active: 'Continue',
  commitment: 'Prepare',
  continue: 'Resume',
  execute: 'Begin',
  clarify: 'Clarify',
  'reorient-day': 'Orient today',
  'reorient-goal': 'Choose milestone',
  reflect: 'Capture what changed',
  recover: 'Step away',
  ask: 'Answer',
  none: 'Choose manually',
};

export default function NextMoveDrawer({
  decision,
  loading,
  error,
  grabProps,
  dragging,
  keyboardMode,
  snapEdge,
  onClose,
  onPrimary,
  onNotNow,
  onCorrection,
  onAlternative,
  onManual,
  onPlace,
  onStartKeyboardMove,
  activeTask,
  taskSession,
  onRetry,
  clarificationTask,
  clarificationProps,
}) {
  const [showWhy, setShowWhy] = useState(false);
  const [showAlternatives, setShowAlternatives] = useState(false);
  const [showCorrections, setShowCorrections] = useState(false);
  const [showPlacement, setShowPlacement] = useState(false);
  const explanation = useMemo(() => buildSuggestionExplanation(decision || {}), [decision]);

  return (
    <aside
      className={[
        'next-move-drawer',
        dragging ? 'is-dragging' : '',
        keyboardMode ? 'is-keyboard-moving' : '',
        snapEdge ? `will-dock-${snapEdge}` : '',
      ].filter(Boolean).join(' ')}
      aria-label="Next Move"
      aria-busy={loading}
    >
      <header className="next-move-drawer__header">
        <div className="next-move-grab" {...grabProps}>
          <i aria-hidden="true" />
          <span>{keyboardMode ? 'Arrow keys move · Enter saves · Escape cancels' : 'Move Next Move'}</span>
        </div>
        <div className="next-move-header-actions">
          <button
            type="button"
            onClick={() => setShowPlacement((visible) => !visible)}
            aria-expanded={showPlacement}
            aria-label="Next Move placement"
          >
            Position
          </button>
          <button type="button" onClick={onClose} aria-label="Minimize Next Move">Minimize</button>
        </div>
        {showPlacement && (
          <div className="next-move-placement-menu" role="menu">
            {[
              ['dock-left', 'Dock left'],
              ['dock-right', 'Dock right'],
              ['top-left', 'Move to top left'],
              ['top-right', 'Move to top right'],
              ['bottom-left', 'Move to bottom left'],
              ['bottom-right', 'Move to bottom right'],
              ['center', 'Center'],
              ['reset', 'Reset position'],
            ].map(([command, label]) => (
              <button type="button" role="menuitem" key={command} onClick={() => {
                onPlace?.(command);
                setShowPlacement(false);
              }}>
                {label}
              </button>
            ))}
            <button type="button" role="menuitem" onClick={() => {
              onStartKeyboardMove?.();
              setShowPlacement(false);
            }}>
              Move with keyboard
            </button>
          </div>
        )}
      </header>

      <div className="next-move-drawer__body">
        {loading && (
          <div className="next-move-loading" role="status">
            <i aria-hidden="true" />
            <span>Finding the smallest useful move…</span>
          </div>
        )}
        {!loading && error && (
          <div className="next-move-empty" role="alert">
            <span>Direction unavailable</span>
            <p>{error}</p>
            <button type="button" onClick={onManual}>Choose manually</button>
          </div>
        )}
        {!loading && !error && activeTask && taskSession && (
          <ActiveTaskMove
            snapshot={activeTask}
            onExpand={taskSession.expand}
            onTogglePause={taskSession.togglePause}
            onSettle={taskSession.settleSession}
          />
        )}
        {!loading && !error && clarificationTask && (
          <TaskClarification task={clarificationTask} {...clarificationProps} />
        )}
        {!loading && !error && !activeTask && !clarificationTask && decision?.resultType === 'reorient-day' && (
          <DayOrientation decision={decision} onFollow={onPrimary} />
        )}
        {!loading && !error && !activeTask && !clarificationTask && decision?.resultType !== 'reorient-day' && decision && (
          <article className="next-move-recommendation" data-result={decision.resultType}>
            <span className="next-move-kicker">
              {decision.resultType === 'none' ? 'No move needed' : decision.phase}
            </span>
            <h2>{decision.title}</h2>
            {decision.context && <p>{decision.context}</p>}
            {decision.destination?.routeLabel && (
              <div className="next-move-destination">
                <span>Destination</span>
                <strong>{decision.destination.routeLabel}</strong>
              </div>
            )}
            {decision.confidence === 'low' && (
              <p className="next-move-confidence">
                I cannot determine one best move from the current information.
              </p>
            )}
            <button type="button" className="primary next-move-primary" onClick={onPrimary}>
              {decision.primaryAction?.label || PRIMARY_LABEL[decision.resultType] || 'Continue'}
            </button>
          </article>
        )}

        {!loading && !error && !activeTask && !clarificationTask && !decision && (
          <div className="next-move-empty" role="status">
            <span>Ready for a new move</span>
            <p>The last evaluation ended without a recommendation.</p>
            <button type="button" onClick={onRetry}>Try again</button>
          </div>
        )}

        {!loading && !error && decision && !activeTask && !clarificationTask && (
          <>
            <div className="next-move-secondary-actions">
              <button type="button" onClick={() => setShowAlternatives((visible) => !visible)}>
                Another move
              </button>
              <button type="button" onClick={() => setShowWhy((visible) => !visible)}>
                Why this?
              </button>
              <button type="button" onClick={onNotNow}>Not now</button>
              <button type="button" onClick={() => setShowCorrections(true)}>Correct</button>
            </div>
            {showWhy && <NextMoveExplanation explanation={explanation} />}
            {showAlternatives && (
              <NextMoveAlternatives
                alternatives={decision.alternatives}
                onChoose={onAlternative}
                onManual={onManual}
              />
            )}
            {showCorrections && (
              <NextMoveCorrectionMenu
                onClose={() => setShowCorrections(false)}
                onChoose={(type) => {
                  setShowCorrections(false);
                  onCorrection?.(type);
                }}
              />
            )}
          </>
        )}
      </div>

      <footer className="next-move-drawer__footer">
        <span>Local · deterministic · {decision?.rulesetVersion || 'next_move_v1'}</span>
        <kbd>⌘⇧M</kbd>
      </footer>
    </aside>
  );
}
