import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { getGoalTierProgress } from '@domain/goals/GoalTiers.js';
import { isGoalDefinitionVague } from '@domain/goals/GoalModel.js';
import { progressRatio } from '@domain/goals/GoalProgress.js';
import ProfilePicture from '@shared/profile-picture/ProfilePicture.jsx';
import LocalSectionNav from '@shared/navigation/LocalSectionNav/LocalSectionNav.jsx';
import { useLocalSectionRoute } from '@shared/navigation/LocalSectionNav/LocalSectionRouteState.js';
import { useAppContext } from '@app/hooks/useAppContext.js';
import {
  ACHIEVEMENT_EVENT_TYPE,
  createAchievementEvent,
  queueAchievementEvent,
} from '@domain/achievements/AchievementProcessing.js';

const GOAL_DETAIL_PAGES = Object.freeze([
  { id: 'overview', label: 'Overview', description: 'See outcome progress, the current move, and contribution identity.' },
  { id: 'roadmap', label: 'Roadmap', description: 'Organize milestones, stages, and supporting work.' },
  { id: 'activity', label: 'Activity', description: 'Record updates and review the Goal timeline.' },
  { id: 'people', label: 'People', description: 'See who contributes to or follows this Goal.' },
  { id: 'review-settings', label: 'Review & Settings', description: 'Review health, lifecycle, privacy, and Goal settings.' },
]);
const GOAL_COLLECTION_PAGES = Object.freeze([
  { id: 'overview', label: 'Overview', description: 'Your current focus, Goal health, Areas, and active outcomes.' },
  { id: 'areas', label: 'Areas', description: 'Browse ongoing directions and the Goals attached to each.' },
  { id: 'reviews', label: 'Reviews', description: 'Resolve Goals that need a fresh status or next move.' },
  { id: 'completed', label: 'Completed', description: 'Revisit finished outcomes and their retained contribution history.' },
]);

const HEALTH_LABELS = Object.freeze({
  unset: 'Status unset',
  on_track: 'On track',
  at_risk: 'At risk',
  blocked: 'Blocked',
});

const LIFECYCLE_LABELS = Object.freeze({
  active: 'Active',
  paused: 'Paused',
  completed: 'Completed',
  archived: 'Archived',
});

const GOAL_ICONS = ['◆', '✦', '⬡', '⌁', '◈', '▣', '△', '◎'];
const COLOR_PRESETS = ['#4da3ff', '#34d399', '#f59e0b', '#f472b6', '#a78bfa', '#f43f5e'];

const goalAccentStyle = (goal) => (
  goal?.accentColor
    ? {
        '--goals-accent': goal.accentColor,
        '--goals-accent-soft': `color-mix(in srgb, ${goal.accentColor} 16%, transparent)`,
      }
    : {}
);

const formatDate = (value, fallback = 'No target') => {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? fallback
    : new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
};

const actionEntityLabel = (type) => ({
  todo: 'Task',
  task: 'Completed task',
  habit: 'Habit',
  reminder: 'Reminder',
  event: 'Event',
}[type] || 'Action');

function StatusBadge({ kind, value }) {
  const label = kind === 'health'
    ? HEALTH_LABELS[value] || HEALTH_LABELS.unset
    : LIFECYCLE_LABELS[value] || value;
  return (
    <span className={`goals-status goals-status--${kind} goals-status--${value || 'unset'}`}>
      <span aria-hidden="true">{value === 'blocked' ? '!' : value === 'on_track' ? '✓' : '●'}</span>
      {label}
    </span>
  );
}

function ProgressVisual({ progress, compact = false }) {
  const ratio = Math.round(progressRatio(progress) * 100);
  if (progress?.type === 'metric') {
    return (
      <div className={`goals-progress ${compact ? 'is-compact' : ''}`}>
        <div className="goals-progress__labels">
          <strong>{progress.currentValue.toLocaleString()} {progress.unit}</strong>
          <span>Target {progress.targetValue.toLocaleString()} {progress.unit}</span>
        </div>
        <div
          className="goals-progress__track"
          role="progressbar"
          aria-label="Outcome progress"
          aria-valuemin="0"
          aria-valuemax="100"
          aria-valuenow={ratio}
        >
          <span style={{ width: `${ratio}%` }} />
        </div>
      </div>
    );
  }
  const learning = progress?.type === 'learning';
  const completed = learning ? progress.completedStages : progress?.completed || 0;
  const total = learning ? progress.totalStages : progress?.total || 0;
  const current = learning ? progress.currentStage : progress?.currentMilestone;
  return (
    <div className={`goals-progress goals-progress--steps ${compact ? 'is-compact' : ''}`}>
      <div className="goals-progress__labels">
        <strong>{completed} of {total} {learning ? 'stages' : 'milestones'}</strong>
        <span>{current?.title || (total ? 'Choose the current stage' : `Add ${learning ? 'a learning stage' : 'a milestone'}`)}</span>
      </div>
      <div
        className="goals-progress__track"
        role="progressbar"
        aria-label="Outcome progress"
        aria-valuemin="0"
        aria-valuemax={Math.max(1, total)}
        aria-valuenow={completed}
      >
        <span style={{ width: `${ratio}%` }} />
      </div>
    </div>
  );
}

function ContributionBadge({ card, detail = null }) {
  const tier = card?.contributionTier || detail?.contributionTier || getGoalTierProgress(0);
  return (
    <span className="goals-contribution-badge" aria-label={`Contribution Tier ${tier.current.tier}`}>
      <b>{card?.goal?.goalIcon || detail?.goal?.goalIcon || '◆'}</b>
      Contribution Tier {tier.current.tier} · {tier.total.toLocaleString()}
    </span>
  );
}

function GoalCard({ card, onOpen }) {
  return (
    <button
      type="button"
      className="goals-card"
      style={goalAccentStyle(card.goal)}
      onClick={() => onOpen(card.goalUUID)}
    >
      <div className="goals-card__top">
        <span className="goals-card__identity">
          <i aria-hidden="true">{card.goal?.goalIcon || '◆'}</i>
          <span className="goals-card__area">{card.area?.icon || '◇'} {card.area?.name || 'No Area'}</span>
        </span>
        <StatusBadge kind="health" value={card.healthStatus} />
      </div>
      <h3>{card.name}</h3>
      <p className="goals-card__finish"><span>Finished when</span>{card.finishCondition || 'Needs a clear finish condition.'}</p>
      <ProgressVisual progress={card.progress} compact />
      <div className="goals-card__next">
        <small>Next action</small>
        <strong>{card.nextAction?.labelSnapshot || 'Choose a next action'}</strong>
      </div>
      <div className="goals-card__footer">
        <span>{card.targetDate ? `Target ${formatDate(card.targetDate)}` : 'No target date'}</span>
        <span>Open Goal →</span>
      </div>
    </button>
  );
}

