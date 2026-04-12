import { useContext, useMemo, useState } from 'react';
import { AppContext } from '../../App';
import NiceModal from '@ebay/nice-modal-react';
import JournalPopup from '../../Modals/JournalPopup/JournalPopup';
import JournalEntryDetail from '../../Modals/JournalEntryDetail/JournalEntryDetail';
import { UTCStringToLocalDate, UTCStringToLocalTime } from '../../utils/Helpers/Time';
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
  const display = new Date(dateKey + 'T00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });

  const items = useMemo(() => {
    const dayEntries = entries
      .filter(e => toDateKey(e.createdAt) === dateKey)
      .map(e => ({ ...e, _type: 'entry', _time: new Date(e.createdAt).getTime() }));

    const dayTasks = tasks
      .filter(t => t.completedAt && toDateKey(t.completedAt) === dateKey)
      .map(t => ({ ...t, _type: 'task', _time: new Date(t.completedAt).getTime() }));

    return [...dayEntries, ...dayTasks].sort((a, b) => a._time - b._time);
  }, [entries, tasks, dateKey]);

  // When adding an entry from a day view, pass the date so JournalPopup can
  // pre-fill / store the entry under that specific day rather than "now".
  const handleAddEntry = () => NiceModal.show(JournalPopup, { initialDate: dateKey });

  return (
    <div className="journal-day-detail">
      <div className="journal-day-header">
        <button className="journal-back-btn" onClick={onBack}>&#8592; Back</button>
        <span className="journal-day-title">{display}</span>
        <button className="btn-primary journal-add-btn-sm" onClick={handleAddEntry}>+ entry</button>
      </div>

      {items.length === 0 ? (
        <div className="journal-day-empty-state">
          <p>Nothing recorded for this day.</p>
          <p>Write a journal entry or complete a task to see history here.</p>
        </div>
      ) : (
        <div className="journal-history-list">
          {items.map(item =>
            item._type === 'entry' ? (
              <div
                key={item.UUID}
                className="journal-history-row journal-history-row--entry"
                onClick={() => NiceModal.show(JournalEntryDetail, { entry: item })}
              >
                <div className="journal-history-icon journal-history-icon--entry">JNL</div>
                <div className="journal-history-body">
                  <span className="journal-history-title">{item.title || 'Untitled entry'}</span>
                  {item.entry && (
                    <span className="journal-history-preview">
                      {item.entry.slice(0, 100)}{item.entry.length > 100 ? '…' : ''}
                    </span>
                  )}
                </div>
                <span className="journal-history-time">{UTCStringToLocalTime(item.createdAt)}</span>
              </div>
            ) : (
              <div key={item.UUID} className="journal-history-row journal-history-row--task">
                <div className="journal-history-icon journal-history-icon--task">TSK</div>
                <div className="journal-history-body">
                  <span className="journal-history-title">{item.name || 'Untitled task'}</span>
                  {item.estimatedDuration && (
                    <span className="journal-history-preview">{item.estimatedDuration}m estimated</span>
                  )}
                </div>
                <span className="journal-history-time">{UTCStringToLocalTime(item.completedAt)}</span>
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}

// ── Main journal page ─────────────────────────────────────────────────────────
function Journal() {
  const { journals: entries = [], allTasks: tasks = [], cacheReady } = useContext(AppContext);

  const [selectedDay, setSelectedDay] = useState(null);
  const today = new Date();
  const [viewYear,  setViewYear]  = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());

  const dim = new Date(viewYear, viewMonth + 1, 0).getDate();
  const fd  = new Date(viewYear, viewMonth, 1).getDay();

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

  if (!cacheReady) return <div className="journal-loading">Loading...</div>;

  if (selectedDay) {
    return (
      <div className="page journal-page">
        <div className="journal-inner">
          <DayDetail
            dateKey={selectedDay}
            entries={entries}
            tasks={tasks}
            onBack={() => setSelectedDay(null)}
          />
        </div>
      </div>
    );
  }

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
            {/* Top-level + entry button creates an entry for today */}
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
                  className={['journal-cal-day', key === todayKey ? 'journal-cal-day--today' : ''].filter(Boolean).join(' ')}
                  onClick={() => handleDayClick(day)}
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
          <p className="journal-total-label">
            {entries.length} total {entries.length === 1 ? 'entry' : 'entries'}
          </p>
        </div>
      </div>
    </div>
  );
}

export default Journal;