import { useMemo, useState } from 'react';
import { v4 as uuid } from 'uuid';
import { MINUTE } from '@domain/constants.js';
import { getCurrentIGT } from '@domain/time/Time.js';
import { Icon } from '@shared/icons/Icon.jsx';

const TYPE_META = Object.freeze({
  one_time: { label: 'One time', icon: '✓', description: 'Complete once each day.' },
  quantity: { label: 'Quantity', icon: '↗', description: 'Add a measurable amount toward a daily target.' },
  duration: { label: 'Duration', icon: '◷', description: 'Run a wall-clock timer toward a daily target.' },
});
const ICON_PRESETS = ['✓', '✦', '◷', '↗', '☀', '☾', '●', '◆'];

function formatDuration(value, compact = false) {
  const milliseconds = Math.max(0, Number(value) || 0);
  const totalSeconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (compact && hours) return `${hours}h ${minutes}m`;
  if (compact && minutes) return `${minutes}m ${seconds}s`;
  if (hours) return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function formatValue(card, value = card.todayTotal) {
  if (card.type === 'duration') return formatDuration(value, true);
  if (card.type === 'quantity') return `${Number(value || 0).toLocaleString()} ${card.unit}`;
  return value ? 'Completed' : 'Not completed';
}

function cardStyle(card) {
  const accent = card.accentColor || '#a78bfa';
  return { '--habit-accent': accent };
}

function OneTimeGraph({ card }) {
  return (
    <div className="habit-day-grid" role="img" aria-label={`${card.name} completion history for the last 12 weeks`}>
      {card.series.map((point) => (
        <span
          key={point.key}
          className={point.value ? 'is-filled' : ''}
          tabIndex={0}
          title={`${point.label}: ${point.value ? 'completed' : 'not completed'}`}
          aria-label={`${point.label}: ${point.value ? 'completed' : 'not completed'}`}
        />
      ))}
    </div>
  );
}

function QuantityGraph({ card }) {
  const max = Math.max(card.target, ...card.series.map((point) => point.value), 1);
  const targetPosition = Math.min(100, (card.target / max) * 100);
  return (
    <div className="habit-bar-chart" role="img" aria-label={`${card.name} quantity history for the last 14 days`}>
      <span className="habit-chart-target" style={{ bottom: `${targetPosition}%` }} aria-hidden="true" />
      {card.series.map((point) => (
        <span className="habit-bar-slot" key={point.key}>
          <span
            className="habit-bar-value"
            style={{ height: `${Math.max(point.value ? 7 : 0, (point.value / max) * 100)}%` }}
            tabIndex={0}
            title={`${point.label}: ${point.value.toLocaleString()} ${card.unit}`}
            aria-label={`${point.label}: ${point.value.toLocaleString()} ${card.unit}`}
          />
        </span>
      ))}
    </div>
  );
}

function DurationGraph({ card }) {
  const max = Math.max(card.target, ...card.series.map((point) => point.value), 1);
  const targetY = 35 - (card.target / max) * 30;
  const points = card.series.map((point, index) => {
    const x = card.series.length === 1 ? 50 : (index / (card.series.length - 1)) * 100;
    const y = 35 - (point.value / max) * 30;
    return { ...point, x, y };
  });
  const polyline = points.map((point) => `${point.x},${point.y}`).join(' ');
  return (
    <div className="habit-line-chart">
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" role="img" aria-label={`${card.name} duration history for the last 14 days`}>
        <line x1="0" y1={targetY} x2="100" y2={targetY} className="habit-line-target" />
        <polyline points={polyline} className="habit-line-value" />
      </svg>
      {points.map((point) => (
        <span
          key={point.key}
          className="habit-line-point"
          style={{ left: `${point.x}%`, top: `${(point.y / 40) * 100}%` }}
          tabIndex={0}
          title={`${point.label}: ${formatDuration(point.value, true)}`}
          aria-label={`${point.label}: ${formatDuration(point.value, true)}`}
        />
      ))}
    </div>
  );
}

function HabitGraph({ card }) {
  return (
    <div className="habit-history" onClick={(event) => event.stopPropagation()}>
      <div className="habit-history-meta">
        <span>{card.type === 'one_time' ? '12 weeks' : 'Last 14 days'}</span>
        <strong>
          {card.event.streakVisible
            ? `${card.streak} opportunity streak`
            : card.rhythmLabel}
        </strong>
      </div>
      {card.type === 'one_time' && <OneTimeGraph card={card} />}
      {card.type === 'quantity' && <QuantityGraph card={card} />}
      {card.type === 'duration' && <DurationGraph card={card} />}
    </div>
  );
}

function OneTimeControl({ card, onComplete, busy }) {
  return (
    <button
      type="button"
      className="habit-one-time-control"
      disabled={card.complete || busy}
      onClick={(event) => { event.stopPropagation(); onComplete(card); }}
      aria-label={card.complete ? `${card.name} completed today` : `Complete ${card.name}`}
    >
      <Icon name="check" size={18} />
      <span>{card.complete ? 'Done' : 'Complete'}</span>
    </button>
  );
}

function QuantityControl({ card, onLog, busy }) {
  const [amount, setAmount] = useState(0);
  const [exact, setExact] = useState('');
  const commit = (value) => {
    const safe = Math.max(0, Math.floor(Number(value) || 0));
    if (!safe || busy || card.complete) return;
    onLog(card, safe);
    setAmount(0);
    setExact('');
  };
  return (
    <div className="habit-quantity-control" onClick={(event) => event.stopPropagation()}>
      <div className="habit-scale-row">
        <span className="habit-scale-preview">+{amount}</span>
        <input
          type="range"
          min="0"
          max={Math.max(1, card.target)}
          step="1"
          value={amount}
          disabled={card.complete || busy}
          onChange={(event) => setAmount(Number(event.target.value))}
          onPointerUp={() => commit(amount)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit(amount);
          }}
          aria-label={`Drag to add ${card.unit} to ${card.name}`}
        />
      </div>
      <div className="habit-exact-row">
        <input
          type="number"
          min="1"
          inputMode="numeric"
          value={exact}
          disabled={card.complete || busy}
          onChange={(event) => setExact(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit(exact);
          }}
          placeholder="Exact"
          aria-label={`Exact ${card.unit} amount`}
        />
        <button type="button" disabled={!exact || card.complete || busy} onClick={() => commit(exact)}>Add</button>
      </div>
    </div>
  );
}

