import { useContext, useState, useEffect } from 'react';
import { AppContext } from '../../App';
import { supabase } from '../../network/supabaseClient';
import NiceModal from '@ebay/nice-modal-react';
import UpgradePopup from '../../Modals/UpgradePopup/UpgradePopup';
import { STORES } from '../../utils/Constants';
import './Settings.css';

function Settings() {
  const { databaseConnection: db, player, refresh, hasAccess } = useContext(AppContext);

  const [accessKey,    setAccessKey]    = useState('');
  const [keyStatus,    setKeyStatus]    = useState(null);
  const [keyMessage,   setKeyMessage]   = useState('');
  const [keyLoading,   setKeyLoading]   = useState(false);
  const [downloading,  setDownloading]  = useState(false);
  const [importing,    setImporting]    = useState(false);
  const [importStatus, setImportStatus] = useState('');
  const [importFile,   setImportFile]   = useState(null);
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
    setDownloading(true);
    await db.getDataAsJSON();
    setDownloading(false);
  };

  const handleImport = async () => {
    if (!importFile) return;
    setImporting(true);
    setImportStatus('');
    try {
      const text = await importFile.text();
      await db.dataUpload(text);
      setImportStatus('success');
      setImportFile(null);
      refresh();
    } catch (err) {
      setImportStatus('error:' + (err.message || 'Import failed.'));
    }
    setImporting(false);
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

        {/* ── Upgrade banner (no access) ── */}
        {!hasAccess && (
          <div className="settings-upgrade-banner" onClick={() => NiceModal.show(UpgradePopup)}>
            <div className="upgrade-banner-left">
              <span className="upgrade-banner-badge">Free plan</span>
              <span className="upgrade-banner-text">
                You're on the free tier — 3 trees max, no deadlines or durations.
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

        {/* ── Account ── */}
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
            <button className="btn-ghost" onClick={() => setPwSection(v => !v)}>
              Change password
            </button>
            <button className="btn-danger" onClick={handleSignOut}>Sign out</button>
          </div>

          {pwSection && (
            <form className="settings-pw-form" onSubmit={handleChangePassword}>
              <input
                type="password"
                placeholder="New password"
                value={newPw}
                onChange={e => setNewPw(e.target.value)}
                minLength={6}
                required
              />
              <button className="btn-primary" type="submit">Update</button>
              {pwStatus && <span className="settings-feedback">{pwStatus}</span>}
            </form>
          )}
        </section>

        {/* ── Access key ── */}
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
              No key? <a className="settings-link" onClick={() => NiceModal.show(UpgradePopup)}>Learn more →</a>
            </p>
          )}

          <form className="settings-key-form" onSubmit={handleClaimKey}>
            <input
              type="text"
              placeholder="CANOPY-XXXX-XXXX"
              value={accessKey}
              onChange={e => setAccessKey(e.target.value)}
              className="settings-key-input"
            />
            <button
              type="submit"
              className="btn-primary"
              disabled={keyLoading || !accessKey.trim()}
            >
              {keyLoading ? 'Validating…' : 'Activate'}
            </button>
          </form>

          {keyStatus && (
            <p className={`settings-feedback settings-feedback--${keyStatus}`}>
              {keyMessage}
            </p>
          )}
        </section>

        {/* ── Data ── */}
        <section className="settings-section">
          <h3 className="settings-section-title">Data</h3>
          <div className="settings-row settings-row--actions">
            <button onClick={handleDownload} disabled={downloading}>
              {downloading ? 'Exporting...' : 'Export data (JSON)'}
            </button>
          </div>
          <div className="settings-import-row">
            <input
              type="file"
              accept=".json"
              style={{ fontSize: 12 }}
              onChange={e => { setImportFile(e.target.files[0]); setImportStatus(''); }}
            />
            <button
              onClick={handleImport}
              disabled={!importFile || importing}
              className="btn-primary"
              style={{ whiteSpace: 'nowrap' }}
            >
              {importing ? 'Importing...' : 'Import'}
            </button>
          </div>
          {importStatus === 'success' && (
            <p className="settings-feedback settings-feedback--success">Data imported successfully.</p>
          )}
          {importStatus.startsWith('error:') && (
            <p className="settings-feedback settings-feedback--error">{importStatus.slice(6)}</p>
          )}
        </section>
      </div>
    </div>
  );
}

export default Settings;
