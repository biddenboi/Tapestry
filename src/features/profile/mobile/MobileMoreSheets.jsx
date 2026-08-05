import { useEffect, useState } from 'react';
import { useAppContext } from '@app/hooks/useAppContext.js';
import { DOMAIN_INVALIDATION } from '@app/context/domainRevisions.js';
import { STORES } from '@domain/constants.js';
import ProfileIdentity from '@shared/profile-identity/ProfileIdentity.jsx';
import { useMobileSurface } from '@app/mobile/MobileSurfaceContext.jsx';

function notificationActorUUID(item) {
  return item?.meta?.requesterUUID
    || item?.meta?.accepterUUID
    || item?.meta?.actorUUID
    || item?.meta?.sourcePlayerUUID
    || null;
}

export function MobilePlayerSheet({ payload }) {
  const { closeSurface } = useMobileSurface();
  const { currentPlayer, metrics } = payload;

  return (
    <section className="mobile-sheet mobile-player-sheet" role="dialog" aria-modal="true" aria-labelledby="mobile-player-sheet-title">
      <header><div><span>Current player</span><h2 id="mobile-player-sheet-title">Identity</h2></div><button type="button" onClick={() => closeSurface()}>Close</button></header>
      <ProfileIdentity player={currentPlayer} rank="full" avatarSize={70} />
      <div className="mobile-player-sheet-stats"><span><b>{metrics.contribution}</b>Contribution</span><span><b>{metrics.points}</b>Points</span><span><b>{metrics.elo == null ? 'Unrated' : metrics.elo}</b>Elo</span><span><b>{metrics.coins}</b>Coins</span><span><b>{metrics.igt}</b>IGT</span></div>
    </section>
  );
}

export function MobileNotificationsSheet({ payload = {} }) {
  const { databaseConnection, currentPlayer, invalidateDomains } = useAppContext();
  const { closeSurface } = useMobileSurface();
  const [items, setItems] = useState([]);
  const [profiles, setProfiles] = useState({});
  useEffect(() => {
    if (!currentPlayer?.UUID) return;
    Promise.all([
      databaseConnection.getPlayerStore(STORES.notification, currentPlayer.UUID),
      databaseConnection.getAllPlayers?.({ includeArchived: false, includeBanned: false })
        || databaseConnection.getAll(STORES.player),
    ]).then(async ([rows, players]) => {
      const ordered = [...rows].sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || ''))).slice(0, 30);
      setItems(ordered);
      setProfiles(Object.fromEntries(players.map((profile) => [String(profile.UUID), profile])));
      await Promise.all(ordered.filter((item) => !item.readAt).map((item) => databaseConnection.markNotificationRead(item.UUID)));
      invalidateDomains?.(DOMAIN_INVALIDATION.inboxWrite);
      await payload.onRead?.();
    }).catch(() => setItems([]));
  }, [currentPlayer?.UUID, databaseConnection, invalidateDomains, payload]);
  return (
    <section className="mobile-sheet mobile-notifications-sheet" role="dialog" aria-modal="true" aria-labelledby="mobile-notifications-title">
      <header><div><span>Updates</span><h2 id="mobile-notifications-title">Notifications</h2></div><button type="button" onClick={() => closeSurface()}>Close</button></header>
      <div className="mobile-sheet-scroll">{items.map((item) => {
        const actor = profiles[String(notificationActorUUID(item))] || null;
        return <article key={item.UUID} className={item.readAt ? '' : 'is-unread'}>{actor && <ProfileIdentity player={actor} compact avatarOnly avatarSize={36} />}<div><strong>{item.title || 'Tapestry'}</strong><p>{item.message || ''}</p><small>{new Date(item.createdAt).toLocaleString()}</small></div></article>;
      })}{!items.length && <div className="mobile-compact-empty"><strong>No notifications</strong><span>System and social updates appear here.</span></div>}</div>
    </section>
  );
}
