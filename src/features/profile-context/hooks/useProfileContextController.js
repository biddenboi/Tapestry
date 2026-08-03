import { useCallback, useEffect, useMemo, useState } from 'react';
import { DOMAIN_INVALIDATION } from '@app/context/domainRevisions.js';

export function useProfileContextController({
  databaseConnection,
  ensureDomainLoaded,
  invalidateDomains,
  ownerId,
  viewerId,
  relationshipTier,
  viewerIGT,
  revision = 0,
  enabled = true,
} = {}) {
  const [projection, setProjection] = useState(null);
  const [ownerState, setOwnerState] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!enabled || !ownerId || !viewerId) return null;
    setLoading(true);
    setError(null);
    try {
      await ensureDomainLoaded?.('profileContext');
      const isOwner = String(ownerId) === String(viewerId);
      const [nextProjection, nextOwnerState] = await Promise.all([
        databaseConnection.getProfileContextProjection({
          viewerId,
          subjectId: ownerId,
          relationshipTier,
          viewerIGT,
          revision,
        }),
        isOwner
          ? databaseConnection.getProfileContextOwnerState({ ownerId, viewerId })
          : null,
      ]);
      setProjection(nextProjection);
      setOwnerState(nextOwnerState);
      return { projection: nextProjection, ownerState: nextOwnerState };
    } catch (nextError) {
      setError(nextError);
      return null;
    } finally {
      setLoading(false);
    }
  }, [
    databaseConnection,
    enabled,
    ensureDomainLoaded,
    ownerId,
    relationshipTier,
    revision,
    viewerIGT,
    viewerId,
  ]);

  useEffect(() => {
    let active = true;
    load().then((value) => { if (!active && value) return null; });
    return () => { active = false; };
  }, [load]);

  const command = useCallback(async (method, payload) => {
    setSaving(true);
    setError(null);
    try {
      const result = await databaseConnection[method]({
        ownerId,
        actorId: viewerId,
        viewerIGT,
        ...payload,
      });
      invalidateDomains?.(DOMAIN_INVALIDATION.profileContextWrite);
      await load();
      return result;
    } catch (nextError) {
      setError(nextError);
      throw nextError;
    } finally {
      setSaving(false);
    }
  }, [databaseConnection, invalidateDomains, load, ownerId, viewerIGT, viewerId]);

  return useMemo(() => ({
    projection,
    ownerState,
    loading,
    saving,
    error,
    reload: load,
    saveQuick: (payload) => command('saveQuickProfileContext', payload),
    saveItem: (payload) => command('saveProfileContextItem', payload),
    revokeItem: (itemId) => command('revokeProfileContextItem', { itemId }),
    resolveSuggestion: (payload) => command('resolveProfileContextSuggestion', payload),
    savePreferences: (preferences) => command('saveProfileContextPreferences', { preferences }),
    refreshSuggestions: async () => {
      setSaving(true);
      try {
        await ensureDomainLoaded?.(['tasks', 'profileContext']);
        const result = await databaseConnection.refreshProfileContextSuggestions({
          ownerId,
          viewerIGT,
        });
        invalidateDomains?.(DOMAIN_INVALIDATION.profileContextWrite);
        await load();
        return result;
      } finally {
        setSaving(false);
      }
    },
    preview: ({ previewViewerId, previewTier }) => databaseConnection.getProfileContextProjection({
      viewerId: previewViewerId,
      subjectId: ownerId,
      relationshipTier: previewTier,
      viewerIGT,
      revision: `${revision}:preview`,
    }),
  }), [
    command,
    databaseConnection,
    ensureDomainLoaded,
    error,
    invalidateDomains,
    load,
    loading,
    ownerId,
    ownerState,
    projection,
    revision,
    saving,
    viewerIGT,
  ]);
}

export default useProfileContextController;