function FocusHero({ card, onOpen, onChangeFocus }) {
  if (!card) return null;
  const current = card.progress.type === 'learning'
    ? card.progress.currentStage
    : card.progress.currentMilestone;
  return (
    <section className="goals-focus" style={goalAccentStyle(card.goal)}>
      <div className="goals-focus__header">
        <div className="goals-focus__identity">
          <span className="goals-focus__icon" aria-hidden="true">{card.goal?.goalIcon || '◆'}</span>
          <div className="goals-focus__eyebrow">Current focus</div>
        </div>
        <StatusBadge kind="health" value={card.healthStatus} />
      </div>
      <h2>{card.name}</h2>
      <p className="goals-focus__finish">{card.finishCondition || 'This Goal still needs a finish condition.'}</p>
      <div className="goals-focus__move">
        <div>
          <span>Next action</span>
          <strong>{card.nextAction?.labelSnapshot || 'Choose the next move'}</strong>
        </div>
        <small>
          Current {card.progress.type === 'learning' ? 'stage' : card.progress.type === 'metric' ? 'measurement' : 'milestone'} · {' '}
          {current?.title || (card.progress.type === 'metric' ? `${card.progress.currentValue} ${card.progress.unit}` : 'Not selected')}
        </small>
      </div>
      <div className="goals-focus__actions">
        <button type="button" className="primary" onClick={() => onOpen(card.goalUUID)}>Work on this</button>
        <button type="button" onClick={onChangeFocus}>Change focus</button>
      </div>
    </section>
  );
}

function PurposeKey() {
  return (
    <section className="goals-purpose-key" aria-labelledby="goals-purpose-key-title">
      <div className="goals-section-heading">
        <div>
          <span id="goals-purpose-key-title">What belongs where</span>
          <p>Keep ongoing direction, finite outcomes, daily action, and reflection distinct.</p>
        </div>
      </div>
      <dl>
        <div><dt>Areas</dt><dd>Ongoing responsibilities or directions. They stay relevant; they are not completed.</dd></div>
        <div><dt>Goals</dt><dd>Finite outcomes with an observable finish condition.</dd></div>
        <div><dt>Tasks &amp; Habits</dt><dd>Concrete work: Tasks are finishable actions; Habits repeat on a rhythm.</dd></div>
        <div><dt>Stories</dt><dd>Writing collections that preserve a season or narrative; they do not measure progress.</dd></div>
      </dl>
    </section>
  );
}

function AreaCreator({ repository, currentPlayer, onCreated, onCancel }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    setError('');
    try {
      await repository.saveArea({ name, description }, currentPlayer);
      await onCreated();
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="goals-area-create">
      <label>
        <span>Area name</span>
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Community, Health, Research…" autoFocus />
      </label>
      <label>
        <span>What belongs here?</span>
        <input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="An ongoing responsibility or direction" />
      </label>
      {error && <p role="alert">{error}</p>}
      <button type="button" onClick={onCancel}>Cancel</button>
      <button type="button" className="primary" disabled={!name.trim() || saving} onClick={save}>{saving ? 'Saving…' : 'Add Area'}</button>
    </div>
  );
}

function GoalArenaBoard({
  model,
  databaseConnection,
  currentPlayer,
  onOpen,
  onCreate,
  onReview,
  onRefresh,
}) {
  const [areaFilter, setAreaFilter] = useState('all');
  const [creatingArea, setCreatingArea] = useState(false);
  const repository = databaseConnection.getRepository('goals');
  const { activePageId, selectPage } = useLocalSectionRoute({
    sectionId: 'goals',
    pages: GOAL_COLLECTION_PAGES,
    profileUUID: currentPlayer.UUID,
    databaseConnection,
    defaultPageId: 'overview',
  });
  const focusCard = model.activeGoals.find((card) => card.goalUUID === model.currentFocusGoalUUID) || null;
  const activeGoals = areaFilter === 'all'
    ? model.activeGoals
    : model.activeGoals.filter((card) => String(card.area?.UUID || 'none') === areaFilter);
  const changeFocus = async () => {
    await repository.setCurrentFocus(currentPlayer, null);
    await onRefresh();
  };
  return (
    <div className="evt-world-body goals-overview">
      <LocalSectionNav
        items={GOAL_COLLECTION_PAGES}
        value={activePageId}
        onChange={selectPage}
        label="Goals sections"
        className="goals-collection-nav"
      />
      {activePageId === 'overview' && <FocusHero card={focusCard} onOpen={onOpen} onChangeFocus={changeFocus} />}

      {activePageId === 'overview' && <section className="goals-summary" aria-label="Goals summary">
        <span className="goals-summary__item goals-summary__item--active"><i aria-hidden="true">◆</i><span><strong>{model.summary.activeCount}</strong> active</span></span>
        <span className="goals-summary__item goals-summary__item--attention"><i aria-hidden="true">!</i><span><strong>{model.attentionItems.length}</strong> need attention</span></span>
        <span className="goals-summary__item goals-summary__item--complete"><i aria-hidden="true">✓</i><span><strong>{model.summary.completedThisMonth}</strong> milestones this month</span></span>
      </section>}

      {activePageId === 'overview' && <PurposeKey />}

      {['overview', 'areas'].includes(activePageId) && <section className="goals-areas">
        <div className="goals-section-heading">
          <div><span>Areas</span><p>Ongoing directions do not need a completion percentage.</p></div>
          <button type="button" onClick={() => setCreatingArea((value) => !value)}>+ Area</button>
        </div>
        {creatingArea && (
          <AreaCreator
            repository={repository}
            currentPlayer={currentPlayer}
            onCancel={() => setCreatingArea(false)}
            onCreated={async () => {
              setCreatingArea(false);
              await onRefresh();
            }}
          />
        )}
        <div className="goals-area-strip" role="group" aria-label="Filter Goals by Area">
          <button type="button" className={areaFilter === 'all' ? 'active' : ''} onClick={() => setAreaFilter('all')}>
            All <b>{model.activeGoals.length}</b>
          </button>
          {model.areas.map((area) => {
            const count = model.activeGoals.filter((card) => card.area?.UUID === area.UUID).length;
            return (
              <button key={area.UUID} type="button" className={areaFilter === area.UUID ? 'active' : ''} onClick={() => setAreaFilter(area.UUID)}>
                {area.icon || '◇'} {area.name} <b>{count}</b>
              </button>
            );
          })}
          <button type="button" className={areaFilter === 'none' ? 'active' : ''} onClick={() => setAreaFilter('none')}>
            No Area <b>{model.activeGoals.filter((card) => !card.area).length}</b>
          </button>
        </div>
      </section>}

      {['overview', 'reviews'].includes(activePageId) && model.attentionItems.length > 0 && (
        <section className="goals-attention">
          <div className="goals-section-heading">
            <div><span>Needs attention</span><p>Factual signals that need your interpretation.</p></div>
            <button type="button" onClick={onReview}>Review goals</button>
          </div>
          <div className="goals-attention__list">
            {model.attentionItems.slice(0, 6).map((item, index) => (
              <button key={`${item.goalUUID}-${item.type}-${index}`} type="button" onClick={() => onOpen(item.goalUUID)}>
                <span className={`goals-attention__icon is-${item.type}`} aria-hidden="true">!</span>
                <span><strong>{item.goalName}</strong><small>{item.message}</small></span>
                <b>{item.actionLabel} →</b>
              </button>
            ))}
          </div>
        </section>
      )}
      {activePageId === 'reviews' && model.attentionItems.length === 0 && (
        <section className="goals-empty">
          <strong>Goal states are current.</strong>
          <button type="button" className="primary" onClick={onReview}>Start check-in</button>
        </section>
      )}

      {['overview', 'areas'].includes(activePageId) && <section className="goals-active">
        <div className="goals-section-heading">
          <div><span>Active Goals</span><p>Finite outcomes your everyday work is building toward.</p></div>
          <strong>{activeGoals.length}</strong>
        </div>
        {activeGoals.length ? (
          <div className="goals-card-grid">
            {activeGoals.map((card) => <GoalCard key={card.goalUUID} card={card} onOpen={onOpen} />)}
          </div>
        ) : (
          <div className="goals-empty">
            <strong>{model.activeGoals.length ? 'No active Goals in this Area.' : 'No active Goals yet.'}</strong>
            <p>Create a finite outcome with a clear definition of finished.</p>
            <button type="button" className="primary" onClick={onCreate}>New goal</button>
          </div>
        )}
      </section>}

      {activePageId === 'overview' && model.recentMilestones.length > 0 && (
        <section className="goals-recent">
          <div className="goals-section-heading">
            <div><span>Recent milestones</span><p>Small wins across the roadmap.</p></div>
          </div>
          <div className="goals-recent__list">
            {model.recentMilestones.map((milestone) => (
              <button key={milestone.UUID} type="button" onClick={() => onOpen(milestone.goalUUID)}>
                <span aria-hidden="true">✓</span>
                <strong>{milestone.title}</strong>
                <small>{formatDate(milestone.completedAt)}</small>
              </button>
            ))}
          </div>
        </section>
      )}

      {activePageId === 'overview' && (model.pausedGoals.length > 0 || model.completedGoals.length > 0) && (
        <details className="goals-history">
          <summary>Paused / completed <span>{model.pausedGoals.length + model.completedGoals.length}</span></summary>
          <div className="goals-card-grid">
            {[...model.pausedGoals, ...model.completedGoals].map((card) => (
              <GoalCard key={card.goalUUID} card={card} onOpen={onOpen} />
            ))}
          </div>
        </details>
      )}
      {activePageId === 'completed' && (
        <section className="goals-active">
          <div className="goals-section-heading">
            <div><span>Completed Goals</span></div>
            <strong>{model.completedGoals.length}</strong>
          </div>
          {model.completedGoals.length ? (
            <div className="goals-card-grid">
              {model.completedGoals.map((card) => (
                <GoalCard key={card.goalUUID} card={card} onOpen={onOpen} />
              ))}
            </div>
          ) : <div className="goals-empty"><strong>No completed Goals yet.</strong></div>}
        </section>
      )}
    </div>
  );
}

