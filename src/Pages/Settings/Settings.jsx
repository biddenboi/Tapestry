import { useContext, useState, useEffect, useRef } from 'react';
import { v4 as uuid } from 'uuid';
import { AppContext } from '../../App';
import { STORES, COSMETIC_THEMES, COSMETIC_FONTS, BANNER_GRADIENTS } from '../../utils/Constants.js';
import { getRank, getRankLabel, getRankProgress, getRankGlow, getRankClass } from '../../utils/Helpers/Rank.js';
import { RankIcon } from '../../components/Icons/RankIcon.jsx';
import { Icon } from '../../components/Icons/Icon.jsx';
import './Settings.css';

const FONT_FAMILY_MAP = {
  default:  'Rajdhani, sans-serif',
  orbitron: 'Orbitron, sans-serif',
  exo:      '"Exo 2", sans-serif',
  mono:     '"JetBrains Mono", monospace',
  syne:     'Syne, sans-serif',
  space:    '"Space Grotesk", sans-serif',
};

const PRESET_COLORS = ['#0d1b2a','#1a0507','#0a1a0d','#09090f','#1a0800','#1a1a2e','#100840','#1a1040'];

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
    default: '#4da3ff', crimson: '#ff6b6b', emerald: '#34d399',
    violet: '#a78bfa', gold: '#fbbf24', shadow: '#818cf8',
    sand: '#c4963a', pure: '#2563eb', paper: '#6366f1', rose: '#db2777',
  };
  const c = colorMap[theme.id] || '#4da3ff';
  const isLight = !theme.dark;
  return (
    <button
      className={`theme-swatch ${active ? 'active' : ''} ${!owned ? 'locked' : ''} ${isLight ? 'swatch-light' : ''}`}
      onClick={() => owned && onSelect(theme.id)}
      title={theme.label + (!owned ? ` (◈ ${theme.cost})` : '')}
      style={{ '--swatch-color': c }}
    >
      <div className="swatch-color" style={{ background: isLight ? '#f5f0e8' : '#0d1220', border: `3px solid ${c}` }} />
      <span className="swatch-label">{theme.label}</span>
      {isLight && <span className="swatch-light-tag">☀</span>}
      {!owned && <span className="swatch-lock">◈ {theme.cost}</span>}
      {active && <div className="swatch-active-ring" />}
    </button>
  );
}

function FontOption({ font, active, owned, onSelect }) {
  const fontFamily = FONT_FAMILY_MAP[font.id] || 'Rajdhani, sans-serif';
  return (
    <button
      className={`font-option ${active ? 'active' : ''} ${!owned ? 'locked' : ''}`}
      onClick={() => owned && onSelect(font.id)}
      title={font.label + (!owned ? ` (◈ ${font.cost})` : '')}
    >
      <span className="font-preview" style={{ fontFamily }}>{font.sample || 'Aa'}</span>
      <div className="font-meta">
        <span className="font-label" style={{ fontFamily }}>{font.label}</span>
        {!owned && <span className="font-lock">◈ {font.cost}</span>}
      </div>
    </button>
  );
}

