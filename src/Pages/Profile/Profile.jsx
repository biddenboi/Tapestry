import './Profile.css';
import { useContext, useEffect, useMemo, useState } from 'react';
import { v4 as uuid } from 'uuid';
import NiceModal from '@ebay/nice-modal-react';
import { AppContext } from '../../App.jsx';
import { STORES } from '../../utils/Constants.js';
import ProfilePicture from '../../components/ProfilePicture/ProfilePicture.jsx';
import { UTCStringToLocalDate, UTCStringToLocalTime, formatDuration } from '../../utils/Helpers/Time.js';
import { getTaskDuration } from '../../utils/Helpers/Tasks.js';
import { getRank, getRankLabel, getRankProgress, getRankGlow, getRankClass } from '../../utils/Helpers/Rank.js';
import TodoDetailModal from '../../Modals/TodoDetailModal/TodoDetailModal.jsx';
import JournalDetailModal from '../../Modals/JournalDetailModal/JournalDetailModal.jsx';
import MatchDetailsModal from '../../Modals/MatchDetailsModal/MatchDetailsModal.jsx';
import EventDetailModal from '../../Modals/EventDetailModal/EventDetailModal.jsx';

function HistoryItem({ item, onOpen }) {
  const iconMap = { task: 'TSK', journal: 'JNL', event: 'EVT' };
  const timestamp = item.createdAt || item.completedAt;

  const subtitle = item.type === 'task'
    ? `${formatDuration(getTaskDuration(item)) || '—'} · ${item.points || 0} pts`
    : item.type === 'journal'
      ? `${(item.entry || '').slice(0, 56)}${(item.entry || '').length > 56 ? '…' : ''}`
      : item.description || item.type;

  return (
    <button className="profile-history-item" onClick={() => onOpen(item)}>
      <div className={`profile-history-icon phi-${item.type}`}>{iconMap[item.type] || '—'}</div>
      <div className="profile-history-copy">
        <span className="profile-history-title">{item.name || item.title || item.description || 'Untitled'}</span>
        <span className="profile-history-sub">{subtitle}</span>
      </div>
      <div className="profile-history-time">
        <div>{UTCStringToLocalDate(timestamp)}</div>
        <div>{UTCStringToLocalTime(timestamp)}</div>
      </div>
    </button>
  );
}

function PlayerRow({ entry, active, onClick }) {
  const rankClass = getRankClass(entry.elo || 0);
  const rankLabel = getRankLabel(entry.elo || 0);
  return (
    <button className={`profile-search-row ${active ? 'active' : ''}`} onClick={onClick}>
      <ProfilePicture src={entry.profilePicture} username={entry.username} size={38} />
      <div className="profile-search-copy">
        <div className="profile-search-name">{entry.username || 'Unknown'}</div>
        <div className={`profile-search-rank rank-${rankClass}`}>{rankLabel}</div>
      </div>
      <div className="profile-search-elo">{entry.elo || 0}</div>
    </button>
  );
}

