import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import getSupabaseAuthService, {
  PRIMARY_OWNER_EMAIL,
} from '@data/sync/supabase/SupabaseAuthService.js';
import { describeMobileSyncState } from './MobileDataBackupModel.js';

const EMPTY_SYNC = Object.freeze({
  status: 'local-only',
  label: 'Local only',
  counts: {},
  openConflictCount: 0,
  transportConfigured: false,
});
const authService = getSupabaseAuthService();

export default function MobileDataBackupSettings({ databaseConnection, onRestored = null }) {
  const runtimeStore = databaseConnection.syncRuntime?.statusStore;
  const sync = useSyncExternalStore(
    runtimeStore?.subscribe || (() => () => undefined),
    runtimeStore?.getSnapshot || (() => EMPTY_SYNC),
    runtimeStore?.getSnapshot || (() => EMPTY_SYNC),
  );
  const auth = useSyncExternalStore(authService.subscribe, authService.getSnapshot, authService.getSnapshot);
  const [accountOpen, setAccountOpen] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const restoreRef = useRef(null);
  const online = typeof navigator === 'undefined' ? true : navigator.onLine;
  const status = describeMobileSyncState(sync, { online });

  useEffect(() => {
    void authService.initialize().catch((initializeError) => {
      setError(initializeError?.message || 'Private account status is unavailable.');
    });
  }, []);

  const perform = async (action, successMessage = '') => {
    if (busy) return null;
    setBusy(true);
    setMessage('');
    setError('');
    try {
      const result = await action();
      if (successMessage) setMessage(successMessage);
      return result;
    } catch (actionError) {
      setError(actionError?.message || 'The requested data action could not be completed.');
      return null;
    } finally {
      setBusy(false);
    }
  };

  const syncNow = () => perform(
    () => databaseConnection.syncRuntime.synchronize({ reason: 'mobile-settings-manual' }),
    'Private sync is up to date.',
  );

  const signInWithPassword = async (event) => {
    event.preventDefault();
    const result = await perform(() => authService.signInWithPassword(PRIMARY_OWNER_EMAIL, password));
    if (result) setPassword('');
  };

  const requestRecovery = () => perform(
    () => authService.signIn(PRIMARY_OWNER_EMAIL),
    'Recovery email requested.',
  );

  const restore = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const result = await perform(() => databaseConnection.saveUpload(file), 'Backup restored and verified.');
    if (result) await onRestored?.();
  };

  return (
    <div className="mobile-data-settings">
      <section className={`mobile-settings-card mobile-sync-summary is-${status.tone}`} aria-live="polite">
        <div><strong>{status.label}</strong><span>{status.detail}</span></div>
        <button type="button" onClick={syncNow} disabled={busy || !sync.transportConfigured || !online}>{busy ? 'Working…' : 'Sync now'}</button>
      </section>

      <section className="mobile-settings-card mobile-settings-disclosure">
        <button type="button" aria-expanded={accountOpen} onClick={() => setAccountOpen((value) => !value)}>
          <div><strong>Private account</strong><span>{!auth.configured ? 'Not configured in this build' : auth.user?.email || 'Signed out'}</span></div><b>{accountOpen ? '−' : '+'}</b>
        </button>
        {accountOpen && <div className="mobile-settings-disclosure__body">
          {!auth.configured && <p>Local SQLite remains available without a private account.</p>}
          {auth.configured && auth.user && <><p>Private sync is authenticated on this device.</p><button type="button" onClick={() => perform(() => authService.signOut(), 'Signed out on this device.')} disabled={busy || auth.busy}>Sign out</button></>}
          {auth.configured && !auth.user && <>
            <button type="button" className="primary" onClick={() => perform(() => authService.signInWithGoogle())} disabled={busy || auth.busy}>Continue with Google</button>
            <form onSubmit={signInWithPassword}>
              <label className="mobile-field"><span>Private-sync password</span><input type="password" autoComplete="current-password" maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
              <button type="submit" disabled={busy || auth.busy || !password}>Sign in with password</button>
            </form>
            <button type="button" onClick={requestRecovery} disabled={busy || auth.busy}>Email recovery link</button>
          </>}
        </div>}
      </section>

      <section className="mobile-settings-card mobile-settings-disclosure">
        <button type="button" aria-expanded={recoveryOpen} onClick={() => setRecoveryOpen((value) => !value)}>
          <div><strong>Backup and recovery</strong><span>Export or restore a verified compact package</span></div><b>{recoveryOpen ? '−' : '+'}</b>
        </button>
        {recoveryOpen && <div className="mobile-settings-disclosure__body">
          <button type="button" onClick={() => perform(() => databaseConnection.createCompactBackup(), 'Backup downloaded.')} disabled={busy}>Download backup</button>
          <input ref={restoreRef} type="file" accept=".zip,application/zip" className="mobile-settings-file-input" onChange={restore} />
          <button type="button" onClick={() => restoreRef.current?.click()} disabled={busy}>Restore backup…</button>
          <p>Restore replaces local data only after package verification succeeds.</p>
        </div>}
      </section>

      {(message || auth.notice) && <div className="mobile-settings-message" role="status">{message || auth.notice}</div>}
      {(error || auth.error?.message) && <div className="mobile-page-error" role="alert">{error || auth.error.message}</div>}
    </div>
  );
}

