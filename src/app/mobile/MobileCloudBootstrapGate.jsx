import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useAppContext } from '@app/hooks/useAppContext.js';
import getSupabaseAuthService, {
  BACKUP_OWNER_EMAIL,
  PRIMARY_OWNER_EMAIL,
} from '@data/sync/supabase/SupabaseAuthService.js';
import ModalFrame from '@shared/ui/ModalFrame.jsx';
import { continueInThisInstance, isWriterLeaseError } from '@shared/runtime/InstanceHandoff.js';
import '@app/data-source/DataSourceGate/DataSourceGate.css';
import './MobileCloudBootstrapGate.css';

const auth = getSupabaseAuthService();

function demoAvailable() {
  if (typeof window === 'undefined') return false;
  return ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname)
    || new URLSearchParams(window.location.search).has('demo');
}


function isDemoOnlyWorkspace(players = []) {
  return players.length > 0 && players.every((player) => (
    String(player?.UUID || player?.id || '').startsWith('demo-')
  ));
}

function restoreProgressText(progress) {
  if (!progress || progress.stage === 'connecting') return 'Connecting to your private cloud…';
  if (progress.stage === 'downloading') {
    const records = Number(progress.downloaded || 0).toLocaleString();
    const pages = Number(progress.page || 0);
    return `Downloaded ${records} records${pages ? ` across ${pages} ${pages === 1 ? 'batch' : 'batches'}` : ''}…`;
  }
  if (progress.stage === 'applying') {
    return `Applying ${Number(progress.total || progress.downloaded || 0).toLocaleString()} synchronized records…`;
  }
  if (progress.stage === 'synchronizing') return 'Checking for newer changes from your other devices…';
  if (progress.stage === 'opening') {
    return `Opening ${Number(progress.applied || 0).toLocaleString()} restored records…`;
  }
  return 'Preparing your private workspace…';
}

