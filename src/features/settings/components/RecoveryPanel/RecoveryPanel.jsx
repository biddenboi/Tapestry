import { useEffect, useState } from 'react';
import { publishMobileBootstrapData } from '@data/sync/MobileReferenceSync.js';

function downloadJson(databaseConnection, value, filename) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  databaseConnection._downloadBlob(blob, filename);
}

export default function RecoveryPanel({ databaseConnection, onRestored = null }) {
  const bridge = typeof window === 'undefined' ? null : window.tapestryDesktopBackups;
  const [desktop, setDesktop] = useState(null);
  const [desktopBusy, setDesktopBusy] = useState(false);
  const [serverBusy, setServerBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [comparison, setComparison] = useState(null);

  useEffect(() => {
    if (bridge?.getConfig) void bridge.getConfig().then(setDesktop).catch(() => setDesktop(null));
  }, [bridge]);

  const configureDesktop = async () => {
    if (!bridge || desktopBusy) return;
    setDesktopBusy(true);
    setMessage('');
    try {
      let next = desktop?.directory ? desktop : await bridge.chooseDirectory();
      if (!next) return;
      next = await bridge.setEnabled(true);
      setDesktop(next);
      const result = await databaseConnection.createEncryptedDesktopBackup();
      setDesktop(await bridge.getConfig());
      setMessage(`Encrypted backup created: ${result.filename}`);
    } catch (error) {
      setMessage(error?.message || 'Desktop backup configuration failed.');
    } finally {
      setDesktopBusy(false);
    }
  };

  const disableDesktop = async () => {
    if (!bridge || desktopBusy) return;
    setDesktopBusy(true);
    try {
      setDesktop(await bridge.setEnabled(false));
      setMessage('Scheduled desktop backups are paused. Existing files were not removed.');
    } finally {
      setDesktopBusy(false);
    }
  };

  const backupNow = async () => {
    setDesktopBusy(true);
    setMessage('');
    try {
      const result = await databaseConnection.createEncryptedDesktopBackup();
      setDesktop(await bridge.getConfig());
      setMessage(`Encrypted backup created: ${result.filename}`);
    } catch (error) {
      setMessage(error?.message || 'The encrypted backup could not be created.');
    } finally {
      setDesktopBusy(false);
    }
  };

  const restoreEncrypted = async () => {
    setDesktopBusy(true);
    setMessage('');
    try {
      const result = await databaseConnection.restoreEncryptedDesktopBackup();
      if (result) {
        setMessage('Encrypted desktop backup restored and verified.');
        onRestored?.();
      }
    } catch (error) {
      setMessage(error?.message || 'The encrypted backup could not be restored.');
    } finally {
      setDesktopBusy(false);
    }
  };

  const exportServer = async () => {
    const transport = databaseConnection?.syncRuntime?.transport;
    if (!transport?.exportServerSnapshot || serverBusy) return;
    setServerBusy(true);
    setMessage('');
    try {
      const snapshot = await transport.exportServerSnapshot();
      const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
      downloadJson(databaseConnection, snapshot, `tapestry-server-export-${stamp}.json`);
      setMessage('Owner-scoped server snapshot downloaded.');
    } catch (error) {
      setMessage(error?.message || 'The server snapshot could not be created.');
    } finally {
      setServerBusy(false);
    }
  };

  const compareIntegrity = async () => {
    const runtime = databaseConnection?.syncRuntime;
    const transport = runtime?.transport;
    if (!transport?.getServerIntegrity || serverBusy) return;
    setServerBusy(true);
    setMessage('');
    try {
      const [local, server, diagnostics] = await Promise.all([
        databaseConnection.verifySave({ persistReport: false }),
        transport.getServerIntegrity(),
        runtime.getDiagnostics(),
      ]);
      const ownerCursor = (diagnostics.cursors || []).find(({ streamName }) => streamName === 'owner')
        || diagnostics.cursors?.[0];
      const serverSequence = Number(server.latestSequence || 0);
      const localSequence = Number(ownerCursor?.serverSequence || 0);
      const queued = Number(diagnostics.counts?.pending || 0) + Number(diagnostics.counts?.uploading || 0);
      setComparison({
        localIntegrity: local.exportReady ? 'Ready' : 'Review',
        serverSequence,
        localSequence,
        sequenceLag: Math.max(0, serverSequence - localSequence),
        queued,
        serverCounts: server.counts || {},
        comparedAt: new Date().toISOString(),
      });
      setMessage('Local integrity and the server replication cursor were compared.');
    } catch (error) {
      setMessage(error?.message || 'The local/server comparison could not be completed.');
    } finally {
      setServerBusy(false);
    }
  };

  const publishMobileData = async () => {
    const transport = databaseConnection?.syncRuntime?.transport;
    if (!transport || serverBusy) return;
    setServerBusy(true);
    setMessage('Publishing the mobile-safe working set…');
    try {
      await databaseConnection.syncRuntime.synchronize({ reason: 'desktop-mobile-bootstrap-publish' });
      const result = await publishMobileBootstrapData(databaseConnection, transport);
      setMessage(`Published ${Number(result.uploaded || 0)} records for clean-device mobile restore.`);
    } catch (error) {
      setMessage(error?.message || 'Mobile data could not be published.');
    } finally {
      setServerBusy(false);
    }
  };

  const connected = Boolean(databaseConnection?.syncRuntime?.transport);
  return (
    <>
      <div className="settings-offline-storage">
        <div>
          <strong>Encrypted desktop backups</strong>
          <span>{!bridge ? 'Available in the desktop app' : desktop?.enabled ? 'Every 24 hours while Tapestry is running' : 'Not scheduled'}</span>
          {desktop?.lastRunAt && <small>Last backup {new Date(desktop.lastRunAt).toLocaleString()}</small>}
        </div>
        {bridge && (
          <div className="settings-folder-actions">
            <button type="button" disabled={desktopBusy} onClick={desktop?.enabled ? backupNow : configureDesktop}>
              {desktopBusy ? 'Working…' : desktop?.enabled ? 'Back up now' : 'Choose folder'}
            </button>
            {desktop?.enabled && <button type="button" disabled={desktopBusy} onClick={disableDesktop}>Pause</button>}
            <button type="button" disabled={desktopBusy} onClick={restoreEncrypted}>Restore</button>
          </div>
        )}
      </div>
      <div className="settings-offline-storage">
        <div>
          <strong>Server recovery snapshot</strong>
          <span>{connected ? 'Private server connected · mobile bootstrap is automatic' : 'Sign in and connect private sync first'}</span>
        </div>
        <div className="settings-folder-actions">
          <button type="button" disabled={!connected || serverBusy} onClick={publishMobileData}>Publish mobile data</button>
          <button type="button" disabled={!connected || serverBusy} onClick={exportServer}>Export server</button>
          <button type="button" disabled={!connected || serverBusy} onClick={compareIntegrity}>Compare integrity</button>
        </div>
      </div>
      {comparison && (
        <div className="settings-verification__grid">
          <span>Local<strong>{comparison.localIntegrity}</strong></span>
          <span>Server cursor<strong>{comparison.serverSequence}</strong></span>
          <span>Local cursor<strong>{comparison.localSequence}</strong></span>
          <span>Sequence lag<strong>{comparison.sequenceLag}</strong></span>
          <span>Queued<strong>{comparison.queued}</strong></span>
          <span>Server entities<strong>{Number(comparison.serverCounts.entities || 0)}</strong></span>
        </div>
      )}
      {message && <div className="settings-sync-status">{message}</div>}
    </>
  );
}
