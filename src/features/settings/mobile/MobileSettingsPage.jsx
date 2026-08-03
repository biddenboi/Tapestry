import { useState } from 'react';
import { useAppContext } from '@app/hooks/useAppContext.js';
import { Icon } from '@shared/icons/Icon.jsx';
import MobileDataBackupSettings from './MobileDataBackupSettings.jsx';

const SECTIONS = Object.freeze([
  { id: 'data', label: 'Data & Backup', icon: 'journal' },
  { id: 'accessibility', label: 'Accessibility', icon: 'settings' },
  { id: 'privacy', label: 'Privacy', icon: 'profile' },
]);

export default function MobileSettingsPage({ onBack }) {
  const { databaseConnection, currentPlayer, commitCurrentProfile, refreshApp } = useAppContext();
  const [section, setSection] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const update = async (patch) => {
    setBusy(true);
    setError('');
    try {
      await commitCurrentProfile({ ...currentPlayer, ...patch });
    } catch (updateError) {
      setError(updateError?.message || 'The setting could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  if (!section) {
    return (
      <section className="mobile-page mobile-settings-page">
        <button type="button" className="mobile-page-back" onClick={onBack}>← More</button>
        <header className="mobile-page-header"><div><span>Preferences</span><h1>Settings</h1></div></header>
        <div className="mobile-settings-menu">{SECTIONS.map((item) => <button key={item.id} type="button" onClick={() => setSection(item.id)}><Icon name={item.icon} size={19} /><strong>{item.label}</strong><span>›</span></button>)}</div>
      </section>
    );
  }

  return (
    <section className="mobile-page mobile-settings-page mobile-settings-detail">
      <button type="button" className="mobile-page-back" onClick={() => setSection(null)}>← Settings</button>
      <header className="mobile-page-header"><div><span>Settings</span><h1>{SECTIONS.find(({ id }) => id === section)?.label}</h1></div></header>
      {section === 'data' && <MobileDataBackupSettings databaseConnection={databaseConnection} onRestored={refreshApp} />}
      {section === 'accessibility' && <div className="mobile-settings-card-list">
        <label className="mobile-settings-toggle"><div><strong>Reduced motion</strong><span>Uses instant transitions and quiet feedback.</span></div><input type="checkbox" checked={currentPlayer?.reducedMotion === true} disabled={busy} onChange={(event) => update({ reducedMotion: event.target.checked })} /></label>
        <label className="mobile-settings-toggle"><div><strong>High contrast</strong><span>Strengthens boundaries and status contrast.</span></div><input type="checkbox" checked={currentPlayer?.highContrast === true} disabled={busy} onChange={(event) => update({ highContrast: event.target.checked })} /></label>
        <label className="mobile-settings-toggle"><div><strong>Larger mobile text</strong><span>Increases companion text without changing desktop layout.</span></div><input type="checkbox" checked={currentPlayer?.largeMobileText === true} disabled={busy} onChange={(event) => update({ largeMobileText: event.target.checked })} /></label>
      </div>}
      {section === 'privacy' && <div className="mobile-settings-card-list">
        <label className="mobile-field"><span>Presence detail</span><select value={currentPlayer?.presenceVisibilityPolicy || 'state-only'} disabled={busy} onChange={(event) => update({ presenceVisibilityPolicy: event.target.value })}><option value="state-only">State only</option><option value="goal">Include linked Goal</option><option value="task">Include exact task</option><option value="private">Private</option></select></label>
        <label className="mobile-field"><span>Profile visibility</span><select value={currentPlayer?.profileVisibility || 'fellows'} disabled={busy} onChange={(event) => update({ profileVisibility: event.target.value })}><option value="public">Public</option><option value="fellows">Fellows</option><option value="private">Private</option></select></label>
      </div>}
      {error && <div className="mobile-page-error" role="alert">{error}</div>}
    </section>
  );
}