function DurationControl({ card, onToggle, busy }) {
  const runningFor = card.activeSession?.loggedAt
    ? Math.max(0, Date.now() - new Date(card.activeSession.loggedAt).getTime())
    : 0;
  return (
    <button
      type="button"
      className={`habit-duration-control ${card.isRunning ? 'is-running' : ''}`}
      disabled={card.complete || busy}
      onClick={(event) => { event.stopPropagation(); onToggle(card); }}
      aria-label={card.isRunning ? `Stop ${card.name} timer` : `Start ${card.name} timer`}
    >
      <span className="habit-timer-symbol">{card.isRunning ? '■' : '▶'}</span>
      <span>{card.isRunning ? formatDuration(runningFor) : 'Start timer'}</span>
    </button>
  );
}

function HabitCard({ card, onEdit, onComplete, onLogQuantity, onToggleDuration, busy, celebrating }) {
  const meta = TYPE_META[card.type];
  return (
    <article
      className={`habit-card ${card.complete ? 'is-complete' : ''} ${card.isRunning ? 'is-running' : ''} ${celebrating ? 'is-celebrating' : ''}`}
      style={cardStyle(card)}
    >
      <div className="habit-card-accent" aria-hidden="true" />
      <div className="habit-card-main">
        <button type="button" className="habit-card-body" onClick={() => onEdit(card.event)}>
          <span className="habit-card-icon" aria-hidden="true">{card.event.icon || meta.icon}</span>
          <span className="habit-card-copy">
            <span className="habit-card-type">{meta.label}</span>
            <strong>{card.name}</strong>
            {card.description && <small>{card.description}</small>}
            <small>{card.rhythmLabel}</small>
          </span>
          <span className="habit-card-progress">
            <strong>{formatValue(card)}</strong>
            {card.type !== 'one_time' && <small>of {formatValue(card, card.target)}</small>}
          </span>
        </button>
        <div className="habit-card-action">
          {card.type === 'one_time' && <OneTimeControl card={card} onComplete={onComplete} busy={busy} />}
          {card.type === 'quantity' && <QuantityControl card={card} onLog={onLogQuantity} busy={busy} />}
          {card.type === 'duration' && <DurationControl card={card} onToggle={onToggleDuration} busy={busy} />}
        </div>
      </div>
      <HabitGraph card={card} />
      <span className="habit-complete-burst" aria-hidden="true">✓</span>
    </article>
  );
}

