import { useEffect, useRef } from 'react';
import NiceModal from '@ebay/nice-modal-react';
import { markStartup } from '@shared/performance/startupPerf.js';
import { loadBanModal } from '@features/profile/loaders.js';

const showPendingBan = async () => {
  const BanModal = await loadBanModal();
  return NiceModal.show(BanModal, { forceFinal: true });
};

export function useCurrentPlayerSession({
  databaseConnection,
  profileRevision,
  matchesRevision,
  dataSourceReady,
  setCurrentPlayer,
  setCurrentPlayerLoaded,
}) {
  const banShownProfileRef = useRef(null);

  useEffect(() => {
    if (!dataSourceReady) {
      setCurrentPlayer(null);
      setCurrentPlayerLoaded(false);
      return undefined;
    }

    let cancelled = false;
    const load = async () => {
      markStartup('current-player-load-start');
      const player = await databaseConnection.getCurrentPlayer();
      if (cancelled) return;
      setCurrentPlayer(player || null);
      setCurrentPlayerLoaded(true);
      markStartup('current-player-loaded', {
        hasPlayer: !!player?.UUID,
      });

      if (
        player?.UUID
        && databaseConnection.hasBanPending(player.UUID)
        && banShownProfileRef.current !== player.UUID
      ) {
        banShownProfileRef.current = player.UUID;
        window.setTimeout(() => {
          showPendingBan().catch((error) => console.warn('Failed to load ban screen:', error));
        }, 150);
      }
    };

    load().catch((error) => console.warn('Failed to refresh app data:', error));
    return () => {
      cancelled = true;
    };
  }, [
    databaseConnection,
    profileRevision,
    matchesRevision,
    dataSourceReady,
    setCurrentPlayer,
    setCurrentPlayerLoaded,
  ]);
}
