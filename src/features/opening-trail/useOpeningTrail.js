import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppContext } from '@app/hooks/useAppContext.js';
import { reconcileOpeningTrail } from '@domain/contribution-road/ContributionRoad.js';

export default function useOpeningTrail() {
  const { databaseConnection, currentPlayer, domainRevisions } = useAppContext();
  const [trail, setTrail] = useState(null);
  const load = useCallback(async () => {
    if (!currentPlayer?.UUID) return;
    setTrail(await reconcileOpeningTrail(databaseConnection, currentPlayer.UUID));
  }, [currentPlayer?.UUID, databaseConnection]);
  useEffect(() => { load().catch((error) => console.warn('[OpeningTrail] reconciliation failed:', error)); }, [load, domainRevisions.contributionRoad]);
  const revealed = useMemo(() => new Set(trail?.steps?.filter((step) => step.revealed).flatMap((step) => step.reveals) || []), [trail]);
  return Object.freeze({
    trail,
    revealed,
    isRevealed: (capability) => revealed.has(capability),
    refresh: load,
  });
}