export default function Profile({ uuid: targetUUID }) {
  const { databaseConnection, currentPlayer, timestamp, refreshApp, notify, openPanel } = useContext(AppContext);
  const [player, setPlayer]       = useState(null);
  const [friends, setFriends]     = useState([]);
  const [history, setHistory]     = useState([]);
  const [search, setSearch]       = useState('');
  const [players, setPlayers]     = useState([]);
  const [matches, setMatches]     = useState([]);
  const [friendship, setFriendship] = useState(null);

  useEffect(() => {
    const load = async () => {
      const resolvedUUID = targetUUID || currentPlayer?.UUID;
      if (!resolvedUUID) { setPlayer(null); setPlayers([]); setFriends([]); setHistory([]); setMatches([]); setFriendship(null); return; }

      const viewed = await databaseConnection.get(STORES.player, resolvedUUID);
      setPlayer(viewed || null);
      if (!viewed) return;

      const [tasks, journals, events, matchList, allPlayers, friendships] = await Promise.all([
        databaseConnection.getPlayerStore(STORES.task, viewed.UUID),
        databaseConnection.getPlayerStore(STORES.journal, viewed.UUID),
        databaseConnection.getPlayerStore(STORES.event, viewed.UUID),
        databaseConnection.getMatchesForPlayer(viewed.UUID),
        databaseConnection.getAllPlayers(),
        currentPlayer?.UUID ? databaseConnection.getFriendshipsForPlayer(currentPlayer.UUID) : Promise.resolve([]),
      ]);

      const cleanedPlayers = allPlayers
        .filter((e) => e?.UUID)
        .filter((e, i, arr) => arr.findIndex((c) => c.UUID === e.UUID) === i)
        .sort((a, b) => String(a.username || '').localeCompare(String(b.username || '')));

      /* Only completed tasks (not uncompleted todos) go in timeline */
      const combined = [
        ...tasks.filter((t) => t.completedAt).map((item) => ({ ...item, type: 'task',    sortAt: item.completedAt || item.createdAt })),
        ...journals.map((item) => ({ ...item, type: 'journal', sortAt: item.createdAt })),
        ...events.map((item)  => ({ ...item, type: 'event',   sortAt: item.createdAt })),
      ].sort((a, b) => String(b.sortAt || '').localeCompare(String(a.sortAt || '')));

      const acceptedFriendships = friendships.filter((e) => e.status === 'accepted');
      const friendUUIDs = new Set(acceptedFriendships.flatMap((e) => e.players).filter((id) => id !== currentPlayer?.UUID));

      setPlayers(cleanedPlayers);
      setFriends(cleanedPlayers.filter((e) => friendUUIDs.has(e.UUID)));
      setFriendship(friendships.find((e) => e.players?.includes(viewed.UUID) && e.players?.includes(currentPlayer?.UUID)) || null);
      setHistory(combined);
      setMatches(matchList.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))).slice(0, 10));
    };
    load();
  }, [databaseConnection, targetUUID, currentPlayer, timestamp]);

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    const pool = players.filter((e) => e.UUID !== player?.UUID);
    if (!q) return pool.slice(0, 8);
    return pool.filter((e) => String(e.username || '').toLowerCase().includes(q) || String(e.description || '').toLowerCase().includes(q)).slice(0, 8);
  }, [players, player, search]);

  const isSelf     = player?.UUID === currentPlayer?.UUID;
  const accepted   = friendship?.status === 'accepted';
  const totalPoints = useMemo(() => history.filter((i) => i.type === 'task').reduce((s, i) => s + Number(i.points || 0), 0), [history]);

  const handleAddFriend = async () => {
    if (!player || !currentPlayer || isSelf || accepted) return;
    const record = friendship || { UUID: uuid(), createdAt: new Date().toISOString(), players: [currentPlayer.UUID, player.UUID] };
    await databaseConnection.add(STORES.friendship, { ...record, requestedBy: currentPlayer.UUID, status: 'accepted', acceptedAt: new Date().toISOString() });
    await databaseConnection.add(STORES.notification, { UUID: uuid(), parent: currentPlayer.UUID, title: 'Friend added', message: `${player.username} joined your friends list.`, kind: 'success', createdAt: new Date().toISOString(), readAt: null });
    refreshApp();
    notify({ title: 'Friend added', message: `${player.username} joined your friends list.`, kind: 'success', persist: false });
  };

  const openHistoryItem = (item) => {
    if (item.type === 'journal') { NiceModal.show(JournalDetailModal, { item }); return; }
    if (item.type === 'task')    { NiceModal.show(TodoDetailModal, { item }); return; }
    NiceModal.show(EventDetailModal, { item });
  };

  if (!player) return <div className="profile-page"><div className="profile-empty">Profile not found.</div></div>;

  const elo       = player.elo || 0;
  const rank      = getRank(elo);
  const rankLabel = getRankLabel(elo);
  const rankProg  = getRankProgress(elo);
  const rankClass = getRankClass(elo);
  const rankGlow  = getRankGlow(elo, 20);

  return (
    <div className="profile-page">
      {/* ── Banner / hero ──────────────────────────────────── */}
      <div className="profile-hero" style={player.bannerImage ? { backgroundImage: `url(${player.bannerImage})` } : {}}>
        <div className="profile-hero-overlay" />
        <div className="profile-hero-content">
          <div className="profile-avatar-wrap" style={{ boxShadow: rankGlow }}>
            <ProfilePicture
              src={player.profilePicture}
              username={player.username}
              size={88}
              editable={isSelf}
              onUpload={async (base64) => {
                const updated = { ...player, profilePicture: base64 };
                await databaseConnection.add(STORES.player, updated);
                setPlayer(updated);
                refreshApp();
              }}
            />
          </div>
          <div className="profile-hero-info">
            <div className="profile-name-row">
              <h2 className="profile-name">{player.username}</h2>
              <div className={`profile-rank-badge rank-${rankClass}`}>
                <span className="prb-icon">{rank.icon}</span>
                <span className="prb-label">{rankLabel}</span>
              </div>
            </div>
            <p className="profile-desc">{player.description || 'No description set.'}</p>
            <div className="profile-rank-progress">
              <div className="prp-track">
                <div className="prp-fill" style={{ width: `${rankProg}%`, background: rank.color }} />
              </div>
              <span className="prp-label">{rankProg}% to next rank · {elo} ELO</span>
            </div>
          </div>
          {!isSelf && (
            <button className="primary profile-friend-btn" onClick={handleAddFriend} disabled={accepted}>
              {accepted ? '✓ FRIEND' : '+ ADD FRIEND'}
            </button>
          )}
        </div>
      </div>

      {/* ── Grid body ─────────────────────────────────────── */}
      <div className="profile-grid">
        {/* Stats row */}
        <div className="profile-stats-row">
          <div className="profile-stat-card">
            <span className="psc-value">{totalPoints.toLocaleString()}</span>
            <span className="psc-label">LIFETIME PTS</span>
          </div>
          <div className="profile-stat-card">
            <span className="psc-value">{matches.length}</span>
            <span className="psc-label">MATCHES</span>
          </div>
          <div className="profile-stat-card">
            <span className="psc-value">{history.filter((i) => i.type === 'task').length}</span>
            <span className="psc-label">TASKS DONE</span>
          </div>
        </div>

        <div className="profile-body-grid">
          {/* Timeline */}
          <section className="profile-card profile-timeline-card">
            <div className="profile-card-title">TIMELINE</div>
            <div className="profile-timeline-list">
              {history.length === 0
                ? <div className="profile-empty-row">No history yet.</div>
                : history.map((item) => <HistoryItem key={`${item.type}-${item.UUID}`} item={item} onOpen={openHistoryItem} />)
              }
            </div>
          </section>

          {/* Right column */}
          <div className="profile-right-col">
            {/* Matches */}
            <section className="profile-card">
              <div className="profile-card-title">MATCHES</div>
              <div className="profile-match-list">
                {matches.length === 0
                  ? <div className="profile-empty-row">No matches recorded.</div>
                  : matches.map((match) => (
                    <button key={match.UUID} className="profile-match-row"
                      onClick={() => NiceModal.show(MatchDetailsModal, { match, currentPlayerUUID: currentPlayer?.UUID, onOpenProfile: (id) => openPanel('profile', id) })}
                    >
                      <span className={`pmr-result ${match.status === 'active' ? 'live' : match.result?.iWon ? 'win' : 'loss'}`}>
                        {match.status === 'active' ? 'LIVE' : match.result?.iWon ? 'WIN' : 'LOSS'}
                      </span>
                      <span className="pmr-info">{match.duration}h match</span>
                      <span className="pmr-date">{UTCStringToLocalDate(match.createdAt)}</span>
                    </button>
                  ))
                }
              </div>
            </section>

            {/* Player search */}
            <section className="profile-card">
              <div className="profile-card-title">FIND PLAYERS</div>
              <input className="profile-search-input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search username..." />
              <div className="profile-search-list">
                {searchResults.length === 0
                  ? <div className="profile-empty-row">No players found.</div>
                  : searchResults.map((e) => (
                    <PlayerRow key={e.UUID} entry={e} active={e.UUID === player.UUID} onClick={() => openPanel('profile', e.UUID)} />
                  ))
                }
              </div>
            </section>

            {/* Friends */}
            <section className="profile-card">
              <div className="profile-card-title">FRIENDS</div>
              <div className="profile-friends-list">
                {friends.length === 0
                  ? <div className="profile-empty-row">No friends yet.</div>
                  : friends.map((f) => (
                    <PlayerRow key={f.UUID} entry={f} active={f.UUID === player.UUID} onClick={() => openPanel('profile', f.UUID)} />
                  ))
                }
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
