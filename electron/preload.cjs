const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  // Add any APIs you want to expose to your React app
});

/**
 * electron/preload.js
 *
 * Exposes a safe `window.updater` API to the renderer via contextBridge.
 * This file is referenced in your BrowserWindow's webPreferences:
 *
 *   new BrowserWindow({
 *     webPreferences: {
 *       preload: path.join(__dirname, 'preload.js'),
 *       contextIsolation: true,
 *       nodeIntegration: false,   // keep this false
 *     }
 *   });
 *
 * If you already have a preload.js, merge the `updater` section into it.
 */

const { contextBridge, ipcRenderer } = require('electron');

// ── Updater bridge ────────────────────────────────────────────────────────────
contextBridge.exposeInMainWorld('updater', {
  /** Trigger a manual update check. */
  check: () => ipcRenderer.send('updater:check'),

  /** Quit and install the downloaded update. */
  install: () => ipcRenderer.send('updater:install'),

  /** Request the current status object (fires 'updater:status' in response). */
  getStatus: () => ipcRenderer.send('updater:get-status'),

  /**
   * Subscribe to status updates.
   * @param {(status: UpdateStatus) => void} callback
   * @returns {() => void} unsubscribe function
   *
   * Status shape: { state, version?, percent?, speed?, error? }
   */
  onStatus: (callback) => {
    const handler = (_event, status) => callback(status);
    ipcRenderer.on('updater:status', handler);
    return () => ipcRenderer.removeListener('updater:status', handler);
  },
});

/*
 * If you want to expose other Electron APIs (e.g. app version),
 * add them here:
 *
 * contextBridge.exposeInMainWorld('electron', {
 *   getVersion: () => ipcRenderer.invoke('app:get-version'),
 * });
 */