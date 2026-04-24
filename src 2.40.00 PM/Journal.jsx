import { useContext, useMemo, useState } from 'react';
import { AppContext } from '../../App';
import NiceModal from '@ebay/nice-modal-react';
import JournalPopup from '../../Modals/JournalPopup/JournalPopup';
import JournalEntryDetail from '../../Modals/JournalEntryDetail/JournalEntryDetail';
import { UTCStringToLocalTime } from '../../utils/Helpers/Time';
import './Journal.css';

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December'
];

function toDateKey(dateStr) {
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// ── Day detail view ───────────────────────────────────────────────────────────
function DayDetail({ dateKey, entries, tasks, onBack }) {
  const dayEntries = useMemo(
    () => entries.filter(e => toDateKey(e.createdAt) === dateKey),
    [entries, dateKey]
  );
  const dayTasks = useMemo(
    () => tasks.filter(t => t.completedAt && toDateKey(t.completedAt) === dateKey),
    [tasks, dateKey]
  );

  const display = new Date(dateKey + 'T00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });

  return (
    <div className="journal-inner">
      <div className="journal-day-detail">
        <div className="journal-day-header">
          <button className="journal-back-btn" onClick={onBack}>&#8592; Back</button>
          <span className="journal-day-title">{display}</span>
          <button
            className="btn-primary journal-add-btn-sm"
            onClick={() => NiceModal.show(JournalPopup)}
          >+ entry</button>
        </div>

        <div className="journal-day-section">
          <p className="journal-day-section-label label-sm">journal entries</p>
          {dayEntries.length === 0 ? (
            <p className="journal-day-empty">No journal entries for this day.</p>
          ) : (
            dayEntries.map(e => (
              <div
                key={e.UUID}
                className="journal-day-entry-row"
                onClick={() => NiceModal.show(JournalEntryDetail, { entry: e })}
              >
                <span className="journal-day-entry-title">{e.title || 'Untitled entry'}</span>
                {e.entry && (
                  <span className="journal-day-entry-preview">
                    {e.entry.slice(0, 120)}{e.entry.length > 120 ? '...' : ''}
                  </span>
                )}
                <span className="journal-day-entry-time">{UTCStringToLocalTime(e.createdAt)}</span>
              </div>
            ))
          )}
        </div>

        <div className="journal-day-section">
          <p className="journal-day-section-label label-sm">tasks completed</p>
          {dayTasks.length === 0 ? (
            <p className="journal-day-empty">No tasks completed on this day.</p>
          ) : (
            dayTasks.map(t => (
              <div key={t.UUID} className="journal-day-task-row">
                <svg width="10" height="10" viewBox="0 0 10 10" style={{ flexShrink: 0, marginTop: 2 }}>
                  <polyline points="2,5 4,7 8,3" stroke="var(--green)" strokeWidth="1.5" fill="none" />
                </svg>
                <div className="journal-day-task-body">
                  <span className="journal-day-task-name">{t.name || 'Untitled task'}</span>
                  {t.estimatedDuration && (
                    <span className="journal-day-task-meta">{t.estimatedDuration}m estimated</span>
                  )}
                </div>
                <span className="journal-day-entry-time">{UTCStringToLocalTime(t.completedAt)}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main journal page ─────────────────────────────────────────────────────────
function Journal() {
  // Read from the shared app-level cache — no local fetch, no blocking load state
  const { journals: entries = [], allTasks: tasks = [] } = useContext(AppContext);

  const [selectedDay, setSelectedDay] = useState(null); // "YYYY-MM-DD" or null

  const today = new Date();
  const [viewYear,  setViewYear]  = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());

  const dim = new Date(viewYear, viewMonth + 1, 0).getDate();
  const fd  = new Date(viewYear, viewMonth, 1).getDay();

  // Memoized sets — only recompute when underlying data changes
  const entryDays = useMemo(() => new Set(entries.map(e => toDateKey(e.createdAt))), [entries]);
  const taskDays  = useMemo(
    () => new Set(tasks.filter(t => t.completedAt).map(t => toDateKey(t.completedAt))),
    [tasks]
  );

  const todayKey = toDateKey(today.toISOString());

  const prevMonth = () => { if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y-1); } else setViewMonth(m => m-1); };
  const nextMonth = () => { if (viewMonth === 11) { setViewMonth(0);  setViewYear(y => y+1); } else setViewMonth(m => m+1); };
  const prevYear  = () => setViewYear(y => y-1);
  const nextYear  = () => setViewYear(y => y+1);

  const handleDayClick = (day) => {
    const key = `${viewYear}-${String(viewMonth+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    setSelectedDay(key);
  };

  // ── Day detail view ──
  if (selectedDay) {
    return (
      <div className="page journal-page">
        <DayDetail
          dateKey={selectedDay}
          entries={entries}
          tasks={tasks}
          onBack={() => setSelectedDay(null)}
        />
      </div>
    );
  }

  // ── Main calendar view ──
  return (
    <div className="page journal-page">
      <div className="journal-inner">

        <div className="journal-cal-section">
          <div className="journal-cal-nav">
            <button className="journal-nav-btn" onClick={prevMonth}>&#8249;</button>
            <span className="journal-cal-month">{MONTH_NAMES[viewMonth]}</span>
            <button className="journal-nav-btn" onClick={nextMonth}>&#8250;</button>

            <div className="journal-year-nav">
              <button className="journal-nav-btn journal-nav-btn--sm" onClick={prevYear}>&#8249;</button>
              <span className="journal-cal-year">{viewYear}</span>
              <button className="journal-nav-btn journal-nav-btn--sm" onClick={nextYear}>&#8250;</button>
            </div>

            <button className="btn-primary journal-add-btn" onClick={() => NiceModal.show(JournalPopup)}>
              + entry
            </button>
          </div>

          <div className="journal-cal-grid">
            {['S','M','T','W','T','F','S'].map((d,i) => (
              <div key={i} className="journal-cal-hd">{d}</div>
            ))}
            {Array.from({ length: fd }).map((_, i) => <div key={`e${i}`} />)}
            {Array.from({ length: dim }).map((_, i) => {
              const day = i + 1;
              const key = `${viewYear}-${String(viewMonth+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
              const hasEntry = entryDays.has(key);
              const hasTask  = taskDays.has(key);
              return (
                <div
                  key={day}
                  className={[
                    'journal-cal-day',
                    key === todayKey ? 'journal-cal-day--today' : '',
                  ].filter(Boolean).join(' ')}
                  onClick={() => handleDayClick(day)}
                  title="View this day"
                >
                  <span className="journal-cal-day-num">{day}</span>
                  {(hasEntry || hasTask) && (
                    <div className="journal-cal-dots">
                      {hasEntry && <span className="journal-cal-dot journal-cal-dot--entry" />}
                      {hasTask  && <span className="journal-cal-dot journal-cal-dot--task"  />}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="journal-cal-legend">
            <span className="legend-item legend-item--entry">entry</span>
            <span className="legend-item legend-item--task">tasks done</span>
          </div>
          <p className="journal-total-label">{entries.length} total {entries.length === 1 ? 'entry' : 'entries'}</p>
        </div>

      </div>
    </div>
  );
}

export default Journal;
