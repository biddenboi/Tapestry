import '@features/profile/modals/BanModal/BanModal.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import { useAppContext } from '@app/hooks/useAppContext.js';
import { STORES } from '@domain/constants.js';
import { getIgtDayNumber } from '@domain/events/Events.js';

/**
 * BanModal — the reprimand tool, now with a graduated penalty system.
 *
 * Three phases in one component:
 *   0. Penalty phase: shows the rules, the current strike ratio (X / MAX),
 *      and a "REPORT PENALTY" button. Clicking it increments strikes for the
 *      current IGT day. Strikes reset at the start of each new IGT day.
 *      When the final strike is filed, the modal locks and advances to phase 2.
 *   2. Confirmation phase: GitHub-style typed-username confirmation. Cannot be
 *      dismissed or escaped — not even by reloading. The app is blocked until
 *      the profile is deleted.
 *
 * The "locked-out" state and per-day strike counts are persisted through
 * DatabaseConnection, which writes them into the selected folder's app state.
 */

/* Left-tailed strike-threshold distribution (discrete PMF, support [1,8]).
   Mean ≈ 5.05, mode = 6, third central moment ≈ −2.3 → left-skewed.
   Centered at 5 with the mass clustering at 5–6 and a thinning tail
   toward lower values, so a ban occasionally triggers surprisingly
   early. Fresh sample per IGT day; stable within the day. */
const STRIKE_THRESHOLD_PMF = [
  [1, 0.04],
  [2, 0.07],
  [3, 0.10],
  [4, 0.14],
  [5, 0.20],
  [6, 0.22],
  [7, 0.15],
  [8, 0.08],
];

function sampleStrikeThreshold() {
  const u = Math.random();
  let cum = 0;
  for (const [value, p] of STRIKE_THRESHOLD_PMF) {
    cum += p;
    if (u < cum) return value;
  }
  // Floating-point safety net — return the last value if we somehow walk off the end.
  return STRIKE_THRESHOLD_PMF[STRIKE_THRESHOLD_PMF.length - 1][0];
}

