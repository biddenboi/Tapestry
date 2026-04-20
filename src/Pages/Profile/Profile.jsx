import './Profile.css';
import { useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { v4 as uuid } from 'uuid';
import NiceModal from '@ebay/nice-modal-react';
import { AppContext } from '../../App.jsx';
import { STORES } from '../../utils/Constants.js';
import ProfilePicture from '../../components/ProfilePicture/ProfilePicture.jsx';
import { UTCStringToLocalDate, UTCStringToLocalTime, formatDuration, getCurrentIGT, formatInGameTime } from '../../utils/Helpers/Time.js';
import { getTaskDuration } from '../../utils/Helpers/Tasks.js';
import { getRank, getRankLabel, getRankProgress, getRankGlow, getRankClass } from '../../utils/Helpers/Rank.js';
import { BANNER_GRADIENTS } from '../../utils/Constants.js';
import TodoDetailModal from '../../Modals/TodoDetailModal/TodoDetailModal.jsx';
import JournalDetailModal from '../../Modals/JournalDetailModal/JournalDetailModal.jsx';
import MatchDetailsModal from '../../Modals/MatchDetailsModal/MatchDetailsModal.jsx';
import EventDetailModal from '../../Modals/EventDetailModal/EventDetailModal.jsx';
import AchievementsModal from '../../Modals/AchievementsModal/AchievementsModal.jsx';
import AchievementBadge from '../../components/AchievementBadge/AchievementBadge.jsx';
import { checkPassiveAchievements, getAchievementByKey, computeRarity, getRarityLabel } from '../../utils/Achievements.js';

/**
 * Derives match outcome from the perspective of a specific player UUID.
 * Uses team membership + stored winner field — works correctly on any player's
 * profile, not just the logged-in viewer's.
 */
function matchOutcomeFor(match, playerUUID) {
  if (match.status === 'active') return 'live';
  const winner = match.result?.winner;
  if (winner == null) return 'loss';
  const team1 = match.teams?.[0] || [];
  const onTeam1 = team1.some((p) => String(p.UUID) === String(playerUUID));
  return (winner === 1 && onTeam1) || (winner === 2 && !onTeam1) ? 'win' : 'loss';
}

function HistoryItem({ item, onOpen, canPin, onTogglePin }) {
  const iconMap = { task: 'TSK', journal: 'JNL', event: 'EVT', item_use: 'USE', money_log: '$', transaction: 'TXN' };
  const timestamp = item.createdAt || item.completedAt;

  const subtitle = item.type === 'task'
    ? `${formatDuration(getTaskDuration(item)) || '—'} · ${item.points || 0} pts`
    : item.type === 'journal'
      ? `${(item.entry || '').slice(0, 56)}${(item.entry || '').length > 56 ? '…' : ''}`
      : item.type === 'item_use'
        ? `Used ${item.name || 'an item'}${item.category ? ` · ${item.category}` : ''}`
        : item.type === 'money_log'
          ? `+$${Number(item.amount || item.cost || 0).toFixed(2)}${item.description ? ` — ${item.description}` : ''}`
          : item.type === 'transaction'
            ? `${item.cost != null ? `$${Number(item.cost).toFixed(2)}` : ''}${item.description ? ` · ${item.description}` : ''}`.trim() || 'Transaction'
            : item.description || item.type;

  const title = item.type === 'item_use'
    ? (item.name || 'Item used')
    : (item.name || item.title || item.description || 'Untitled');

  const handlePinClick = (e) => {
    e.stopPropagation();
    onTogglePin?.(item);
  };

  return (
    <button className={`profile-history-item ${item.pinned ? 'profile-history-item--pinned' : ''}`} onClick={() => onOpen(item)}>
      {canPin && (
        <span
          role="button"
          tabIndex={0}
          className={`profile-history-pin ${item.pinned ? 'profile-history-pin--active' : ''}`}
          onClick={handlePinClick}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handlePinClick(e); } }}
          title={item.pinned ? 'Unpin from top of timeline' : 'Pin to top of timeline'}
          aria-label={item.pinned ? 'Unpin entry' : 'Pin entry'}
        >
          ⚲
        </span>
      )}
      <div className={`profile-history-icon phi-${item.type}`}>{iconMap[item.type] || '—'}</div>
      <div className="profile-history-copy">
        <span className="profile-history-title">{title}</span>
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

