import './BanModal.css';
import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import { AppContext } from '../../App.jsx';
import { STORES } from '../../utils/Constants.js';

/**
 * BanModal — the reprimand tool.
 *
 * Two phases in one component:
 *   1. Description phase: lays out what qualifies for a ban and what does
 *      not. Single forward action ("I UNDERSTAND THE RISKS").
 *   2. Confirmation phase: GitHub-style typed-username confirmation. Shows
 *      a live count of timeline records that will be erased so the weight
 *      of the action is concrete, not abstract. The DELETE FOREVER button
 *      is disabled until the typed value exactly matches the username.
 *
 * On confirm: calls databaseConnection.wipeProfile(currentPlayer.UUID),
 * dismisses every other modal, and refreshes the app so the bootstrap flow
 * (App.jsx → getCurrentPlayer) handles whatever's left.
 */
export default NiceModal.create(() => {
  const { databaseConnection, currentPlayer, refreshApp } = useContext(AppContext);
  const modal = useModal();

  const [phase, setPhase]         = useState(1);   // 1 = description, 2 = confirm
  const [typed, setTyped]         = useState('');
  const [counts, setCounts]       = useState(null);
  const [busy, setBusy]           = useState(false);
  const [closing, setClosing]     = useState(false);
  const inputRef                  = useRef(null);

  // Length of the staged goodbye animation. Kept in JS so the wait
  // here matches the CSS keyframe duration in BanModal.css. If you
  // change one, change the other.
  const CLOSE_ANIM_MS = 1400;

  const username = currentPlayer?.username || '';
  const playerUUID = currentPlayer?.UUID || null;

  // Strict, case-sensitive match — this is destructive, no leniency.
  const typedMatches = useMemo(
    () => typed.length > 0 && typed === username,
    [typed, username],
  );

  // Phase 2: pull real counts so the user is staring at how much they're
  // about to delete. Best-effort — we still show the modal even if these
  // calls fail (counts just stay null and the panel collapses).
  useEffect(() => {
    if (phase !== 2 || !playerUUID || counts) return;
    let cancelled = false;
    (async () => {
      try {
        const [tasks, journals, events, todos, projects, comments, matches, transactions] = await Promise.all([
          databaseConnection.getPlayerStore(STORES.task,         playerUUID),
          databaseConnection.getPlayerStore(STORES.journal,      playerUUID),
          databaseConnection.getPlayerStore(STORES.event,        playerUUID),
          databaseConnection.getPlayerStore(STORES.todo,         playerUUID),
          databaseConnection.getPlayerStore(STORES.project,      playerUUID),
          databaseConnection.getAll(STORES.journalComment).then((all) =>
            (all || []).filter((c) => c.authorUUID === playerUUID),
          ),
          databaseConnection.getPlayerStore(STORES.match,        playerUUID),
          databaseConnection.getPlayerStore(STORES.transaction,  playerUUID),
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

  // Autofocus the typed-confirm input the moment phase 2 opens.
  useEffect(() => {
    if (phase === 2 && inputRef.current) {
      const t = setTimeout(() => inputRef.current?.focus(), 60);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [phase]);

  const close = () => {
    if (closing) return;     // never interrupt the goodbye
    modal.hide();
    modal.remove();
  };

  const handleAdvance = () => setPhase(2);

  const handleConfirm = async () => {
    if (!typedMatches || !playerUUID || busy) return;
    setBusy(true);
    setClosing(true);

    // Run the wipe in parallel with the goodbye animation so the
    // moment lands ceremonially even if the database call is fast.
    // Whichever finishes first waits for the other.
    const minDelay = new Promise((resolve) => setTimeout(resolve, CLOSE_ANIM_MS));

    try {
      await Promise.all([
        databaseConnection.wipeProfile(playerUUID),
        minDelay,
      ]);
    } catch (err) {
      console.error('[BanModal] wipeProfile failed:', err);
      setBusy(false);
      setClosing(false);
      return;
    }

    // Tear down every other open modal — task creation, end-day, etc.,
    // are all bound to a player that no longer exists.
    try { NiceModal.hideAll(); } catch { /* noop */ }
    modal.remove();
    refreshApp();
  };

  if (!modal.visible) return null;

  // ── Render ──────────────────────────────────────────────
  return (
    <div className="ban-overlay">
      <div
        className={`blanker ban-blanker${closing ? ' ban-blanker--closing' : ''}`}
        onClick={busy ? undefined : close}
      />
      <div
        className={[
          'ban-card',
          phase === 2 ? 'ban-card--final' : '',
          closing ? 'ban-card--closing' : '',
        ].filter(Boolean).join(' ')}
      >
        {/* A single thin red horizon line at the top of the card —
            the only chrome. No stripes, no banners, no scan line. */}
        <div className="ban-horizon" aria-hidden="true" />

        {/* Quiet header: a small sentence-case label, no eyebrow, no
            glyph in motion. The header exists for orientation, not
            announcement. */}
        <div className="ban-header">
          <span className="ban-header-label">
            {phase === 1 ? 'Ban profile' : 'Confirm ban'}
          </span>
        </div>

        {/* ── PHASE 1 ───────────────────────────────────── */}
        {phase === 1 && (
          <div className="ban-body">
            <h2 className="ban-headline">Ban this profile?</h2>

            <p className="ban-prose">
              The ban tool exists for a specific purpose: the rules of the app weren't followed.
              Whether by the repeated usage of shop items without equivalent exchange, or by
              knowingly breaking the immersion of the game, this option exists as a reprimand
              for such behaviors. Below describes a list of what does and does not qualify for a ban:
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
              <span className="ban-consequence-label">What happens next</span>
              <p>
                By banning a player, the player's save data and all their corresponding
                timeline data will be wiped from memory. This includes tasks, journals,
                comments, events, etc.
              </p>
            </div>

            <div className="ban-footer">
              <button className="ban-btn-secondary" onClick={close}>Return</button>
              <button className="ban-btn-advance" onClick={handleAdvance}>
                I understand
              </button>
            </div>
          </div>
        )}

        {/* ── PHASE 2 ───────────────────────────────────── */}
        {phase === 2 && (
          <div className="ban-body ban-body--final">
            <h2 className="ban-headline">Confirm permanent erasure</h2>

            <p className="ban-prose">
              The following timeline data is bound to this profile and will be deleted
              from memory. This action cannot be undone.
            </p>

            {/* Live counts of what's about to vanish. The ledger does
                most of the emotional work in this phase — it makes the
                weight concrete instead of abstract. */}
            {counts && (
              <div className="ban-ledger">
                <div className="ban-ledger-header">
                  <span className="ban-ledger-eyebrow">What will be erased</span>
                  <span className="ban-ledger-target">{username || 'agent'}</span>
                </div>
                <div className="ban-ledger-rows">
                  {[
                    ['Tasks',         counts.tasks],
                    ['Journals',      counts.journals],
                    ['Comments',      counts.comments],
                    ['Events',        counts.events],
                    ['Todos',         counts.todos],
                    ['Projects',      counts.projects],
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
              <button
                className="ban-btn-secondary"
                onClick={close}
                disabled={busy}
              >
                Return
              </button>
              <button
                className={`ban-btn-final ${typedMatches ? 'is-armed' : ''}`}
                onClick={handleConfirm}
                disabled={!typedMatches || busy}
              >
                {busy ? 'Erasing…' : 'Delete forever'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});