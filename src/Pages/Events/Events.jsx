import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { v4 as uuid } from 'uuid';
import { AppContext } from '../../App.jsx';
import { STORES, SPECIAL_KIND, HABIT_STREAK_CAP_DAYS } from '../../utils/Constants.js';
import {
  computeHabitMultiplier,
  computeQuantityMultiplier,
  computeFirstMatchMultiplier,
  computeWakeTimeMultiplier,
  computeEntertainmentMultiplier,
  computeHabitStreakFromLogs,
  getDateKey,
  getLogDateKey,
  shiftDateKey,
  checkInHabit,
  logQuantity,
} from '../../utils/Helpers/Events.js';
import { Icon } from '../../components/Icons/Icon.jsx';
import ProfilePicture from '../../components/ProfilePicture/ProfilePicture.jsx';
import './Events.css';

/* ════════════════════════════════════════════════════════════════════
   Helpers
   ════════════════════════════════════════════════════════════════════ */
function formatMs(ms) {
  const safe = Math.max(0, Number(ms) || 0);
  const sec = Math.floor(safe / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ${String(sec % 60).padStart(2, '0')}s`;
  const hr = Math.floor(min / 60);
  return `${hr}h ${String(min % 60).padStart(2, '0')}m`;
}

function bannerStyle(customEvent, fallbackKind) {
  if (customEvent?.bannerImageUrl) {
    return {
      backgroundImage: `url(${customEvent.bannerImageUrl})`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
    };
  }
  if (customEvent?.bannerColor) return { background: customEvent.bannerColor };
  // Theme-aware fallback gradients per type — these read against any theme.
  if (fallbackKind === 'habit') {
    return { background: 'linear-gradient(135deg, var(--accent-dim) 0%, var(--bg-raised) 100%)' };
  }
  if (fallbackKind === 'quantity') {
    return { background: 'linear-gradient(135deg, var(--bg-raised) 0%, var(--accent-dim) 100%)' };
  }
  return { background: 'linear-gradient(135deg, var(--bg-raised) 0%, var(--bg-card) 100%)' };
}

const accentVarsFor = (customEvent) => {
  const accent = customEvent?.accentColor || null;
  if (!accent) return {};
  // Convert hex → semi-transparent variants for soft / border tints.
  const m = /^#([0-9a-f]{6})$/i.exec(accent);
  let soft = `${accent}26`;   // ~15% alpha
  let border = `${accent}59`; // ~35% alpha
  if (m) {
    soft = `#${m[1]}26`;
    border = `#${m[1]}59`;
  }
  return {
    '--evt-accent': accent,
    '--evt-accent-soft': soft,
    '--evt-accent-border': border,
  };
};

const TYPE_LABEL = { habit: 'HABIT', quantity: 'QUANTITY', special: 'SYSTEM' };

/* ════════════════════════════════════════════════════════════════════
   MAIN
   ════════════════════════════════════════════════════════════════════ */
