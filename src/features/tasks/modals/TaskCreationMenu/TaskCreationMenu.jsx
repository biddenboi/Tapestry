import '@features/tasks/modals/TaskCreationMenu/TaskCreationMenu.css';
import { useState, useMemo, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import { useAppContext } from '@app/hooks/useAppContext.js';
import { DOMAIN_INVALIDATION } from '@app/context/domainRevisions.js';
import { STORES } from '@domain/constants.js';
import { coerceAversion } from '@domain/tasks/Tasks.js';
import { parseCombinedInput } from '@shared/nlp/NLP.js';
import { formatTaskRecurrence, ruleWithAnchor } from '@domain/tasks/TaskRecurrence.js';
import { isGoalActive, isGoalTaskCategory } from '@domain/contribution/Contribution.js';
import { deleteTaskCommand } from '@domain/tasks/TaskCommands.js';
import { saveTaskDraftCommand } from '@domain/tasks/TaskDraftCommand.js';
import MarkdownEditor from '@shared/markdown-editor/MarkdownEditor.jsx';
import useOverlayFocus from '@shared/ui/useOverlayFocus.js';

const AVERSION_LABELS = { 1: 'Low', 2: 'Medium', 3: 'High' };
const TASK_GOAL_INVALIDATION = Object.freeze([
  ...new Set([
    ...DOMAIN_INVALIDATION.taskWrite,
    ...DOMAIN_INVALIDATION.goalLinkWrite,
  ]),
]);

/** Reconstruct the combined text from an existing task's fields for editing. */
const seedCombined = (task) => {
  if (!task) return '';
  const parts = [];
  if (task.name) parts.push(task.name);
  if (task.recurrence || task.repeatRule) parts.push(formatTaskRecurrence(task.recurrence || task.repeatRule));
  if (task.dueDate) {
    const d = new Date(task.dueDate);
    if (!Number.isNaN(d.getTime())) {
      const datePart = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      const timePart = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      parts.push(`${datePart} ${timePart}`);
    }
  }
  const minutes = Number(task.estimatedDuration);
  if (Number.isFinite(minutes) && minutes > 0) {
    if (minutes < 60) parts.push(`${minutes} min`);
    else {
      const h = Math.floor(minutes / 60);
      const m = minutes % 60;
      parts.push(m === 0 ? (h === 1 ? '1 hour' : `${h} hours`) : `${h}h ${m}m`);
    }
  }
  return parts.join(' ');
};

// ── Highlight overlay helpers ──────────────────────────────────────────────

/**
 * Split the input text into segments tagged as 'normal', 'date', 'duration', or 'recurrence'.
 * Used to render the backdrop overlay with coloured token spans.
 */
function buildSegments(text, ranges) {
  const { date, duration, recurrence } = ranges;
  const marked = [];
  if (date)     marked.push({ start: date[0],     end: date[1],     type: 'date' });
  if (duration) marked.push({ start: duration[0], end: duration[1], type: 'duration' });
  if (recurrence) marked.push({ start: recurrence[0], end: recurrence[1], type: 'recurrence' });
  marked.sort((a, b) => a.start - b.start);

  const segments = [];
  let pos = 0;
  for (const { start, end, type } of marked) {
    if (pos < start) segments.push({ text: text.slice(pos, start), type: 'normal' });
    if (start < end) segments.push({ text: text.slice(start, end), type });
    pos = end;
  }
  if (pos < text.length) segments.push({ text: text.slice(pos), type: 'normal' });
  return segments;
}

/**
 * Use canvas measureText to find which character in `text` sits at pixel
 * offset `targetPx` (already adjusted for padding and scroll).
 * Returns a character index 0..text.length.
 */
function charIndexAtPx(text, targetPx, fontString) {
  if (targetPx <= 0) return 0;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  ctx.font = fontString;
  for (let i = 1; i <= text.length; i++) {
    if (ctx.measureText(text.slice(0, i)).width > targetPx) return i - 1;
  }
  return text.length;
}

// ── Component ──────────────────────────────────────────────────────────────

export default NiceModal.create(() => {
  const {
    databaseConnection,
    invalidateDomains,
    playSound,
    currentPlayer,
    activeTask: [activeTask, setActiveTask],
  } = useAppContext();
  const modal = useModal();
  const modalFrameRef = useOverlayFocus(modal.visible, undefined, false, false, true);

  const [combinedText, setCombinedText]   = useState(() => seedCombined(activeTask));
  const [excludedTypes, setExcludedTypes] = useState(new Set());
  const [projects, setProjects]           = useState([]);

  const inputRef = useRef(null);
  // Ref to the backdrop's inner span. We sync its horizontal transform
  // imperatively (NOT via React state) so that typing — which causes the
  // native input to auto-scroll to keep the caret visible — never triggers
  // an extra render. That extra render was the root of the cursor-jump:
  // the re-render caused React to reconcile the controlled <input> and, in
  // combination with the backdrop DOM changing under it, the caret
  // position was being lost on tokens that became highlighted.
  const backdropInnerRef = useRef(null);

  const syncBackdropScroll = useCallback(() => {
    if (inputRef.current && backdropInnerRef.current) {
      backdropInnerRef.current.style.transform =
        `translateX(-${inputRef.current.scrollLeft}px)`;
    }
  }, []);

  // Re-seed on task switch (same modal mount, different task).
  useEffect(() => {
    setCombinedText(seedCombined(activeTask));
    setExcludedTypes(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTask.UUID]);

  // Goals are created and managed from the Goals button in the Events header. Tasks only select them.
  useEffect(() => {
    databaseConnection.getAll(STORES.project)
      .then((rows) => setProjects(
        rows.filter((goal) => (
          (!currentPlayer?.UUID || !goal.parent || String(goal.parent) === String(currentPlayer.UUID))
          && isGoalActive(goal)
          && isGoalTaskCategory(goal)
        )).sort((a, b) => String(a.name).localeCompare(String(b.name))),
      ))
      .catch(() => {});
  }, [currentPlayer?.UUID, databaseConnection]);

  const parsed = useMemo(
    () => parseCombinedInput(combinedText, {
      excludeDate:     excludedTypes.has('date'),
      excludeDuration: excludedTypes.has('duration'),
    }),
    [combinedText, excludedTypes],
  );
  const selectedProjectId = projects.some((project) => (
    String(project.UUID) === String(activeTask.projectId || '')
  )) ? activeTask.projectId : '';

  const segments = useMemo(
    () => buildSegments(combinedText, parsed.ranges),
    [combinedText, parsed.ranges],
  );

  const canSave = () => !!(parsed.name && parsed.dueDate.iso && parsed.duration.minutes);

  const close = () => { modal.hide(); modal.remove(); };

  // ── Text change ────────────────────────────────────────────────────────
  const handleCombinedChange = useCallback((e) => {
    setCombinedText(e.target.value);
    // Only reset exclusions when there's something to reset — avoids an
    // unnecessary state update (and the extra render) on every keystroke.
    setExcludedTypes((prev) => (prev.size === 0 ? prev : new Set()));
    // Backdrop scroll is kept in sync by the useLayoutEffect below, so no
    // post-commit state update needed here.
  }, []);

  // Backdrop transform tracks the input's native scroll without any state.
  const handleScroll = useCallback(() => {
    syncBackdropScroll();
  }, [syncBackdropScroll]);

  // After every text change, re-sync the backdrop's transform in case the
  // input auto-scrolled to keep the caret visible. useLayoutEffect runs
  // before paint so there's no visible lag between the caret and the
  // coloured tokens beneath it.
  useLayoutEffect(() => {
    syncBackdropScroll();
  }, [combinedText, syncBackdropScroll]);

  // ── Token click detection ──────────────────────────────────────────────
  // Intercept mousedown (before cursor placement) on the real input.
  // If the click lands inside a highlighted range we toggle exclusion and
  // call preventDefault() so the cursor does NOT jump to that position.
  const handleMouseDown = useCallback((e) => {
    const { date, duration } = parsed.ranges;
    if (!date && !duration) return;          // nothing to intercept

    const rect = inputRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const padLeft = 10;                      // mirrors the 10px CSS padding-left
    const font = '400 13.5px "DM Sans", system-ui, sans-serif';
    // Read scrollLeft directly from the DOM — no React state needed here.
    const scrollLeft = inputRef.current.scrollLeft;
    const charIdx = charIndexAtPx(combinedText, clickX - padLeft + scrollLeft, font);

    if (date && charIdx >= date[0] && charIdx <= date[1]) {
      e.preventDefault();
      inputRef.current.focus();             // keep input focused
      setExcludedTypes((prev) => {
        const next = new Set(prev);
        next.has('date') ? next.delete('date') : next.add('date');
        return next;
      });
      return;
    }
    if (duration && charIdx >= duration[0] && charIdx <= duration[1]) {
      e.preventDefault();
      inputRef.current.focus();
      setExcludedTypes((prev) => {
        const next = new Set(prev);
        next.has('duration') ? next.delete('duration') : next.add('duration');
        return next;
      });
    }
  }, [parsed.ranges, combinedText]);

  // ── Save / delete / discard ────────────────────────────────────────────
  const handleSaveTodo = async () => {
    if (!canSave()) return;
    const player = currentPlayer?.UUID ? currentPlayer : await databaseConnection.getCurrentPlayer();

    const description = String(activeTask.description ?? activeTask.efficiency ?? '');
    await saveTaskDraftCommand(databaseConnection, {
      taskDraft: activeTask,
      player,
      fields: {
        name: parsed.name,
        estimatedDuration: parsed.duration.minutes,
        dueDate: parsed.dueDate.iso,
        aversion: coerceAversion(activeTask.aversion),
        projectId: activeTask.projectId || null,
        recurrence: ruleWithAnchor(
          parsed.recurrence || activeTask.recurrence || activeTask.repeatRule || null,
          parsed.dueDate.iso,
        ),
        description,
      },
    }, { origin: 'desktop' });
    playSound?.('add', { volume: 0.78 });
    setActiveTask({});
    close();
    requestAnimationFrame(() => invalidateDomains(TASK_GOAL_INVALIDATION));
  };

  const handleDelete = async () => {
    if (activeTask.UUID) {
      await deleteTaskCommand(databaseConnection, activeTask);
      playSound?.('warning', { volume: 0.62 });
      invalidateDomains(DOMAIN_INVALIDATION.taskWrite);
    }
    setActiveTask({});
    close();
  };

  const handleDiscard = () => { setActiveTask({}); close(); };

  const currentAversion = coerceAversion(activeTask.aversion);

  if (!modal.visible) return null;

  return (
    <div className="task-modal-overlay">
      <div className="blanker" aria-hidden="true" />
      <div
        ref={modalFrameRef}
        className="task-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-editor-title"
      >

        <div className="task-modal-header">
          <span id="task-editor-title">{activeTask.UUID ? 'TASK EDITING' : 'TASK CREATION'}</span>
          {activeTask.UUID && (
            <button className="tcm-delete-btn" onClick={handleDelete} title="Delete this task">
              ✕ DELETE
            </button>
          )}
        </div>

        <div className="task-form-body">

          {/* ── Task input (full width) ───────────────────────── */}
          <label className="tcm-task-label">
            Task
            <div className="nlp-input-wrapper">
              <div className="nlp-input-backdrop" aria-hidden="true">
                <span ref={backdropInnerRef} className="nlp-backdrop-inner">
                  {segments.map((seg, i) =>
                    seg.type === 'normal' ? (
                      <span key={i}>{seg.text}</span>
                    ) : (
                      <span key={i} className={`nlp-token nlp-token--${seg.type}`}>
                        {seg.text}
                      </span>
                    )
                  )}
                </span>
              </div>
              <input
                ref={inputRef}
                type="text"
                autoFocus
                className="nlp-input-field"
                placeholder='e.g. "Buy groceries tomorrow 5pm 30min"'
                value={combinedText}
                onChange={handleCombinedChange}
                onScroll={handleScroll}
                onMouseDown={handleMouseDown}
              />
            </div>
            {(parsed.dueDate.display || parsed.duration.display || parsed.recurrence) && (
              <div className="nlp-meta">
                {parsed.dueDate.display && (
                  <span className="nlp-meta-token nlp-meta-date">{parsed.dueDate.display}</span>
                )}
                {parsed.dueDate.display && parsed.duration.display && (
                  <span className="nlp-meta-sep">·</span>
                )}
                {parsed.duration.display && (
                  <span className="nlp-meta-token nlp-meta-dur">{parsed.duration.display}</span>
                )}
                {parsed.recurrence && (
                  <span className="nlp-meta-token nlp-meta-repeat">↻ {formatTaskRecurrence(parsed.recurrence)}</span>
                )}
              </div>
            )}
          </label>

          {/* ── Goal + Resistance on same row ─────────────── */}
          <div className="tcm-meta-row">
            <label className="tcm-project-label">
              Goal
              <select
                className="project-select"
                value={selectedProjectId}
                onChange={(e) =>
                  setActiveTask((prev) => ({ ...prev, projectId: e.target.value || null }))
                }
              >
                <option value="">— No Goal —</option>
                {projects.map((p) => (
                  <option key={p.UUID} value={p.UUID}>{p.name}</option>
                ))}
              </select>
            </label>
            <div className="tcm-field-group">
              <span className="tcm-field-label">Resistance</span>
              <div className="aversion-selector">
                {[1, 2, 3].map((level) => (
                  <button
                    key={level}
                    type="button"
                    className={`aversion-btn aversion-btn--${level} ${currentAversion === level ? 'active' : ''}`}
                    onClick={() => setActiveTask((prev) => ({ ...prev, aversion: level }))}
                  >
                    {AVERSION_LABELS[level]}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* ── Task description ─────────────────────────────── */}
          <label className="full-width">
            Description
            <MarkdownEditor
              value={activeTask.description ?? activeTask.efficiency ?? ''}
              onChange={(value) => setActiveTask((prev) => ({
                ...prev,
                description: value,
                efficiency: value,
              }))}
              placeholder="Notes, context, or links for this task..."
              className="description-editor"
            />
          </label>

        </div>

        <div className="task-modal-footer">
          <button onClick={handleDiscard}>DISCARD</button>
          <button className="primary" onClick={handleSaveTodo} disabled={!canSave()}>
            SAVE TODO
          </button>
        </div>

      </div>
    </div>
  );
});
