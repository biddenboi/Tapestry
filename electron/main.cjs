const { app, BrowserWindow, dialog, ipcMain, safeStorage } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('path');

const BACKUP_FORMAT = Buffer.from('TAPESTRY-ENC-1\n', 'utf8');

function backupConfigPath() {
  return path.join(app.getPath('userData'), 'desktop-backups.json');
}

function backupKeyPath() {
  return path.join(app.getPath('userData'), 'desktop-backup-key.bin');
}

async function readBackupConfig() {
  try {
    const parsed = JSON.parse(await fs.readFile(backupConfigPath(), 'utf8'));
    return {
      enabled: parsed.enabled === true,
      directory: typeof parsed.directory === 'string' ? parsed.directory : null,
      lastRunAt: typeof parsed.lastRunAt === 'string' ? parsed.lastRunAt : null,
      intervalHours: 24,
    };
  } catch {
    return { enabled: false, directory: null, lastRunAt: null, intervalHours: 24 };
  }
}

async function writeBackupConfig(patch) {
  const next = { ...(await readBackupConfig()), ...patch, intervalHours: 24 };
  await fs.mkdir(path.dirname(backupConfigPath()), { recursive: true });
  await fs.writeFile(backupConfigPath(), JSON.stringify(next, null, 2), { mode: 0o600 });
  return next;
}

async function desktopBackupKey() {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('The operating-system secure storage is unavailable.');
  }
  try {
    const encrypted = await fs.readFile(backupKeyPath());
    return Buffer.from(safeStorage.decryptString(encrypted), 'base64url');
  } catch (error) {
    if (error?.code && error.code !== 'ENOENT') throw error;
    const key = crypto.randomBytes(32);
    const encrypted = safeStorage.encryptString(key.toString('base64url'));
    await fs.mkdir(path.dirname(backupKeyPath()), { recursive: true });
    await fs.writeFile(backupKeyPath(), encrypted, { mode: 0o600 });
    return key;
  }
}

async function encryptBackup(bytes) {
  const key = await desktopBackupKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return Buffer.concat([BACKUP_FORMAT, iv, cipher.getAuthTag(), ciphertext]);
}

async function decryptBackup(bytes) {
  if (!bytes.subarray(0, BACKUP_FORMAT.length).equals(BACKUP_FORMAT)) {
    throw new Error('This is not a Tapestry encrypted backup.');
  }
  const key = await desktopBackupKey();
  const ivStart = BACKUP_FORMAT.length;
  const iv = bytes.subarray(ivStart, ivStart + 12);
  const tag = bytes.subarray(ivStart + 12, ivStart + 28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(bytes.subarray(ivStart + 28)), decipher.final()]);
}

function installBackupIpc() {
  ipcMain.handle('tapestry-backup:get-config', () => readBackupConfig());
  ipcMain.handle('tapestry-backup:choose-directory', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Choose Tapestry backup folder',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return writeBackupConfig({ directory: path.resolve(result.filePaths[0]) });
  });
  ipcMain.handle('tapestry-backup:set-enabled', (_event, enabled) => (
    writeBackupConfig({ enabled: enabled === true })
  ));
  ipcMain.handle('tapestry-backup:write', async (_event, payload = {}) => {
    const config = await readBackupConfig();
    if (!config.enabled || !config.directory) throw new Error('Scheduled desktop backups are not configured.');
    const bytes = Buffer.from(payload.bytes || []);
    if (!bytes.length || bytes.length > 1024 * 1024 * 1024) throw new Error('The backup payload is invalid.');
    const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
    const requested = path.basename(String(payload.filename || `tapestry-backup-${stamp}.zip`));
    const filename = `${requested.replace(/\.zip$/i, '')}.tapestry.enc`;
    const destination = path.join(config.directory, filename);
    await fs.mkdir(config.directory, { recursive: true });
    await fs.writeFile(destination, await encryptBackup(bytes), { mode: 0o600 });
    const next = await writeBackupConfig({ lastRunAt: new Date().toISOString() });
    return { path: destination, filename, lastRunAt: next.lastRunAt };
  });
  ipcMain.handle('tapestry-backup:restore', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Restore encrypted Tapestry backup',
      properties: ['openFile'],
      filters: [{ name: 'Tapestry encrypted backup', extensions: ['enc'] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const source = path.resolve(result.filePaths[0]);
    const decrypted = await decryptBackup(await fs.readFile(source));
    return { bytes: new Uint8Array(decrypted), filename: `${path.basename(source, '.tapestry.enc')}.zip` };
  });
}


function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs')
    }
  });

  // In development, load from Vite dev server
  if (process.env.NODE_ENV === 'development') {
    const devServerUrl = process.env.TAPESTRY_VITE_DEV_SERVER_URL;
    if (!devServerUrl) {
      throw new Error('TAPESTRY_VITE_DEV_SERVER_URL is required in development. Start with npm run electron:dev.');
    }
    mainWindow.loadURL(devServerUrl);
    mainWindow.webContents.openDevTools();
  } else {
    // In production, load the built files
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(() => {
  installBackupIpc();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