export default function MobileCloudBootstrapGate({ onReady }) {
  const { databaseConnection } = useAppContext();
  const snapshot = useSyncExternalStore(auth.subscribe, auth.getSnapshot, auth.getSnapshot);
  const [phase, setPhase] = useState('checking');
  const [error, setError] = useState('');
  const [summary, setSummary] = useState(null);
  const [restoreProgress, setRestoreProgress] = useState(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [leaseBlocked, setLeaseBlocked] = useState(false);
  const [password, setPassword] = useState('');
  const zipUploadRef = useRef(null);
  const restorePromiseRef = useRef(null);

  const restoreFromCloud = useCallback(async () => {
    if (restorePromiseRef.current) return restorePromiseRef.current;
    const restore = (async () => {
      setPhase('downloading');
      setError('');
      setRestoreProgress({ stage: 'connecting', downloaded: 0, page: 0 });
      try {
        await databaseConnection.ready;
        const [{ initializeSupabaseSync }, { restoreMobileBootstrapData }] = await Promise.all([
          import('@data/sync/supabase/SupabaseSyncBootstrap.js'),
          import('@data/sync/MobileReferenceSync.js'),
        ]);
        await initializeSupabaseSync(databaseConnection);
        const transport = databaseConnection.syncRuntime?.transport;
        if (!transport) throw new Error('Private sync could not connect on this device.');
        const bootstrap = await restoreMobileBootstrapData(databaseConnection, transport, {
          onProgress: setRestoreProgress,
        });
        setRestoreProgress({
          stage: 'synchronizing',
          downloaded: Number(bootstrap.downloaded || 0),
          applied: Number(bootstrap.applied || 0),
        });
        const players = await databaseConnection.getAll('players');
        setSummary({
          downloaded: Number(bootstrap.downloaded || 0),
          applied: Number(bootstrap.applied || 0),
          pulled: 0,
          syncPending: true,
        });
        if (!players.length) {
          setPhase('empty-cloud');
          return;
        }
        setPhase('ready');
        setRestoreProgress({
          stage: 'opening',
          downloaded: Number(bootstrap.downloaded || 0),
          applied: Number(bootstrap.applied || 0),
        });
        onReady();
        // The reference mirror above is already the complete current working
        // set. Replay the operation log behind the usable shell so a slow or
        // unavailable sync endpoint never strands startup on this gate.
        void databaseConnection.syncRuntime.synchronize({
          reason: 'mobile-clean-device-bootstrap',
        }).catch((syncError) => {
          console.warn('[Tapestry] Mobile bootstrap sync will retry in the background.', syncError);
        });
      } catch (restoreError) {
        setPhase('error');
        setLeaseBlocked(isWriterLeaseError(restoreError));
        setError(restoreError?.message || 'Tapestry could not download your private mobile data.');
      } finally {
        restorePromiseRef.current = null;
      }
    })();
    restorePromiseRef.current = restore;
    return restore;
  }, [databaseConnection, onReady]);

  useEffect(() => {
    let cancelled = false;
    const initialize = async () => {
      try {
        await databaseConnection.ready;
        const players = await databaseConnection.getAll('players');
        if (cancelled) return;
        if (players.length && !isDemoOnlyWorkspace(players)) {
          const { initializeSupabaseSync } = await import('@data/sync/supabase/SupabaseSyncBootstrap.js');
          await initializeSupabaseSync(databaseConnection);
          if (cancelled) return;
          onReady();
          void databaseConnection.syncRuntime?.synchronize?.({
            reason: 'mobile-resume-before-open',
          }).catch((syncError) => {
            // Existing local SQLite remains usable offline. The durable queue
            // and runtime backoff retry without closing the application.
            console.warn('[Tapestry] Mobile resume sync will retry in the background.', syncError);
          });
          return;
        }
        await auth.initialize();
        if (!cancelled) setPhase('account');
      } catch (initializationError) {
        if (!cancelled) {
          setPhase('error');
          setLeaseBlocked(isWriterLeaseError(initializationError));
          setError(initializationError?.message || 'Tapestry could not prepare local mobile storage.');
        }
      }
    };
    void initialize();
    return () => { cancelled = true; };
  }, [databaseConnection, onReady]);

  useEffect(() => {
    if (snapshot.status === 'signed-in' && ['checking', 'account'].includes(phase)) {
      void restoreFromCloud();
    }
  }, [phase, restoreFromCloud, snapshot.session?.access_token, snapshot.status]);

  const requestLink = async (email) => {
    setAuthBusy(true);
    setError('');
    try {
      await auth.signIn(email);
    } catch (requestError) {
      setError(requestError?.message || 'The private sign-in link could not be sent.');
    } finally {
      setAuthBusy(false);
    }
  };

  const signInWithPassword = async (event) => {
    event.preventDefault();
    setAuthBusy(true);
    setError('');
    try {
      await auth.signInWithPassword(PRIMARY_OWNER_EMAIL, password);
      setPassword('');
    } catch (signInError) {
      setError(signInError?.message || 'The private-sync password was not accepted.');
    } finally {
      setAuthBusy(false);
    }
  };

  const signInWithGoogle = async () => {
    setAuthBusy(true);
    setError('');
    try {
      await auth.signInWithGoogle();
    } catch (signInError) {
      setError(signInError?.message || 'Google sign-in could not start.');
      setAuthBusy(false);
    }
  };

  const useDemo = async () => {
    setAuthBusy(true);
    setError('');
    try {
      await databaseConnection.loadDemoData();
      onReady();
    } catch (demoError) {
      setError(demoError?.message || 'Unable to load mobile demo data.');
    } finally {
      setAuthBusy(false);
    }
  };

  const disconnectAccount = async () => {
    setAuthBusy(true);
    setError('');
    try {
      await auth.signOut();
      setSummary(null);
      setRestoreProgress(null);
      setPhase('account');
    } catch (signOutError) {
      setError(signOutError?.message || 'This account could not be disconnected.');
    } finally {
      setAuthBusy(false);
    }
  };

  const restoreZip = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setPhase('zip');
    setError('');
    try {
      await databaseConnection.saveUpload(file);
      onReady();
    } catch (restoreError) {
      setPhase('error');
      setError(restoreError?.message || 'The recovery ZIP could not be restored.');
    }
  };

  const continueHere = async () => {
    setAuthBusy(true);
    setError('Asking the other Tapestry window to finish synchronizing and release storage…');
    try {
      await continueInThisInstance();
    } catch (handoffError) {
      setError(handoffError?.message || 'The other Tapestry window could not release storage yet.');
      setAuthBusy(false);
    }
  };

  const signedOut = snapshot.status === 'signed-out' || snapshot.status === 'checking';
  const downloading = phase === 'checking' || phase === 'downloading' || phase === 'zip';
  const title = leaseBlocked ? 'Tapestry is open elsewhere'
    : phase === 'empty-cloud' ? 'Desktop data needed'
    : phase === 'error' ? 'Mobile restore needs attention'
      : snapshot.status === 'signed-in' ? 'Restoring Tapestry' : 'Connect your Tapestry';
  const subtitle = signedOut
    ? 'Sign in once to download the private data published by your desktop.'
    : 'Your synchronized records are restored into private local storage on this device.';

  return (
    <div className="data-source-gate-shell mobile-cloud-bootstrap-shell">
      <ModalFrame
        open
        title={title}
        subtitle={subtitle}
        eyebrow="Private mobile setup"
        size="md"
        accent="var(--color-profile)"
        closeOnBackdrop={false}
        closeOnEscape={false}
        className="data-source-gate mobile-cloud-bootstrap"
        footer={(
          <div className="data-source-gate__actions mobile-cloud-bootstrap__actions">
            <input
              ref={zipUploadRef}
              type="file"
              accept=".zip,application/zip"
              className="data-source-gate__file-input"
              onChange={restoreZip}
            />
            {leaseBlocked ? (
              <button type="button" className="primary" disabled={authBusy} onClick={continueHere}>
                {authBusy ? 'Requesting control…' : 'Continue here'}
              </button>
            ) : signedOut && !downloading && (
              <>
                {demoAvailable() && (
                  <button type="button" disabled={authBusy} onClick={useDemo}>Use demo data</button>
                )}
                <button type="button" disabled={authBusy} onClick={() => requestLink(BACKUP_OWNER_EMAIL)}>
                  Backup-email recovery
                </button>
                <button type="button" disabled={authBusy} onClick={() => requestLink(PRIMARY_OWNER_EMAIL)}>
                  Email recovery link
                </button>
              </>
            )}
            {!leaseBlocked && ['empty-cloud', 'error'].includes(phase) && snapshot.status === 'signed-in' && (
              <>
                <button type="button" disabled={authBusy} onClick={disconnectAccount}>Use another account</button>
                <button type="button" className="primary" disabled={authBusy} onClick={restoreFromCloud}>Retry download</button>
              </>
            )}
            {!leaseBlocked && !downloading && (
              <button type="button" onClick={() => zipUploadRef.current?.click()}>Recovery ZIP</button>
            )}
          </div>
        )}
      >
          <div className="data-source-gate__body">
          {!leaseBlocked && signedOut && !downloading && (
            <form className="mobile-cloud-bootstrap__password" onSubmit={signInWithPassword}>
              <label htmlFor="mobile-private-sync-password">Private owner sign-in</label>
              <span>{PRIMARY_OWNER_EMAIL}</span>
              <button type="button" className="primary" disabled={authBusy} onClick={signInWithGoogle}>
                {authBusy ? 'Connecting…' : 'Continue with Google'}
              </button>
              <small className="mobile-cloud-bootstrap__divider">or use your private-sync password</small>
              <input
                id="mobile-private-sync-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Enter password"
                maxLength={128}
                disabled={authBusy}
              />
              <button type="submit" className="primary" disabled={authBusy || !password}>
                {authBusy ? 'Signing in…' : 'Sign in with password'}
              </button>
              <small>Password setup is optional under desktop Settings → Data &amp; Backup.</small>
            </form>
          )}
          <div className="data-source-gate__card mobile-cloud-bootstrap__card">
            <span className="data-source-gate__kicker">Cloud-first restore</span>
            <strong>{leaseBlocked
              ? 'Your local data is safe'
              : downloading ? 'Preparing your private workspace…' : 'No manual save transfer required'}</strong>
            <span>
              {leaseBlocked
                ? 'Continue Here asks the active Safari or Home Screen copy to flush, synchronize, and enter standby. Tapestry never resets the database to solve a lock.'
                : phase === 'empty-cloud'
                ? 'Open Tapestry on your desktop, connect Private Sync, and choose Publish mobile data. Then retry here.'
                : 'Tapestry downloads the mobile-safe working set, then replays newer synchronized operations.'}
            </span>
            {snapshot.status === 'signed-in' && !['error', 'empty-cloud'].includes(phase) && (
              <div className="mobile-cloud-bootstrap__progress" role="status" aria-live="polite">
                <span>{restoreProgressText(restoreProgress)}</span>
                <div aria-hidden="true"><i /></div>
              </div>
            )}
          </div>
          {snapshot.notice && signedOut && <div className="mobile-cloud-bootstrap__notice">{snapshot.notice}</div>}
          {summary && phase === 'empty-cloud' && (
            <div className="mobile-cloud-bootstrap__notice">
              The server responded, but it does not contain a published profile yet.
            </div>
          )}
          {(error || snapshot.error?.message) && (
            <div className="data-source-gate__error">{error || snapshot.error.message}</div>
          )}
          <p className="mobile-cloud-bootstrap__recovery-note">
            Google or your private-sync password handles normal setup. Email and ZIP are recovery options.
          </p>
        </div>
      </ModalFrame>
    </div>
  );
}
