import { useEffect, useMemo, useState } from 'react';
import { useAppContext } from '@app/hooks/useAppContext.js';
import { projectDojoStandings } from '@domain/social-world/DojoStandings.js';
import { DOJO_STANDINGS_UPDATED_EVENT } from '@data/persistence/services/DojoStandingsService.js';

const EMPTY = Object.freeze({ current: null, around: [], top: [], updating: false });

export default function useDojoStandingsController({
  active,
  scene,
  dojoSessionUUID,
} = {}) {
  const { databaseConnection, currentPlayer, domainRevisions } = useAppContext();
  const [standings, setStandings] = useState(EMPTY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handleUpdate = () => setRefresh((revision) => revision + 1);
    window.addEventListener(DOJO_STANDINGS_UPDATED_EVENT, handleUpdate);
    return () => window.removeEventListener(DOJO_STANDINGS_UPDATED_EVENT, handleUpdate);
  }, []);

  useEffect(() => {
    if (!active || !currentPlayer?.UUID) return undefined;
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.resolve(databaseConnection.ensureDomainLoaded?.('leaderboards'))
      .then(() => databaseConnection.getDojoStandings({
        playerId: currentPlayer.UUID,
        currentSessionId: dojoSessionUUID,
        aroundRadius: 2,
        topLimit: 10,
      })).then((next) => {
      if (!cancelled) setStandings(next || EMPTY);
    }).catch((nextError) => {
      if (!cancelled) {
        setStandings(EMPTY);
        setError(nextError);
      }
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [
    active,
    currentPlayer?.UUID,
    databaseConnection,
    dojoSessionUUID,
    domainRevisions.leaderboards,
    domainRevisions.tasks,
    refresh,
  ]);

  return useMemo(() => ({
    ...projectDojoStandings(standings, scene),
    error,
    loading,
  }), [error, loading, scene, standings]);
}
