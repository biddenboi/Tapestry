const { spawn } = require('node:child_process');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const devServerUrl = 'http://localhost:5173';
const ansiPattern = /\x1B\[[0-?]*[ -/]*[@-~]/g;

let electronProcess = null;
let stopping = false;
let readyTimer = null;
let viteOutputBuffer = '';

const viteProcess = spawn(
  npmCommand,
  ['exec', 'vite', '--', '--host', 'localhost', '--port', '5173', '--strictPort'],
  {
    cwd: projectRoot,
    env: { ...process.env, BROWSER: 'none' },
    stdio: ['inherit', 'pipe', 'pipe'],
  },
);

function stopChildren(signal = 'SIGTERM') {
  if (stopping) return;
  stopping = true;
  if (readyTimer) clearTimeout(readyTimer);
  if (electronProcess && !electronProcess.killed) electronProcess.kill(signal);
  if (!viteProcess.killed) viteProcess.kill(signal);
}

function launchElectron() {
  if (electronProcess || stopping) return;
  if (readyTimer) clearTimeout(readyTimer);
  const electronPath = require('electron');
  electronProcess = spawn(electronPath, ['.'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      TAPESTRY_VITE_DEV_SERVER_URL: devServerUrl,
    },
    stdio: 'inherit',
  });
  electronProcess.on('error', (error) => {
    console.error('[electron:dev] Electron failed to start:', error);
    stopChildren();
    process.exitCode = 1;
  });
  electronProcess.on('exit', (code, signal) => {
    if (!stopping) {
      process.exitCode = code ?? (signal ? 1 : 0);
      stopChildren();
    }
  });
}

function inspectViteOutput(chunk) {
  const output = String(chunk);
  process.stdout.write(output);
  const plain = output.replace(ansiPattern, '');
  viteOutputBuffer = `${viteOutputBuffer}${plain}`.slice(-8192);
  if (viteOutputBuffer.includes('Local:') && viteOutputBuffer.includes(devServerUrl)) launchElectron();
}

viteProcess.stdout.on('data', inspectViteOutput);
viteProcess.stderr.on('data', (chunk) => process.stderr.write(chunk));
viteProcess.on('error', (error) => {
  console.error('[electron:dev] Vite failed to start:', error);
  process.exitCode = 1;
  stopChildren();
});
viteProcess.on('exit', (code, signal) => {
  if (!stopping) {
    if (!electronProcess) {
      console.error('[electron:dev] The Vite process exited before this run became ready.');
    }
    process.exitCode = code ?? (signal ? 1 : 0);
    stopChildren();
  }
});

readyTimer = setTimeout(() => {
  console.error(`[electron:dev] Timed out waiting for this Vite process at ${devServerUrl}.`);
  process.exitCode = 1;
  stopChildren();
}, 30000);

process.once('SIGINT', () => stopChildren('SIGINT'));
process.once('SIGTERM', () => stopChildren('SIGTERM'));
process.once('exit', () => stopChildren());
