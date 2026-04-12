/**
 * src/utils/updater.js
 *
 * Renderer-side utilities for the auto-updater.
 * Use the `useUpdater()` hook in Settings (or anywhere) to get live update state.
 *
 * Works only inside Electron. In the browser dev environment,
 * `window.updater` won't exist and everything degrades gracefully.
 */

import { useState, useEffect, useCallback } from 'react';

/** True when running inside Electron with the preload bridge available. */
export const isElectron = () =>
  typeof window !== 'undefined' && !!window.updater;

/**
 * @typedef {Object} UpdateStatus
 * @property {'idle'|'checking'|'available'|'downloading'|'ready'|'up-to-date'|'error'} state
 * @property {string}  [version]  - new version string (available / ready states)
 * @property {number}  [percent]  - download progress 0–100 (downloading state)
 * @property {number}  [speed]    - download speed in KB/s (downloading state)
 * @property {string}  [error]    - error message (error state)
 */

/**
 * Hook: subscribes to update status from the main process.
 * Returns { status, check, install }.
 */
export function useUpdater() {
  const [status, setStatus] = useState(/** @type {UpdateStatus} */({ state: 'idle' }));

  useEffect(() => {
    if (!isElectron()) return;
    const unsub = window.updater.onStatus(setStatus);
    // Ask for current status in case we mounted after a check already ran
    window.updater.getStatus();
    return unsub;
  }, []);

  const check = useCallback(() => {
    if (!isElectron()) return;
    window.updater.check();
  }, []);

  const install = useCallback(() => {
    if (!isElectron()) return;
    window.updater.install();
  }, []);

  return { status, check, install };
}

/** Human-readable label for each state. */
export function updaterStateLabel(state) {
  switch (state) {
    case 'checking':    return 'Checking for updates…';
    case 'available':   return 'Update found — downloading…';
    case 'downloading': return 'Downloading update…';
    case 'ready':       return 'Update ready to install';
    case 'up-to-date':  return 'You\'re up to date';
    case 'error':       return 'Update check failed';
    default:            return 'Up to date';
  }
}