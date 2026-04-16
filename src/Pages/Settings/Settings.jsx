import { useContext, useState, useEffect } from 'react';
import { v4 as uuid } from 'uuid';
import { AppContext } from '../../App';
import { STORES, COSMETIC_THEMES, COSMETIC_FONTS } from '../../utils/Constants.js';
import { getRank, getRankLabel, getRankProgress, getRankGlow, getRankClass } from '../../utils/Helpers/Rank.js';
import './Settings.css';

function SettingsSection({ icon, title, children }) {
  return (
    <div className="settings-section">
      <div className="settings-section-header">
        <span className="settings-section-icon">{icon}</span>
        <span className="settings-section-title">{title}</span>
      </div>
      <div className="settings-section-body">{children}</div>
    </div>
  );
}

function SettingsRow({ label, hint, children }) {
  return (
    <div className="settings-row">
      <div className="settings-row-label">
        <span>{label}</span>
        {hint && <span className="settings-row-hint">{hint}</span>}
      </div>
      <div className="settings-row-control">{children}</div>
    </div>
  );
}

function ThemeSwatch({ theme, active, owned, onSelect }) {
  const colorMap = {
    default: '#4da3ff',
    crimson: '#ff6b6b',
    emerald: '#34d399',
    violet:  '#a78bfa',
    gold:    '#fbbf24',
    shadow:  '#818cf8',
  };
  const c = colorMap[theme.id] || '#4da3ff';
  return (
    <button
      className={`theme-swatch ${active ? 'active' : ''} ${!owned ? 'locked' : ''}`}
      onClick={() => owned && onSelect(theme.id)}
      title={theme.label + (!owned ? ` (◈ ${theme.cost})` : '')}
      style={{ '--swatch-color': c }}
    >
      <div className="swatch-color" style={{ background: c }} />
      <span className="swatch-label">{theme.label}</span>
      {!owned && <span className="swatch-lock">◈ {theme.cost}</span>}
      {active && <div className="swatch-active-ring" />}
    </button>
  );
}

function FontOption({ font, active, owned, onSelect }) {
  return (
    <button
      className={`font-option ${active ? 'active' : ''} ${!owned ? 'locked' : ''}`}
      onClick={() => owned && onSelect(font.id)}
      title={font.label + (!owned ? ` (◈ ${font.cost})` : '')}
    >
      <span className="font-preview" style={{ fontFamily: font.id === 'default' ? 'Rajdhani' : font.id === 'mono' ? 'JetBrains Mono' : font.id === 'orbitron' ? 'Orbitron' : 'Exo 2' }}>
        Aa
      </span>
      <span className="font-label">{font.label}</span>
      {!owned && <span className="font-lock">◈ {font.cost}</span>}
    </button>
  );
}

