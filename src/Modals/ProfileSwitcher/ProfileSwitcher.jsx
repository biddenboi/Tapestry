import { useContext, useEffect, useState, useCallback } from 'react';
import { v4 as uuid } from 'uuid';
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import { AppContext } from '../../App.jsx';
import { STORES } from '../../utils/Constants.js';
import ProfilePicture from '../../components/ProfilePicture/ProfilePicture.jsx';
import { getCurrentIGT, formatInGameTime } from '../../utils/Helpers/Time.js';
import { getRankClass, getRankLabel } from '../../utils/Helpers/Rank.js';
import { startDay } from '../../utils/Helpers/Events.js';
import Purgatory from '../Purgatory/Purgatory.jsx';
import './ProfileSwitcher.css';

/* ── Inline new-profile form ────────────────────────────── */
function NewProfileForm({ onCancel, onCreate }) {
  const [username, setUsername] = useState('');
  const [description, setDescription] = useState('');

  const handleCreate = () => {
    const name = username.trim();
    if (!name) return;
    onCreate({ username: name, description: description.trim() });
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
      <input
        className="ps-new-input"
        placeholder="Short description (optional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        maxLength={80}
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
function ProfileCard({ player, isActive, isCurrent, onClick }) {
  const rankClass = getRankClass(player.elo || 0);
  const rankLabel = getRankLabel(player.elo || 0);
  const igt = isCurrent ? getCurrentIGT(player) : (player.inGameTime || 0);
  const isArchived = !!player.archivedAt;

  return (
    <button
      className={`ps-profile-card ${isActive ? 'ps-profile-card--active' : ''} ${isArchived ? 'ps-profile-card--archived' : ''}`}
      onClick={onClick}
    >
      <ProfilePicture src={player.profilePicture} username={player.username || '?'} size={44} />
      <div className="ps-profile-card-info">
        <div className="ps-profile-card-name-row">
          <span className="ps-profile-card-name">{player.username || 'Unknown'}</span>
          {isArchived && <span className="ps-archived-tag">Archived</span>}
        </div>
        {player.description && (
          <div className="ps-profile-card-desc">{player.description}</div>
        )}
        <div className="ps-profile-card-meta">
          <span className={`ps-profile-card-rank rank-${rankClass}`}>{rankLabel}</span>
          <span className="ps-profile-card-igt">{formatInGameTime(igt)}</span>
        </div>
      </div>
      {isActive && <div className="ps-profile-card-check">✓</div>}
    </button>
  );
}

/* ── Main modal ─────────────────────────────────────────── */
export default NiceModal.create(({ skipPurgatory = false, todayStr = '' }) => {
  const { databaseConnection, currentPlayer, refreshApp } = useContext(AppContext);
  const modal = useModal();
  const [allPlayers, setAllPlayers] = useState([]);
  const [search, setSearch] = useState('');
  const [showNewForm, setShowNewForm] = useState(false);
  const [switching, setSwitching] = useState(false);

  const loadPlayers = useCallback(async () => {
    const players = await databaseConnection.getActivePlayers();
    setAllPlayers(players);
  }, [databaseConnection]);

  useEffect(() => { loadPlayers(); }, [loadPlayers]);

  /** Persist that the user has made their end-of-day choice. */
  const markChosen = useCallback(() => {
    if (currentPlayer?.UUID && todayStr) {
      localStorage.setItem(`tapestry_eod_${currentPlayer.UUID}_${todayStr}`, 'chosen');
    }
  }, [currentPlayer, todayStr]);

  const otherPlayers = allPlayers.filter((p) => p.UUID !== currentPlayer?.UUID);
  const filteredPlayers = search.trim()
    ? otherPlayers.filter((p) =>
        (p.username || '').toLowerCase().includes(search.toLowerCase()) ||
        (p.description || '').toLowerCase().includes(search.toLowerCase())
      )
    : otherPlayers;

  const handleContinue = async () => {
    markChosen();
    modal.remove();
    if (skipPurgatory) {
      // Missed-deadline flow: start the day immediately, no waiting for midnight.
      const fresh = await databaseConnection.getCurrentPlayer();
      await startDay(databaseConnection, fresh);
      refreshApp();
    } else {
      // Normal flow: sleep time just passed, midnight hasn't yet — enter purgatory.
      NiceModal.show(Purgatory);
      refreshApp();
    }
  };

  const handleSwitch = async (targetPlayer) => {
    if (switching) return;
    setSwitching(true);
    try {
      markChosen();
      await databaseConnection.switchProfile(currentPlayer, targetPlayer.UUID);
      modal.remove();
      refreshApp();
    } finally {
      setSwitching(false);
    }
  };

  const handleCreate = async ({ username, description }) => {
    if (switching) return;
    setSwitching(true);
    try {
      markChosen();
      const newPlayer = {
        UUID: uuid(),
        username,
        description,
        tokens: 0,
        elo: 1000,
        minutesClearedToday: 0,
        wakeTime: '08:00',
        sleepTime: '23:00',
        activeCosmetics: {},
        profilePicture: null,
      };
      await databaseConnection.createAndSwitchProfile(currentPlayer, newPlayer);
      modal.remove();
      refreshApp();
    } finally {
      setSwitching(false);
    }
  };

  if (!modal.visible) return null;

  return (
    <div className="ps-overlay">
      <div className="ps-card">
        <div className="ps-card-header">
          <div className="ps-card-corner" />
          <span>END OF DAY</span>
        </div>

        <div className="ps-card-body">
          {/* Continue section */}
          <div className="ps-section">
            <div className="ps-section-label">CONTINUE</div>
            {currentPlayer && (
              <ProfileCard
                player={currentPlayer}
                isActive
                isCurrent
                onClick={handleContinue}
              />
            )}
          </div>

          <div className="ps-divider" />

          {/* Switch / create section */}
          <div className="ps-section ps-section--scroll">
            <div className="ps-section-label-row">
              <span className="ps-section-label">SWITCH PROFILE</span>
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
                        isCurrent={false}
                        onClick={() => handleSwitch(p)}
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
