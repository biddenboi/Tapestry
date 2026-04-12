import { useContext, useState } from 'react';
import { AppContext } from '../../App';
import { supabase } from '../../network/supabaseClient';
import NiceModal from '@ebay/nice-modal-react';
import UpgradePopup from '../../Modals/UpgradePopup/UpgradePopup';
import { STORES } from '../../utils/Constants';
import { useUpdater, updaterStateLabel, isElectron } from '../../utils/updater';
import './Settings.css';

// ── Update section sub-component ─────────────────────────────────────────────
function UpdatesSection() {
  const { status, check, install } = useUpdater();
  const { state, version, percent, speed, error } = status;

  if (!isElectron()) {
    return (
      <section className="settings-section">
        <h3 className="settings-section-title">Updates</h3>
        <p className="settings-hint">Auto-update is only available in the desktop app.</p>
      </section>
    );
  }

  const isActive   = ['checking','available','downloading'].includes(state);
  const isReady    = state === 'ready';
  const isError    = state === 'error';
  const isUpToDate = state === 'up-to-date';

  return (
    <section className="settings-section">
      <h3 className="settings-section-title">Updates</h3>

      {/* Status display */}
      <div className="settings-row">
        <span className="settings-label">Status</span>
        <span className={`settings-value update-status-text update-status--${state}`}>
          {updaterStateLabel(state)}
          {state === 'downloading' && percent != null && ` (${percent}%)`}
        </span>
      </div>

      {/* Version badge when update is available */}
      {version && (state === 'available' || state === 'downloading' || state === 'ready') && (
        <div className="settings-row">
          <span className="settings-label">New version</span>
          <span className="settings-value settings-badge settings-badge--full">v{version}</span>
        </div>
      )}

      {/* Download progress bar */}
      {state === 'downloading' && percent != null && (
        <div className="update-progress-wrap">
          <div className="update-progress-bar" style={{ width: `${percent}%` }} />
          <span className="update-progress-label">
            {percent}%{speed ? ` · ${speed} KB/s` : ''}
          </span>
        </div>
      )}

      {/* Error message */}
      {isError && error && (
        <p className="settings-feedback settings-feedback--error">{error}</p>
      )}

      {/* Actions */}
      <div className="settings-row settings-row--actions">
        {isReady ? (
          <button className="btn-success" onClick={install}>
            Restart and install v{version}
          </button>
        ) : (
          <button
            className="btn-primary"
            onClick={check}
            disabled={isActive}
          >
            {isActive ? updaterStateLabel(state) : 'Check for updates'}
          </button>
        )}
      </div>
    </section>
  );
}