export default NiceModal.create(({ forceFinal = false }) => {
  const { databaseConnection, currentPlayer, refreshApp } = useAppContext();
  const modal = useModal();

  const [phase, setPhase]       = useState(forceFinal ? 2 : 0);
  const [typed, setTyped]       = useState('');
  const [counts, setCounts]     = useState(null);
  const [busy, setBusy]         = useState(false);
  const [closing, setClosing]   = useState(false);
  const [strikes, setStrikes]     = useState(0);
  const [threshold, setThreshold] = useState(null);  // sampled per IGT day in readViolations
  const [reported, setReported]   = useState(false);
  const inputRef                = useRef(null);

  const CLOSE_ANIM_MS = 1400;

  const username   = currentPlayer?.username || '';
  const playerUUID = currentPlayer?.UUID || null;

  const currentIgtDay = useMemo(
    () => (currentPlayer ? getIgtDayNumber(currentPlayer) : 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentPlayer?.UUID],
  );

  // Load current strikes + per-day sampled threshold on phase 0 open.
  useEffect(() => {
    if (phase !== 0 || !playerUUID) return;
    let cancelled = false;
    const load = async () => {
      let vio = databaseConnection.getViolations(playerUUID, currentIgtDay);
      if (!Number.isInteger(vio.threshold) || vio.threshold <= 0) {
        vio = { ...vio, threshold: sampleStrikeThreshold() };
        databaseConnection.setViolations(playerUUID, vio);
      }
      if (cancelled) return;
      setStrikes(vio.strikes);
      setThreshold(vio.threshold);
    };
    load();
    return () => { cancelled = true; };
  }, [databaseConnection, phase, playerUUID, currentIgtDay]);

  // Phase 2: pull record counts
  useEffect(() => {
    if (phase !== 2 || !playerUUID || counts) return;
    let cancelled = false;
    (async () => {
      try {
        const [tasks, journals, events, todos, projects, comments, matches, transactions] = await Promise.all([
          databaseConnection.getPlayerStore(STORES.task,        playerUUID),
          databaseConnection.getPlayerStore(STORES.journal,     playerUUID),
          databaseConnection.getPlayerStore(STORES.event,       playerUUID),
          databaseConnection.getPlayerStore(STORES.todo,        playerUUID),
          databaseConnection.getPlayerStore(STORES.project,     playerUUID),
          databaseConnection.getAll(STORES.journalComment).then((all) =>
            (all || []).filter((c) => c.authorUUID === playerUUID),
          ),
          databaseConnection.getPlayerStore(STORES.match,       playerUUID),
          databaseConnection.getPlayerStore(STORES.transaction, playerUUID),
        ]);
        if (cancelled) return;
        setCounts({
          tasks:        (tasks        || []).length,
          journals:     (journals     || []).length,
          events:       (events       || []).length,
          todos:        (todos        || []).length,
          projects:     (projects     || []).length,
          comments:     (comments     || []).length,
          matches:      (matches      || []).length,
          transactions: (transactions || []).length,
        });
      } catch {
        if (!cancelled) setCounts({});
      }
    })();
    return () => { cancelled = true; };
  }, [phase, playerUUID, counts, databaseConnection]);

  // Autofocus confirm input on phase 2
  useEffect(() => {
    if (phase === 2 && inputRef.current) {
      const t = setTimeout(() => inputRef.current?.focus(), 60);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [phase]);

  const typedMatches = useMemo(
    () => typed.length > 0 && typed === username,
    [typed, username],
  );

  const isLocked = phase === 2 && (forceFinal || (playerUUID && databaseConnection.hasBanPending(playerUUID)));

  const close = () => {
    if (closing || isLocked) return;
    modal.hide();
    modal.remove();
  };

  const handleReportPenalty = async () => {
    if (!playerUUID) return;
    let vio = databaseConnection.getViolations(playerUUID, currentIgtDay);
    if (!Number.isInteger(vio.threshold) || vio.threshold <= 0) {
      vio = { ...vio, threshold: sampleStrikeThreshold() };
    }
    const newStrikes = vio.strikes + 1;
    // Preserve the sampled threshold across the write so it stays stable
    // for the rest of the IGT day — it should NOT re-roll on every report.
    databaseConnection.setViolations(playerUUID, {
      strikes:   newStrikes,
      igtDay:    currentIgtDay,
      threshold: vio.threshold,
    });
    setStrikes(newStrikes);
    setReported(true);

    if (newStrikes >= vio.threshold) {
      databaseConnection.setBanPending(playerUUID);
      setTimeout(() => setPhase(2), 520);
    }
  };

  const handleConfirm = async () => {
    if (!typedMatches || !playerUUID || busy) return;
    setBusy(true);
    setClosing(true);
    const minDelay = new Promise((resolve) => setTimeout(resolve, CLOSE_ANIM_MS));
    try {
      // Penalty deletion scrubs identity/progress, deletes match data, keeps
      // household work, and detaches journals from the deleted profile.
      // resolvePendingBan also clears the ban-pending app-state flag.
      await Promise.all([databaseConnection.resolvePendingBan(playerUUID), minDelay]);
    } catch (err) {
      console.error('[BanModal] resolvePendingBan failed:', err);
      setBusy(false);
      setClosing(false);
      return;
    }
    // Defensive — resolvePendingBan already clears this, but in case the data
    // call partially failed mid-flight, make sure the modal won't re-arm.
    databaseConnection.clearBanPending(playerUUID);
    try { NiceModal.hideAll(); } catch { /* noop */ }
    modal.remove();
    refreshApp();
  };

  if (!modal.visible) return null;

  // threshold is briefly null on first render before the load effect runs.
  // Guard so isFinalStrike doesn't trip on undefined → 0 comparisons and
  // auto-advance to phase 2 with garbage. The threshold value itself is
  // never rendered — it's only used to drive isFinalStrike.
  const isFinalStrike = threshold != null && strikes >= threshold;

  return (
    <div className="ban-overlay">
      <div
        className={`blanker ban-blanker${closing ? ' ban-blanker--closing' : ''}`}
        onClick={isLocked || busy ? undefined : close}
      />
      <div
        className={[
          'ban-card',
          phase === 2 ? 'ban-card--final' : '',
          closing ? 'ban-card--closing' : '',
        ].filter(Boolean).join(' ')}
      >
        <div className="ban-horizon" aria-hidden="true" />

        <div className="ban-header">
          <span className="ban-header-label">
            {phase === 0 ? 'Issue penalty' : 'Confirm ban'}
          </span>
        </div>

        {/* ── PHASE 0 — Penalty description + strike counter ── */}
        {phase === 0 && (
          <div className="ban-body">
            <h2 className="ban-headline">Report a violation?</h2>

            <p className="ban-prose">
              The penalty system exists for a specific purpose: the rules of the app weren't followed.
              Whether by the repeated usage of shop items without equivalent exchange, or by
              knowingly breaking the immersion of the game, this option exists as a reprimand
              for such behaviors. Below describes a list of what does and does not qualify:
            </p>

            <ul className="ban-rules">
              <li>
                <span className="ban-rule-marker" aria-hidden="true">•</span>
                <span>Using shop items without payment repeatedly and not by mistake.</span>
              </li>
              <li>
                <span className="ban-rule-marker" aria-hidden="true">•</span>
                <span>Editing the save data manually to benefit the current profile.</span>
              </li>
              <li>
                <span className="ban-rule-marker" aria-hidden="true">•</span>
                <span>"Farming" points or otherwise misrepresenting actual workload intentionally.</span>
              </li>
            </ul>

            <p className="ban-prose ban-prose--note">
              Note this does not apply to brief lapses in judgement or "forgetting". The usual
              cases this applies to is the recognition of a behavior that qualifies in the above
              categories and the deliberate choice to continue in such negative behaviors.
            </p>

            <div className="ban-consequence">
              <span className="ban-consequence-label">What happens at the limit</span>
              <p>
                Once the penalty limit is reached, this profile's identity, cosmetics,
                match history, and progress will be removed. Tasks, Goals, Habits,
                reminders, and journal content remain household data.
              </p>
            </div>

            {/* Strike counter — current count only. The threshold is intentionally
                hidden so the player can't compute how many penalties remain. */}
            <div className={`ban-strike-counter${isFinalStrike ? ' ban-strike-counter--max' : reported ? ' ban-strike-counter--hit' : ''}`}>
              <span className="ban-strike-label">Strikes this IGT day</span>
              <div className="ban-strike-ratio">
                <span className="ban-strike-current">{strikes}</span>
              </div>
              {isFinalStrike && (
                <span className="ban-strike-remaining ban-strike-remaining--max">
                  Limit reached — advancing to ban
                </span>
              )}
            </div>

            <div className="ban-footer">
              {!isFinalStrike && (
                <button className="ban-btn-secondary" onClick={close}>Return</button>
              )}
              <button
                className={`ban-btn-advance ban-btn-penalty${isFinalStrike ? ' is-disabled' : ''}`}
                onClick={isFinalStrike ? undefined : handleReportPenalty}
                disabled={isFinalStrike}
              >
                Report penalty
              </button>
            </div>
          </div>
        )}

        {/* ── PHASE 2 — Locked username confirmation ───────── */}
        {phase === 2 && (
          <div className="ban-body ban-body--final">
            <h2 className="ban-headline">Confirm profile reset</h2>

            {isLocked && (
              <div className="ban-lockout-notice">
                <span className="ban-lockout-glyph" aria-hidden="true">⊗</span>
                <span>
                  The penalty limit has been reached. This profile must be deleted
                  before the app can be used again.
                </span>
              </div>
            )}

            <p className="ban-prose">
              Profile-bound progress and match data will be deleted. Journal entries will
              become unlinked; household tasks, Goals, Habits, and reminders are retained.
            </p>

            {counts && (
              <div className="ban-ledger">
                <div className="ban-ledger-header">
                  <span className="ban-ledger-eyebrow">What will be erased</span>
                  <span className="ban-ledger-target">{username || 'agent'}</span>
                </div>
                <div className="ban-ledger-rows">
                  {[
                    ['Task progress', counts.tasks],
                    ['Journals unlinked', counts.journals],
                    ['Comments',      counts.comments],
                    ['Habit progress', counts.events],
                    ['Todos retained', counts.todos],
                    ['Goals retained', counts.projects],
                    ['Matches',       counts.matches],
                    ['Transactions',  counts.transactions],
                  ].filter(([, n]) => n > 0).map(([label, n]) => (
                    <div className="ban-ledger-row" key={label}>
                      <span className="ban-ledger-label">{label}</span>
                      <span className="ban-ledger-dots" aria-hidden="true" />
                      <span className="ban-ledger-count">{n.toLocaleString()}</span>
                    </div>
                  ))}
                  {Object.values(counts).every((n) => !n) && (
                    <div className="ban-ledger-row ban-ledger-row--empty">
                      <span>No timeline records found. The profile itself will still be erased.</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="ban-confirm-block">
              <label className="ban-confirm-label" htmlFor="ban-confirm-input">
                If you understand the risks/consequences, type the current player
                username below:
              </label>
              <div className="ban-username-display" aria-hidden="true">
                <span className="ban-username-text">{username}</span>
              </div>
              <input
                ref={inputRef}
                id="ban-confirm-input"
                className={`ban-confirm-input ${typedMatches ? 'is-match' : ''}`}
                type="text"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder="Type username to confirm…"
                autoComplete="off"
                spellCheck="false"
                disabled={busy}
              />
            </div>

            <div className="ban-footer">
              {!isLocked && (
                <button className="ban-btn-secondary" onClick={close} disabled={busy}>
                  Return
                </button>
              )}
              <button
                className={`ban-btn-final ${typedMatches ? 'is-armed' : ''}`}
                onClick={handleConfirm}
                disabled={!typedMatches || busy}
              >
                {busy ? 'Resetting…' : 'Delete profile data'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});