function BannerEditor({ title, current, onSave, onClose }) {
  const [type, setType]   = useState(current?.type || 'gradient');
  const [value, setValue] = useState(current?.type === 'gradient' ? current.value : BANNER_GRADIENTS[0].value);
  const [colorVal, setColorVal] = useState(current?.type === 'color' ? current.value : PRESET_COLORS[0]);

  const handleImageUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setValue(ev.target.result);
    reader.readAsDataURL(file);
  };

  const handleSave = () => {
    if (type === 'gradient') onSave({ type: 'gradient', value });
    else if (type === 'color') onSave({ type: 'color', value: colorVal });
    else if (type === 'image' && value) onSave({ type: 'image', value });
    onClose();
  };

  const previewStyle = type === 'gradient' ? { background: value }
    : type === 'color'    ? { background: colorVal }
    : type === 'image' && value ? { backgroundImage: `url(${value})`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : {};

  return (
    <div className="banner-editor-overlay" onClick={onClose}>
      <div className="banner-editor" onClick={(e) => e.stopPropagation()}>
        <div className="be-header">
          <span>{title}</span>
          <button className="be-close" onClick={onClose}>✕</button>
        </div>
        <div className="be-body">
          <div className="be-type-row">
            {['gradient', 'color', 'image'].map((t) => (
              <button key={t} className={`be-type-btn ${type === t ? 'active' : ''}`} onClick={() => setType(t)}>
                {t.toUpperCase()}
              </button>
            ))}
          </div>
          {type === 'gradient' && (
            <div className="be-gradients">
              {BANNER_GRADIENTS.map((g) => (
                <button key={g.id} className={`be-gradient-chip ${value === g.value ? 'selected' : ''}`}
                  style={{ background: g.value }} onClick={() => setValue(g.value)} title={g.label} />
              ))}
            </div>
          )}
          {type === 'color' && (
            <div className="be-colors">
              {PRESET_COLORS.map((c) => (
                <button key={c} className={`be-color-chip ${colorVal === c ? 'selected' : ''}`}
                  style={{ background: c }} onClick={() => setColorVal(c)} />
              ))}
              <div className="be-color-custom">
                <label className="settings-file-label" style={{ position: 'relative' }}>
                  CUSTOM
                  <input type="color" value={colorVal} onChange={(e) => setColorVal(e.target.value)}
                    style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }} />
                </label>
                <div className="be-custom-preview" style={{ background: colorVal }} />
              </div>
            </div>
          )}
          {type === 'image' && (
            <div className="be-image-upload">
              <input type="file" accept="image/*" id="banner-image-upload" style={{ display: 'none' }}
                onChange={handleImageUpload} />
              <label htmlFor="banner-image-upload" className="settings-file-label">CHOOSE IMAGE</label>
              {value && type === 'image' && (
                <div className="be-image-preview" style={{ backgroundImage: `url(${value})`, backgroundSize: 'cover', backgroundPosition: 'center' }} />
              )}
            </div>
          )}
          <div className="be-preview-wrap">
            <span className="be-preview-label">PREVIEW</span>
            <div className="be-preview" style={previewStyle}>
              <div className="be-preview-overlay" />
              <span className="be-preview-text">Player Name</span>
            </div>
          </div>
        </div>
        <div className="be-footer">
          <button onClick={onClose}>CANCEL</button>
          <button className="primary" onClick={handleSave}>APPLY</button>
        </div>
      </div>
    </div>
  );
}