export default function Settings() {
  const { databaseConnection, currentPlayer, refreshApp } = useContext(AppContext);
  const [player, setPlayer]     = useState(null);
  const [saved, setSaved]       = useState(false);
  const [inventory, setInventory] = useState([]);
  const [form, setForm]         = useState({ username: '', description: '', wakeTime: '07:00', sleepTime: '23:00' });

  useEffect(() => {
    const load = async () => {
      const p = await databaseConnection.getCurrentPlayer();
      if (!p) return;
      setPlayer(p);
      setForm({
        username:    p.username    || '',
        description: p.description || '',
        wakeTime:    p.wakeTime    || '07:00',
        sleepTime:   p.sleepTime   || '23:00',
      });
      const inv = await databaseConnection.getPlayerStore(STORES.inventory, p.UUID);
      setInventory(inv);
    };
    load();
  }, [databaseConnection, currentPlayer]);

  const ownedThemes = new Set(['default', ...(inventory.filter((i) => i.type === 'cosmetic_theme').map((i) => i.itemId || i.name))]);
  const ownedFonts  = new Set(['default', ...(inventory.filter((i) => i.type === 'cosmetic_font').map((i) => i.itemId || i.name))]);

  const activeTheme = player?.activeCosmetics?.theme || 'default';
  const activeFont  = player?.activeCosmetics?.font  || 'default';

  const setCosmetic = async (key, value) => {
    if (!player) return;
    const updated = { ...player, activeCosmetics: { ...(player.activeCosmetics || {}), [key]: value } };
    await databaseConnection.add(STORES.player, updated);
    setPlayer(updated);
    refreshApp();
    document.documentElement.setAttribute('data-theme', key === 'theme' ? (value === 'default' ? '' : value) : (updated.activeCosmetics?.theme === 'default' ? '' : (updated.activeCosmetics?.theme || '')));
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!player) return;
    await databaseConnection.add(STORES.player, {
      ...player,
      username:    form.username    || player.username,
      description: form.description || player.description,
      wakeTime:    form.wakeTime,
      sleepTime:   form.sleepTime,
    });
    refreshApp();
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const handleNewProfile = async () => {
    if (player) await databaseConnection.add(STORES.player, { ...player, completedAt: new Date().toISOString() });
    await databaseConnection.add(STORES.player, {
      UUID: uuid(),
      username: 'Agent',
      createdAt: new Date().toISOString(),
      wakeTime: '07:00',
      sleepTime: '23:00',
      tokens: 0,
      elo: 0,
      minutesClearedToday: 0,
    });
    refreshApp();
  };

  const elo = player?.elo || 0;
  const rank = getRank(elo);
  const rankLabel = getRankLabel(elo);
  const rankProgress = getRankProgress(elo);
  const rankGlow = getRankGlow(elo, 20);
  const rankClass = getRankClass(elo);

  return (
    <div className="settings-page">
      {/* Rank showcase */}
      <div className="settings-rank-hero">
        <div className="srh-bg" />
        <div className="srh-avatar-wrap" style={{ boxShadow: rankGlow }}>
          {player?.profilePicture
            ? <img src={player.profilePicture} className="srh-avatar" alt="" />
            : <div className="srh-avatar srh-avatar--init">{player?.username?.[0]?.toUpperCase() || '?'}</div>
          }
        </div>
        <div className="srh-rank-info">
          <div className={`srh-rank-icon rank-${rankClass}`}>{rank.icon}</div>
          <div className="srh-rank-label-group">
            <span className={`srh-rank-name rank-${rankClass}`}>{rankLabel}</span>
            <span className="srh-elo">{elo} ELO</span>
          </div>
          <div className="srh-progress">
            <div className="srh-progress-track">
              <div className="srh-progress-fill" style={{ width: `${rankProgress}%`, background: rank.color }} />
            </div>
            <span className="srh-progress-label">{rankProgress}% to next rank</span>
          </div>
        </div>
      </div>

      <form className="settings-form" onSubmit={handleSave}>
        <SettingsSection icon="◯" title="Profile">
          <SettingsRow label="Username">
            <input
              value={form.username}
              onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
              placeholder={player?.username || 'Username'}
              className="settings-input"
            />
          </SettingsRow>
          <SettingsRow label="Description">
            <input
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder={player?.description || 'About you'}
              className="settings-input"
            />
          </SettingsRow>
          <SettingsRow label="Wake Time">
            <input type="time" value={form.wakeTime} onChange={(e) => setForm((f) => ({ ...f, wakeTime: e.target.value }))} className="settings-input settings-input--time" />
          </SettingsRow>
          <SettingsRow label="Bed Time" hint="Tokens lost if missed">
            <input type="time" value={form.sleepTime} onChange={(e) => setForm((f) => ({ ...f, sleepTime: e.target.value }))} className="settings-input settings-input--time" />
          </SettingsRow>

          <div className="settings-save-row">
            <button type="submit" className="primary settings-save-btn">
              {saved ? '✓ SAVED' : 'SAVE CHANGES'}
            </button>
          </div>
        </SettingsSection>

        <SettingsSection icon="◈" title="Theme">
          <div className="settings-row">
            <div className="settings-row-label"><span>Color Theme</span><span className="settings-row-hint">Purchase in Shop</span></div>
          </div>
          <div className="theme-swatches">
            {COSMETIC_THEMES.map((t) => (
              <ThemeSwatch
                key={t.id}
                theme={t}
                active={activeTheme === t.id}
                owned={ownedThemes.has(t.id)}
                onSelect={(id) => setCosmetic('theme', id)}
              />
            ))}
          </div>
        </SettingsSection>

        <SettingsSection icon="✎" title="Typography">
          <div className="settings-row">
            <div className="settings-row-label"><span>Name Font</span><span className="settings-row-hint">Purchase in Shop</span></div>
          </div>
          <div className="font-options">
            {COSMETIC_FONTS.map((f) => (
              <FontOption
                key={f.id}
                font={f}
                active={activeFont === f.id}
                owned={ownedFonts.has(f.id)}
                onSelect={(id) => setCosmetic('font', id)}
              />
            ))}
          </div>
        </SettingsSection>

        <SettingsSection icon="▤" title="Data">
          <SettingsRow label="Create Profile">
            <button type="button" onClick={handleNewProfile}>NEW PROFILE</button>
          </SettingsRow>
          <SettingsRow label="Download Data">
            <button type="button" onClick={() => databaseConnection.getDataAsJSON()}>DOWNLOAD</button>
          </SettingsRow>
          <SettingsRow label="Upload Data">
            <div className="settings-upload-row">
              <input type="file" accept=".json" id="data-upload" className="settings-file-input"
                onChange={async (e) => {
                  const file = e.target.files[0];
                  if (!file) return;
                  const text = await file.text();
                  await databaseConnection.dataUpload(text);
                  refreshApp();
                }}
              />
              <label htmlFor="data-upload" className="settings-file-label">CHOOSE FILE</label>
            </div>
          </SettingsRow>
        </SettingsSection>
      </form>
    </div>
  );
}