export default function Events() {
  const { databaseConnection, currentPlayer, refreshApp, timestamp } = useContext(AppContext);

  const [events, setEvents] = useState([]);
  const [allLogs, setAllLogs] = useState([]);          // CROSS-PROFILE logs
  const [activeBuffs, setActiveBuffs] = useState([]);
  const [allPlayers, setAllPlayers] = useState([]);
  const [mode, setMode] = useState({ view: 'list' });
  const [tab, setTab] = useState('available');

  const todayKey = useMemo(() => getDateKey(new Date(timestamp)), [timestamp]);

  const loadAll = useCallback(async () => {
    if (!currentPlayer?.UUID) return;
    const [evts, logs, buffs, players] = await Promise.all([
      databaseConnection.getAllCustomEvents(),
      databaseConnection.getAllEventLogs(),
      databaseConnection.getActiveEventBuffsForPlayer(currentPlayer.UUID),
      databaseConnection.getActivePlayers(),
    ]);
    setEvents(evts || []);
    setAllLogs(logs || []);
    setActiveBuffs(buffs || []);
    setAllPlayers(players || []);
  }, [databaseConnection, currentPlayer]);

  useEffect(() => { loadAll(); }, [loadAll, timestamp]);

  const refresh = useCallback(async () => {
    await loadAll();
    refreshApp();
  }, [loadAll, refreshApp]);

  const logsByEvent = useMemo(() => {
    const map = {};
    for (const l of allLogs) (map[l.eventUUID] ||= []).push(l);
    return map;
  }, [allLogs]);

  const buffsByEvent = useMemo(() => {
    const map = {};
    for (const b of activeBuffs) map[b.eventUUID] = b;
    return map;
  }, [activeBuffs]);

  const playersByUUID = useMemo(() => {
    const m = {};
    for (const p of allPlayers) m[p.UUID] = p;
    return m;
  }, [allPlayers]);

  /* ── Routing: form / style / detail / list ─────────────────── */
  if (mode.view === 'create' || mode.view === 'edit') {
    return (
      <EventForm
        events={events}
        editingUUID={mode.view === 'edit' ? mode.uuid : null}
        databaseConnection={databaseConnection}
        currentPlayer={currentPlayer}
        onCancel={() => setMode(mode.view === 'edit' ? { view: 'detail', uuid: mode.uuid } : { view: 'list' })}
        onSave={async (savedUUID) => { await refresh(); setMode({ view: 'detail', uuid: savedUUID }); }}
        onDelete={async () => { await refresh(); setMode({ view: 'list' }); }}
      />
    );
  }

  if (mode.view === 'style') {
    const customEvent = events.find((e) => e.UUID === mode.uuid);
    if (!customEvent) return null;
    return (
      <StylePage
        customEvent={customEvent}
        databaseConnection={databaseConnection}
        onClose={async () => { await refresh(); setMode({ view: 'detail', uuid: customEvent.UUID }); }}
      />
    );
  }

  if (mode.view === 'detail') {
    const customEvent = events.find((e) => e.UUID === mode.uuid);
    if (!customEvent) {
      setTimeout(() => setMode({ view: 'list' }), 0);
      return null;
    }
    return (
      <DetailView
        customEvent={customEvent}
        logs={logsByEvent[customEvent.UUID] || []}
        buff={buffsByEvent[customEvent.UUID] || null}
        todayKey={todayKey}
        databaseConnection={databaseConnection}
        currentPlayer={currentPlayer}
        playersByUUID={playersByUUID}
        allPlayers={allPlayers}
        onBack={() => setMode({ view: 'list' })}
        onEdit={() => setMode({ view: 'edit', uuid: customEvent.UUID })}
        onAfterAction={refresh}
        openStyle={() => setMode({ view: 'style', uuid: customEvent.UUID })}
      />
    );
  }

  /* ── List view ──────────────────────────────────────────────── */
  const isAvailable = (e) => {
    if (e.type === 'special') return false;
    const ls = logsByEvent[e.UUID] || [];
    if (e.type === 'habit') {
      // Available = no success log dated today across any profile.
      return !ls.some((l) => getLogDateKey(l) === todayKey && l.status === 'success');
    }
    // Quantity: not yet at target across all profiles today.
    const total = ls
      .filter((l) => getLogDateKey(l) === todayKey && l.status === 'success')
      .reduce((acc, l) => acc + (Number(l.value) || 0), 0);
    return total < (Number(e.dailyTarget) || 1);
  };

  const isActive = (e) => !!buffsByEvent[e.UUID];

  // For the list, sort so user-created (non-special) events come first, then specials.
  // Within each, alphabetic by name for stability.
  const visibleEvents = events.filter((e) => tab === 'available' ? isAvailable(e) : isActive(e));
  visibleEvents.sort((a, b) => {
    if (a.type === 'special' && b.type !== 'special') return 1;
    if (b.type === 'special' && a.type !== 'special') return -1;
    return (a.name || '').localeCompare(b.name || '');
  });

  const availableCount = events.filter(isAvailable).length;
  const activeCount = events.filter(isActive).length;

  return (
    <div className="evt-page">
      <header className="evt-header">
        <div className="evt-header-left">
          <span className="evt-header-title">EVENTS</span>
          <span className="evt-header-stat">CALENDAR · {todayKey}</span>
        </div>
        <button className="evt-header-add" onClick={() => setMode({ view: 'create' })} title="Create event">
          <Icon name="add" size={14} />
          <span>NEW EVENT</span>
        </button>
      </header>

      <nav className="evt-tabs">
        <button className={`evt-tab ${tab === 'available' ? 'active' : ''}`} onClick={() => setTab('available')}>
          AVAILABLE<span className="evt-tab-count">{availableCount}</span>
        </button>
        <button className={`evt-tab ${tab === 'active' ? 'active' : ''}`} onClick={() => setTab('active')}>
          ACTIVE<span className="evt-tab-count">{activeCount}</span>
        </button>
      </nav>

      <div className="evt-list">
        {visibleEvents.length === 0
          ? <EmptyState tab={tab} />
          : visibleEvents.map((customEvent) => (
              <EventCard
                key={customEvent.UUID}
                customEvent={customEvent}
                logs={logsByEvent[customEvent.UUID] || []}
                buff={buffsByEvent[customEvent.UUID] || null}
                todayKey={todayKey}
                onClick={() => setMode({ view: 'detail', uuid: customEvent.UUID })}
              />
            ))
        }
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   List card  —  wide horizontal strip
   ════════════════════════════════════════════════════════════════════ */
function EmptyState({ tab }) {
  if (tab === 'active') {
    return (
      <div className="evt-empty">
        <p className="evt-empty-title">No active buffs.</p>
        <p className="evt-empty-sub">
          Check in to a habit, log progress on a quantity event, or wake up on time to earn multipliers.
          Active buffs apply to every task you complete in the current day.
        </p>
      </div>
    );
  }
  return (
    <div className="evt-empty">
      <p className="evt-empty-title">All caught up.</p>
      <p className="evt-empty-sub">
        You've cleared every event for today. New ones unlock at the start of the next calendar day.
      </p>
    </div>
  );
}

function EventCard({ customEvent, logs, buff, todayKey, onClick }) {
  // Today's success logs across all profiles.
  const todaySuccess = logs.filter((l) => getLogDateKey(l) === todayKey && l.status === 'success');

  let sideContent;
  if (customEvent.type === 'habit') {
    const streak = computeHabitStreakFromLogs(logs, todayKey);
    sideContent = (
      <>
        <span className={`evt-card-side-num ${streak === 0 ? 'evt-card-side-num--dim' : ''}`}>
          {streak}
        </span>
        <span className="evt-card-side-lbl">DAY STREAK</span>
        {buff && (
          <span className="evt-card-side-buff">
            ×{Number(buff.multiplierValue).toFixed(3)} ACTIVE
          </span>
        )}
      </>
    );
  } else if (customEvent.type === 'quantity') {
    const todayTotal = todaySuccess.reduce((acc, l) => acc + (Number(l.value) || 0), 0);
    const target = Math.max(1, Number(customEvent.dailyTarget) || 1);
    sideContent = (
      <>
        <span className={`evt-card-side-num ${todayTotal === 0 ? 'evt-card-side-num--dim' : ''}`}>
          {todayTotal}
          <span className="evt-card-side-num-of">/{target}</span>
        </span>
        <span className="evt-card-side-lbl">{(customEvent.quantityUnit || 'UNITS').toUpperCase()}</span>
        {buff && (
          <span className="evt-card-side-buff">
            ×{Number(buff.multiplierValue).toFixed(3)} ACTIVE
          </span>
        )}
      </>
    );
  } else {
    sideContent = buff ? (
      <>
        <span className="evt-card-side-num">×{Number(buff.multiplierValue).toFixed(3)}</span>
        <span className="evt-card-side-lbl">SYSTEM BUFF</span>
        <span className="evt-card-side-buff">ACTIVE</span>
      </>
    ) : (
      <>
        <span className="evt-card-side-num evt-card-side-num--dim">—</span>
        <span className="evt-card-side-lbl">DORMANT</span>
        <span className="evt-card-side-buff evt-card-side-buff--dim">NOT YET FIRED</span>
      </>
    );
  }

  // Meta pills for context — what kind of event, how generous it is.
  const metaPills = [];
  if (customEvent.type === 'habit') {
    metaPills.push(`UP TO +${customEvent.maxBonusPct || 10}%`);
  } else if (customEvent.type === 'quantity') {
    metaPills.push(`UP TO +${customEvent.maxBonusPct || 8}%`);
    metaPills.push(`TARGET ${customEvent.dailyTarget || 1}`);
  } else {
    if (customEvent.specialKind === SPECIAL_KIND.wake_time) metaPills.push('UP TO +15%');
    else if (customEvent.specialKind === SPECIAL_KIND.first_match) metaPills.push('UP TO +12%');
    else metaPills.push('FLAT +5%');
  }

  return (
    <button className="evt-card" onClick={onClick} style={accentVarsFor(customEvent)}>
      <div className="evt-card-banner" style={bannerStyle(customEvent, customEvent.type)}>
        {!customEvent.bannerImageUrl && !customEvent.bannerColor && (
          <span className="evt-card-banner-empty">{TYPE_LABEL[customEvent.type] || ''}</span>
        )}
        <div className="evt-card-banner-tint" />
        <span className={`evt-type-badge evt-type-${customEvent.type}`}>
          {TYPE_LABEL[customEvent.type] || ''}
        </span>
      </div>
      <div className="evt-card-body">
        <span className="evt-card-name">{customEvent.name}</span>
        {customEvent.description && (
          <p className="evt-card-desc">{customEvent.description}</p>
        )}
        <div className="evt-card-meta">
          {metaPills.map((p) => <span key={p} className="evt-card-meta-pill">{p}</span>)}
        </div>
      </div>
      <div className="evt-card-side">{sideContent}</div>
    </button>
  );
}

/* ════════════════════════════════════════════════════════════════════
   Detail view (themed by the event's banner + accent)
   ════════════════════════════════════════════════════════════════════ */
function DetailView(props) {
  const { customEvent } = props;
  if (customEvent.type === 'habit') return <HabitDetail {...props} />;
  if (customEvent.type === 'quantity') return <QuantityDetail {...props} />;
  if (customEvent.type === 'special') {
    if (customEvent.specialKind === SPECIAL_KIND.entertainment) return <HabitDetail {...props} entertainmentMode />;
    return <SpecialTimingDetail {...props} />;
  }
  return null;
}

function DetailHeader({ customEvent, onBack, onEdit, openStyle }) {
  const isSpecial = customEvent.type === 'special';
  return (
    <>
      <div className="evt-detail-back-bar">
        <button className="evt-back-btn" onClick={onBack}>← EVENTS</button>
        <div className="evt-detail-back-actions">
          <button className="evt-pill-btn" onClick={openStyle}>STYLE</button>
          {!isSpecial && <button className="evt-pill-btn" onClick={onEdit}>EDIT</button>}
        </div>
      </div>
      <div className="evt-detail-hero" style={bannerStyle(customEvent, customEvent.type)}>
        <div className="evt-detail-hero-tint" />
        <div className="evt-detail-hero-content">
          <div className="evt-detail-hero-eyebrow">
            <span className={`evt-type-badge evt-type-${customEvent.type}`}>
              {TYPE_LABEL[customEvent.type] || ''}
            </span>
            {isSpecial && <span>SYSTEM EVENT · NON-EDITABLE</span>}
          </div>
          <h1 className="evt-detail-hero-name">{customEvent.name}</h1>
          {customEvent.description && (
            <p className="evt-detail-hero-desc">{customEvent.description}</p>
          )}
        </div>
      </div>
    </>
  );
}

/* ── Profile leaderboard / contribution panels ──────────────── */
function ProfileLeaderboard({ title, subtitle, entries, currentPlayerUUID, valueFormatter }) {
  const top = entries.slice(0, 10);
  const selfIdx = entries.findIndex((e) => e.player.UUID === currentPlayerUUID);
  const showSelf = selfIdx >= 10;

  return (
    <div className="evt-leader">
      <div className="evt-leader-head">
        <div className="evt-leader-title">{title}</div>
        {subtitle && <div className="evt-leader-sub">{subtitle}</div>}
      </div>
      {entries.length === 0 ? (
        <div className="evt-leader-empty">No profile data yet.</div>
      ) : (
        <div className="evt-leader-list">
          {top.map((entry, idx) => (
            <LeaderRow
              key={entry.player.UUID}
              rank={idx + 1}
              entry={entry}
              self={entry.player.UUID === currentPlayerUUID}
              valueFormatter={valueFormatter}
            />
          ))}
          {showSelf && (
            <>
              <div className="evt-leader-gap">···</div>
              <LeaderRow
                rank={selfIdx + 1}
                entry={entries[selfIdx]}
                self
                valueFormatter={valueFormatter}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function LeaderRow({ rank, entry, self, valueFormatter }) {
  const { player, total } = entry;
  return (
    <div className={`evt-leader-row ${self ? 'evt-leader-row--self' : ''}`}>
      <span className="evt-leader-rank">{String(rank).padStart(2, '0')}</span>
      <ProfilePicture src={player.profilePicture} username={player.username} size={28} />
      <span className="evt-leader-name">{player.username || '—'}</span>
      <span className="evt-leader-val">{valueFormatter(total)}</span>
    </div>
  );
}

function ContributionPanel({ entries, currentPlayerUUID, valueFormatter }) {
  if (!entries.length) return null;
  const max = Math.max(1, ...entries.map((e) => e.total));
  return (
    <div className="evt-contrib">
      {entries.map((entry) => {
        const self = entry.player.UUID === currentPlayerUUID;
        const pct = (entry.total / max) * 100;
        return (
          <div key={entry.player.UUID} className={`evt-contrib-row ${self ? 'evt-contrib-row--self' : ''}`}>
            <ProfilePicture src={entry.player.profilePicture} username={entry.player.username} size={28} />
            <div className="evt-contrib-name-wrap">
              <span className="evt-contrib-name">{entry.player.username || '—'}{self && ' · YOU'}</span>
              <div className="evt-contrib-bar"><div className="evt-contrib-bar-fill" style={{ width: `${pct}%` }} /></div>
            </div>
            <span className="evt-contrib-val">{valueFormatter(entry.total)}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   Habit detail (also entertainment in inverted/read-only mode)
   ════════════════════════════════════════════════════════════════════ */
function HabitDetail({
  customEvent, logs, todayKey, databaseConnection, currentPlayer, playersByUUID, allPlayers,
  onBack, onEdit, onAfterAction, openStyle, entertainmentMode = false,
}) {
  const checkedInToday = logs.some((l) => getLogDateKey(l) === todayKey && l.status === 'success');
  const streak = computeHabitStreakFromLogs(logs, todayKey);
  const maxBonusPct = entertainmentMode ? 5 : (customEvent.maxBonusPct || 10);

  const currentMultiplier = entertainmentMode
    ? (checkedInToday ? computeEntertainmentMultiplier() : 1)
    : computeHabitMultiplier(streak, maxBonusPct);
  const targetMultiplier = entertainmentMode
    ? computeEntertainmentMultiplier()
    : computeHabitMultiplier(HABIT_STREAK_CAP_DAYS, maxBonusPct);

  const handleCheckIn = async () => {
    if (entertainmentMode || checkedInToday) return;
    await checkInHabit(databaseConnection, currentPlayer, customEvent);
    onAfterAction();
  };

  // Timeline: 30 days going backward from today, latest on the right.
  const timelineDays = useMemo(() => {
    const out = [];
    const successByDate = new Set(
      logs.filter((l) => l.status === 'success').map(getLogDateKey).filter(Boolean)
    );
    const failureByDate = new Set(
      logs.filter((l) => l.status === 'failure').map(getLogDateKey).filter(Boolean)
    );
    const earliestSuccessKey = customEvent.createdAt ? getDateKey(new Date(customEvent.createdAt)) : null;

    for (let i = 29; i >= 0; i -= 1) {
      const key = shiftDateKey(todayKey, -i);
      let state;
      if (key === todayKey) {
        state = successByDate.has(key) ? 'today-done' : 'today';
      } else if (successByDate.has(key)) {
        state = 'success';
      } else if (failureByDate.has(key)) {
        state = 'failure';
      } else if (earliestSuccessKey && key < earliestSuccessKey) {
        state = 'future'; // before event existed
      } else {
        state = 'failure';
      }
      out.push({ key, state });
    }
    return out;
  }, [logs, todayKey, customEvent.createdAt]);

  // Profile cross-comparison: for habits, "total successful days logged" by profile.
  const profileEntries = useMemo(() => {
    const counts = {};
    for (const l of logs) {
      if (l.status !== 'success') continue;
      counts[l.parent] = (counts[l.parent] || 0) + 1;
    }
    return allPlayers
      .map((p) => ({ player: p, total: counts[p.UUID] || 0 }))
      .filter((e) => e.total > 0 || e.player.UUID === currentPlayer?.UUID)
      .sort((a, b) => b.total - a.total);
  }, [logs, allPlayers, currentPlayer]);

  return (
    <div className="evt-page evt-detail" style={accentVarsFor(customEvent)}>
      <DetailHeader customEvent={customEvent} onBack={onBack} onEdit={onEdit} openStyle={openStyle} />

      <div className="evt-detail-body evt-detail-body--split">
        <div className="evt-detail-col">

          <section className="evt-detail-stats">
            <div className="evt-stat-block">
              <span className="evt-stat-num">{streak}</span>
              <span className="evt-stat-lbl">{entertainmentMode ? 'CLEAN STREAK' : 'DAY STREAK'}</span>
            </div>
            <div className="evt-stat-block">
              <span className="evt-stat-num">×{currentMultiplier.toFixed(3)}</span>
              <span className="evt-stat-lbl">CURRENT BUFF</span>
            </div>
            <div className="evt-stat-block">
              <span className="evt-stat-num evt-stat-num--dim">×{targetMultiplier.toFixed(3)}</span>
              <span className="evt-stat-lbl">AT FULL ({entertainmentMode ? 'ANY DAY' : `${HABIT_STREAK_CAP_DAYS}D`})</span>
            </div>
          </section>

          {!entertainmentMode && (
            <button
              className={`evt-action-btn ${checkedInToday ? 'evt-action-btn--done' : ''}`}
              disabled={checkedInToday}
              onClick={handleCheckIn}
            >
              {checkedInToday ? '✓ CHECKED IN TODAY' : 'CHECK IN'}
            </button>
          )}

          {entertainmentMode && (
            <p className="evt-detail-note">
              Fires automatically when you tap END WORK DAY without consuming anything from
              the Entertainment shop category. Stay disciplined — the buff lands the moment
              your work block closes.
            </p>
          )}

          <section className="evt-section">
            <h3 className="evt-section-title">TIMELINE · LAST 30 DAYS</h3>
            <div className="evt-timeline">
              {timelineDays.map(({ key, state }) => (
                <span
                  key={key}
                  className={`evt-tl-cell evt-tl-cell--${state}`}
                  title={`${key} · ${
                    state === 'success' || state === 'today-done' ? 'Completed'
                    : state === 'today' ? 'Today (pending)'
                    : state === 'future' ? '—' : 'Missed'
                  }`}
                />
              ))}
            </div>
          </section>

          <section className="evt-section">
            <h3 className="evt-section-title">HISTORY</h3>
            <ul className="evt-history">
              {logs.length === 0 && <li className="evt-history-empty">No history yet.</li>}
              {logs
                .slice()
                .sort((a, b) => String(b.loggedAt || '').localeCompare(String(a.loggedAt || '')))
                .slice(0, 60)
                .map((l) => {
                  const profile = playersByUUID[l.parent];
                  return (
                    <li key={l.UUID} className={`evt-history-row evt-history-row--${l.status}`}>
                      <span className="evt-history-day">{getLogDateKey(l) || '—'}</span>
                      <span className="evt-history-pp">
                        <ProfilePicture src={profile?.profilePicture} username={profile?.username || '?'} size={20} />
                      </span>
                      <span className="evt-history-status">
                        {l.status === 'success' ? '✓' : '✕'} {profile?.username || 'unknown'}
                      </span>
                      <span className="evt-history-meta">
                        {l.loggedAt
                          ? new Date(l.loggedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                          : '—'}
                      </span>
                    </li>
                  );
                })}
            </ul>
          </section>
        </div>

        <aside className="evt-detail-col">
          <ProfileLeaderboard
            title="PROFILE LEADERBOARD"
            subtitle="Successful days logged by each profile"
            entries={profileEntries}
            currentPlayerUUID={currentPlayer?.UUID}
            valueFormatter={(t) => `${t} day${t === 1 ? '' : 's'}`}
          />

          <section className="evt-section">
            <h3 className="evt-section-title">CONTRIBUTIONS</h3>
            <ContributionPanel
              entries={profileEntries}
              currentPlayerUUID={currentPlayer?.UUID}
              valueFormatter={(t) => `${t}d`}
            />
          </section>
        </aside>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   Quantity detail (always two-column with leaderboard)
   ════════════════════════════════════════════════════════════════════ */
function QuantityDetail({
  customEvent, logs, todayKey, databaseConnection, currentPlayer, playersByUUID, allPlayers,
  onBack, onEdit, onAfterAction, openStyle,
}) {
  const [logCount, setLogCount] = useState(1);

  const todayTotal = useMemo(
    () => logs.filter((l) => getLogDateKey(l) === todayKey && l.status === 'success')
                .reduce((acc, l) => acc + (Number(l.value) || 0), 0),
    [logs, todayKey]
  );

  const currentMultiplier = computeQuantityMultiplier(todayTotal, customEvent.dailyTarget, customEvent.maxBonusPct);
  const targetMultiplier  = computeQuantityMultiplier(customEvent.dailyTarget || 1, customEvent.dailyTarget, customEvent.maxBonusPct);

  const handleLog = async () => {
    const safe = Math.max(1, Math.floor(Number(logCount) || 1));
    await logQuantity(databaseConnection, currentPlayer, customEvent, safe);
    onAfterAction();
  };

  const historyByDay = useMemo(() => {
    const map = {};
    for (const l of logs) {
      if (l.status !== 'success') continue;
      const dk = getLogDateKey(l);
      if (!dk) continue;
      if (!map[dk]) map[dk] = { dateKey: dk, total: 0, count: 0, byProfile: {} };
      map[dk].total += Number(l.value) || 0;
      map[dk].count += 1;
      map[dk].byProfile[l.parent] = (map[dk].byProfile[l.parent] || 0) + (Number(l.value) || 0);
    }
    return Object.values(map).sort((a, b) => b.dateKey.localeCompare(a.dateKey));
  }, [logs]);

  // Cross-profile leaderboard: total of this metric across all time, by profile.
  const profileEntries = useMemo(() => {
    const totals = {};
    for (const l of logs) {
      if (l.status !== 'success') continue;
      totals[l.parent] = (totals[l.parent] || 0) + (Number(l.value) || 0);
    }
    return allPlayers
      .map((p) => ({ player: p, total: totals[p.UUID] || 0 }))
      .filter((e) => e.total > 0 || e.player.UUID === currentPlayer?.UUID)
      .sort((a, b) => b.total - a.total);
  }, [logs, allPlayers, currentPlayer]);

  const unit = customEvent.quantityUnit || 'units';

  return (
    <div className="evt-page evt-detail" style={accentVarsFor(customEvent)}>
      <DetailHeader customEvent={customEvent} onBack={onBack} onEdit={onEdit} openStyle={openStyle} />

      <div className="evt-detail-body evt-detail-body--split">
        <div className="evt-detail-col">
          <section className="evt-detail-stats">
            <div className="evt-stat-block">
              <span className="evt-stat-num">
                {todayTotal}<span className="evt-stat-num-of">/{customEvent.dailyTarget || 1}</span>
              </span>
              <span className="evt-stat-lbl">{unit.toUpperCase()} TODAY</span>
            </div>
            <div className="evt-stat-block">
              <span className="evt-stat-num">×{currentMultiplier.toFixed(3)}</span>
              <span className="evt-stat-lbl">CURRENT BUFF</span>
            </div>
            <div className="evt-stat-block">
              <span className="evt-stat-num evt-stat-num--dim">×{targetMultiplier.toFixed(3)}</span>
              <span className="evt-stat-lbl">AT TARGET</span>
            </div>
          </section>

          <div className="evt-quant-log">
            <div className="evt-quant-log-row">
              <input
                type="number"
                min={1}
                max={9999}
                value={logCount}
                onChange={(e) => setLogCount(e.target.value)}
                className="evt-quant-input"
              />
              <button className="evt-action-btn" onClick={handleLog}>
                LOG +{Math.max(1, Math.floor(Number(logCount) || 1))}
              </button>
            </div>
            <p className="evt-banner-hint">
              Resets each calendar day. Logging beyond the daily target doesn't increase the buff.
            </p>
          </div>

          <section className="evt-section">
            <h3 className="evt-section-title">HISTORY · BY DAY</h3>
            <ul className="evt-history">
              {historyByDay.length === 0 && <li className="evt-history-empty">No history yet.</li>}
              {historyByDay.slice(0, 60).map((row) => {
                // Pick the dominant profile contributor for this day to display.
                const dominantUUID = Object.keys(row.byProfile)
                  .sort((a, b) => row.byProfile[b] - row.byProfile[a])[0];
                const dominant = playersByUUID[dominantUUID];
                return (
                  <li key={row.dateKey} className="evt-history-row">
                    <span className="evt-history-day">{row.dateKey}</span>
                    <span className="evt-history-pp">
                      <ProfilePicture src={dominant?.profilePicture} username={dominant?.username || '?'} size={20} />
                    </span>
                    <span className="evt-history-status">
                      {row.total} {unit}
                    </span>
                    <span className="evt-history-meta">
                      {row.count} log{row.count === 1 ? '' : 's'}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>

        <aside className="evt-detail-col">
          <ProfileLeaderboard
            title="ALL-TIME LEADERBOARD"
            subtitle={`Total ${unit} logged across all time`}
            entries={profileEntries}
            currentPlayerUUID={currentPlayer?.UUID}
            valueFormatter={(t) => t.toLocaleString()}
          />

          <section className="evt-section">
            <h3 className="evt-section-title">CONTRIBUTIONS</h3>
            <ContributionPanel
              entries={profileEntries}
              currentPlayerUUID={currentPlayer?.UUID}
              valueFormatter={(t) => t.toLocaleString()}
            />
          </section>
        </aside>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   Special timing detail (wake_time / first_match)
   ════════════════════════════════════════════════════════════════════ */
function SpecialTimingDetail({
  customEvent, logs, todayKey, currentPlayer, playersByUUID, allPlayers,
  onBack, onEdit, openStyle,
}) {
  const isWakeTime = customEvent.specialKind === SPECIAL_KIND.wake_time;
  const computeMult = isWakeTime ? computeWakeTimeMultiplier : computeFirstMatchMultiplier;

  const todayLog = logs.find((l) => getLogDateKey(l) === todayKey && l.status === 'success' && l.parent === currentPlayer?.UUID)
                 || logs.find((l) => getLogDateKey(l) === todayKey && l.status === 'success');
  const todayMultiplier = todayLog ? computeMult(todayLog.value || 0) : 1;
  const ceilingMultiplier = computeMult(0);

  // Leaderboard: best (lowest) delta per profile across all time.
  const profileEntries = useMemo(() => {
    const bestByPlayer = {};
    for (const l of logs) {
      if (l.status !== 'success') continue;
      const delta = Number(l.value) || 0;
      if (bestByPlayer[l.parent] == null || delta < bestByPlayer[l.parent]) {
        bestByPlayer[l.parent] = delta;
      }
    }
    return allPlayers
      .map((p) => ({ player: p, total: bestByPlayer[p.UUID] }))
      .filter((entry) => entry.total != null)
      .sort((a, b) => a.total - b.total);
  }, [logs, allPlayers]);

  return (
    <div className="evt-page evt-detail" style={accentVarsFor(customEvent)}>
      <DetailHeader customEvent={customEvent} onBack={onBack} onEdit={onEdit} openStyle={openStyle} />

      <div className="evt-detail-body evt-detail-body--split">
        <div className="evt-detail-col">
          <section className="evt-detail-stats">
            <div className="evt-stat-block">
              <span className="evt-stat-num">{todayLog ? formatMs(todayLog.value || 0) : '—'}</span>
              <span className="evt-stat-lbl">{isWakeTime ? "TODAY'S DELTA" : 'TIME TO MATCH'}</span>
            </div>
            <div className="evt-stat-block">
              <span className="evt-stat-num">×{todayMultiplier.toFixed(3)}</span>
              <span className="evt-stat-lbl">{todayLog ? 'BUFF EARNED' : 'NOT YET FIRED'}</span>
            </div>
            <div className="evt-stat-block">
              <span className="evt-stat-num evt-stat-num--dim">×{ceilingMultiplier.toFixed(3)}</span>
              <span className="evt-stat-lbl">CEILING</span>
            </div>
          </section>

          <p className="evt-detail-note">
            {isWakeTime
              ? 'Fires when you confirm ENTER DAY in the morning. The closer to your set wake time, the larger the buff. Decay halves every 30 minutes.'
              : 'Fires the first time you start a match each day. Decay halves every 2 hours after waking — start strong to lock in the largest buff.'}
          </p>

          <section className="evt-section">
            <h3 className="evt-section-title">HISTORY · BY DAY</h3>
            <ul className="evt-history">
              {logs.length === 0 && <li className="evt-history-empty">No history yet.</li>}
              {logs
                .slice()
                .sort((a, b) => String(b.loggedAt || '').localeCompare(String(a.loggedAt || '')))
                .slice(0, 60)
                .map((l) => {
                  const profile = playersByUUID[l.parent];
                  return (
                    <li key={l.UUID} className="evt-history-row">
                      <span className="evt-history-day">{getLogDateKey(l) || '—'}</span>
                      <span className="evt-history-pp">
                        <ProfilePicture src={profile?.profilePicture} username={profile?.username || '?'} size={20} />
                      </span>
                      <span className="evt-history-status">{formatMs(l.value || 0)}</span>
                      <span className="evt-history-meta evt-history-meta--mult">
                        ×{computeMult(l.value || 0).toFixed(3)}
                      </span>
                    </li>
                  );
                })}
            </ul>
          </section>
        </div>

        <aside className="evt-detail-col">
          <ProfileLeaderboard
            title="LEADERBOARD"
            subtitle={isWakeTime ? 'Closest to wake target (best delta)' : 'Fastest first match after waking'}
            entries={profileEntries}
            currentPlayerUUID={currentPlayer?.UUID}
            valueFormatter={(t) => formatMs(t)}
          />
        </aside>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   Banner uploader  (data-URL based, like profile pictures)
   ════════════════════════════════════════════════════════════════════ */
function BannerUploader({ value, onChange }) {
  const inputId = useMemo(() => `evt-banner-${uuid().slice(0, 8)}`, []);

  const handleFile = (file) => {
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) {
      alert('Banner image must be under 4MB. Try compressing or resizing it first.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => onChange(String(reader.result));
    reader.onerror = () => alert('Could not read image file.');
    reader.readAsDataURL(file);
  };

  const previewStyle = value
    ? { backgroundImage: `url(${value})` }
    : {};

  return (
    <div className="evt-banner-upload">
      <div className="evt-banner-preview" style={previewStyle}>
        {!value && <div className="evt-banner-preview-empty">NO BANNER IMAGE</div>}
      </div>
      <div className="evt-banner-controls">
        <input
          id={inputId}
          type="file"
          accept="image/*"
          className="evt-banner-file-input"
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
        <label htmlFor={inputId} className="evt-banner-file-label">
          {value ? 'REPLACE IMAGE' : 'UPLOAD IMAGE'}
        </label>
        {value && (
          <button type="button" className="evt-banner-clear" onClick={() => onChange('')}>
            CLEAR
          </button>
        )}
        <p className="evt-banner-hint">
          Stored locally as part of your customization bundle (Settings → Download Customization).
        </p>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   Form (create + edit)
   ════════════════════════════════════════════════════════════════════ */
function EventForm({ events, editingUUID, databaseConnection, currentPlayer, onCancel, onSave, onDelete }) {
  const editing = editingUUID ? events.find((e) => e.UUID === editingUUID) : null;
  const [step, setStep] = useState(editing ? 'config' : 'pick-type');
  const [type, setType] = useState(editing?.type || 'habit');
  const [name, setName] = useState(editing?.name || '');
  const [description, setDescription] = useState(editing?.description || '');
  const [maxBonusPct, setMaxBonusPct] = useState(editing?.maxBonusPct ?? (editing?.type === 'quantity' ? 8 : 12));
  const [quantityUnit, setQuantityUnit] = useState(editing?.quantityUnit || '');
  const [dailyTarget, setDailyTarget] = useState(editing?.dailyTarget || 5);
  const [bannerColor, setBannerColor] = useState(editing?.bannerColor || '');
  const [bannerImageUrl, setBannerImageUrl] = useState(editing?.bannerImageUrl || '');
  const [accentColor, setAccentColor] = useState(editing?.accentColor || '');
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const habitMin = 3, habitMax = 20;
  const quantityMin = 3, quantityMax = 15;
  const bonusMin = type === 'habit' ? habitMin : quantityMin;
  const bonusMax = type === 'habit' ? habitMax : quantityMax;

  // Clamp maxBonusPct when type changes (ranges differ).
  useEffect(() => {
    setMaxBonusPct((current) => Math.min(bonusMax, Math.max(bonusMin, Number(current) || bonusMin)));
  }, [type, bonusMin, bonusMax]);

  const valid = name.trim().length > 0 && (type !== 'quantity' || quantityUnit.trim().length > 0);

  const handleSave = async () => {
    if (!valid) return;
    const now = new Date().toISOString();
    const record = {
      UUID: editing?.UUID || uuid(),
      ownerUUID: editing?.ownerUUID || currentPlayer?.UUID || null,
      name: name.trim().slice(0, 40),
      description: description.trim().slice(0, 200),
      type,
      specialKind: editing?.specialKind || null,
      maxBonusPct: Math.max(bonusMin, Math.min(bonusMax, Number(maxBonusPct) || bonusMin)),
      quantityUnit: type === 'quantity' ? quantityUnit.trim().slice(0, 20) : null,
      dailyTarget:  type === 'quantity' ? Math.max(1, Math.floor(Number(dailyTarget) || 1)) : null,
      bannerColor:  bannerColor.trim() || null,
      bannerImageUrl: bannerImageUrl || null,
      accentColor:  accentColor.trim() || null,
      createdAt: editing?.createdAt || now,
      updatedAt: now,
    };
    await databaseConnection.add(STORES.customEvent, record);
    onSave(record.UUID);
  };

  const handleDelete = async () => {
    if (!editing || editing.type === 'special') return;
    // Cascade clean-up for the active player. Other profiles' logs remain so
    // their history is preserved if the event is re-imported via a customization
    // bundle later.
    const buffs = await databaseConnection.getActiveEventBuffsForPlayer(currentPlayer.UUID);
    for (const b of buffs.filter((bb) => bb.eventUUID === editing.UUID)) {
      // eslint-disable-next-line no-await-in-loop
      await databaseConnection.remove(STORES.eventBuff, b.UUID);
    }
    await databaseConnection.remove(STORES.customEvent, editing.UUID);
    onDelete();
  };

  if (step === 'pick-type') {
    return (
      <div className="evt-page">
        <header className="evt-header">
          <div className="evt-header-left">
            <button className="evt-back-btn" onClick={onCancel}>← EVENTS</button>
            <span className="evt-header-title">NEW EVENT</span>
          </div>
        </header>
        <div className="evt-form-pick">
          <h2 className="evt-form-title">CHOOSE EVENT TYPE</h2>
          <div className="evt-form-pick-grid">
            <button className="evt-form-pick-card" onClick={() => { setType('habit'); setStep('config'); }}>
              <span className="evt-form-pick-eyebrow">HABIT</span>
              <span className="evt-form-pick-name">Daily Check-In</span>
              <p className="evt-form-pick-desc">A binary check-in that builds streaks. The longer the streak, the larger the buff. Capped at 30 days.</p>
              <span className="evt-form-pick-range">3 – 20% MAX BONUS</span>
            </button>
            <button className="evt-form-pick-card" onClick={() => { setType('quantity'); setStep('config'); }}>
              <span className="evt-form-pick-eyebrow">QUANTITY</span>
              <span className="evt-form-pick-name">Daily Counter</span>
              <p className="evt-form-pick-desc">Log progress each day. The buff scales linearly with progress toward your daily target. Resets each day.</p>
              <span className="evt-form-pick-range">3 – 15% MAX BONUS</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="evt-page">
      <header className="evt-header">
        <div className="evt-header-left">
          <button className="evt-back-btn" onClick={onCancel}>← {editing ? editing.name : 'EVENTS'}</button>
          <span className="evt-header-title">{editing ? 'EDIT EVENT' : `NEW · ${type.toUpperCase()}`}</span>
        </div>
      </header>

      <div className="evt-form">
        <label className="evt-form-field">
          <span>NAME</span>
          <input type="text" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Morning workout" />
        </label>

        <label className="evt-form-field">
          <span>DESCRIPTION</span>
          <textarea maxLength={200} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional context (max 200 chars)" />
        </label>

        {type === 'quantity' && (
          <div className="evt-form-row">
            <label className="evt-form-field">
              <span>UNIT LABEL</span>
              <input type="text" maxLength={20} value={quantityUnit} onChange={(e) => setQuantityUnit(e.target.value)} placeholder="e.g. sessions" />
            </label>
            <label className="evt-form-field">
              <span>DAILY TARGET</span>
              <input type="number" min={1} max={9999} value={dailyTarget} onChange={(e) => setDailyTarget(e.target.value)} />
            </label>
          </div>
        )}

        <label className="evt-form-field">
          <span>MAX BONUS · {Number(maxBonusPct).toFixed(0)}%</span>
          <input
            type="range"
            min={bonusMin}
            max={bonusMax}
            step={1}
            value={maxBonusPct}
            onChange={(e) => setMaxBonusPct(e.target.value)}
            className="evt-form-slider"
          />
          <span className="evt-form-hint">
            At full {type === 'habit' ? 'streak' : 'progress'}, this event grants ×
            {(1 + Number(maxBonusPct) / 100).toFixed(3)} on every task.
          </span>
        </label>

        <fieldset className="evt-form-fieldset">
          <legend>SUBQUEST IDENTITY</legend>

          <label className="evt-form-field">
            <span>BANNER IMAGE</span>
            <BannerUploader value={bannerImageUrl} onChange={setBannerImageUrl} />
          </label>

          <div className="evt-form-row">
            <label className="evt-form-field evt-form-field--color">
              <span>BANNER COLOR</span>
              <span className="evt-form-hint">Used when no image is set.</span>
              <div className="evt-color-row">
                <input type="color" value={bannerColor || '#1a6ef5'} onChange={(e) => setBannerColor(e.target.value)} />
                <input type="text" value={bannerColor} onChange={(e) => setBannerColor(e.target.value)} placeholder="#0c1526 or any CSS color" />
              </div>
            </label>
            <label className="evt-form-field evt-form-field--color">
              <span>ACCENT COLOR</span>
              <span className="evt-form-hint">Drives multipliers, buttons, and timeline glow.</span>
              <div className="evt-color-row">
                <input type="color" value={accentColor || '#4da3ff'} onChange={(e) => setAccentColor(e.target.value)} />
                <input type="text" value={accentColor} onChange={(e) => setAccentColor(e.target.value)} placeholder="#4da3ff" />
              </div>
            </label>
          </div>
        </fieldset>

        <div className="evt-form-footer">
          {editing && editing.type !== 'special' && (
            confirmingDelete ? (
              <div className="evt-form-confirm">
                <span>Permanently delete?</span>
                <button className="danger" onClick={handleDelete}>YES, DELETE</button>
                <button onClick={() => setConfirmingDelete(false)}>CANCEL</button>
              </div>
            ) : (
              <button className="evt-form-delete" onClick={() => setConfirmingDelete(true)}>DELETE EVENT</button>
            )
          )}
          <div className="evt-form-footer-spacer" />
          <button onClick={onCancel}>CANCEL</button>
          <button className="primary" onClick={handleSave} disabled={!valid}>
            {editing ? 'SAVE CHANGES' : 'CREATE EVENT'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   Style page  (banner image / banner color / accent — applies everywhere)
   ════════════════════════════════════════════════════════════════════ */
function StylePage({ customEvent, databaseConnection, onClose }) {
  const [bannerColor, setBannerColor]       = useState(customEvent.bannerColor || '');
  const [bannerImageUrl, setBannerImageUrl] = useState(customEvent.bannerImageUrl || '');
  const [accentColor, setAccentColor]       = useState(customEvent.accentColor || '');

  const previewEvent = { ...customEvent, bannerColor, bannerImageUrl, accentColor };

  const handleSave = async () => {
    await databaseConnection.add(STORES.customEvent, {
      ...customEvent,
      bannerColor: bannerColor.trim() || null,
      bannerImageUrl: bannerImageUrl || null,
      accentColor: accentColor.trim() || null,
      updatedAt: new Date().toISOString(),
    });
    onClose();
  };

  return (
    <div className="evt-page">
      <header className="evt-header">
        <div className="evt-header-left">
          <button className="evt-back-btn" onClick={onClose}>← {customEvent.name}</button>
          <span className="evt-header-title">SUBQUEST IDENTITY</span>
        </div>
      </header>

      <div className="evt-form">
        <div className="evt-style-preview">
          <span className="evt-form-hint">PREVIEW · LIST CARD</span>
          <div className="evt-card" style={accentVarsFor(previewEvent)}>
            <div className="evt-card-banner" style={bannerStyle(previewEvent, customEvent.type)}>
              {!previewEvent.bannerImageUrl && !previewEvent.bannerColor && (
                <span className="evt-card-banner-empty">{TYPE_LABEL[customEvent.type]}</span>
              )}
              <div className="evt-card-banner-tint" />
              <span className={`evt-type-badge evt-type-${customEvent.type}`}>{TYPE_LABEL[customEvent.type]}</span>
            </div>
            <div className="evt-card-body">
              <span className="evt-card-name">{customEvent.name}</span>
              {customEvent.description && <p className="evt-card-desc">{customEvent.description}</p>}
            </div>
            <div className="evt-card-side">
              <span className="evt-card-side-num">×1.075</span>
              <span className="evt-card-side-lbl">PREVIEW</span>
            </div>
          </div>
        </div>

        <div className="evt-style-preview">
          <span className="evt-form-hint">PREVIEW · DETAIL HERO</span>
          <div className="evt-detail-hero" style={{ ...bannerStyle(previewEvent, customEvent.type), height: 160, ...accentVarsFor(previewEvent) }}>
            <div className="evt-detail-hero-tint" />
            <div className="evt-detail-hero-content" style={{ padding: '14px 18px' }}>
              <div className="evt-detail-hero-eyebrow">
                <span className={`evt-type-badge evt-type-${customEvent.type}`}>{TYPE_LABEL[customEvent.type]}</span>
              </div>
              <h1 className="evt-detail-hero-name" style={{ fontSize: 26 }}>{customEvent.name}</h1>
            </div>
          </div>
        </div>

        <fieldset className="evt-form-fieldset">
          <legend>BANNER</legend>
          <label className="evt-form-field">
            <span>IMAGE</span>
            <BannerUploader value={bannerImageUrl} onChange={setBannerImageUrl} />
          </label>
          <label className="evt-form-field evt-form-field--color">
            <span>FALLBACK COLOR</span>
            <span className="evt-form-hint">Shown when no image is set.</span>
            <div className="evt-color-row">
              <input type="color" value={bannerColor || '#1a6ef5'} onChange={(e) => setBannerColor(e.target.value)} />
              <input type="text" value={bannerColor} onChange={(e) => setBannerColor(e.target.value)} placeholder="#0c1526 or any CSS color" />
            </div>
          </label>
        </fieldset>

        <fieldset className="evt-form-fieldset">
          <legend>ACCENT</legend>
          <label className="evt-form-field evt-form-field--color">
            <span>ACCENT COLOR</span>
            <span className="evt-form-hint">Tints multipliers, buttons, leaderboards, and timeline highlights.</span>
            <div className="evt-color-row">
              <input type="color" value={accentColor || '#4da3ff'} onChange={(e) => setAccentColor(e.target.value)} />
              <input type="text" value={accentColor} onChange={(e) => setAccentColor(e.target.value)} placeholder="#4da3ff" />
            </div>
          </label>
        </fieldset>

        <div className="evt-form-footer">
          <div className="evt-form-footer-spacer" />
          <button onClick={onClose}>CANCEL</button>
          <button className="primary" onClick={handleSave}>SAVE STYLE</button>
        </div>
      </div>
    </div>
  );
}