export default function Settings() {
  const { databaseConnection, currentPlayer, refreshApp } = useContext(AppContext);
  const [player, setPlayer]       = useState(null);
  const [saved, setSaved]         = useState(false);
  const [inventory, setInventory] = useState([]);
  const [form, setForm]           = useState({ username: '', description: '', wakeTime: '07:00', sleepTime: '23:00' });
  const [cardBannerEditor, setCardBannerEditor]       = useState(false);
  const [profileBannerEditor, setProfileBannerEditor] = useState(false);
  const [lobbyBannerEditor, setLobbyBannerEditor]     = useState(false);

  // Guard: track when we last wrote a cosmetic so the re-load effect doesn't
  // overwrite local state before the DB flush propagates into context.
  const lastCosmeticWriteRef = useRef(0);
  // Guard: once the form is dirty, don't clobber user edits on re-load
  const formDirtyRef = useRef(false);

  // Keep the loader keyed to the player identity rather than the full currentPlayer
  // reference — the latter changes every 10s via the timestamp interval, which
  // was wiping unsaved form edits.
  const playerUUID = currentPlayer?.UUID || null;

  useEffect(() => {
    const load = async () => {
      if (Date.now() - lastCosmeticWriteRef.current < 1500) return;
      const p = await databaseConnection.getCurrentPlayer();
      if (!p) return;
      setPlayer(p);
      // Only re-seed the form if the user hasn't started editing it.
      if (!formDirtyRef.current) {
        setForm({
          username:    p.username    || '',
          description: p.description || '',
          wakeTime:    p.wakeTime    || '07:00',
          sleepTime:   p.sleepTime   || '23:00',
        });
      }
      const inv = await databaseConnection.getPlayerStore(STORES.inventory, p.UUID);
      setInventory(inv);
    };
    load();
  }, [databaseConnection, playerUUID]);

  const updateForm = (patch) => {
    formDirtyRef.current = true;
    setForm((f) => ({ ...f, ...patch }));
  };

  const ownedTypes = new Set(inventory.map((i) => i.type));
  const ownedIds   = new Set(inventory.map((i) => i.itemId || (i.name || '').toLowerCase()));
  const ownedThemes = new Set(['default', ...inventory.filter((i) => i.type === 'cosmetic_theme').map((i) => i.itemId || i.name)]);
  const ownedFonts  = new Set(['default', ...inventory.filter((i) => i.type === 'cosmetic_font').map((i) => i.itemId || i.name)]);
  const hasCardBannerPass    = ownedTypes.has('cosmetic_card_banner')    || ownedIds.has('card_banner');
  const hasProfileBannerPass = ownedTypes.has('cosmetic_profile_banner') || ownedIds.has('profile_banner');
  const hasLobbyBannerPass   = ownedTypes.has('cosmetic_lobby_banner')   || ownedIds.has('lobby_banner');

  const activeTheme        = player?.activeCosmetics?.theme        || 'default';
  const activeFont         = player?.activeCosmetics?.font         || 'default';
  const activeCardBanner   = player?.activeCosmetics?.cardBanner   || null;
  const activeProfileBanner= player?.activeCosmetics?.profileBanner|| null;
  const activeLobbyBanner  = player?.activeCosmetics?.lobbyBanner  || null;

  const setCosmetic = async (key, value) => {
    if (!player) return;
    lastCosmeticWriteRef.current = Date.now();
    const updated = { ...player, activeCosmetics: { ...(player.activeCosmetics || {}), [key]: value } };
    setPlayer(updated);
    if (key === 'theme') {
      document.documentElement.setAttribute('data-theme', value === 'default' ? '' : value);
    }
    if (key === 'font') {
      document.documentElement.setAttribute('data-font', value === 'default' ? '' : value);
    }
    await databaseConnection.add(STORES.player, updated);
    refreshApp();
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!player) return;
    await databaseConnection.add(STORES.player, {
      ...player,
      username:    form.username    || player.username,
      description: form.description !== undefined ? form.description : player.description,
      wakeTime:    form.wakeTime,
      sleepTime:   form.sleepTime,
    });
    formDirtyRef.current = false;
    refreshApp();
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const handleArchiveToggle = async () => {
    if (!player) return;
    const isArchived = !!player.archivedAt;
    const updated = { ...player, archivedAt: isArchived ? null : new Date().toISOString() };
    await databaseConnection.add(STORES.player, updated);
    setPlayer(updated);
    refreshApp();
  };

  const handleNewProfile = async () => {
    await databaseConnection.createAndSwitchProfile(player, {
      UUID: uuid(),
      username: 'Agent',
      wakeTime: '07:00',
      sleepTime: '23:00',
      tokens: 0,
      elo: 0,
      minutesClearedToday: 0,
    });
    refreshApp();
  };

  const bannerPreviewStyle = (banner) => {
    if (!banner) return {};
    if (banner.type === 'gradient') return { background: banner.value };
    if (banner.type === 'color')    return { background: banner.value };
    if (banner.type === 'image')    return { backgroundImage: `url(${banner.value})`, backgroundSize: 'cover', backgroundPosition: 'center' };
    return {};
  };

  const elo          = player?.elo || 0;
  const rank         = getRank(elo);
  const rankLabel    = getRankLabel(elo);
  const rankProgress = getRankProgress(elo);
  const rankGlow     = getRankGlow(elo, 20);
  const rankClass    = getRankClass(elo);

  const darkThemes  = COSMETIC_THEMES.filter((t) => t.dark !== false);
  const lightThemes = COSMETIC_THEMES.filter((t) => t.dark === false);

  return (
    <div className="settings-page">
      {/* Rank showcase */}
      <div className="settings-rank-hero">
        <div className="srh-bg" />
        <div className="srh-avatar-wrap" style={{ boxShadow: rankGlow }}>
          {player?.profilePicture
            ? <img src={player.profilePicture} className="srh-avatar" alt="" />
            : <div className="srh-avatar srh-avatar--init">{player?.username?.[0]?.toUpperCase() || '?'}</div>}
        </div>
        <div className="srh-rank-info">
          <div className={`srh-rank-icon rank-${rankClass}`}><RankIcon group={rank.group} sub={rank.sub} size={28} /></div>
          <div className="srh-rank-label-group">
            <span className={`srh-rank-name rank-${rankClass}`}>{rankLabel}</span>
            <span className="srh-elo">{elo} ELO</span>
            {player?.archivedAt && <span className="srh-archived-badge">Archived</span>}
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
        {/* Profile */}
        <SettingsSection icon={<Icon name="profile" size={16} />} title="Profile">
          <SettingsRow label="Username">
            <input value={form.username} onChange={(e) => updateForm({ username: e.target.value })} placeholder={player?.username || 'Username'} className="settings-input" />
          </SettingsRow>
          <SettingsRow label="Description" hint="Supports ~200 words">
            <textarea
              value={form.description}
              onChange={(e) => updateForm({ description: e.target.value })}
              placeholder={player?.description || 'About you'}
              className="settings-input settings-input--textarea"
              rows={4}
            />
          </SettingsRow>
          <SettingsRow label="Wake Time">
            <input type="time" value={form.wakeTime} onChange={(e) => updateForm({ wakeTime: e.target.value })} className="settings-input settings-input--time" />
          </SettingsRow>
          <SettingsRow label="Bed Time" hint="Tokens lost if missed">
            <input type="time" value={form.sleepTime} onChange={(e) => updateForm({ sleepTime: e.target.value })} className="settings-input settings-input--time" />
          </SettingsRow>
          <div className="settings-save-row">
            <button type="submit" className="primary settings-save-btn">{saved ? '✓ SAVED' : 'SAVE CHANGES'}</button>
          </div>
        </SettingsSection>

        {/* Theme */}
        <SettingsSection icon={<Icon name="shop" size={16} />} title="Theme">
          <div className="settings-row">
            <div className="settings-row-label"><span>Dark Themes</span></div>
          </div>
          <div className="theme-swatches">
            {darkThemes.map((t) => (
              <ThemeSwatch key={t.id} theme={t} active={activeTheme === t.id} owned={ownedThemes.has(t.id)} onSelect={(id) => setCosmetic('theme', id)} />
            ))}
          </div>
          <div className="settings-row" style={{ marginTop: 8 }}>
            <div className="settings-row-label"><span>Light Themes</span><span className="settings-row-hint">Purchase in Shop → Cosmetics</span></div>
          </div>
          <div className="theme-swatches">
            {lightThemes.map((t) => (
              <ThemeSwatch key={t.id} theme={t} active={activeTheme === t.id} owned={ownedThemes.has(t.id)} onSelect={(id) => setCosmetic('theme', id)} />
            ))}
          </div>
        </SettingsSection>

        {/* Font */}
        <SettingsSection icon={<Icon name="notes" size={16} />} title="Typography">
          <div className="settings-row">
            <div className="settings-row-label"><span>UI Font</span><span className="settings-row-hint">Affects names, labels, headers</span></div>
          </div>
          <div className="font-options">
            {COSMETIC_FONTS.map((f) => (
              <FontOption key={f.id} font={f} active={activeFont === f.id} owned={ownedFonts.has(f.id)} onSelect={(id) => setCosmetic('font', id)} />
            ))}
          </div>
          {activeFont !== 'default' && (
            <div className="settings-font-preview-row">
              <span style={{ fontFamily: FONT_FAMILY_MAP[activeFont] || 'inherit' }}>
                Active: {COSMETIC_FONTS.find((f) => f.id === activeFont)?.label} — The quick brown fox
              </span>
            </div>
          )}
        </SettingsSection>

        {/* Card Banner */}
        {hasCardBannerPass && (
          <SettingsSection icon={<Icon name="inbox" size={16} />} title="Card Banner">
            <SettingsRow label="Arena Player Card" hint="Shown on your card during matches">
              <div className="banner-preview-row">
                <div className="banner-thumb" style={activeCardBanner ? bannerPreviewStyle(activeCardBanner) : {}}>
                  {!activeCardBanner && <span className="banner-thumb-none">NONE</span>}
                </div>
                <button type="button" onClick={() => setCardBannerEditor(true)}>EDIT</button>
                {activeCardBanner && <button type="button" onClick={() => setCosmetic('cardBanner', null)}>REMOVE</button>}
              </div>
            </SettingsRow>
          </SettingsSection>
        )}

        {/* Lobby Banner */}
        {hasLobbyBannerPass && (
          <SettingsSection icon={<Icon name="feed" size={16} />} title="Lobby Banner">
            <SettingsRow label="Lobby Player Card" hint="Background of your lobby sidebar card">
              <div className="banner-preview-row">
                <div className="banner-thumb" style={activeLobbyBanner ? bannerPreviewStyle(activeLobbyBanner) : {}}>
                  {!activeLobbyBanner && <span className="banner-thumb-none">NONE</span>}
                </div>
                <button type="button" onClick={() => setLobbyBannerEditor(true)}>EDIT</button>
                {activeLobbyBanner && <button type="button" onClick={() => setCosmetic('lobbyBanner', null)}>REMOVE</button>}
              </div>
            </SettingsRow>
          </SettingsSection>
        )}

        {/* Profile Banner */}
        {hasProfileBannerPass && (
          <SettingsSection icon={<Icon name="profile" size={16} />} title="Profile Banner">
            <SettingsRow label="Profile Page Background" hint="Seen by others visiting your profile">
              <div className="banner-preview-row">
                <div className="banner-thumb banner-thumb--wide" style={activeProfileBanner ? bannerPreviewStyle(activeProfileBanner) : {}}>
                  {!activeProfileBanner && <span className="banner-thumb-none">NONE</span>}
                </div>
                <button type="button" onClick={() => setProfileBannerEditor(true)}>EDIT</button>
                {activeProfileBanner && <button type="button" onClick={() => setCosmetic('profileBanner', null)}>REMOVE</button>}
              </div>
            </SettingsRow>
          </SettingsSection>
        )}

        {/* Locked passes guide */}
        {(!hasCardBannerPass || !hasProfileBannerPass || !hasLobbyBannerPass) && (
          <SettingsSection icon={<Icon name="inventory" size={16} />} title="Locked Cosmetics">
            <div className="settings-row">
              <div className="settings-row-label">
                <span>More Customization</span>
                <span className="settings-row-hint">Purchase passes in Shop → Cosmetics → Passes</span>
              </div>
            </div>
            {!hasCardBannerPass    && <div className="settings-locked-pass"><span>◉ Card Banner Pass</span><span className="settings-row-hint">Customize arena player card</span><span className="swatch-lock">◈ 750</span></div>}
            {!hasLobbyBannerPass   && <div className="settings-locked-pass"><span>◈ Lobby Banner Pass</span><span className="settings-row-hint">Customize lobby sidebar card</span><span className="swatch-lock">◈ 500</span></div>}
            {!hasProfileBannerPass && <div className="settings-locked-pass"><span>⬡ Profile Banner Pass</span><span className="settings-row-hint">Set a custom profile page background</span><span className="swatch-lock">◈ 600</span></div>}
          </SettingsSection>
        )}

        {/* Data */}
        <SettingsSection icon={<Icon name="journal" size={16} />} title="Data">
          <SettingsRow label="Create Profile">
            <button type="button" onClick={handleNewProfile}>NEW PROFILE</button>
          </SettingsRow>
          <SettingsRow
            label={player?.archivedAt ? 'Unarchive Profile' : 'Archive Profile'}
            hint={player?.archivedAt
              ? 'Restore access as an active profile'
              : 'Hides this profile from the switcher (can still appear as ghost)'}
          >
            <button type="button" onClick={handleArchiveToggle}>
              {player?.archivedAt ? 'UNARCHIVE' : 'ARCHIVE'}
            </button>
          </SettingsRow>
          <SettingsRow label="Download Profiles" hint="Player identities, profile pictures, and banners">
            <button type="button" onClick={() => databaseConnection.getProfilesAsJSON()}>DOWNLOAD</button>
          </SettingsRow>
          <SettingsRow label="Upload Profiles" hint="Restores player profiles and visual assets">
            <div className="settings-upload-row">
              <input type="file" accept=".json" id="profiles-upload" className="settings-file-input"
                onChange={async (e) => {
                  const file = e.target.files[0];
                  if (!file) return;
                  const text = await file.text();
                  await databaseConnection.profileUpload(text);
                  refreshApp();
                }} />
              <label htmlFor="profiles-upload" className="settings-file-label">CHOOSE FILE</label>
            </div>
          </SettingsRow>
          <SettingsRow label="Download Data" hint="Tasks, journals, timeline events, shop history, and more">
            <button type="button" onClick={() => databaseConnection.getDataAsJSON()}>DOWNLOAD</button>
          </SettingsRow>
          <SettingsRow label="Upload Data" hint="Restores activity data — upload profiles first or after">
            <div className="settings-upload-row">
              <input type="file" accept=".json" id="data-upload" className="settings-file-input"
                onChange={async (e) => {
                  const file = e.target.files[0];
                  if (!file) return;
                  const text = await file.text();
                  await databaseConnection.dataUpload(text);
                  refreshApp();
                }} />
              <label htmlFor="data-upload" className="settings-file-label">CHOOSE FILE</label>
            </div>
          </SettingsRow>
        </SettingsSection>
      </form>

      {cardBannerEditor    && <BannerEditor title="CARD BANNER"    current={activeCardBanner}    onSave={(v) => setCosmetic('cardBanner', v)}    onClose={() => setCardBannerEditor(false)} />}
      {lobbyBannerEditor   && <BannerEditor title="LOBBY BANNER"   current={activeLobbyBanner}   onSave={(v) => setCosmetic('lobbyBanner', v)}   onClose={() => setLobbyBannerEditor(false)} />}
      {profileBannerEditor && <BannerEditor title="PROFILE BANNER" current={activeProfileBanner} onSave={(v) => setCosmetic('profileBanner', v)} onClose={() => setProfileBannerEditor(false)} />}
    </div>
  );
}