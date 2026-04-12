/**
 * electron/main.js
 *
 * Main Electron process. Integrates the auto-updater.
 * Adjust the loadURL / loadFile call to match your Vite dev server port
 * and your built output path.
 */

const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const { initUpdater } = require('./updater');

const isDev = !app.isPackaged;

// ── Window factory ────────────────────────────────────────────────────────────
function createWindow() {
  const win = new BrowserWindow({
    width:  1200,
    height: 800,
    minWidth:  900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',  // remove if you prefer the default chrome
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,              // required for electron-updater preload
    },
  });

  if (isDev) {
    // Vite dev server — adjust port if yours differs
    win.loadURL('http://localhost:5173');
    win.webContents.openDevTools();
  } else {
    // Production build — adjust path to match your output directory
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // Open external links in the OS browser, not inside the app
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // ── Auto-updater: start checking after the page loads ─────────────────────
  win.webContents.on('did-finish-load', () => {
    initUpdater(win);
  });

  return win;
}

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    // macOS: re-create window if dock icon clicked and no windows open
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});