import { useCallback, useEffect } from 'react';
import NiceModal from '@ebay/nice-modal-react';
import {
  getDailyLifecycleAppLaunchId,
  getDailyLifecycleLaunchState,
  needsInitialProfile,
} from '@domain/events/DailyLifecycleService.js';
import { markStartup } from '@shared/performance/startupPerf.js';
import { loadProfileSwitcher } from '@features/profile/loaders.js';
import { loadWakePopup } from '@features/events/loaders.js';

const startupLatch = {
  profileSwitcherKey: null,
  wakeKey: null,
};

/**
 * Routes the durable start-of-day gate for both desktop and mobile shells.
 * A completed night ritual requires profile selection and then the selected
 * profile's morning checklist on the following application launch.
 */
export function useDayBoundaryAutomation({
  databaseConnection,
  currentPlayer,
  currentPlayerLoaded,
  eventRevision,
  profileRevision,
  onGateActiveChange,
}) {
  const showProfileSwitcher = useCallback(async (props = {}) => {
    await databaseConnection.ensureDomainLoaded?.('profiles');
    const ProfileSwitcher = await loadProfileSwitcher();
    return NiceModal.show(ProfileSwitcher, { mode: 'startup', ...props });
  }, [databaseConnection]);

  useEffect(() => {
    if (!currentPlayerLoaded) {
      onGateActiveChange?.(false);
      return undefined;
    }
    let cancelled = false;
    onGateActiveChange?.(true);

    const routeDailyLifecycle = async () => {
      // Normal arrivals remain non-blocking; only a durable transition receipt opens a gate.
      const launchState = await getDailyLifecycleLaunchState(databaseConnection);
      if (cancelled) return;

      if (
        launchState?.state === 'profile-selection-required'
        && launchState.sourceLaunchId !== getDailyLifecycleAppLaunchId()
      ) {
        const key = `profile:${launchState.flowId}`;
        if (startupLatch.profileSwitcherKey !== key) {
          startupLatch.profileSwitcherKey = key;
          markStartup('profile-switcher-needed', { reason: 'end-of-day-reopen' });
          showProfileSwitcher({
            eodDateStr: launchState.eodDateStr,
            lifecycleFlowId: launchState.flowId,
          }).catch((error) => console.warn('[DailyLifecycle] profile switcher load failed:', error));
        }
        return;
      }

      if (launchState?.state === 'wake-required') {
        if (String(currentPlayer?.UUID || '') !== String(launchState.selectedPlayerUUID || '')) return;
        const key = `wake:${launchState.flowId}:${launchState.selectedPlayerUUID}`;
        if (startupLatch.wakeKey !== key) {
          startupLatch.wakeKey = key;
          const WakePopup = await loadWakePopup();
          markStartup('wake-checklist-needed', { reason: 'selected-profile' });
          NiceModal.show(WakePopup, { lifecycleFlowId: launchState.flowId })
            .catch((error) => console.warn('[DailyLifecycle] wake checklist load failed:', error));
        }
        return;
      }

      if (needsInitialProfile(currentPlayer)) {
        const key = 'profile:initial';
        if (startupLatch.profileSwitcherKey !== key) {
          startupLatch.profileSwitcherKey = key;
          markStartup('profile-switcher-needed', { reason: 'initial-profile' });
          showProfileSwitcher()
            .catch((error) => console.warn('[DailyLifecycle] profile switcher load failed:', error));
        }
        return;
      }

      startupLatch.profileSwitcherKey = null;
      startupLatch.wakeKey = null;
      onGateActiveChange?.(false);
      markStartup('day-gate-cleared', { reason: 'continuity-entry' });
    };

    routeDailyLifecycle().catch((error) => {
      if (cancelled) return;
      onGateActiveChange?.(false);
      console.warn('[DailyLifecycle] routing failed:', error);
    });

    return () => { cancelled = true; };
  }, [
    currentPlayer,
    currentPlayerLoaded,
    databaseConnection,
    eventRevision,
    onGateActiveChange,
    profileRevision,
    showProfileSwitcher,
  ]);
}