function HabitList({ cards, empty, busyIds, celebratingIds, ...cardProps }) {
  if (!cards.length) return <p className="habit-list-empty">{empty}</p>;
  return (
    <div className="habit-list">
      {cards.map((card) => (
        <HabitCard
          key={card.id}
          card={card}
          busy={busyIds?.has(card.id)}
          celebrating={celebratingIds?.has(card.id)}
          {...cardProps}
        />
      ))}
    </div>
  );
}

export function HabitPage({ model, onCreate, onOpenGoals, onEdit, onComplete, onLogQuantity, onToggleDuration, busyIds, celebratingIds }) {
  return (
    <div className="habit-page">
      <header className="habit-page-header">
        <div>
          <span className="habit-page-eyebrow">Daily practice</span>
          <h1>Events</h1>
          <p>Track the small things directly, then let the history speak for itself.</p>
        </div>
        <div className="habit-page-actions">
          <button type="button" onClick={onOpenGoals}>Goals</button>
          <button type="button" className="primary" onClick={onCreate}><Icon name="add" size={15} /> New event</button>
        </div>
      </header>
      <main className="habit-page-scroll">
        <div className="habit-page-content">
          {model.cards.length === 0 ? (
            <div className="habit-empty-state">
              <span>✦</span>
              <h2>Build your first rhythm</h2>
              <p>Create a one-time, quantity, or duration event. Its history will grow here one day at a time.</p>
              <button type="button" className="primary" onClick={onCreate}>Create an event</button>
            </div>
          ) : (
            <>
              <section className="habit-section">
                <div className="habit-section-heading">
                  <span>Today</span>
                  <strong>{model.active.length} remaining</strong>
                </div>
                <HabitList
                  cards={model.active}
                  empty="Everything is complete for today."
                  onEdit={onEdit}
                  onComplete={onComplete}
                  onLogQuantity={onLogQuantity}
                  onToggleDuration={onToggleDuration}
                  busyIds={busyIds}
                  celebratingIds={celebratingIds}
                />
              </section>
              {model.completed.length > 0 && (
                <section className="habit-section habit-section--completed">
                  <div className="habit-section-heading">
                    <span>Completed today</span>
                    <strong>{model.completed.length}</strong>
                  </div>
                  <HabitList
                    cards={model.completed}
                    onEdit={onEdit}
                    onComplete={onComplete}
                    onLogQuantity={onLogQuantity}
                    onToggleDuration={onToggleDuration}
                    busyIds={busyIds}
                    celebratingIds={celebratingIds}
                  />
                </section>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}

function eraLabel(type) {
  return TYPE_META[type]?.label || type;
}

export function HabitEditor({ tracker = null, logs = [], currentPlayer, onCancel, onSave, onDelete }) {
  const [type, setType] = useState(tracker?.type || 'one_time');
  const [name, setName] = useState(tracker?.name || '');
  const [description, setDescription] = useState(tracker?.description || '');
  const [unit, setUnit] = useState(tracker?.unit || 'times');
  const [quantityTarget, setQuantityTarget] = useState(tracker?.type === 'quantity' ? tracker.dailyTarget : 5);
  const [durationMinutes, setDurationMinutes] = useState(tracker?.type === 'duration' ? Math.max(1, Math.round(Number(tracker.dailyTarget || 0) / MINUTE)) : 25);
  const [accentColor, setAccentColor] = useState(tracker?.accentColor || '#a78bfa');
  const [icon, setIcon] = useState(tracker?.icon || TYPE_META[tracker?.type || 'one_time'].icon);
  const [cadenceType, setCadenceType] = useState(tracker?.rhythmCadenceType || 'daily');
  const [eligibleWeekdays, setEligibleWeekdays] = useState(
    Array.isArray(tracker?.eligibleWeekdays) ? tracker.eligibleWeekdays : [1, 2, 3, 4, 5],
  );
  const [opportunitiesPerPeriod, setOpportunitiesPerPeriod] = useState(
    Math.max(1, Number(tracker?.opportunitiesPerPeriod) || 3),
  );
  const [streakVisible, setStreakVisible] = useState(Boolean(tracker?.streakVisible));
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const eras = Array.isArray(tracker?.trackingEras) ? tracker.trackingEras : [];
  const previousEras = useMemo(() => eras.filter((era) => era.UUID !== tracker?.currentEraId), [eras, tracker?.currentEraId]);
  const valid = name.trim().length > 0
    && (type !== 'quantity' || (unit.trim().length > 0 && Number(quantityTarget) > 0))
    && (type !== 'duration' || Number(durationMinutes) > 0);

  const save = () => {
    if (!valid) return;
    const now = new Date().toISOString();
    const inGameTimestamp = getCurrentIGT(currentPlayer);
    let currentEraId = tracker?.currentEraId || uuid();
    let trackingEras = eras.length ? [...eras] : [{
      UUID: currentEraId,
      type,
      startedAt: tracker?.createdAt || now,
      inGameTimestamp: tracker?.createdInGameTimestamp ?? 0,
    }];
    if (tracker && tracker.type !== type) {
      trackingEras = trackingEras.map((era) => era.UUID === tracker.currentEraId
        ? { ...era, endedAt: now, endedInGameTimestamp: inGameTimestamp }
        : era);
      currentEraId = uuid();
      trackingEras.push({ UUID: currentEraId, type, startedAt: now, inGameTimestamp });
    }
    onSave({
      ...(tracker || {}),
      UUID: tracker?.UUID || uuid(),
      ownerUUID: tracker?.ownerUUID || currentPlayer?.UUID || null,
      name: name.trim().slice(0, 60),
      description: description.trim().slice(0, 240),
      type,
      unit: type === 'quantity' ? unit.trim().slice(0, 24) : null,
      dailyTarget: type === 'quantity'
        ? Math.max(1, Math.floor(Number(quantityTarget) || 1))
        : type === 'duration'
          ? Math.max(MINUTE, Math.floor(Number(durationMinutes) || 1) * MINUTE)
          : null,
      icon: String(icon || TYPE_META[type].icon).slice(0, 2),
      accentColor: accentColor || '#a78bfa',
      currentEraId,
      trackingEras,
      specialKind: null,
      maxBonusPct: Number(tracker?.maxBonusPct || 0),
      rhythmCadenceType: cadenceType,
      eligibleWeekdays: cadenceType === 'weekdays' ? eligibleWeekdays : [],
      opportunitiesPerPeriod: ['times-per-week', 'duration-per-week'].includes(cadenceType)
        ? opportunitiesPerPeriod
        : null,
      streakVisible,
      createdAt: tracker?.createdAt || now,
      createdInGameTimestamp: tracker?.createdInGameTimestamp ?? inGameTimestamp,
      updatedAt: now,
    });
  };

  return (
    <div className="habit-editor" role="dialog" aria-modal="true" aria-label={tracker ? `Edit ${tracker.name}` : 'Create event'}>
      <header className="habit-editor-header">
        <div>
          <span>{tracker ? 'Edit event' : 'New event'}</span>
          <h2>{tracker?.name || 'Create a daily rhythm'}</h2>
        </div>
        <button type="button" onClick={onCancel} aria-label="Close event editor">×</button>
      </header>
      <div className="habit-editor-scroll">
        <fieldset className="habit-type-picker">
          <legend>Tracking type</legend>
          {Object.entries(TYPE_META).map(([value, meta]) => (
            <button
              key={value}
              type="button"
              className={type === value ? 'active' : ''}
              onClick={() => { setType(value); setIcon(meta.icon); }}
            >
              <span>{meta.icon}</span>
              <strong>{meta.label}</strong>
              <small>{meta.description}</small>
            </button>
          ))}
        </fieldset>

        <label className="habit-editor-field">
          <span>Name</span>
          <input value={name} maxLength={60} onChange={(event) => setName(event.target.value)} placeholder="Morning walk" autoFocus />
        </label>

        <fieldset className="habit-rhythm-picker">
          <legend>Rhythm · flexible opportunity windows</legend>
          <label className="habit-editor-field">
            <span>Cadence</span>
            <select value={cadenceType} onChange={(event) => setCadenceType(event.target.value)}>
              <option value="daily">Daily opportunity</option>
              <option value="weekdays">Selected weekdays</option>
              <option value="times-per-week">Times per week</option>
              <option value="duration-per-week">Duration per week</option>
              <option value="event-triggered">Event-triggered</option>
            </select>
          </label>
          {cadenceType === 'weekdays' && (
            <div className="habit-weekday-picker" aria-label="Eligible weekdays">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((label, day) => (
                <button
                  type="button"
                  key={label}
                  className={eligibleWeekdays.includes(day) ? 'active' : ''}
                  onClick={() => setEligibleWeekdays((current) => (
                    current.includes(day) ? current.filter((value) => value !== day) : [...current, day].sort()
                  ))}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          {['times-per-week', 'duration-per-week'].includes(cadenceType) && (
            <label className="habit-editor-field">
              <span>{cadenceType === 'times-per-week' ? 'Opportunities per week' : 'Target minutes per week'}</span>
              <input
                type="number"
                min="1"
                value={opportunitiesPerPeriod}
                onChange={(event) => setOpportunitiesPerPeriod(Math.max(1, Number(event.target.value) || 1))}
              />
            </label>
          )}
          <label className="habit-streak-option">
            <input
              type="checkbox"
              checked={streakVisible}
              onChange={(event) => setStreakVisible(event.target.checked)}
            />
            <span>Show streak as optional context</span>
          </label>
          <p>Missed windows expire without debt, penalties, or reward multipliers.</p>
        </fieldset>
        <label className="habit-editor-field">
          <span>Description</span>
          <textarea value={description} maxLength={240} rows={3} onChange={(event) => setDescription(event.target.value)} placeholder="A little context or encouragement…" />
        </label>

        {type === 'quantity' && (
          <div className="habit-editor-row">
            <label className="habit-editor-field">
              <span>Unit</span>
              <input value={unit} maxLength={24} onChange={(event) => setUnit(event.target.value)} placeholder="pages" />
            </label>
            <label className="habit-editor-field">
              <span>Daily target</span>
              <input type="number" min="1" value={quantityTarget} onChange={(event) => setQuantityTarget(event.target.value)} />
            </label>
          </div>
        )}
        {type === 'duration' && (
          <label className="habit-editor-field">
            <span>Daily target · minutes</span>
            <input type="number" min="1" max="1440" value={durationMinutes} onChange={(event) => setDurationMinutes(event.target.value)} />
          </label>
        )}

        <fieldset className="habit-appearance-picker">
          <legend>Appearance</legend>
          <div className="habit-icon-picker">
            {ICON_PRESETS.map((value) => (
              <button key={value} type="button" className={icon === value ? 'active' : ''} onClick={() => setIcon(value)}>{value}</button>
            ))}
          </div>
          <label className="habit-editor-field habit-editor-color">
            <span>Accent color</span>
            <input type="color" value={accentColor} onChange={(event) => setAccentColor(event.target.value)} />
            <input value={accentColor} onChange={(event) => setAccentColor(event.target.value)} />
          </label>
        </fieldset>

        {previousEras.length > 0 && (
          <section className="habit-era-history">
            <span>Previous tracking periods</span>
            {previousEras.map((era) => (
              <div key={era.UUID}>
                <strong>{eraLabel(era.type)}</strong>
                <small>{new Date(era.startedAt).toLocaleDateString()} – {era.endedAt ? new Date(era.endedAt).toLocaleDateString() : 'present'}</small>
                <b>{logs.filter((log) => log.trackingEraId === era.UUID && log.status === 'success').length} entries</b>
              </div>
            ))}
          </section>
        )}
      </div>
      <footer className="habit-editor-footer">
        {tracker && (confirmingDelete ? (
          <span className="habit-delete-confirm">
            <strong>Delete event and its history?</strong>
            <button type="button" className="danger" onClick={() => onDelete(tracker)}>Delete</button>
            <button type="button" onClick={() => setConfirmingDelete(false)}>Keep it</button>
          </span>
        ) : <button type="button" className="danger ghost" onClick={() => setConfirmingDelete(true)}>Delete</button>)}
        <span className="habit-editor-spacer" />
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="button" className="primary" disabled={!valid} onClick={save}>{tracker ? 'Save changes' : 'Create event'}</button>
      </footer>
    </div>
  );
}