// ── Main Settings component ───────────────────────────────────────────────────
function Settings() {
  const {
    databaseConnection: db,
    player,
    refresh,
    hasAccess,
    isOnline,
    syncing,
    pendingSyncCount,
    lastSyncedAt,
  } = useContext(AppContext);

  const [accessKey,    setAccessKey]    = useState('');
  const [keyStatus,    setKeyStatus]    = useState(null);
  const [keyMessage,   setKeyMessage]   = useState('');
  const [keyLoading,   setKeyLoading]   = useState(false);
  const [downloading,  setDownloading]  = useState(false);
  const [pwSection,    setPwSection]    = useState(false);
  const [newPw,        setNewPw]        = useState('');
  const [pwStatus,     setPwStatus]     = useState('');

  const handleClaimKey = async (e) => {
    e.preventDefault();
    if (!accessKey.trim()) return;
    setKeyLoading(true);
    setKeyStatus(null);
    const result = await db.claimAccessKey(accessKey.trim());
    if (result?.success) {
      setKeyStatus('success');
      setKeyMessage('Access granted. Full features unlocked.');
      setAccessKey('');
      refresh();
    } else {
      setKeyStatus('error');
      setKeyMessage(result?.error || 'Invalid or expired key.');
    }
    setKeyLoading(false);
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    refresh();
  };

  const handleDownload = async () => {
    if (!hasAccess) { NiceModal.show(UpgradePopup); return; }
    setDownloading(true);
    try { await db.getDataAsJSON(); }
    catch (err) { console.error('Export failed:', err); }
    finally { setDownloading(false); }
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    const { error } = await supabase.auth.updateUser({ password: newPw });
    setPwStatus(error ? error.message : 'Password updated.');
    setNewPw('');
  };

  return (
    <div className="page settings-page">
      <div className="settings-body">

        {/* Upgrade banner */}
        {!hasAccess && (
          <div className="settings-upgrade-banner" onClick={() => NiceModal.show(UpgradePopup)}>
            <div className="upgrade-banner-left">
              <span className="upgrade-banner-badge">Free plan</span>
              <span className="upgrade-banner-text">
                You're on the free tier — 5 trees max, limited advanced workflow tools.
              </span>
            </div>
            <button
              className="upgrade-banner-btn"
              onClick={e => { e.stopPropagation(); NiceModal.show(UpgradePopup); }}
            >
              Unlock full access →
            </button>
          </div>
        )}

        {/* Account */}
        <section className="settings-section">
          <h3 className="settings-section-title">Account</h3>
          <div className="settings-row">
            <span className="settings-label">Email</span>
            <span className="settings-value">{player?.email || '—'}</span>
          </div>
          <div className="settings-row">
            <span className="settings-label">Access</span>
            <span className={`settings-badge ${hasAccess ? 'settings-badge--full' : 'settings-badge--free'}`}>
              {hasAccess ? 'Full access' : 'Free tier'}
            </span>
          </div>
          <div className="settings-row settings-row--actions">
            <button className="btn-ghost" onClick={() => setPwSection(v => !v)}>Change password</button>
            <button className="btn-danger" onClick={handleSignOut}>Sign out</button>
          </div>
          {pwSection && (
            <form className="settings-pw-form" onSubmit={handleChangePassword}>
              <input type="password" placeholder="New password" value={newPw}
                onChange={e => setNewPw(e.target.value)} minLength={6} required/>
              <button className="btn-primary" type="submit">Update</button>
              {pwStatus && <span className="settings-feedback">{pwStatus}</span>}
            </form>
          )}
        </section>

        {/* Access key */}
        <section className="settings-section">
          <h3 className="settings-section-title">Access key</h3>
          {hasAccess ? (
            <p className="settings-hint">
              Your key is active. All features unlocked.
              Entering a new key will transfer access to this account.
            </p>
          ) : (
            <p className="settings-hint">
              Enter your access key to unlock full features.
              No key?{' '}
              <a className="settings-link" onClick={() => NiceModal.show(UpgradePopup)}>Learn more →</a>
            </p>
          )}
          <form className="settings-key-form" onSubmit={handleClaimKey}>
            <input type="text" placeholder="CANOPY-XXXX-XXXX"
              value={accessKey} onChange={e => setAccessKey(e.target.value)}
              className="settings-key-input"/>
            <button type="submit" className="btn-primary"
              disabled={keyLoading || !accessKey.trim()}>
              {keyLoading ? 'Validating…' : 'Activate'}
            </button>
          </form>
          {keyStatus && (
            <p className={`settings-feedback settings-feedback--${keyStatus}`}>{keyMessage}</p>
          )}
        </section>

        {/* Sync */}
        <section className="settings-section">
          <h3 className="settings-section-title">Sync</h3>
          <div className="settings-row">
            <span className="settings-label">Connection</span>
            <span className="settings-value">
              {isOnline ? (syncing ? 'Online · syncing' : 'Online') : 'Offline'}
            </span>
          </div>
          <div className="settings-row">
            <span className="settings-label">Pending changes</span>
            <span className="settings-value">{pendingSyncCount}</span>
          </div>
          <div className="settings-row">
            <span className="settings-label">Last sync</span>
            <span className="settings-value">
              {lastSyncedAt ? new Date(lastSyncedAt).toLocaleString() : 'Not yet'}
            </span>
          </div>
          <div className="settings-row settings-row--actions">
            <button className="btn-primary" onClick={() => refresh()} disabled={!isOnline || syncing}>
              {syncing ? 'Syncing...' : 'Sync now'}
            </button>
          </div>
        </section>

        {/* Updates */}
        <UpdatesSection />

        {/* Data export */}
        {hasAccess && (
          <section className="settings-section">
            <h3 className="settings-section-title">Data</h3>
            <div className="settings-row settings-row--actions">
              <button onClick={handleDownload} disabled={downloading}>
                {downloading ? 'Exporting…' : 'Export data (JSON)'}
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

export default Settings;