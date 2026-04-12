/**
 * electron/updater.js
 *
 * Handles auto-updates via electron-updater + GitHub Releases.
 *
 * SETUP REQUIRED (see bottom of file for step-by-step):
 *   1. npm install electron-updater
 *   2. Add publish config to package.json (see below)
 *   3. Import and call initUpdater(mainWindow) from your main.js
 *   4. When you release: git tag v1.x.x, push, then run electron-builder
 *
 * IPC channels (renderer → main):
 *   'updater:check'          — check for update now
 *   'updater:install'        — quit and install downloaded update
 *   'updater:get-status'     — request current status object
 *
 * IPC channels (main → renderer):
 *   'updater:status'         — { state, version?, percent?, error? }
 *
 * State values:
 *   'idle'         — no update activity
 *   'checking'     — checking for updates
 *   'available'    — update found, about to download
 *   'downloading'  — downloading (percent field set)
 *   'ready'        — downloaded and ready to install
 *   'up-to-date'   — already on latest
 *   'error'        — something went wrong (error field set)
 */

const { autoUpdater }  = require('electron-updater');
const { ipcMain }      = require('electron');
const log              = require('electron-log');  // comes with electron-updater

// ── Configure logging ─────────────────────────────────────────────────────────
autoUpdater.logger         = log;
autoUpdater.logger.transports.file.level = 'info';
autoUpdater.autoDownload   = true;   // download silently in the background
autoUpdater.autoInstallOnAppQuit = false; // we'll prompt the user instead

let _mainWindow = null;
let _currentStatus = { state: 'idle' };

// ── Internal helpers ──────────────────────────────────────────────────────────
function send(status) {
  _currentStatus = status;
  if (_mainWindow && !_mainWindow.isDestroyed()) {
    _mainWindow.webContents.send('updater:status', status);
  }
}

// ── autoUpdater events ────────────────────────────────────────────────────────
autoUpdater.on('checking-for-update', () => {
  send({ state: 'checking' });
});

autoUpdater.on('update-available', (info) => {
  send({ state: 'available', version: info.version });
});

autoUpdater.on('update-not-available', () => {
  send({ state: 'up-to-date' });
  // Reset to idle after 5 s so the UI doesn't linger
  setTimeout(() => send({ state: 'idle' }), 5000);
});

autoUpdater.on('download-progress', (progress) => {
  send({
    state:   'downloading',
    percent: Math.round(progress.percent),
    speed:   Math.round(progress.bytesPerSecond / 1024), // KB/s
  });
});

autoUpdater.on('update-downloaded', (info) => {
  send({ state: 'ready', version: info.version });
  log.info(`Update ${info.version} downloaded and ready to install`);
});

autoUpdater.on('error', (err) => {
  const msg = err?.message || String(err);
  send({ state: 'error', error: msg });
  log.error('Auto-updater error:', msg);
  // Reset to idle after 8 s
  setTimeout(() => send({ state: 'idle' }), 8000);
});

// ── IPC handlers ──────────────────────────────────────────────────────────────
function registerIPC() {
  // Renderer requests a manual check
  ipcMain.on('updater:check', () => {
    autoUpdater.checkForUpdates().catch(err => {
      send({ state: 'error', error: err.message });
    });
  });

  // Renderer wants to quit and install
  ipcMain.on('updater:install', () => {
    autoUpdater.quitAndInstall(false, true); // isSilent=false, isForceRunAfter=true
  });

  // Renderer requests the current status (e.g. on page load)
  ipcMain.on('updater:get-status', (event) => {
    event.reply('updater:status', _currentStatus);
  });
}

// ── Public init ───────────────────────────────────────────────────────────────
/**
 * Call this from your main.js after the main window is ready.
 * @param {BrowserWindow} mainWindow
 */
function initUpdater(mainWindow) {
  _mainWindow = mainWindow;
  registerIPC();

  // Auto-check on launch, with a 3-second delay so the app finishes loading
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(err => {
      log.error('Startup update check failed:', err.message);
    });
  }, 3000);
}

module.exports = { initUpdater };

/*
 * ============================================================
 * SETUP INSTRUCTIONS — Read this once, then delete this block
 * ============================================================
 *
 * 1. INSTALL DEPENDENCIES
 *    npm install electron-updater electron-log
 *
 * 2. CONFIGURE PACKAGE.JSON
 *    Add this to your package.json (replace username/repo):
 *
 *    "build": {
 *      "appId": "com.yourname.canopy",
 *      "productName": "Canopy",
 *      "publish": {
 *        "provider": "github",
 *        "owner": "YOUR_GITHUB_USERNAME",
 *        "repo": "canopy",
 *        "private": false
 *      },
 *      "mac": {
 *        "target": ["dmg", "zip"]
 *      },
 *      "win": {
 *        "target": ["nsis"]
 *      },
 *      "linux": {
 *        "target": ["AppImage"]
 *      }
 *    }
 *
 * 3. IMPORT IN MAIN.JS
 *    const { initUpdater } = require('./updater');
 *
 *    app.whenReady().then(() => {
 *      const win = new BrowserWindow({ ... });
 *      win.loadURL(...);
 *      win.webContents.on('did-finish-load', () => {
 *        initUpdater(win);
 *      });
 *    });
 *
 * 4. MAKE A RELEASE
 *    a. Bump the version in package.json (e.g. "version": "1.1.0")
 *    b. Commit and push:
 *         git add -A && git commit -m "v1.1.0"
 *         git tag v1.1.0
 *         git push && git push --tags
 *    c. Build and publish:
 *         GH_TOKEN=your_github_token npx electron-builder --publish always
 *       OR if you use a CI/CD workflow, just push the tag and let it build.
 *
 *    electron-builder will:
 *      - Build the app for each platform
 *      - Create a GitHub Release with the tag name
 *      - Upload the installers + latest.yml (the manifest electron-updater reads)
 *
 * 5. GITHUB TOKEN
 *    Create one at: github.com → Settings → Developer settings →
 *    Personal access tokens → Fine-grained tokens
 *    Scopes needed: repo (write), releases (write)
 *    Store it in your environment as GH_TOKEN, never in code.
 *
 * 6. FOR PRIVATE REPOS
 *    Set "private": true in the publish config and pass the GH_TOKEN
 *    to the running app via:
 *      autoUpdater.setFeedURL({
 *        provider: 'github', owner: '...', repo: '...', token: process.env.GH_TOKEN
 *      });
 *    But for simplicity, a public repo is recommended for a solo project.
 * ============================================================
 */