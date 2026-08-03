import { useEffect, useState, useCallback } from 'react';
import { v4 as uuid } from 'uuid';
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import { useAppContext } from '@app/hooks/useAppContext.js';
import { STORES } from '@domain/constants.js';
import ProfilePicture from '@shared/profile-picture/ProfilePicture.jsx';
import { getCurrentIGT, formatInGameTime } from '@domain/time/Time.js';
import { getPlayerRankPresentation } from '@domain/rank/Rank.js';
import {
  getDailyLifecycleAppLaunchId,
  prepareProfileHandoff,
  requireDailyLifecycleWake,
  setDurableEndOfDayState,
} from '@domain/events/DailyLifecycleService.js';
import { publishActiveProfileReference } from '@data/sync/MobileReferenceSync.js';
import '@features/profile/modals/ProfileSwitcher/ProfileSwitcher.css';

/* ── Inline new-profile form ────────────────────────────── */
function NewProfileForm({ onCancel, onCreate }) {
  const [username, setUsername] = useState('');

  const handleCreate = () => {
    const name = username.trim();
    if (!name) return;
    onCreate({ username: name });
  };

  return (
    <div className="ps-new-form">
      <div className="ps-new-form-header">CREATE NEW PROFILE</div>
      <input
        className="ps-new-input"
        placeholder="Username"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        maxLength={32}
        autoFocus
      />
      <div className="ps-new-form-actions">
        <button className="ps-btn-secondary" onClick={onCancel}>CANCEL</button>
        <button className="ps-btn-primary" onClick={handleCreate} disabled={!username.trim()}>
          CREATE →
        </button>
      </div>
    </div>
  );
}

/* ── Single profile contact card ────────────────────────── */
function ProfileCard({ player, isActive, onClick, onArchive, archiveDisabled = false }) {
  const rankPresentation = getPlayerRankPresentation(player);
  const igt = getCurrentIGT(player);
  const isArchived = !!player.archivedAt;

  return (
    <div className={`ps-profile-row ${isArchived ? 'ps-profile-row--archived' : ''}`}>
      <button
        type="button"
        className={`ps-profile-card ${isActive ? 'ps-profile-card--active' : ''}`}
        onClick={onClick}
        disabled={isArchived}
      >
        <ProfilePicture src={player.profilePicture} username={player.username || '?'} size={44} />
        <div className="ps-profile-card-info">
          <div className="ps-profile-card-name-row">
            <span className="ps-profile-card-name">{player.username || 'Unknown'}</span>
            {isArchived && <span className="ps-archived-tag">Archived</span>}
          </div>
          <div className="ps-profile-card-meta">
            <span className={`ps-profile-card-rank rank-${rankPresentation.rankClass}`}>
              {rankPresentation.rankLabel}
            </span>
            <span className="ps-profile-card-igt">{formatInGameTime(igt)}</span>
          </div>
        </div>
        {isActive && !isArchived && <div className="ps-profile-card-check">✓</div>}
      </button>
      <button
        type="button"
        className="ps-profile-archive"
        onClick={() => onArchive(player)}
        disabled={archiveDisabled}
        aria-label={`${isArchived ? 'Restore' : 'Archive'} ${player.username || 'profile'}`}
        title={isArchived ? 'Restore profile' : 'Archive profile'}
      >
        {isArchived ? 'RESTORE' : 'ARCHIVE'}
      </button>
    </div>
  );
}

