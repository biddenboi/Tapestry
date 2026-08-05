import { useEffect, useState, useSyncExternalStore } from 'react';
import { isRetiredWorkingSetSyncError } from '@data/sync/SyncErrorPolicy.js';
import getSupabaseAuthService, {
  BACKUP_OWNER_EMAIL,
  PRIMARY_OWNER_EMAIL,
} from '@data/sync/supabase/SupabaseAuthService.js';

const service = getSupabaseAuthService();



export default function SyncAccountPanel() {
  const snapshot = useSyncExternalStore(
    service.subscribe,
    service.getSnapshot,
    service.getSnapshot,
  );
  const [requestError, setRequestError] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');

  useEffect(() => {
    service.clearRetiredWorkingSetError?.();
    void service.initialize()
      .then(() => service.clearRetiredWorkingSetError?.())
      .catch((error) => setRequestError(error?.message || 'Unable to inspect sign-in.'));
  }, []);

  const requestLink = async (email) => {
    setRequestError('');
    try {
      await service.signIn(email);
    } catch (error) {
      setRequestError(error?.message || 'Unable to send the private sign-in link.');
    }
  };

  const signOut = async () => {
    setRequestError('');
    try {
      await service.signOut();
    } catch (error) {
      setRequestError(error?.message || 'Unable to sign out on this device.');
    }
  };

  const signInWithPassword = async (event) => {
    event.preventDefault();
    setRequestError('');
    try {
      await service.signInWithPassword(PRIMARY_OWNER_EMAIL, password);
      setPassword('');
    } catch (error) {
      setRequestError(error?.message || 'Unable to sign in with the private-sync password.');
    }
  };

  const signInWithGoogle = async () => {
    setRequestError('');
    try {
      await service.signInWithGoogle();
    } catch (error) {
      setRequestError(error?.message || 'Unable to start Google sign-in.');
    }
  };

  const savePassword = async (event) => {
    event.preventDefault();
    setRequestError('');
    if (password !== confirmation) {
      setRequestError('The password confirmation does not match.');
      return;
    }
    try {
      await service.setPassword(password);
      setPassword('');
      setConfirmation('');
    } catch (error) {
      setRequestError(error?.message || 'Unable to save the private-sync password.');
    }
  };

  const authenticationError = isRetiredWorkingSetSyncError(snapshot.error)
    ? null
    : snapshot.error;

  if (!snapshot.configured) {
    return (
      <div className="settings-sync-account settings-sync-account--unavailable">
        <div>
          <strong>Private account</strong>
          <span>Supabase client settings are not present in this build. Local SQLite remains available.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="settings-sync-account">
      <div className="settings-sync-account__identity">
        <strong>Private account</strong>
        {snapshot.user ? (
          <>
            <span>{snapshot.user.email}</span>
            <small>Private account connected</small>
          </>
        ) : (
          <>
            <span>Sign in directly with the private-sync password. Email is recovery-only.</span>
            <small>Local only</small>
          </>
        )}
      </div>
      <div className="settings-sync-account__actions">
        {snapshot.user ? (
          <>
            <form className="settings-sync-account__password-form" onSubmit={savePassword}>
              <input
                type="password"
                autoComplete="new-password"
                value={password}
                minLength={12}
                maxLength={128}
                placeholder="New password (12+ characters)"
                disabled={snapshot.busy}
                onChange={(event) => setPassword(event.target.value)}
              />
              <input
                type="password"
                autoComplete="new-password"
                value={confirmation}
                minLength={12}
                maxLength={128}
                placeholder="Confirm password"
                disabled={snapshot.busy}
                onChange={(event) => setConfirmation(event.target.value)}
              />
              <button type="submit" className="primary" disabled={snapshot.busy || !password || !confirmation}>
                {snapshot.busy ? 'Saving…' : 'Set/change mobile password'}
              </button>
            </form>
            <button type="button" disabled={snapshot.busy} onClick={signOut}>Sign out</button>
          </>
        ) : (
          <>
            <button type="button" className="primary" disabled={snapshot.busy} onClick={signInWithGoogle}>
              {snapshot.busy ? 'Connecting…' : 'Continue with Google'}
            </button>
            <form className="settings-sync-account__password-form" onSubmit={signInWithPassword}>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                maxLength={128}
                placeholder="Private-sync password"
                disabled={snapshot.busy}
                onChange={(event) => setPassword(event.target.value)}
              />
              <button type="submit" className="primary" disabled={snapshot.busy || !password}>
                {snapshot.busy ? 'Signing in…' : 'Sign in with password'}
              </button>
            </form>
            <button
              type="button"
              disabled={snapshot.busy}
              onClick={() => requestLink(PRIMARY_OWNER_EMAIL)}
            >
              Email recovery link
            </button>
            <button
              type="button"
              className="settings-sync-account__backup"
              disabled={snapshot.busy}
              onClick={() => requestLink(BACKUP_OWNER_EMAIL)}
            >
              Use backup email
            </button>
          </>
        )}
      </div>
      {(snapshot.notice || authenticationError?.message || requestError) && (
        <span className={authenticationError || requestError
          ? 'settings-sync-account__message settings-sync-account__message--error'
          : 'settings-sync-account__message'}
        >
          {requestError || authenticationError?.message || snapshot.notice}
        </span>
      )}
    </div>
  );
}
