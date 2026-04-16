import './Profile.css';
import { useContext, useEffect, useMemo, useState } from 'react';
import { v4 as uuid } from 'uuid';
import NiceModal from '@ebay/nice-modal-react';
import { AppContext } from '../../App.jsx';
import { STORES } from '../../utils/Constants.js';
import ProfilePicture from '../../components/ProfilePicture/ProfilePicture.jsx';
import { UTCStringToLocalDate, UTCStringToLocalTime, formatDuration } from '../../utils/Helpers/Time.js';
import { getTaskDuration } from '../../utils/Helpers/Tasks.js';
import TodoDetailModal from '../../Modals/TodoDetailModal/TodoDetailModal.jsx';
import JournalDetailModal from '../../Modals/JournalDetailModal/JournalDetailModal.jsx';
import MatchDetailsModal from '../../Modals/MatchDetailsModal/MatchDetailsModal.jsx';
import EventDetailModal from '../../Modals/EventDetailModal/EventDetailModal.jsx';

function HistoryItem({ item, onOpen }) {
  const iconMap = { task: 'TSK', todo: 'TDO', journal: 'JNL', event: 'EVT' };
  const timestamp = item.createdAt || item.completedAt;

  const subtitle = item.type === 'task'
    ? `${formatDuration(getTaskDuration(item)) || '—'} · ${item.points || 0} pts`
    : item.type === 'journal'
      ? `${(item.entry || '').slice(0, 56)}${(item.entry || '').length > 56 ? '…' : ''}`
      : item.type === 'todo'
        ? `${item.estimatedDuration || 0} min · due ${item.dueDate || '—'}`
        : item.description || item.type;

  return (
    <button className="profile-history-item" onClick={() => onOpen(item)}>
      <div className={`profile-history-icon profile-history-icon--${item.type}`}>{iconMap[item.type] || '—'}</div>
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
  return (
    <button className={`profile-search-row ${active ? 'active' : ''}`} onClick={onClick}>
      <ProfilePicture src={entry.profilePicture} username={entry.username} size={40} />
      <div className="profile-search-copy">
        <div className="profile-search-name">{entry.username || 'Unknown'}</div>
        <div className="profile-search-meta">ELO {entry.elo || 0}</div>
      </div>
    </button>
  );
}

export default function Profile({ uuid: targetUUID }) {
  const { databaseConnection, currentPlayer, timestamp, refreshApp, notify, openPanel } = useContext(AppContext);
  const [player, setPlayer] = useState(null);
  const [friends, setFriends] = useState([]);
  const [history, setHistory] = useState([]);
  const [search, setSearch] = useState('');
  const [players, setPlayers] = useState([]);
  const [matches, setMatches] = useState([]);
  const [friendship, setFriendship] = useState(null);

  useEffect(() => {
    const load = async () => {
      const resolvedUUID = targetUUID || currentPlayer?.UUID;
      if (!resolvedUUID) {
        setPlayer(null);
        setPlayers([]);
        setFriends([]);
        setHistory([]);
        setMatches([]);
        setFriendship(null);
        return;
      }

      const viewed = await databaseConnection.get(STORES.player, resolvedUUID);
      setPlayer(viewed || null);
      if (!viewed) return;

      const [tasks, journals, events, todos, matchList, allPlayers, friendships] = await Promise.all([
        databaseConnection.getPlayerStore(STORES.task, viewed.UUID),
        databaseConnection.getPlayerStore(STORES.journal, viewed.UUID),
        databaseConnection.getPlayerStore(STORES.event, viewed.UUID),
        databaseConnection.getPlayerStore(STORES.todo, viewed.UUID),
        databaseConnection.getMatchesForPlayer(viewed.UUID),
        databaseConnection.getAllPlayers(),
        currentPlayer?.UUID ? databaseConnection.getFriendshipsForPlayer(currentPlayer.UUID) : Promise.resolve([]),
      ]);

      const cleanedPlayers = allPlayers
        .filter((entry) => entry?.UUID)
        .filter((entry, index, array) => array.findIndex((candidate) => candidate.UUID === entry.UUID) === index)
        .sort((a, b) => String(a.username || '').localeCompare(String(b.username || '')));

      const combined = [
        ...tasks.map((item) => ({ ...item, type: 'task', sortAt: item.completedAt || item.createdAt })),
        ...journals.map((item) => ({ ...item, type: 'journal', sortAt: item.createdAt })),
        ...todos.map((item) => ({ ...item, type: 'todo', sortAt: item.createdAt || item.dueDate })),
        ...events.map((item) => ({ ...item, type: 'event', sortAt: item.createdAt })),
      ].sort((a, b) => String(b.sortAt || '').localeCompare(String(a.sortAt || '')));

      const acceptedFriendships = friendships.filter((entry) => entry.status === 'accepted');
      const friendUUIDs = new Set(acceptedFriendships.flatMap((entry) => entry.players).filter((id) => id !== currentPlayer?.UUID));

      setPlayers(cleanedPlayers);
      setFriends(cleanedPlayers.filter((entry) => friendUUIDs.has(entry.UUID)));
      setFriendship(friendships.find((entry) => entry.players?.includes(viewed.UUID) && entry.players?.includes(currentPlayer?.UUID)) || null);
      setHistory(combined);
      setMatches(matchList.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))).slice(0, 10));
    };

    load();
  }, [databaseConnection, targetUUID, currentPlayer, timestamp]);

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    const pool = players.filter((entry) => entry.UUID !== player?.UUID);
    if (!q) return pool.slice(0, 8);
    return pool
      .filter((entry) => {
        const username = String(entry.username || '').toLowerCase();
        const description = String(entry.description || '').toLowerCase();
        return username.includes(q) || description.includes(q);
      })
      .slice(0, 8);
  }, [players, player, search]);

  const isSelf = player?.UUID === currentPlayer?.UUID;
  const accepted = friendship?.status === 'accepted';
  const totalPoints = useMemo(() => history.filter((item) => item.type === 'task').reduce((sum, item) => sum + Number(item.points || 0), 0), [history]);

  const handleAddFriend = async () => {
    if (!player || !currentPlayer || isSelf || accepted) return;
    const record = friendship || {
      UUID: uuid(),
      createdAt: new Date().toISOString(),
      players: [currentPlayer.UUID, player.UUID],
    };

    await databaseConnection.add(STORES.friendship, {
      ...record,
      requestedBy: currentPlayer.UUID,
      status: 'accepted',
      acceptedAt: new Date().toISOString(),
    });

    await databaseConnection.add(STORES.notification, {
      UUID: uuid(),
      parent: currentPlayer.UUID,
      title: 'Friend request accepted',
      message: `${player.username} accepted your request.`,
      kind: 'success',
      createdAt: new Date().toISOString(),
      readAt: null,
    });

    refreshApp();
    notify({ title: 'Friend added', message: `${player.username} joined your friends list.`, kind: 'success', persist: false });
  };

  const openHistoryItem = (item) => {
    if (item.type === 'journal') {
      NiceModal.show(JournalDetailModal, { item });
      return;
    }

    if (item.type === 'task' || item.type === 'todo') {
      NiceModal.show(TodoDetailModal, { item });
      return;
    }

    if (item.type === 'event') {
      NiceModal.show(EventDetailModal, { item });
      return;
    }

    NiceModal.show(EventDetailModal, { item });
  };

  if (!player) {
    return <div className="profile-page"><div className="profile-empty">Profile not found.</div></div>;
  }

  return (
    <div className="profile-page">
      <div className="profile-grid">
        <section className="profile-card profile-summary-card">
          <div className="profile-summary-left">
            <ProfilePicture
              src={player.profilePicture}
              username={player.username}
              size={96}
              editable={isSelf}
              onUpload={async (base64) => {
                const updated = { ...player, profilePicture: base64 };
                await databaseConnection.add(STORES.player, updated);
                setPlayer(updated);
                refreshApp();
              }}
            />
            <div className="profile-copy">
              <div className="profile-name-row">
                <h2 className="profile-name">{player.username}</h2>
              </div>
              <p className="profile-desc">{player.description || 'No description set.'}</p>
              <div className="profile-meta">Joined {UTCStringToLocalDate(player.createdAt)} · ELO {player.elo || 0}</div>
            </div>
          </div>

          <div className="profile-summary-right">
            <div className="profile-stat-card">
              <span className="profile-stat-label">Lifetime points</span>
              <span className="profile-stat-value">{totalPoints}</span>
            </div>
            <div className="profile-stat-card">
              <span className="profile-stat-label">Matches</span>
              <span className="profile-stat-value">{matches.length}</span>
            </div>
            {!isSelf && (
              <button className="primary profile-friend-btn" onClick={handleAddFriend} disabled={accepted}>
                {accepted ? 'FRIEND ADDED' : 'ADD FRIEND'}
              </button>
            )}
          </div>
        </section>

        <aside className="profile-social-column">
          <section className="profile-card profile-social-card">
            <div className="profile-section-title">Player search</div>
            <input
              className="profile-search-input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search players"
            />
            <div className="profile-search-list">
              {searchResults.length === 0 ? (
                <div className="profile-empty">No players found.</div>
              ) : (
                searchResults.map((entry) => (
                  <PlayerRow
                    key={entry.UUID}
                    entry={entry}
                    active={entry.UUID === player.UUID}
                    onClick={() => openPanel('profile', entry.UUID)}
                  />
                ))
              )}
            </div>
          </section>

          <section className="profile-card profile-social-card">
            <div className="profile-section-title">Friends</div>
            <div className="profile-friends-list">
              {friends.length === 0 ? (
                <div className="profile-empty">No friends yet.</div>
              ) : (
                friends.map((friend) => (
                  <PlayerRow
                    key={friend.UUID}
                    entry={friend}
                    active={friend.UUID === player.UUID}
                    onClick={() => openPanel('profile', friend.UUID)}
                  />
                ))
              )}
            </div>
          </section>
        </aside>

        <section className="profile-card profile-history-card">
          <div className="profile-section-title">Timeline</div>
          <div className="profile-history-list">
            {history.length === 0 ? (
              <div className="profile-empty">No history yet.</div>
            ) : (
              history.map((item) => <HistoryItem key={`${item.type}-${item.UUID}`} item={item} onOpen={openHistoryItem} />)
            )}
          </div>
        </section>

        <section className="profile-card profile-matches-card">
          <div className="profile-section-title">Matches</div>
          <div className="profile-match-list">
            {matches.length === 0 ? (
              <div className="profile-empty">No matches recorded.</div>
            ) : (
              matches.map((match) => (
                <button
                  key={match.UUID}
                  className="profile-match-row"
                  onClick={() => NiceModal.show(MatchDetailsModal, {
                    match,
                    currentPlayerUUID: currentPlayer?.UUID,
                    onOpenProfile: (id) => openPanel('profile', id),
                  })}
                >
                  <div className="profile-match-copy">
                    <span className="profile-match-date">{UTCStringToLocalDate(match.createdAt)}</span>
                    <strong>{match.duration}h match</strong>
                  </div>
                  <span className={`profile-match-result ${match.status === 'active' ? 'live' : match.result?.iWon ? 'win' : 'loss'}`}>
                    {match.status === 'active' ? 'LIVE' : match.result?.iWon ? 'WIN' : 'LOSS'}
                  </span>
                </button>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
