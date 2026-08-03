import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useAppContext } from '@app/hooks/useAppContext.js';
import getSupabaseAuthService, {
  BACKUP_OWNER_EMAIL,
  PRIMARY_OWNER_EMAIL,
} from '@data/sync/supabase/SupabaseAuthService.js';
import { markStartup } from '@shared/performance/startupPerf.js';
import ModalFrame from '@shared/ui/ModalFrame.jsx';
import { continueInThisInstance, isWriterLeaseError } from '@shared/runtime/InstanceHandoff.js';
import '@app/data-source/DataSourceGate/DataSourceGate.css';

const auth = getSupabaseAuthService();

function demoAvailable() {
  if (typeof window === 'undefined') return false;
  return ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname)
    || new URLSearchParams(window.location.search).has('demo');
}

export default function DataSourceGate({ onReady }) {
  const { databaseConnection } = useAppContext();
  const snapshot = useSyncExternalStore(auth.subscribe, auth.getSnapshot, auth.getSnapshot);
  const [phase, setPhase] = useState('checking');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [leaseBlocked, setLeaseBlocked] = useState(false);
  const [password, setPassword] = useState('');
  const [summary, setSummary] = useState(null);
  const zipUploadRef = useRef(null);
  const folderUploadRef = useRef(null);
  const restorePromiseRef = useRef(null);

  const finishOpening = useCallback(async () => {
    await databaseConnection.reconcileMissingMaterializedLeaderboards({
      reason: 'cloud-first-startup-cache-reconciliation',
    });
    markStartup('data-source-ready');
    onReady();
  }, [databaseConnection, onReady]);

  const restoreFromCloud = useCallback(async () => {
    if (restorePromiseRef.current) return restorePromiseRef.current;
    const restore = (async () => {
      setBusy(true);
      setPhase('downloading');
      setError('');
      try {
        await databaseConnection.ready;
        await auth.initialize();
        const session = auth.getSnapshot().session;
        if (!session?.user?.id) throw new Error('Sign in before restoring this Tapestry workspace.');

        const [{ initializeSupabaseSync }, { restoreMobileBootstrapData }] = await Promise.all([
          import('@data/sync/supabase/SupabaseSyncBootstrap.js'),
          import('@data/sync/MobileReferenceSync.js'),
        ]);
        // Configuration is awaited before restore. On an empty device the
        // bootstrap is pull-only and checkpoint publication remains gated.
        await initializeSupabaseSync(databaseConnection);
        const runtime = databaseConnection.syncRuntime;
        const transport = runtime?.transport;
        if (!transport) throw new Error('Private Sync could not connect to the cloud.');

        const checkpoint = await transport.downloadDatabaseCheckpoint?.();
        let restored = null;
        let bootstrap = null;
        if (checkpoint?.found) {
          restored = await databaseConnection.restoreCloudCheckpoint(checkpoint.bytes, {
            manifest: checkpoint.manifest,
          });
        } else {
          // Older accounts may not have a full checkpoint yet. The bounded
          // reference mirror plus operation log remains a migration fallback,
          // never the normal desktop-open path after the first checkpoint.
          bootstrap = await restoreMobileBootstrapData(databaseConnection, transport);
        }

        const players = await databaseConnection.getAll('players');
        if (!players.length) {
          setSummary({ checkpoint, bootstrap, restored });
          setPhase('empty-cloud');
          return;
        }

        runtime.setCheckpointPublishingEnabled(true);
        const synchronization = await runtime.synchronize({
          reason: checkpoint?.found
            ? 'desktop-cloud-checkpoint-restored'
            : 'desktop-reference-bootstrap-restored',
        });
        setSummary({
          checkpointCreatedAt: checkpoint?.manifest?.createdAt || null,
          checkpointBytes: Number(checkpoint?.bytes?.byteLength || 0),
          referenceRecords: Number(bootstrap?.applied || 0),
          uploaded: Number(synchronization?.uploaded || 0),
          pulled: Number(synchronization?.pulled || 0),
        });
        setPhase('ready');
        await finishOpening();
      } catch (restoreError) {
        setPhase('error');
        setLeaseBlocked(isWriterLeaseError(restoreError));
        setError(restoreError?.message || 'Tapestry could not restore the cloud database.');
      } finally {
        restorePromiseRef.current = null;
        setBusy(false);
      }
    })();
    restorePromiseRef.current = restore;
    return restore;
  }, [databaseConnection, finishOpening]);

  useEffect(() => {
    let cancelled = false;
    const open = async () => {
      try {
        markStartup('data-source-inspect-start');
        await databaseConnection.ready;
        const players = await databaseConnection.getAll('players');
        if (cancelled) return;
        const runtime = databaseConnection.syncRuntime;
        const cleanCloudRestorePending = Boolean(
          players.length
          && runtime?.transport
          && !runtime.checkpointPublishingEnabled,
        );
        if (players.length && !cleanCloudRestorePending) {
          runtime?.setCheckpointPublishingEnabled(true);
          await finishOpening();
          return;
        }
        await auth.initialize();
        if (cancelled) return;
        setPhase('account');
      } catch (loadError) {
        if (!cancelled) {
          setPhase('error');
          setLeaseBlocked(isWriterLeaseError(loadError));
          setError(loadError?.message || 'Unable to open the SQLite data store.');
        }
      }
    };
    void open();
    return () => { cancelled = true; };
  }, [databaseConnection, finishOpening]);

  useEffect(() => {
    if (snapshot.status === 'signed-in' && ['checking', 'account'].includes(phase)) {
      void restoreFromCloud();
    }
  }, [phase, restoreFromCloud, snapshot.session?.access_token, snapshot.status]);

  const signInWithPassword = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await auth.signInWithPassword(PRIMARY_OWNER_EMAIL, password);
      setPassword('');
    } catch (signInError) {
      setError(signInError?.message || 'The private-sync password was not accepted.');
    } finally {
      setBusy(false);
    }
  };

  const signInWithGoogle = async () => {
    setBusy(true);
    setError('');
    try {
      await auth.signInWithGoogle();
    } catch (signInError) {
      setError(signInError?.message || 'Google sign-in could not start.');
      setBusy(false);
    }
  };

  const requestLink = async (email) => {
    setBusy(true);
    setError('');
    try {
      await auth.signIn(email);
    } catch (requestError) {
      setError(requestError?.message || 'The private sign-in link could not be sent.');
    } finally {
      setBusy(false);
    }
  };

  const restoreZip = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      await databaseConnection.saveUpload(file);
      databaseConnection.syncRuntime?.setCheckpointPublishingEnabled(true);
      await databaseConnection.syncRuntime?.synchronize({ reason: 'recovery-zip-restored' });
      await finishOpening();
    } catch (uploadError) {
      setError(uploadError?.message || 'Unable to restore the Tapestry save.');
    } finally {
      setBusy(false);
    }
  };

  const restoreFolder = async (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!files.length) return;
    setBusy(true);
    setError('');
    try {
      await databaseConnection.saveFolderUpload(files);
      databaseConnection.syncRuntime?.setCheckpointPublishingEnabled(true);
      await databaseConnection.syncRuntime?.synchronize({ reason: 'recovery-folder-restored' });
      await finishOpening();
    } catch (uploadError) {
      setError(uploadError?.message || 'Unable to restore the Tapestry folder.');
    } finally {
      setBusy(false);
    }
  };

  const startNew = async () => {
    databaseConnection.syncRuntime?.setCheckpointPublishingEnabled(true);
    await finishOpening();
  };

  const useDemo = async () => {
    setBusy(true);
    setError('');
    try {
      await databaseConnection.loadDemoData();
      databaseConnection.syncRuntime?.setCheckpointPublishingEnabled(false);
      await finishOpening();
    } catch (demoError) {
      setError(demoError?.message || 'Unable to load demo data.');
    } finally {
      setBusy(false);
    }
  };

  const continueHere = async () => {
    setBusy(true);
    setError('Asking the other Tapestry window to finish synchronizing and release storage…');
    try {
      await continueInThisInstance();
    } catch (handoffError) {
      setError(handoffError?.message || 'The other Tapestry window could not release storage yet.');
      setBusy(false);
    }
  };

  const signedOut = ['signed-out', 'checking'].includes(snapshot.status);
  const downloading = phase === 'checking' || phase === 'downloading';
  const title = leaseBlocked ? 'Tapestry is open elsewhere'
    : phase === 'empty-cloud' ? 'No cloud workspace found'
      : phase === 'error' ? 'Cloud restore needs attention'
        : snapshot.status === 'signed-in' ? 'Opening Tapestry from cloud' : 'Connect your Tapestry';
  const subtitle = leaseBlocked
    ? 'Continue here to safely hand local storage over from the other browser window.'
    : signedOut
      ? 'Sign in to restore the latest private SQLite checkpoint automatically.'
      : 'The cloud database is restored first, then newer operations are replayed.';

  if (phase === 'checking') {
    return <div className="data-source-gate-shell" aria-label="Opening Tapestry data" />;
  }

  return (
    <div className="data-source-gate-shell">
      <ModalFrame
        open
        title={title}
        subtitle={subtitle}
        eyebrow="Private cloud data"
        size="md"
        accent="var(--color-profile)"
        closeOnBackdrop={false}
        closeOnEscape={false}
        className="data-source-gate"
        footer={(
          <div className="data-source-gate__actions">
            <input
              ref={zipUploadRef}
              type="file"
              accept=".zip,application/zip"
              className="data-source-gate__file-input"
              onChange={restoreZip}
            />
            <input
              ref={folderUploadRef}
              type="file"
              className="data-source-gate__file-input"
              webkitdirectory=""
              directory=""
              multiple
              onChange={restoreFolder}
            />
            {leaseBlocked ? (
              <button type="button" className="primary" disabled={busy} onClick={continueHere}>
                {busy ? 'Requesting control…' : 'Continue here'}
              </button>
            ) : (
              <>
                {demoAvailable() && signedOut && (
                  <button type="button" disabled={busy} onClick={useDemo}>Use demo data</button>
                )}
                {!downloading && (
                  <>
                    <button type="button" disabled={busy} onClick={() => zipUploadRef.current?.click()}>
                      Recovery ZIP
                    </button>
                    <button type="button" disabled={busy} onClick={() => folderUploadRef.current?.click()}>
                      Recovery folder
                    </button>
                  </>
                )}
                {snapshot.status === 'signed-in' && ['error', 'empty-cloud'].includes(phase) && (
                  <button type="button" className="primary" disabled={busy} onClick={restoreFromCloud}>
                    {busy ? 'Restoring…' : 'Retry cloud restore'}
                  </button>
                )}
                {phase === 'empty-cloud' && (
                  <button type="button" disabled={busy} onClick={startNew}>Create new workspace</button>
                )}
              </>
            )}
          </div>
        )}
      >
        <div className="data-source-gate__body">
          {!leaseBlocked && signedOut && !downloading && (
            <form className="data-source-gate__cloud-signin" onSubmit={signInWithPassword}>
              <label htmlFor="desktop-private-sync-password">Private owner sign-in</label>
              <span>{PRIMARY_OWNER_EMAIL}</span>
              <button type="button" className="primary" disabled={busy} onClick={signInWithGoogle}>
                {busy ? 'Connecting…' : 'Continue with Google'}
              </button>
              <small>or use your private-sync password</small>
              <input
                id="desktop-private-sync-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Enter password"
                maxLength={128}
                disabled={busy}
              />
              <button type="submit" className="primary" disabled={busy || !password}>
                {busy ? 'Signing in…' : 'Sign in with password'}
              </button>
              <div className="data-source-gate__recovery-links">
                <button type="button" disabled={busy} onClick={() => requestLink(PRIMARY_OWNER_EMAIL)}>
                  Email recovery link
                </button>
                <button type="button" disabled={busy} onClick={() => requestLink(BACKUP_OWNER_EMAIL)}>
                  Backup-email recovery
                </button>
              </div>
            </form>
          )}
          <div className="data-source-gate__card">
            <span className="data-source-gate__kicker">Cloud-first persistence</span>
            <strong>{leaseBlocked
              ? 'Your local database remains intact'
              : downloading ? 'Restoring the latest verified SQLite checkpoint…' : 'No manual file transfer required'}</strong>
            <span>{leaseBlocked
              ? 'Continue Here asks the active copy to flush pending writes, synchronize, and release the writer lock.'
              : 'Normal startup uses the private cloud checkpoint. ZIP and folder import remain recovery tools only.'}</span>
          </div>
          {summary?.checkpointCreatedAt && (
            <div className="data-source-gate__warning">
              Restored cloud checkpoint from {new Date(summary.checkpointCreatedAt).toLocaleString()}.
            </div>
          )}
          {snapshot.notice && signedOut && <div className="data-source-gate__warning">{snapshot.notice}</div>}
          {phase === 'empty-cloud' && (
            <div className="data-source-gate__warning">
              The account is connected, but no profile exists in its checkpoint or synchronized records.
            </div>
          )}
          {(error || snapshot.error?.message) && (
            <div className="data-source-gate__error">{error || snapshot.error.message}</div>
          )}
        </div>
      </ModalFrame>
    </div>
  );
}