/* ── Inline Profile Banner Editor ───────────────────────── */
function ProfileBannerEditor({ current, onSave, onClose }) {
  const [type, setType]     = useState(current?.type || 'gradient');
  const [value, setValue]   = useState(current?.type === 'gradient' ? current.value : BANNER_GRADIENTS[0].value);
  const [colorVal, setColorVal] = useState(current?.type === 'color' ? current.value : '#0d1b2a');

  const handleImageUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => { setValue(ev.target.result); };
    reader.readAsDataURL(file);
  };

  const handleSave = () => {
    if (type === 'gradient') onSave({ type: 'gradient', value });
    else if (type === 'color') onSave({ type: 'color', value: colorVal });
    else if (type === 'image' && value) onSave({ type: 'image', value });
  };

  const previewStyle = type === 'gradient' ? { background: value }
    : type === 'color' ? { background: colorVal }
    : type === 'image' && value ? { backgroundImage: `url(${value})`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : {};

  return (
    <div className="profile-banner-editor-overlay" onClick={onClose}>
      <div className="profile-banner-editor" onClick={(e) => e.stopPropagation()}>
        <div className="pbe-header">
          <span>PROFILE BANNER</span>
          <button className="pbe-close" onClick={onClose}>✕</button>
        </div>
        <div className="pbe-body">
          <div className="pbe-type-row">
            {['gradient', 'color', 'image'].map((t) => (
              <button key={t} className={`pbe-type-btn ${type === t ? 'active' : ''}`} onClick={() => setType(t)}>
                {t.toUpperCase()}
              </button>
            ))}
          </div>

          {type === 'gradient' && (
            <div className="pbe-gradient-grid">
              {BANNER_GRADIENTS.map((g) => (
                <button key={g.id}
                  className={`pbe-gradient-chip ${value === g.value ? 'selected' : ''}`}
                  style={{ background: g.value }}
                  onClick={() => setValue(g.value)}
                  title={g.label}
                />
              ))}
            </div>
          )}

          {type === 'color' && (
            <div className="pbe-color-grid">
              {['#0d1b2a','#1a0507','#0a1a0d','#09090f','#1a0800','#1a1a2e','#100840','#1a1040'].map((c) => (
                <button key={c}
                  className={`pbe-color-chip ${colorVal === c ? 'selected' : ''}`}
                  style={{ background: c }}
                  onClick={() => setColorVal(c)}
                />
              ))}
              <input type="color" value={colorVal} onChange={(e) => setColorVal(e.target.value)}
                className="pbe-color-custom" title="Custom color" />
            </div>
          )}

          {type === 'image' && (
            <div className="pbe-image-row">
              <input type="file" accept="image/*" id="profile-banner-upload" style={{ display: 'none' }}
                onChange={handleImageUpload} />
              <label htmlFor="profile-banner-upload" className="pbe-upload-label">CHOOSE IMAGE</label>
              {value && type === 'image' && (
                <div className="pbe-image-thumb" style={{ backgroundImage: `url(${value})`, backgroundSize: 'cover', backgroundPosition: 'center' }} />
              )}
            </div>
          )}

          <div className="pbe-preview" style={previewStyle}>
            <div className="pbe-preview-overlay" />
            <span className="pbe-preview-name">Your Name</span>
          </div>
        </div>
        <div className="pbe-footer">
          <button onClick={onClose}>CANCEL</button>
          <button className="primary" onClick={handleSave}>APPLY BANNER</button>
        </div>
      </div>
    </div>
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
  const [ownedPassIds, setOwnedPassIds] = useState(new Set());
  const [showBannerEditor, setShowBannerEditor] = useState(false);
  const [showAchievements, setShowAchievements] = useState(false);
  const [allPlayersForRarity, setAllPlayersForRarity] = useState([]);

  useEffect(() => {
    const load = async () => {
      const resolvedUUID = targetUUID || currentPlayer?.UUID;
      if (!resolvedUUID) { setPlayer(null); setPlayers([]); setFriends([]); setHistory([]); setMatches([]); setFriendship(null); return; }
      const isSelfProfile = resolvedUUID === currentPlayer?.UUID;

      const viewed = await databaseConnection.get(STORES.player, resolvedUUID);
      setPlayer(viewed || null);
      if (!viewed) return;

      const [tasks, journals, events, transactions, matchList, allPlayers, friendships, inv] = await Promise.all([
        databaseConnection.getPlayerStore(STORES.task, viewed.UUID),
        databaseConnection.getPlayerStore(STORES.journal, viewed.UUID),
        databaseConnection.getPlayerStore(STORES.event, viewed.UUID),
        databaseConnection.getPlayerStore(STORES.transaction, viewed.UUID),
        databaseConnection.getMatchesForPlayer(viewed.UUID),
        databaseConnection.getAllPlayers(),
        currentPlayer?.UUID ? databaseConnection.getFriendshipsForPlayer(currentPlayer.UUID) : Promise.resolve([]),
        currentPlayer?.UUID ? databaseConnection.getPlayerStore(STORES.inventory, currentPlayer.UUID) : Promise.resolve([]),
      ]);
      setOwnedPassIds(new Set(inv.map((i) => i.type).concat(inv.map((i) => i.itemId || i.name?.toLowerCase()))));

      const cleanedPlayers = allPlayers
        .filter((e) => e?.UUID)
        .filter((e, i, arr) => arr.findIndex((c) => c.UUID === e.UUID) === i)
        .sort((a, b) => String(a.username || '').localeCompare(String(b.username || '')));

      /* Only completed tasks (not uncompleted todos) go in timeline */
      const combined = [
        ...tasks.filter((t) => t.completedAt).map((item) => ({ ...item, type: 'task',    sortAt: item.completedAt || item.createdAt })),
        ...journals.map((item) => ({ ...item, type: 'journal', sortAt: item.createdAt })),
        ...events.map((item)  => ({
          ...item,
          /* Keep item_use as its own timeline kind so the icon and subtitle differ */
          type:    item.type === 'item_use' ? 'item_use' : 'event',
          sortAt:  item.createdAt,
        })),
        ...transactions.map((item) => ({
          ...item,
          /* money_log transactions surface on the timeline with the $ treatment */
          type:    item.type === 'money_log' ? 'money_log' : 'transaction',
          sortAt:  item.completedAt || item.createdAt,
        })),
      ].sort((a, b) => {
        /* Pinned journals float to the top of the timeline */
        const aPin = a.type === 'journal' && a.pinned ? 1 : 0;
        const bPin = b.type === 'journal' && b.pinned ? 1 : 0;
        if (aPin !== bPin) return bPin - aPin;
        return String(b.sortAt || '').localeCompare(String(a.sortAt || ''));
      });

      const acceptedFriendships = friendships.filter((e) => e.status === 'accepted');
      const friendUUIDs = new Set(acceptedFriendships.flatMap((e) => e.players).filter((id) => id !== currentPlayer?.UUID));

      setPlayers(cleanedPlayers);
      setFriends(cleanedPlayers.filter((e) => friendUUIDs.has(e.UUID)));
      // Gate pending requests by IGT: the recipient shouldn't see a request until
      // their in-game time has reached the moment it was sent.
      // The sender always sees it immediately (they know what they did).
      const currentIGT = getCurrentIGT(currentPlayer);
      const visibleFriendship = friendships.find((e) => {
        if (!e.players?.includes(viewed.UUID) || !e.players?.includes(currentPlayer?.UUID)) return false;
        if (e.requestedBy === currentPlayer.UUID) return true; // sender always sees it
        return currentIGT >= (e.inGameTimestamp || 0);        // recipient waits for IGT
      });
      setFriendship(visibleFriendship || null);
      setHistory(combined);
      setMatches(matchList.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))).slice(0, 10));
      setAllPlayersForRarity(allPlayers);

      // Run passive achievement check for the current (self) player on their own profile
      if (isSelfProfile && viewed) {
        const newlyEarned = await checkPassiveAchievements(viewed, databaseConnection);
        if (newlyEarned.length > 0) {
          for (const key of newlyEarned) {
            const a = getAchievementByKey(key);
            if (a) notify({ title: 'Achievement Unlocked', message: a.label, kind: 'success', persist: false });
          }
          refreshApp();
        }
      }
    };
    load();
  }, [databaseConnection, targetUUID, currentPlayer, timestamp]);

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    const pool = players.filter((e) => e.UUID !== player?.UUID);
    if (!q) return pool.slice(0, 8);
    return pool.filter((e) => String(e.username || '').toLowerCase().includes(q) || String(e.description || '').toLowerCase().includes(q)).slice(0, 8);
  }, [players, player, search]);

  const isSelf        = player?.UUID === currentPlayer?.UUID;
  const accepted      = friendship?.status === 'accepted';
  const isPending     = friendship?.status === 'pending';
  const iRequested    = isPending && friendship?.requestedBy === currentPlayer?.UUID;
  const theyRequested = isPending && friendship?.requestedBy === player?.UUID;
  const hasBannerPass = ownedPassIds.has('cosmetic_profile_banner') || ownedPassIds.has('profile_banner');
  const totalPoints = useMemo(() => history.filter((i) => i.type === 'task').reduce((s, i) => s + Number(i.points || 0), 0), [history]);

  // Send a friend request (pending)
  const handleAddFriend = async () => {
    if (!player || !currentPlayer || isSelf || accepted || isPending) return;
    const now = new Date().toISOString();
    const senderIGT = getCurrentIGT(currentPlayer);
    const record = { UUID: uuid(), createdAt: now, players: [currentPlayer.UUID, player.UUID], requestedBy: currentPlayer.UUID, status: 'pending', inGameTimestamp: senderIGT };
    await databaseConnection.add(STORES.friendship, record);
    // Notify the recipient — only delivered once their IGT reaches senderIGT
    await databaseConnection.add(STORES.notification, {
      UUID: uuid(),
      parent: player.UUID,
      title: 'Friend Request',
      message: `${currentPlayer.username} wants to be your friend.`,
      kind: 'friend_request',
      createdAt: now,
      readAt: null,
      inGameTimestamp: senderIGT,
      meta: { friendshipUUID: record.UUID, requesterUUID: currentPlayer.UUID },
    });
    refreshApp();
    notify({ title: 'Request sent', message: `Friend request sent to ${player.username}.`, kind: 'info', persist: false });
  };

  // Accept an incoming request
  const handleAccept = async () => {
    if (!friendship || !currentPlayer || !player) return;
    const now = new Date().toISOString();
    const accepterIGT = getCurrentIGT(currentPlayer);
    await databaseConnection.add(STORES.friendship, { ...friendship, status: 'accepted', acceptedAt: now });
    // Mark the inbox notification as read (use Infinity so we find it regardless of IGT)
    const notifs = await databaseConnection.getNotificationsForPlayer(currentPlayer.UUID);
    const reqNotif = notifs.find((n) => n.meta?.friendshipUUID === friendship.UUID);
    if (reqNotif) await databaseConnection.markNotificationRead(reqNotif.UUID);
    // Send acceptance notification back to the requester — delivered once their IGT reaches accepterIGT
    await databaseConnection.add(STORES.notification, {
      UUID: uuid(),
      parent: player.UUID,
      title: 'Friend Request Accepted',
      message: `${currentPlayer.username} accepted your friend request. (${formatInGameTime(accepterIGT)})`,
      kind: 'success',
      createdAt: now,
      readAt: null,
      inGameTimestamp: accepterIGT,
      meta: { friendshipUUID: friendship.UUID },
    });
    refreshApp();
    notify({ title: 'Friends!', message: `You and ${player.username} are now friends.`, kind: 'success', persist: false });

    // Check town achievements after gaining a friend
    const freshPlayer = await databaseConnection.getCurrentPlayer();
    if (freshPlayer) {
      const newlyEarned = await checkPassiveAchievements(freshPlayer, databaseConnection);
      for (const key of newlyEarned) {
        const a = getAchievementByKey(key);
        if (a) notify({ title: 'Achievement Unlocked', message: a.label, kind: 'success', persist: false });
      }
    }
  };

  // Decline an incoming request
  const handleDecline = async () => {
    if (!friendship || !currentPlayer) return;
    const now = new Date().toISOString();
    await databaseConnection.remove(STORES.friendship, friendship.UUID);
    const notifs = await databaseConnection.getNotificationsForPlayer(currentPlayer.UUID);
    const reqNotif = notifs.find((n) => n.meta?.friendshipUUID === friendship.UUID);
    if (reqNotif) await databaseConnection.markNotificationRead(reqNotif.UUID);
    refreshApp();
    notify({ title: 'Request declined', message: `You declined ${player.username}'s friend request.`, kind: 'info', persist: false });
  };

  const openHistoryItem = (item) => {
    if (item.type === 'journal') { NiceModal.show(JournalDetailModal, { item }); return; }
    if (item.type === 'task')    { NiceModal.show(TodoDetailModal, { item }); return; }
    /* item_use and wake/end_work/sleep events all use the generic event modal */
    NiceModal.show(EventDetailModal, { item });
  };

  // Pin / unpin one of the viewer's own journal entries on their own profile
  const handleTogglePin = async (item) => {
    if (!item || item.type !== 'journal') return;
    const ownsEntry = item.parent && currentPlayer?.UUID && item.parent === currentPlayer.UUID;
    const onOwnProfile = player?.UUID === currentPlayer?.UUID;
    if (!ownsEntry || !onOwnProfile) return;
    const updated = { ...item, pinned: !item.pinned };
    /* Strip timeline-only synthesised fields before persisting back to STORES.journal */
    delete updated.type;
    delete updated.sortAt;
    await databaseConnection.add(STORES.journal, updated);
    refreshApp();
  };

  if (!player) return <div className="profile-page"><div className="profile-empty">Profile not found.</div></div>;

  const elo       = player.elo || 0;
  const rank      = getRank(elo);
  const rankLabel = getRankLabel(elo);
  const rankProg  = getRankProgress(elo);
  const rankClass = getRankClass(elo);
  const rankGlow  = getRankGlow(elo, 20);

  const profileBanner = player?.activeCosmetics?.profileBanner;
  const heroBgStyle = profileBanner
    ? profileBanner.type === 'gradient' ? { background: profileBanner.value }
    : profileBanner.type === 'color'    ? { background: profileBanner.value }
    : profileBanner.type === 'image'    ? { backgroundImage: `url(${profileBanner.value})`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : {}
    : {};

  const saveBanner = async (val) => {
    if (!player || !isSelf) return;
    const updated = { ...player, activeCosmetics: { ...(player.activeCosmetics || {}), profileBanner: val } };
    await databaseConnection.add(STORES.player, updated);
    setPlayer(updated);
    refreshApp();
    setShowBannerEditor(false);
  };

  return (
    <div className="profile-page">
      {/* ── Hero ── */}
      <div
        className={`profile-hero ${profileBanner ? 'profile-hero--has-banner' : ''} ${profileBanner?.type === 'image' ? 'profile-hero--has-image' : ''}`}
        style={heroBgStyle}
      >
        <div className={`profile-hero-overlay ${profileBanner ? 'profile-hero-overlay--strong' : ''}`} />
        {isSelf && hasBannerPass && (
          <button className="profile-banner-edit-btn" onClick={() => setShowBannerEditor(true)}>
            ✎ EDIT BANNER
          </button>
        )}
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
              {player.archivedAt && <span className="profile-archived-badge">Archived</span>}
              {/* Achievement bar */}
              <button
                className={`profile-ach-bar ${isSelf ? 'profile-ach-bar--editable' : ''}`}
                onClick={() => setShowAchievements(true)}
                title="View achievements"
              >
                {[0, 1, 2].map((i) => {
                  const key = player.selectedAchievements?.[i] || null;
                  const a   = key ? getAchievementByKey(key) : null;
                  const rarityPct = key ? computeRarity(key, allPlayersForRarity) : 0;
                  return (
                    <AchievementBadge
                      key={i}
                      achievementKey={key}
                      size={26}
                      empty={!a}
                      rarity={key ? getRarityLabel(rarityPct) : null}
                      showTooltip={!!a}
                      className="profile-ach-bar-badge"
                    />
                  );
                })}
              </button>
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
            <div className="profile-friend-actions">
              {accepted && (
                <button className="primary profile-friend-btn" disabled>✓ FRIENDS</button>
              )}
              {iRequested && (
                <button className="profile-friend-btn profile-friend-btn--pending" disabled>⏳ REQUEST SENT</button>
              )}
              {theyRequested && (
                <>
                  <button className="primary profile-friend-btn" onClick={handleAccept}>✓ ACCEPT</button>
                  <button className="profile-friend-btn profile-friend-btn--decline" onClick={handleDecline}>✕ DECLINE</button>
                </>
              )}
              {!accepted && !isPending && (
                <button className="primary profile-friend-btn" onClick={handleAddFriend}>+ ADD FRIEND</button>
              )}
            </div>
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
                : history.map((item) => {
                    const ownsEntry = item.parent && currentPlayer?.UUID && item.parent === currentPlayer.UUID;
                    const onOwnProfile = player?.UUID === currentPlayer?.UUID;
                    const canPin = item.type === 'journal' && ownsEntry && onOwnProfile;
                    return (
                      <HistoryItem
                        key={`${item.type}-${item.UUID}`}
                        item={item}
                        onOpen={openHistoryItem}
                        canPin={canPin}
                        onTogglePin={handleTogglePin}
                      />
                    );
                  })
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
                      onClick={() => NiceModal.show(MatchDetailsModal, { match, currentPlayerUUID: targetUUID, onOpenProfile: (id) => openPanel('profile', id) })}
                    >
                      <span className={`pmr-result ${matchOutcomeFor(match, targetUUID)}`}>
                        {matchOutcomeFor(match, targetUUID).toUpperCase()}
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

      {/* Inline banner editor for profile hero */}
      {showBannerEditor && (
        <ProfileBannerEditor
          current={profileBanner}
          onSave={saveBanner}
          onClose={() => setShowBannerEditor(false)}
        />
      )}

      {/* Achievements modal */}
      {showAchievements && (
        <AchievementsModal
          player={player}
          isSelf={isSelf}
          databaseConnection={databaseConnection}
          onClose={() => setShowAchievements(false)}
          onSaved={() => { setShowAchievements(false); refreshApp(); }}
        />
      )}
    </div>
  );
}
