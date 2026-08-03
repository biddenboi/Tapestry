import { useEffect, useMemo, useRef, useState } from 'react';
import { getCurrentIGT } from '../../../domain/time/Time.js';
import { PRESENCE_INTERRUPTION } from '../../../domain/social-world/SocialWorldContracts.js';
import SocialWorldPresenceController from '../controllers/SocialWorldPresenceController.js';

export function useSocialWorldPresenceLifecycle({
  databaseConnection,
  dataSourceReady,
  currentPlayer,
  timestamp,
  gameState,
  activeTask,
  activeMatch,
  dojoSessionUUID,
  activePanel,
  invalidateDomains,
} = {}) {
  const controller = useMemo(
    () => new SocialWorldPresenceController({ gateway: databaseConnection }),
    [databaseConnection],
  );
  const [reconciledPlayerId, setReconciledPlayerId] = useState(null);
  const [pageActive, setPageActive] = useState(true);
  const liveFactsRef = useRef(null);
  const viewerIGT = getCurrentIGT(currentPlayer, timestamp);

  useEffect(() => () => controller.dispose(), [controller]);

  liveFactsRef.current = {
    playerId: currentPlayer?.UUID || null,
    viewerIGT,
    gameState,
    activeTask,
    activeMatch,
    dojoSessionUUID,
    activePanel,
    presenceVisibilityPolicy: currentPlayer?.presenceVisibilityPolicy || 'state-only',
  };

  useEffect(() => {
    if (!dataSourceReady || !currentPlayer?.UUID) {
      setReconciledPlayerId(null);
      return undefined;
    }
    let cancelled = false;
    setReconciledPlayerId(null);
    controller.reconcile({ playerId: currentPlayer.UUID })
      .then((result) => {
        if (result?.invalidatedDomains?.length) invalidateDomains?.(...result.invalidatedDomains);
        if (!cancelled) setReconciledPlayerId(currentPlayer.UUID);
      })
      .catch((error) => {
        console.warn('[SocialWorld] startup presence reconciliation failed:', error);
        if (!cancelled) setReconciledPlayerId(currentPlayer.UUID);
      });
    return () => { cancelled = true; };
  }, [controller, currentPlayer?.UUID, dataSourceReady, invalidateDomains]);

  useEffect(() => {
    if (!pageActive
        || !dataSourceReady
        || reconciledPlayerId !== currentPlayer?.UUID) return;
    controller.synchronize({
      ...liveFactsRef.current,
    }).then((result) => {
      if (result?.invalidatedDomains?.length) invalidateDomains?.(...result.invalidatedDomains);
    }).catch((error) => console.warn('[SocialWorld] presence transition failed:', error));
  }, [
    activeMatch,
    activePanel,
    activeTask,
    controller,
    currentPlayer?.UUID,
    dataSourceReady,
    pageActive,
    dojoSessionUUID,
    gameState,
    invalidateDomains,
    reconciledPlayerId,
    viewerIGT,
  ]);

  useEffect(() => {
    if (typeof document === 'undefined' || typeof window === 'undefined') return undefined;
    let mounted = true;
    const applyInvalidations = (result) => {
      if (result?.invalidatedDomains?.length) invalidateDomains?.(...result.invalidatedDomains);
      return result;
    };
    const close = (interruption) => {
      const facts = liveFactsRef.current;
      if (!facts?.playerId) return;
      controller.closeForInterruption({ ...facts, interruption })
        .then(applyInvalidations)
        .catch((error) => console.warn('[SocialWorld] presence interruption failed:', error));
    };
    const resume = () => {
      const facts = liveFactsRef.current;
      if (!facts?.playerId) {
        if (mounted) setPageActive(true);
        return;
      }
      controller.resumeForeground(facts)
        .then(applyInvalidations)
        .catch((error) => console.warn('[SocialWorld] foreground presence resume failed:', error))
        .finally(() => {
          if (mounted) setPageActive(true);
        });
    };
    const handlePageHide = () => {
      setPageActive(false);
      close(PRESENCE_INTERRUPTION.appClose);
    };
    const handlePageShow = () => resume();
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('pageshow', handlePageShow);
    return () => {
      mounted = false;
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('pageshow', handlePageShow);
    };
  }, [controller, invalidateDomains]);
}

export default useSocialWorldPresenceLifecycle;