function Roadmap({ detail, repository, currentPlayer, onChanged }) {
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const goal = detail.goal;
  const label = goal.progressType === 'learning' ? 'Stages' : 'Roadmap';
  const updateMilestone = async (milestone, status) => {
    setSaving(true);
    try {
      const saved = await repository.saveMilestone(goal, { ...milestone, status }, currentPlayer);
      if (status === 'active' || status === 'completed') {
        const remaining = detail.milestones.find((entry) => (
          entry.UUID !== saved.UUID && !['completed', 'skipped'].includes(entry.status)
        ));
        await repository.saveGoal({
          ...goal,
          currentMilestoneUUID: status === 'active' ? saved.UUID : (remaining?.UUID || null),
        }, currentPlayer);
        if (status === 'completed' && remaining && remaining.status === 'not_started') {
          await repository.saveMilestone(goal, { ...remaining, status: 'active' }, currentPlayer);
        }
      }
      await onChanged();
    } finally {
      setSaving(false);
    }
  };
  const add = async () => {
    if (!title.trim() || saving) return;
    setSaving(true);
    try {
      const status = detail.milestones.length ? 'not_started' : 'active';
      const saved = await repository.saveMilestone(goal, {
        title,
        status,
        position: detail.milestones.length,
      }, currentPlayer);
      if (!goal.currentMilestoneUUID) {
        await repository.saveGoal({ ...goal, currentMilestoneUUID: saved.UUID }, currentPlayer);
      }
      setTitle('');
      await onChanged();
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="goals-panel goals-roadmap">
      <div className="goals-panel__heading">
        <div><span>{label}</span><p>{goal.progressType === 'learning' ? 'Demonstrated capability stages.' : 'Meaningful stages toward finished.'}</p></div>
        <strong>{detail.milestones.filter((entry) => entry.status === 'completed').length}/{detail.milestones.filter((entry) => entry.status !== 'skipped').length}</strong>
      </div>
      <div className="goals-roadmap__path" aria-live="polite">
        {detail.milestones.length === 0 && <p className="goals-panel__empty">No {label.toLowerCase()} yet. Add the first meaningful stage.</p>}
        {detail.milestones.map((milestone, index) => (
          <article key={milestone.UUID} className={`goals-milestone is-${milestone.status}`}>
            <span className="goals-milestone__node" aria-hidden="true">
              {milestone.status === 'completed' ? '✓' : milestone.status === 'skipped' ? '–' : milestone.status === 'blocked' ? '!' : '●'}
            </span>
            <div>
              <strong>{milestone.title}</strong>
              <small>{milestone.status.replaceAll('_', ' ')}{milestone.targetDate ? ` · ${formatDate(milestone.targetDate)}` : ''}</small>
            </div>
            <div className="goals-milestone__actions">
              <button type="button" disabled={index === 0 || saving} onClick={() => repository.reorderMilestone(goal.UUID, milestone.UUID, 'up').then(onChanged)} aria-label={`Move ${milestone.title} up`}>↑</button>
              <button type="button" disabled={index === detail.milestones.length - 1 || saving} onClick={() => repository.reorderMilestone(goal.UUID, milestone.UUID, 'down').then(onChanged)} aria-label={`Move ${milestone.title} down`}>↓</button>
              {!['completed', 'skipped'].includes(milestone.status) && <button type="button" disabled={saving} onClick={() => updateMilestone(milestone, 'completed')}>Complete</button>}
              {milestone.status !== 'blocked' && !['completed', 'skipped'].includes(milestone.status) && <button type="button" disabled={saving} onClick={() => updateMilestone(milestone, 'blocked')}>Block</button>}
              {milestone.status !== 'skipped' && milestone.status !== 'completed' && <button type="button" disabled={saving} onClick={() => updateMilestone(milestone, 'skipped')}>Skip</button>}
              {['completed', 'blocked', 'skipped'].includes(milestone.status) && <button type="button" disabled={saving} onClick={() => updateMilestone(milestone, 'active')}>Reactivate</button>}
            </div>
          </article>
        ))}
      </div>
      <div className="goals-roadmap__add">
        <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={`Add ${goal.progressType === 'learning' ? 'learning stage' : 'milestone'}`} onKeyDown={(event) => event.key === 'Enter' && add()} />
        <button type="button" className="primary" disabled={!title.trim() || saving} onClick={add}>Add</button>
      </div>
    </section>
  );
}

function CurrentMove({ goal }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <section className="goals-panel goals-current-move">
      <div className="goals-panel__heading">
        <div><span>Current move</span><p>One selected action, owned by its native workspace.</p></div>
      </div>
      {goal.nextAction ? (
        <div className="goals-current-move__action">
          <span>{actionEntityLabel(goal.nextAction.entityType)}</span>
          <strong>{goal.nextAction.labelSnapshot}</strong>
          <small>If the source is finished or deleted, this snapshot remains until you choose the next move.</small>
        </div>
      ) : <p className="goals-panel__empty">No next action is selected. Edit this Goal to choose one.</p>}
      {(goal.implementationCue || goal.obstacle || goal.obstacleResponse) && (
        <>
          <button type="button" className="goals-text-button" onClick={() => setExpanded((value) => !value)}>
            {expanded ? 'Hide' : 'Plan around'} friction
          </button>
          {expanded && (
            <div className="goals-friction">
              <span><small>When / where</small>{goal.implementationCue || 'Not set'}</span>
              <span><small>Possible obstacle</small>{goal.obstacle || 'Not set'}</span>
              <span><small>Response</small>{goal.obstacleResponse || 'Not set'}</span>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function SupportingWork({ detail, repository, currentPlayer, onChanged }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [typeFilter, setTypeFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [busyKey, setBusyKey] = useState('');
  const options = [
    ...detail.availableWork.todos.map((item) => ({ type: 'todo', item, label: item.name })),
    ...detail.availableWork.habits.map((item) => ({ type: 'habit', item, label: item.name })),
    ...detail.availableWork.reminders.map((item) => ({ type: 'reminder', item, label: item.title })),
    ...detail.availableWork.journals.map((item) => ({ type: 'journal', item, label: item.title || 'Journal entry' })),
  ];
  const counts = detail.linkedWork.reduce((result, item) => {
    result[item.entityType] = (result[item.entityType] || 0) + 1;
    return result;
  }, {});
  const linkedKeys = new Set(detail.linkedWork.map((item) => `${item.entityType}::${item.UUID}`));
  const visibleOptions = options.filter((option) => (
    (typeFilter === 'all' || option.type === typeFilter)
    && (!query.trim() || option.label.toLowerCase().includes(query.trim().toLowerCase()))
  ));
  const link = async (option) => {
    if (!option) return;
    const key = `${option.type}::${option.item.UUID}`;
    setBusyKey(key);
    await repository.saveLink(detail.goal, currentPlayer, {
      entityType: option.type,
      entityUUID: option.item.UUID,
      relation: option.type === 'journal' ? 'evidence' : 'supports',
      labelSnapshot: option.label,
    });
    await onChanged();
    setBusyKey('');
  };
  const unlink = async (item) => {
    const linkRecord = detail.links.find((entry) => (
      entry.entityType === item.entityType && String(entry.entityUUID) === String(item.UUID)
    ));
    if (!linkRecord) return;
    setBusyKey(`${item.entityType}::${item.UUID}`);
    await repository.removeLink(linkRecord.UUID);
    await onChanged();
    setBusyKey('');
  };
  return (
    <section className="goals-panel goals-supporting">
      <div className="goals-panel__heading">
        <div><span>Supporting work</span><p>Work remains editable in Tasks, Habits, Reminders, and Journals.</p></div>
      </div>
      <div className="goals-supporting__summary">
        <span><b>{(counts.todo || 0) + (counts.task || 0)}</b> tasks</span>
        <span><b>{counts.habit || 0}</b> habits</span>
        <span><b>{counts.reminder || 0}</b> reminders</span>
        <span><b>{counts.journal || 0}</b> journals</span>
      </div>
      {detail.linkedWork.length > 0 && (
        <div className="goals-supporting__list">
          {detail.linkedWork.slice(0, 12).map((item) => (
            <span key={`${item.entityType}-${item.UUID}`}>
              <small>{actionEntityLabel(item.entityType)}</small>
              <strong>{item.name || item.title || 'Linked item'}</strong>
              {item.completedAt && <b>Complete</b>}
              {!item.completedAt && detail.links.some((entry) => entry.entityType === item.entityType && String(entry.entityUUID) === String(item.UUID)) && (
                <button type="button" disabled={busyKey === `${item.entityType}::${item.UUID}`} onClick={() => unlink(item)} aria-label={`Remove ${item.name || item.title || 'item'} from Goal`}>×</button>
              )}
            </span>
          ))}
        </div>
      )}
      <button type="button" className="goals-supporting__picker-toggle" onClick={() => setPickerOpen((open) => !open)}>
        {pickerOpen ? 'Close work picker' : '+ Add supporting work'}
      </button>
      {pickerOpen && (
        <div className="goals-supporting__picker">
          <div className="goals-supporting__picker-tools">
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search work…" aria-label="Search supporting work" />
            <div role="tablist" aria-label="Work type">
              {['all', 'todo', 'habit', 'reminder', 'journal'].map((type) => (
                <button type="button" role="tab" aria-selected={typeFilter === type} className={typeFilter === type ? 'active' : ''} key={type} onClick={() => setTypeFilter(type)}>{type === 'all' ? 'All' : actionEntityLabel(type)}</button>
              ))}
            </div>
          </div>
          <div className="goals-supporting__picker-grid">
            {visibleOptions.map((option) => {
              const key = `${option.type}::${option.item.UUID}`;
              const linked = linkedKeys.has(key);
              return (
                <button type="button" key={key} className={linked ? 'is-linked' : ''} disabled={linked || busyKey === key} onClick={() => link(option)}>
                  <span>{actionEntityLabel(option.type)}</span>
                  <strong>{option.label}</strong>
                  <small>{linked ? 'Linked' : 'Add to Goal'}</small>
                </button>
              );
            })}
            {!visibleOptions.length && <p>No work matches this filter.</p>}
          </div>
        </div>
      )}
    </section>
  );
}

function GoalTimeline({ rows }) {
  return (
    <section className="goals-panel goals-timeline">
      <div className="goals-panel__heading">
        <div><span>Timeline</span><p>Outcome changes, context, and real Contribution remain distinct.</p></div>
      </div>
      {rows.length === 0 ? <p className="goals-panel__empty">No Goal history yet.</p> : (
        <div className="goals-timeline__list">
          {rows.slice(0, 30).map((row) => (
            <article key={row.UUID}>
              <span className={`goals-timeline__icon is-${row.type}`} aria-hidden="true">
                {row.type === 'milestone' ? '✓' : row.type === 'contribution' ? '+' : row.type === 'journal' ? '≡' : '●'}
              </span>
              <div>
                <strong>{row.label}</strong>
                <small>{row.sourceLabel} · {row.actor} · {formatDate(row.occurredAt, 'Unknown date')}</small>
              </div>
              {row.contributionValue != null && <b>+{row.contributionValue} Contribution</b>}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function UpdateComposer({ detail, repository, currentPlayer, onChanged }) {
  const [summary, setSummary] = useState('');
  const [health, setHealth] = useState(detail.goal.healthStatus);
  const [blocker, setBlocker] = useState(detail.goal.blockedReason || '');
  const [metric, setMetric] = useState(detail.goal.metric?.currentValue ?? '');
  const [saving, setSaving] = useState(false);
  const post = async () => {
    if (!summary.trim() || saving) return;
    setSaving(true);
    try {
      await repository.postUpdate(detail.goal, currentPlayer, {
        summary,
        healthStatus: health,
        blockedReason: blocker,
        metricCurrentValue: detail.goal.progressType === 'metric' ? metric : undefined,
      });
      setSummary('');
      await onChanged();
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="goals-panel goals-update">
      <div className="goals-panel__heading">
        <div><span>Post update</span><p>Record what changed. Updates do not award Contribution or Coins.</p></div>
      </div>
      <textarea value={summary} onChange={(event) => setSummary(event.target.value)} rows={3} maxLength={500} placeholder="What changed?" />
      <div className="goals-update__fields">
        <label><span>Health</span><select value={health} onChange={(event) => setHealth(event.target.value)}>
          <option value="unset">Unset</option><option value="on_track">On track</option><option value="at_risk">At risk</option><option value="blocked">Blocked</option>
        </select></label>
        {health === 'blocked' && <label><span>Blocker</span><input value={blocker} onChange={(event) => setBlocker(event.target.value)} placeholder="What is blocking progress?" /></label>}
        {detail.goal.progressType === 'metric' && <label><span>Current {detail.goal.metric?.unit}</span><input type="number" value={metric} onChange={(event) => setMetric(event.target.value)} /></label>}
      </div>
      <button type="button" className="primary" disabled={!summary.trim() || saving} onClick={post}>{saving ? 'Posting…' : 'Post update'}</button>
    </section>
  );
}

function ContributionIdentity({ detail }) {
  const total = detail.contributionTier.total;
  const leaderboard = useMemo(() => {
    const totals = new Map();
    for (const entry of detail.contributions) {
      const id = String(entry.parent || '');
      if (!id) continue;
      totals.set(id, (totals.get(id) || 0) + (Number(entry.value) || 0));
    }
    return [...totals.entries()]
      .map(([playerUUID, value]) => ({
        playerUUID,
        value,
        player: detail.players.find((player) => String(player.UUID) === playerUUID),
      }))
      .sort((left, right) => right.value - left.value);
  }, [detail.contributions, detail.players]);
  return (
    <section className="goals-panel goals-identity">
      <div className="goals-panel__heading">
        <div><span>Contribution identity</span><p>Participation history, separate from outcome progress.</p></div>
      </div>
      <ContributionBadge detail={detail} />
      <div className="goals-identity__numbers">
        <span><strong>{total}</strong><small>accumulated</small></span>
        <span><strong>{detail.contributions.filter((entry) => Date.now() - new Date(entry.createdAt).getTime() <= 7 * 86400000).reduce((sum, entry) => sum + (Number(entry.value) || 0), 0)}</strong><small>this week</small></span>
      </div>
      {detail.goal.participationMode === 'competitive' && (
        <div className="goals-competition">
          <span>Contribution ranking</span>
          {leaderboard.map((entry, index) => (
            <div key={entry.playerUUID}>
              <b>#{index + 1}</b>
              <ProfilePicture src={entry.player?.profilePicture} username={entry.player?.username || '?'} size={28} />
              <strong>{entry.player?.username || 'Deleted user'}</strong>
              <span>{entry.value}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function PeoplePanel({ detail }) {
  if (detail.goal.participationMode === 'private') return null;
  return (
    <section className="goals-panel goals-people">
      <div className="goals-panel__heading">
        <div><span>People</span><p>{detail.goal.participationMode === 'competitive' ? 'Competition is ranked by Contribution only.' : 'Shared activity without rank.'}</p></div>
      </div>
      <div className="goals-people__list">
        {detail.participants.map((participant) => {
          const player = detail.players.find((entry) => entry.UUID === participant.playerUUID);
          return (
            <span key={participant.UUID}>
              <ProfilePicture src={player?.profilePicture} username={player?.username || '?'} size={32} />
              <strong>{player?.username || 'Unknown player'}</strong>
              <small>{participant.role}</small>
            </span>
          );
        })}
      </div>
    </section>
  );
}

function GoalDetail({
  goal,
  currentPlayer,
  databaseConnection,
  onBack,
  onEdit,
  onChanged,
}) {
  const { routeIntent, consumeRouteIntent } = useAppContext();
  const repository = databaseConnection.getRepository('goals');
  const [detail, setDetail] = useState(null);
  const { activePageId: tab, selectPage: setTab } = useLocalSectionRoute({
    sectionId: 'goal',
    pages: GOAL_DETAIL_PAGES,
    profileUUID: currentPlayer.UUID,
    databaseConnection,
    routeIntent: routeIntent?.entityUUID === goal.UUID ? routeIntent : null,
    defaultPageId: 'overview',
    onIntentConsumed: consumeRouteIntent,
  });
  const [confirmCompletion, setConfirmCompletion] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const next = await repository.getGoalDetail(goal.UUID);
    setDetail(next);
    return next;
  }, [goal.UUID, repository]);
  useEffect(() => { load().catch((error) => console.warn('[Goals] detail load failed:', error)); }, [load]);
  const changed = async () => {
    await load();
    await onChanged?.();
  };
  const transition = async (to, finishConfirmed = false) => {
    if (!detail || busy) return;
    setBusy(true);
    try {
      await repository.transitionGoal(detail.goal, to, currentPlayer, { finishConfirmed });
      setConfirmCompletion(false);
      await changed();
    } finally {
      setBusy(false);
    }
  };
  if (!detail) return <div className="evt-loading">Loading Goal…</div>;
  const active = detail.goal.lifecycleStatus === 'active';
  const archived = detail.goal.lifecycleStatus === 'archived';
  return (
    <div className="evt-page goals-detail" style={goalAccentStyle(detail.goal)}>
      <header className="evt-header goals-detail__header">
        <div className="evt-header-left">
          <button className="evt-back-btn" onClick={onBack}>← GOALS</button>
          <span className="evt-header-title">GOAL DETAILS</span>
        </div>
        <div className="goals-detail__actions">
          {active && <button type="button" onClick={() => repository.setCurrentFocus(currentPlayer, detail.goal.UUID).then(changed)}>Set focus</button>}
          {!archived && <button type="button" onClick={onEdit}>Edit</button>}
          {active && <button type="button" onClick={() => transition('paused')}>Pause</button>}
          {detail.goal.lifecycleStatus === 'paused' && <button type="button" onClick={() => transition('active')}>Resume</button>}
          {!['completed', 'archived'].includes(detail.goal.lifecycleStatus) && <button type="button" className="primary" onClick={() => setConfirmCompletion(true)}>Complete</button>}
          {detail.goal.lifecycleStatus === 'completed' && <button type="button" onClick={() => transition('active')}>Reopen</button>}
          {!archived && <button type="button" onClick={() => transition('archived')}>Archive</button>}
          {archived && <button type="button" onClick={() => transition('active')}>Restore</button>}
          {archived && <button type="button" className="danger" onClick={() => setConfirmDelete(true)}>Delete</button>}
        </div>
      </header>

      <LocalSectionNav
        items={GOAL_DETAIL_PAGES}
        value={tab}
        onChange={setTab}
        label="Goal sections"
        className="goals-detail__nav"
      />

      <div
        className="goals-detail__scroll"
        id={`local-page-${tab}`}
        role="tabpanel"
        aria-labelledby={`local-tab-${tab}`}
        tabIndex="0"
      >
        {confirmCompletion && (
          <div className="goals-confirm" role="dialog" aria-label="Confirm Goal completion">
            <div><span>Confirm the finish condition</span><strong>{detail.goal.finishCondition || 'No finish condition has been defined.'}</strong><p>Completion preserves all Contribution and history.</p></div>
            <button type="button" onClick={() => setConfirmCompletion(false)}>Cancel</button>
            <button type="button" className="primary" disabled={busy} onClick={() => transition('completed', true)}>This is true — complete Goal</button>
          </div>
        )}
        {confirmDelete && (
          <div className="goals-confirm" role="dialog" aria-label="Confirm Goal deletion">
            <div><span>Delete archived Goal?</span><strong>{detail.goal.name}</strong><p>Linked work stays intact. Contribution snapshots remain in history.</p></div>
            <button type="button" onClick={() => setConfirmDelete(false)}>Cancel</button>
            <button type="button" className="danger" onClick={async () => {
              await repository.deleteArchivedGoal(detail.goal);
              await onChanged?.();
              onBack();
            }}>Delete Goal</button>
          </div>
        )}

        {tab === 'overview' && (
          <>
            <section className="goals-detail__hero">
              <div>
                <span className="goals-detail__area">{detail.area?.icon || '◇'} {detail.area?.name || 'No Area'}</span>
                <h1>{detail.goal.name}</h1>
                <p className="goals-detail__finish"><span>Finished when</span>{detail.goal.finishCondition || 'This Goal needs a clear finish condition.'}</p>
              </div>
              <div className="goals-detail__meta">
                <StatusBadge kind="lifecycle" value={detail.goal.lifecycleStatus} />
                <StatusBadge kind="health" value={detail.goal.healthStatus} />
                <span>Target <strong>{formatDate(detail.goal.targetDate)}</strong></span>
                <span>Mode <strong>{detail.goal.participationMode}</strong></span>
              </div>
            </section>
            <div className="goals-detail__layout">
              <main>
                <section className="goals-panel goals-outcome">
                  <div className="goals-panel__heading"><div><span>Outcome</span><p>Actual progress toward the desired result.</p></div></div>
                  <ProgressVisual progress={detail.progress} />
                </section>
                <CurrentMove goal={detail.goal} />
              </main>
              <aside>
                <ContributionIdentity detail={detail} />
              </aside>
            </div>
          </>
        )}
        {tab === 'roadmap' && (
          <div className="goals-detail__activity">
            <Roadmap detail={detail} repository={repository} currentPlayer={currentPlayer} onChanged={changed} />
            <SupportingWork detail={detail} repository={repository} currentPlayer={currentPlayer} onChanged={changed} />
          </div>
        )}
        {tab === 'activity' && (
          <div className="goals-detail__activity">
            {active && <UpdateComposer detail={detail} repository={repository} currentPlayer={currentPlayer} onChanged={changed} />}
            <GoalTimeline rows={detail.timeline} />
          </div>
        )}
        {tab === 'people' && (
          <div className="goals-detail__activity">
            <ContributionIdentity detail={detail} />
            <PeoplePanel detail={detail} />
          </div>
        )}
        {tab === 'review-settings' && (
          <div className="goals-detail__activity">
            <section className="goals-panel goals-settings-summary">
              <div className="goals-panel__heading">
                <div><span>Review & Settings</span></div>
                {!archived && <button type="button" onClick={onEdit}>Edit</button>}
              </div>
              <span><small>Progress</small>{detail.goal.progressType}</span>
              <span><small>Check-in frequency</small>Every {detail.goal.reviewIntervalDays} days</span>
              <span><small>Visibility</small>{detail.goal.visibility}</span>
              <span><small>Task category</small>{detail.goal.taskCategoryEnabled ? 'Shown' : 'Hidden'}</span>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

function GoalForm({
  goal,
  databaseConnection,
  currentPlayer,
  onCancel,
  onSave,
}) {
  const repository = databaseConnection.getRepository('goals');
  const [areas, setAreas] = useState([]);
  const [availableActions, setAvailableActions] = useState([]);
  const [name, setName] = useState(goal?.name || '');
  const [finishCondition, setFinishCondition] = useState(goal?.finishCondition || goal?.description || '');
  const [description, setDescription] = useState(goal?.description || '');
  const [areaUUID, setAreaUUID] = useState(goal?.areaUUID || '');
  const [progressType, setProgressType] = useState(goal?.progressType || 'milestones');
  const [targetDate, setTargetDate] = useState(goal?.targetDate || '');
  const [healthStatus, setHealthStatus] = useState(goal?.healthStatus || 'unset');
  const [blockedReason, setBlockedReason] = useState(goal?.blockedReason || '');
  const [nextActionKey, setNextActionKey] = useState(goal?.nextAction ? `${goal.nextAction.entityType}::${goal.nextAction.entityUUID}` : '');
  const [actionQuery, setActionQuery] = useState('');
  const [actionType, setActionType] = useState('all');
  const [implementationCue, setImplementationCue] = useState(goal?.implementationCue || '');
  const [obstacle, setObstacle] = useState(goal?.obstacle || '');
  const [obstacleResponse, setObstacleResponse] = useState(goal?.obstacleResponse || '');
  const [participationMode, setParticipationMode] = useState(goal?.participationMode || 'private');
  const [visibility, setVisibility] = useState(goal?.visibility || 'private');
  const [taskCategoryEnabled, setTaskCategoryEnabled] = useState(goal?.taskCategoryEnabled !== false);
  const [metricUnit, setMetricUnit] = useState(goal?.metric?.unit || '');
  const [metricStart, setMetricStart] = useState(goal?.metric?.startValue ?? 0);
  const [metricCurrent, setMetricCurrent] = useState(goal?.metric?.currentValue ?? 0);
  const [metricTarget, setMetricTarget] = useState(goal?.metric?.targetValue ?? 100);
  const [goalIcon, setGoalIcon] = useState(goal?.goalIcon || '◆');
  const [accentColor, setAccentColor] = useState(goal?.accentColor || '#4da3ff');
  const [bannerColor, setBannerColor] = useState(goal?.bannerColor || '');
  const [contributorTitle, setContributorTitle] = useState(goal?.contributorTitle || '');
  const [showTiming, setShowTiming] = useState(Boolean(goal));
  const [showSharing, setShowSharing] = useState(Boolean(goal));
  const [showExecution, setShowExecution] = useState(Boolean(goal?.nextAction || goal?.implementationCue));
  const [showIdentity, setShowIdentity] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const tierProgress = getGoalTierProgress(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      repository.getOverview(currentPlayer.UUID, undefined),
      goal?.UUID ? repository.getGoalDetail(goal.UUID) : null,
    ]).then(([overview, detail]) => {
      if (cancelled) return;
      setAreas(overview.areas);
      const source = detail?.availableWork || { todos: [], habits: [], reminders: [] };
      setAvailableActions([
        ...source.todos.map((item) => ({ type: 'todo', id: item.UUID, label: item.name })),
        ...source.habits.map((item) => ({ type: 'habit', id: item.UUID, label: item.name })),
        ...source.reminders.map((item) => ({ type: 'reminder', id: item.UUID, label: item.title })),
      ]);
    }).catch((nextError) => setError(nextError.message));
    return () => { cancelled = true; };
  }, [currentPlayer.UUID, goal?.UUID, repository]);

  const valid = name.trim().length > 0 && finishCondition.trim().length > 0;
  const vague = valid && isGoalDefinitionVague({ name, finishCondition });
  const save = async () => {
    if (!valid || saving) return;
    setSaving(true);
    setError('');
    try {
      const selectedAction = availableActions.find((entry) => `${entry.type}::${entry.id}` === nextActionKey);
      const saved = await repository.saveGoal({
        ...(goal || {}),
        name,
        finishCondition,
        description,
        areaUUID: areaUUID || null,
        progressType,
        targetDate: targetDate || null,
        healthStatus,
        blockedReason: healthStatus === 'blocked' ? blockedReason : null,
        nextAction: selectedAction ? {
          entityType: selectedAction.type,
          entityUUID: selectedAction.id,
          labelSnapshot: selectedAction.label,
          pinnedAt: new Date().toISOString(),
        } : (nextActionKey ? goal?.nextAction : null),
        implementationCue,
        obstacle,
        obstacleResponse,
        participationMode,
        visibility: participationMode === 'private' ? 'private' : visibility,
        taskCategoryEnabled,
        metric: progressType === 'metric' ? {
          unit: metricUnit,
          startValue: Number(metricStart),
          currentValue: Number(metricCurrent),
          targetValue: Number(metricTarget),
          direction: Number(metricTarget) < Number(metricStart) ? 'decrease' : 'increase',
          updatedAt: new Date().toISOString(),
          source: 'manual',
        } : null,
        goalIcon,
        accentColor,
        bannerColor: bannerColor || null,
        contributorTitle: contributorTitle.trim().toUpperCase().slice(0, 3) || null,
        needsGoalDefinition: false,
      }, currentPlayer);
      if (saved.nextAction) {
        await repository.saveLink(saved, currentPlayer, {
          entityType: saved.nextAction.entityType,
          entityUUID: saved.nextAction.entityUUID,
          relation: 'next_action',
          labelSnapshot: saved.nextAction.labelSnapshot,
        });
      }
      onSave(saved.UUID);
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="evt-page goals-form-page">
      <header className="evt-header">
        <div className="evt-header-left">
          <button className="evt-back-btn" onClick={onCancel}>← GOALS</button>
          <span className="evt-header-title">{goal ? 'EDIT GOAL' : 'NEW GOAL'}</span>
        </div>
      </header>
      <div className="goals-form-scroll">
      <div className="goals-form">
        <div className="goals-form__intro">
          <span>{goal ? 'Refine the outcome' : 'Start with meaning'}</span>
          <h1>{goal ? 'Edit Goal' : 'What are you trying to accomplish?'}</h1>
          <p>A Goal is finite. Ongoing responsibilities belong in Areas and Habits.</p>
        </div>
        <section>
          <div className="goals-form__section-title"><span>Meaning</span><small>Required</small></div>
          <label><span>Goal title</span><input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} placeholder="Run Raven Hacks V2" autoFocus /></label>
          <label><span>Finished when</span><textarea value={finishCondition} maxLength={500} rows={3} onChange={(event) => setFinishCondition(event.target.value)} placeholder="The event is held and every prize is distributed." /></label>
          {vague && (
            <div className="goals-form__guidance">
              <strong>This may work better as an Area or a learning Goal.</strong>
              <span>The wording is allowed; consider describing an observable finish condition.</span>
              <button type="button" onClick={() => setProgressType('learning')}>Use learning stages</button>
            </div>
          )}
          <label><span>Area · optional</span><select value={areaUUID} onChange={(event) => setAreaUUID(event.target.value)}>
            <option value="">No Area</option>
            {areas.map((area) => <option key={area.UUID} value={area.UUID}>{area.name}</option>)}
          </select></label>
          <fieldset className="goals-progress-options">
            <legend>How will you see progress?</legend>
            {[
              ['milestones', 'Milestone roadmap', 'Complete defined checkpoints.'],
              ['metric', 'Measured target', 'Move a number from its start to a target.'],
              ['learning', 'Learning stages', 'Demonstrate increasing levels of capability.'],
            ].map(([value, label, explanation]) => (
              <button
                type="button"
                role="radio"
                aria-checked={progressType === value}
                className={progressType === value ? 'active' : ''}
                key={value}
                onClick={() => setProgressType(value)}
              >
                <strong>{label}</strong>
                <small>{explanation}</small>
              </button>
            ))}
          </fieldset>
          <label><span>Description · optional context</span><textarea value={description} maxLength={500} rows={2} onChange={(event) => setDescription(event.target.value)} placeholder="Why this matters or useful context." /></label>
        </section>

        {progressType === 'metric' && (
          <section>
            <div className="goals-form__section-title"><span>Measurement</span><small>Actual values remain visible</small></div>
            <div className="goals-form__metric">
              <label><span>Unit</span><input value={metricUnit} onChange={(event) => setMetricUnit(event.target.value)} placeholder="rating, lbs, pages" /></label>
              <label><span>Start</span><input type="number" value={metricStart} onChange={(event) => setMetricStart(event.target.value)} /></label>
              <label><span>Current</span><input type="number" value={metricCurrent} onChange={(event) => setMetricCurrent(event.target.value)} /></label>
              <label><span>Target</span><input type="number" value={metricTarget} onChange={(event) => setMetricTarget(event.target.value)} /></label>
            </div>
          </section>
        )}

        <button type="button" className="goals-form__disclosure" onClick={() => setShowTiming((value) => !value)}>
          {showTiming ? '−' : '+'} Timing &amp; health
        </button>
        {showTiming && (
          <section>
            <div className="goals-form__row">
              <label><span>Target date</span><input type="date" value={targetDate} onChange={(event) => setTargetDate(event.target.value)} /></label>
              <label><span>Health</span><select value={healthStatus} onChange={(event) => setHealthStatus(event.target.value)}>
                <option value="unset">Unset</option><option value="on_track">On track</option><option value="at_risk">At risk</option><option value="blocked">Blocked</option>
              </select></label>
            </div>
            {healthStatus === 'blocked' && <label><span>Blocker</span><input value={blockedReason} onChange={(event) => setBlockedReason(event.target.value)} placeholder="Waiting on sponsor response" /></label>}
          </section>
        )}

        <button type="button" className="goals-form__disclosure" onClick={() => setShowSharing((value) => !value)}>
          {showSharing ? '−' : '+'} Sharing
        </button>
        {showSharing && (
          <section>
            <div className="goals-form__row">
              <label><span>Mode</span><select value={participationMode} onChange={(event) => {
                setParticipationMode(event.target.value);
                if (event.target.value === 'private') setVisibility('private');
              }}>
                <option value="private">Private</option><option value="collaborative">Collaborative</option><option value="competitive">Competitive</option>
              </select></label>
              <label><span>Visibility</span><select value={participationMode === 'private' ? 'private' : visibility} disabled={participationMode === 'private'} onChange={(event) => setVisibility(event.target.value)}>
                <option value="private">Private</option><option value="participants">Participants</option><option value="friends">Friends</option>
              </select></label>
            </div>
            <label className="goals-form__check"><input type="checkbox" checked={taskCategoryEnabled} onChange={(event) => setTaskCategoryEnabled(event.target.checked)} /><span><strong>Show as task category</strong><small>Tasks can link to this Goal through their existing Goal field.</small></span></label>
          </section>
        )}

        <button type="button" className="goals-form__disclosure" onClick={() => setShowExecution((value) => !value)}>
          {showExecution ? '−' : '+'} Next move &amp; fallback
        </button>
        {showExecution && (
          <section>
            <div className="goals-action-picker">
              <div className="goals-action-picker__heading"><span>Current next action</span><button type="button" className={!nextActionKey ? 'active' : ''} onClick={() => setNextActionKey('')}>Choose later</button></div>
              <div className="goals-action-picker__tools">
                <input value={actionQuery} onChange={(event) => setActionQuery(event.target.value)} placeholder="Search tasks, Habits, and reminders…" />
                <div>{['all', 'todo', 'habit', 'reminder'].map((type) => <button type="button" key={type} className={actionType === type ? 'active' : ''} onClick={() => setActionType(type)}>{type === 'all' ? 'All' : actionEntityLabel(type)}</button>)}</div>
              </div>
              <div className="goals-action-picker__grid">
                {availableActions.filter((action) => (
                  (actionType === 'all' || action.type === actionType)
                  && (!actionQuery.trim() || action.label.toLowerCase().includes(actionQuery.trim().toLowerCase()))
                )).map((action) => {
                  const key = `${action.type}::${action.id}`;
                  return <button type="button" key={key} className={nextActionKey === key ? 'active' : ''} onClick={() => setNextActionKey(key)}><small>{actionEntityLabel(action.type)}</small><strong>{action.label}</strong><span>{nextActionKey === key ? 'Selected' : 'Select'}</span></button>;
                })}
              </div>
            </div>
            <label><span>When or where will you act?</span><input value={implementationCue} onChange={(event) => setImplementationCue(event.target.value)} placeholder="When I finish school on Tuesday…" /></label>
            <label><span>Possible obstacle</span><input value={obstacle} onChange={(event) => setObstacle(event.target.value)} placeholder="I may keep revising instead of sending." /></label>
            <label><span>If–then response</span><input value={obstacleResponse} onChange={(event) => setObstacleResponse(event.target.value)} placeholder="If that happens, I will note it and send the current version." /></label>
          </section>
        )}

        <button type="button" className="goals-form__disclosure" onClick={() => setShowIdentity((value) => !value)}>
          {showIdentity ? '−' : '+'} Appearance · Contribution Tier {tierProgress.current.tier}
        </button>
        {showIdentity && (
          <section>
            <p className="goals-form__hint">Appearance is optional and advanced. It does not change outcome progress.</p>
            <div className="goals-icon-picker">
              {GOAL_ICONS.map((icon) => <button type="button" key={icon} className={goalIcon === icon ? 'active' : ''} onClick={() => setGoalIcon(icon)}>{icon}</button>)}
            </div>
            <div className="goals-color-picker">
              {COLOR_PRESETS.map((color) => <button type="button" key={color} className={accentColor === color ? 'active' : ''} style={{ '--preset': color }} onClick={() => setAccentColor(color)} aria-label={`Use ${color}`} />)}
              <input type="color" value={accentColor} onChange={(event) => setAccentColor(event.target.value)} />
            </div>
            <div className="goals-form__row">
              <label><span>Banner color</span><input value={bannerColor} onChange={(event) => setBannerColor(event.target.value)} placeholder="Theme default" /></label>
              <label><span>Contributor title · Tier 5</span><input value={contributorTitle} maxLength={3} disabled={tierProgress.current.tier < 5} onChange={(event) => setContributorTitle(event.target.value)} placeholder="MAX" /></label>
            </div>
          </section>
        )}
        {error && <p className="goals-form__error" role="alert">{error}</p>}
        <div className="goals-form__footer">
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="button" className="primary" disabled={!valid || saving} onClick={save}>
            {saving ? 'Saving…' : goal ? 'Save Goal' : 'Create and define roadmap'}
          </button>
        </div>
      </div>
      </div>
    </div>
  );
}

function GoalReview({
  model,
  databaseConnection,
  currentPlayer,
  onOpen,
  onDone,
  onChanged,
}) {
  const repository = databaseConnection.getRepository('goals');
  const queue = model.activeGoals;
  const [index, setIndex] = useState(0);
  const [summary, setSummary] = useState('');
  const [health, setHealth] = useState(queue[0]?.healthStatus || 'unset');
  const [busy, setBusy] = useState(false);
  const card = queue[index];
  useEffect(() => {
    setSummary('');
    setHealth(card?.healthStatus || 'unset');
  }, [card?.goalUUID]);
  if (!card) {
    return (
      <div className="evt-page goals-review">
        <div className="goals-review__complete"><span aria-hidden="true">✓</span><h1>Review complete</h1><p>Your Goal states are current.</p><button type="button" className="primary" onClick={onDone}>Back to Goals</button></div>
      </div>
    );
  }
  const continueReview = async (resolution = 'continue') => {
    if (busy) return;
    setBusy(true);
    try {
      const now = new Date().toISOString();
      await repository.postUpdate({
        ...card.goal,
        lastReviewedAt: now,
      }, currentPlayer, {
        summary: summary.trim() || `Weekly review: ${HEALTH_LABELS[health]}.`,
        healthStatus: health,
        kind: 'review',
        now,
      });
      const refreshed = await repository.getGoalDetail(card.goal.UUID);
      const currentMilestone = refreshed?.progress?.currentMilestone || refreshed?.progress?.currentStage;
      await queueAchievementEvent(databaseConnection, createAchievementEvent({
        type: ACHIEVEMENT_EVENT_TYPE.goalReviewed,
        parent: currentPlayer.UUID,
        sourceUUID: card.goal.UUID,
        occurredAt: now,
        payload: {
          finishCondition: card.goal.finishCondition,
          milestoneUUID: currentMilestone?.UUID || null,
          nextActionUUID: card.goal.nextAction?.entityUUID || null,
          substantiveRevision: summary.trim().length >= 20,
          restoredDirection: health === 'on_track' && card.healthStatus !== 'on_track',
        },
      }));
      if (resolution === 'pause') await repository.transitionGoal(card.goal, 'paused', currentPlayer);
      if (resolution === 'archive') await repository.transitionGoal(card.goal, 'archived', currentPlayer);
      setIndex((value) => value + 1);
      await onChanged();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="evt-page goals-review">
      <header className="evt-header"><div className="evt-header-left"><button className="evt-back-btn" onClick={onDone}>← GOALS</button><span className="evt-header-title">WEEKLY REVIEW</span></div><span>{index + 1} / {queue.length}</span></header>
      <main className="goals-review__card" style={goalAccentStyle(card.goal)}>
        <span className="goals-review__eyebrow">Check in</span>
        <h1>{card.name}</h1>
        <p><span>Finished when</span>{card.finishCondition || 'Needs definition'}</p>
        <ProgressVisual progress={card.progress} />
        <label><span>What changed since the last review?</span><textarea rows={4} value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="A concise update is enough." /></label>
        <fieldset><legend>Health</legend>{['on_track', 'at_risk', 'blocked', 'unset'].map((value) => <button type="button" key={value} className={health === value ? 'active' : ''} onClick={() => setHealth(value)}>{HEALTH_LABELS[value]}</button>)}</fieldset>
        <div className="goals-review__facts">
          <span><small>Current move</small>{card.nextAction?.labelSnapshot || 'No next action selected'}</span>
          <span><small>Target</small>{formatDate(card.targetDate)}</span>
        </div>
        <div className="goals-review__actions">
          <button type="button" onClick={() => onOpen(card.goalUUID)}>Revise</button>
          <button type="button" onClick={() => continueReview('pause')}>Pause</button>
          <button type="button" onClick={() => continueReview('archive')}>Archive</button>
          <button type="button" className="primary" disabled={busy} onClick={() => continueReview('continue')}>{busy ? 'Saving…' : 'Continue'}</button>
        </div>
      </main>
    </div>
  );
}

export {
  GoalArenaBoard,
  GoalDetail,
  GoalForm,
  GoalReview,
};