/* ── Main modal ─────────────────────────────────────────── */
export default NiceModal.create(({
  eodDateStr = '',
  mode = 'handoff',
  lifecycleFlowId = '',
}) => {
  const { databaseConnection, currentPlayer, refreshApp } = useAppContext();
  const modal = useModal();
  const [allPlayers, setAllPlayers] = useState([]);
  const [search, setSearch] = useState('');
  const [showNewForm, setShowNewForm] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [archivingUUID, setArchivingUUID] = useState(null);

  const loadPlayers = useCallback(async () => {
    const viewerIGT = currentPlayer ? getCurrentIGT(currentPlayer) : Infinity;
    const players = databaseConnection.getPlayersAtIGT
      ? await databaseConnection.getPlayersAtIGT(viewerIGT, { includeArchived: true })
      : await databaseConnection.getAllPlayers({ includeArchived: true });
    setAllPlayers(players);
  }, [currentPlayer, databaseConnection]);

  useEffect(() => { loadPlayers(); }, [loadPlayers]);

  /** Persist that the user has made their end-of-day choice. */
  const markChosen = useCallback(async () => {
    if (currentPlayer?.UUID && eodDateStr) {
      await setDurableEndOfDayState(
        databaseConnection,
        currentPlayer.UUID,
        eodDateStr,
        'chosen',
      );
    }
  }, [currentPlayer, databaseConnection, eodDateStr]);

  const isStartup = mode === 'startup' || !currentPlayer?.UUID;
  const displayedCurrent = allPlayers.find((player) => player.UUID === currentPlayer?.UUID)
    || currentPlayer;
  const otherPlayers = allPlayers.filter((p) => p.UUID !== currentPlayer?.UUID);
  const filteredPlayers = search.trim()
    ? otherPlayers.filter((p) =>
        (p.username || '').toLowerCase().includes(search.toLowerCase())
      )
    : otherPlayers;

  const finishHandoff = () => {
    // GameHub is the sole day-boundary router. Refreshing here lets it decide
    // whether this is a same-day sleep or a genuine new calendar day.
    refreshApp();
  };

  const flushBoundaryWrites = async () => {
    await databaseConnection.flushWrites();
    const transport = databaseConnection.syncRuntime?.transport;
    if (transport) {
      await publishActiveProfileReference(databaseConnection, transport)
        .catch(() => databaseConnection.syncRuntime?.scheduleSync?.('profile-boundary-selection'));
    }
    databaseConnection.syncRuntime?.scheduleSync?.('profile-boundary-selection');
  };

  const markWakeRequired = async (selectedPlayerUUID) => {
    if (!lifecycleFlowId || !selectedPlayerUUID) return;
    await requireDailyLifecycleWake(databaseConnection, {
      flowId: lifecycleFlowId,
      selectedPlayerUUID,
      selectionLaunchId: getDailyLifecycleAppLaunchId(),
    });
  };

  const handleContinue = async () => {
    if (displayedCurrent?.archivedAt) return;
    if (displayedCurrent?.UUID) {
      await databaseConnection.switchProfile(displayedCurrent, displayedCurrent.UUID);
      await prepareProfileHandoff(databaseConnection, displayedCurrent.UUID, displayedCurrent.UUID);
    }
    await markChosen();
    await markWakeRequired(displayedCurrent?.UUID);
    await flushBoundaryWrites();
    modal.remove();
    finishHandoff();
  };

  const handleArchive = async (targetPlayer) => {
    if (!targetPlayer?.UUID || archivingUUID) return;
    setArchivingUUID(targetPlayer.UUID);
    try {
      const updated = {
        ...targetPlayer,
        archivedAt: targetPlayer.archivedAt ? null : new Date().toISOString(),
      };
      await databaseConnection.add(STORES.player, updated);
      setAllPlayers((players) => players.map((player) => (
        player.UUID === updated.UUID ? updated : player
      )));
      await flushBoundaryWrites();
    } finally {
      setArchivingUUID(null);
    }
  };

  const handleSwitch = async (targetPlayer) => {
    if (switching) return;
    setSwitching(true);
    try {
      const sourceUUID = currentPlayer?.UUID;
      await markChosen();
      await databaseConnection.switchProfile(currentPlayer, targetPlayer.UUID);
      if (sourceUUID) {
        await prepareProfileHandoff(databaseConnection, sourceUUID, targetPlayer.UUID);
      }
      await markWakeRequired(targetPlayer.UUID);
      await flushBoundaryWrites();
      modal.remove();
      finishHandoff();
    } finally {
      setSwitching(false);
    }
  };

  const handleCreate = async ({ username }) => {
    if (switching) return;
    setSwitching(true);
    try {
      const sourceUUID = currentPlayer?.UUID;
      await markChosen();
      const newPlayer = {
        UUID: uuid(),
        username,
        tokens: 0,
        elo: 0,
        minutesClearedToday: 0,
        wakeTime: '08:00',
        sleepTime: '23:00',
        wakeChecklist: [],
        sleepChecklist: [],
        activeCosmetics: {},
        profilePicture: null,
      };
      await databaseConnection.createAndSwitchProfile(currentPlayer, newPlayer);
      if (sourceUUID) {
        await prepareProfileHandoff(databaseConnection, sourceUUID, newPlayer.UUID);
      }
      await markWakeRequired(newPlayer.UUID);
      await flushBoundaryWrites();
      modal.remove();
      finishHandoff();
    } finally {
      setSwitching(false);
    }
  };

  if (!modal.visible) return null;

  return (
    <div className="ps-overlay">
      <div className="ps-card">
        <div className="ps-card-header">
          <span>{isStartup ? 'SELECT PROFILE' : 'END OF DAY'}</span>
        </div>

        <div className="ps-card-body">
          {/* Continue section */}
          {displayedCurrent && (
            <div className="ps-section">
              <div className="ps-section-label">CONTINUE</div>
              <ProfileCard
                player={displayedCurrent}
                isActive
                onClick={handleContinue}
                onArchive={handleArchive}
                archiveDisabled={!!archivingUUID}
              />
            </div>
          )}

          {displayedCurrent && <div className="ps-divider" />}

          {/* Switch / create section */}
          <div className="ps-section ps-section--scroll">
            <div className="ps-section-label-row">
              <span className="ps-section-label">{isStartup ? 'ENTER AS' : 'SWITCH PROFILE'}</span>
              <button
                className="ps-new-btn"
                onClick={() => setShowNewForm((v) => !v)}
              >
                {showNewForm ? '✕ CANCEL' : '+ NEW'}
              </button>
            </div>

            {showNewForm && (
              <NewProfileForm
                onCancel={() => setShowNewForm(false)}
                onCreate={(data) => { setShowNewForm(false); handleCreate(data); }}
              />
            )}

            {!showNewForm && (
              <>
                <input
                  className="ps-search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search profiles…"
                />
                <div className="ps-profile-list">
                  {filteredPlayers.length === 0 ? (
                    <div className="ps-empty">
                      {otherPlayers.length === 0 ? 'No other profiles yet.' : 'No matches found.'}
                    </div>
                  ) : (
                    filteredPlayers.map((p) => (
                      <ProfileCard
                        key={p.UUID}
                        player={p}
                        isActive={false}
                        onClick={() => handleSwitch(p)}
                        onArchive={handleArchive}
                        archiveDisabled={!!archivingUUID}
                      />
                    ))
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});
