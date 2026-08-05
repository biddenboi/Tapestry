import { useState, useEffect, useRef } from 'react';
import { v4 as uuid } from 'uuid';
import { useAppContext } from '@app/hooks/useAppContext.js';
import { STORES } from '@domain/constants.js';
import {
  applyThemeToElement,
  clearThemePreview,
  DEFAULT_THEME_ID,
  resolveThemeId,
} from '@domain/themes/ThemeRegistry.js';
import { getPlayerRankPresentation } from '@domain/rank/Rank.js';
import { RankIcon } from '@shared/icons/RankIcon.jsx';
import { Icon } from '@shared/icons/Icon.jsx';
import { normalizeRitualChecklist } from '@domain/events/Events.js';
import { saveSharedRitualSettings } from '@domain/events/SharedRitualSettings.js';
import { DOMAIN_INVALIDATION } from '@app/context/domainRevisions.js';
import { reconcileOpeningTrail } from '@domain/contribution-road/ContributionRoad.js';
import ProfileIdentity from '@shared/profile-identity/ProfileIdentity.jsx';
import AppearanceStudio from '@features/settings/components/AppearanceStudio/AppearanceStudio.jsx';
import { DEFAULT_COSMETIC_EQUIPMENT, normalizeCosmeticEquipment } from '@domain/cosmetics/CosmeticCatalog.js';
import { areSoundEffectsEnabled, setSoundEffectsEnabled } from '@shared/audio/AppSounds.js';
import {
  exportTaskRecommendationV12Bundle,
  importTaskRecommendationV12Bundle,
  importTaskRecommendationV12Checkpoint,
  readTaskRecommendationV12Checkpoint,
  trainTaskRecommendationV12,
} from '@domain/tasks/TaskRecommendationV12.js';
import {
  getTaskRecommenderV12Settings,
  saveTaskRecommenderV12Settings,
} from '@domain/tasks/TaskRecommenderV12Settings.js';
import LocalSectionNav from '@shared/navigation/LocalSectionNav/LocalSectionNav.jsx';
import { useLocalSectionRoute } from '@shared/navigation/LocalSectionNav/LocalSectionRouteState.js';
import SyncStatusPanel from '@features/settings/components/SyncStatusPanel/SyncStatusPanel.jsx';
import SyncAccountPanel from '@features/settings/components/SyncAccountPanel/SyncAccountPanel.jsx';
import OfflineStoragePanel from '@features/settings/components/OfflineStoragePanel/OfflineStoragePanel.jsx';
import WebPushPanel from '@features/settings/components/WebPushPanel/WebPushPanel.jsx';
import RecoveryPanel from '@features/settings/components/RecoveryPanel/RecoveryPanel.jsx';
import '@features/settings/pages/Settings/Settings.css';

const SETTINGS_PAGES = Object.freeze([
  { id: 'general', label: 'General', icon: 'settings' },
  { id: 'appearance', label: 'Appearance', icon: 'shop' },
  { id: 'notifications', label: 'Notifications', icon: 'inbox' },
  { id: 'privacy', label: 'Privacy', icon: 'profile' },
  { id: 'accessibility', label: 'Accessibility', icon: 'eye' },
  { id: 'data', label: 'Data & Backup', icon: 'journal' },
  { id: 'advanced', label: 'Advanced', icon: 'tasks' },
]);
const MOBILE_SETTINGS_PAGES = Object.freeze(
  SETTINGS_PAGES.filter(({ id }) => ['appearance', 'notifications', 'privacy', 'accessibility', 'data'].includes(id)),
);

function SettingsSection({ icon, title, children, page, activePage }) {
  if (page && page !== activePage) return null;
  return (
    <section className="ui-surface ui-window settings-section">
      <div className="ui-window__titlebar settings-section-header">
        <span className="settings-section-icon">{icon}</span>
        <span className="settings-section-title">{title}</span>
      </div>
      <div className="settings-section-body">{children}</div>
    </section>
  );
}

function SettingsRow({ label, hint, children, className = '' }) {
  return (
    <div className={`settings-row ${className}`.trim()}>
      <div className="settings-row-label">
        <span>{label}</span>
        {hint && <span className="settings-row-hint">{hint}</span>}
      </div>
      <div className="settings-row-control">{children}</div>
    </div>
  );
}

function applyPreviewTheme(themeId) {
  applyThemeToElement(document.documentElement, themeId, { preview: true });
}

function restorePersistedTheme(themeId) {
  clearThemePreview(document.documentElement, themeId);
}

export default function Settings({ embedded = false, routeIntent = null, mobileRestricted = false }) {
  const {
    databaseConnection,
    currentPlayer,
    refreshApp,
    playSound,
    invalidateDomains,
    commitCurrentProfile,
    consumeRouteIntent,
    reportLocalSubpage,
  } = useAppContext();
  const [player, setPlayer]       = useState(null);
  const [saved, setSaved]         = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(() => areSoundEffectsEnabled());
  const [inventory, setInventory] = useState([]);
  const [form, setForm]           = useState({
    username: '',
    wakeTime: '07:00',
    sleepTime: '23:00',
    wakeChecklist: '',
    sleepChecklist: '',
  });
  const [folderBusy, setFolderBusy] = useState(false);
  const [folderError, setFolderError] = useState('');
  const [folderMessage, setFolderMessage] = useState('');
  const [recommenderSettings, setRecommenderSettings] = useState(null);
  const [recommenderCheckpoint, setRecommenderCheckpoint] = useState(null);
  const [recommenderBusy, setRecommenderBusy] = useState(false);
  const [recommenderMessage, setRecommenderMessage] = useState('');
  const [verification, setVerification] = useState(null);
  const [verificationBusy, setVerificationBusy] = useState(false);
  const [interfaceRevealBusy, setInterfaceRevealBusy] = useState(false);
  const [interfaceRevealComplete, setInterfaceRevealComplete] = useState(false);
  const [memoryBusy, setMemoryBusy] = useState(false);
  const [privacyMessage, setPrivacyMessage] = useState('');

  // Guard: track when we last wrote a cosmetic so the re-load effect doesn't
  // overwrite local state before the DB flush propagates into context.
  const lastCosmeticWriteRef = useRef(0);
  const persistedThemeRef = useRef(DEFAULT_THEME_ID);
  // Guard: once the form is dirty, don't clobber user edits on re-load
  const formDirtyRef = useRef(false);

  // Keep the loader keyed to the player identity rather than the full currentPlayer
  // reference — the latter changes on the app's low-frequency clock, which
  // was wiping unsaved form edits.
  const playerUUID = currentPlayer?.UUID || null;
  const availableSettingsPages = mobileRestricted ? MOBILE_SETTINGS_PAGES : SETTINGS_PAGES;
  const { activePageId, selectPage } = useLocalSectionRoute({
    sectionId: 'settings',
    pages: availableSettingsPages,
    profileUUID: playerUUID,
    databaseConnection,
    routeIntent,
    defaultPageId: mobileRestricted ? 'data' : 'general',
    onIntentConsumed: consumeRouteIntent,
    onPageChange: reportLocalSubpage,
  });
  const presentedPageId = availableSettingsPages.some(({ id }) => id === activePageId)
    ? activePageId
    : mobileRestricted ? 'data' : 'general';

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
          wakeTime:    p.wakeTime    || '07:00',
          sleepTime:   p.sleepTime   || '23:00',
          wakeChecklist: normalizeRitualChecklist(p.wakeChecklist).join('\n'),
          sleepChecklist: normalizeRitualChecklist(p.sleepChecklist).join('\n'),
        });
      }
      const inv = await databaseConnection.getPlayerStore(STORES.inventory, p.UUID);
      setInventory(inv);
    };
    load();
  }, [databaseConnection, playerUUID]);

  useEffect(() => {
    let cancelled = false;
    if (!playerUUID) return () => { cancelled = true; };
    Promise.all([
      getTaskRecommenderV12Settings(databaseConnection, playerUUID),
      readTaskRecommendationV12Checkpoint(databaseConnection, playerUUID),
    ]).then(([settings, checkpoint]) => {
      if (cancelled) return;
      setRecommenderSettings(settings);
      setRecommenderCheckpoint(checkpoint);
    }).catch((error) => {
      if (cancelled) return;
      console.warn('[Settings] v12 recommender load failed:', error);
      setRecommenderMessage(error?.message || 'Could not load the v12 checkpoint.');
    });
    return () => { cancelled = true; };
  }, [databaseConnection, playerUUID]);

  const updateForm = (patch) => {
    formDirtyRef.current = true;
    setForm((f) => ({ ...f, ...patch }));
  };

  const handleSoundToggle = (enabled) => {
    setSoundEnabled(enabled);
    setSoundEffectsEnabled(enabled);
    if (enabled) playSound?.('success', { force: true, volume: 0.72 });
  };

  const handleInboxNotificationsToggle = async (enabled) => {
    if (!player) return;
    const updated = { ...player, inboxNotificationsEnabled: enabled };
    setPlayer(await commitCurrentProfile(updated));
  };

  const savePlayerPolicy = async (patch) => {
    if (!player) return;
    const updated = { ...player, ...patch };
    setPlayer(await commitCurrentProfile(updated));
  };

  const updateNotificationPolicy = async (patch) => savePlayerPolicy({
    notificationPolicy: {
      maximumPerDay: 2,
      maximumRepeatPerAction: 1,
      ...(player?.notificationPolicy || {}),
      ...patch,
      categories: {
        ...(player?.notificationPolicy?.categories || {}),
        ...(patch.categories || {}),
      },
    },
  });

  const deleteEncounterMemories = async () => {
    if (!player?.UUID || memoryBusy || !window.confirm('Delete every “since last saw” encounter memory for this profile? Underlying tasks, posts, Matches, and profiles are not deleted.')) return;
    setMemoryBusy(true);
    setPrivacyMessage('');
    try {
      const result = await databaseConnection.clearSocialEncounterMemories({ viewerId: player.UUID });
      invalidateDomains?.(['encounters', 'socialWorld']);
      setPrivacyMessage(`${result.deleted.toLocaleString()} encounter memory record${result.deleted === 1 ? '' : 's'} deleted.`);
    } catch (error) {
      setPrivacyMessage(error?.message || 'Encounter memories could not be deleted.');
    } finally {
      setMemoryBusy(false);
    }
  };

  const activeTheme        = resolveThemeId(player?.activeCosmetics?.appTheme || player?.activeCosmetics?.theme || DEFAULT_THEME_ID);

  const setCosmetic = async (key, value) => {
    if (!player) return;
    lastCosmeticWriteRef.current = Date.now();
    const previous = player;
    const updated = { ...player, activeCosmetics: { ...(player.activeCosmetics || {}), [key]: value } };
    if (key === 'appTheme' || key === 'theme') {
      persistedThemeRef.current = resolveThemeId(value);
      // Keep the preview guard in place until the player write and app-context
      // update both finish. Otherwise an older in-flight profile projection
      // can repaint the root theme between preview and commit.
      applyPreviewTheme(persistedThemeRef.current);
    }
    try {
      const committed = await commitCurrentProfile(updated);
      if ((key === 'appTheme' || key === 'theme') && typeof document !== 'undefined') {
        document.documentElement.setAttribute('data-theme-commit-player', updated.UUID);
        document.documentElement.setAttribute('data-theme-commit-id', persistedThemeRef.current);
        document.documentElement.setAttribute('data-theme-commit-at', String(Date.now()));
        restorePersistedTheme(persistedThemeRef.current);
      }
      setPlayer(committed);
      return committed;
    } catch (error) {
      setPlayer(previous);
      if (key === 'appTheme' || key === 'theme') {
        persistedThemeRef.current = resolveThemeId(previous.activeCosmetics?.appTheme || previous.activeCosmetics?.theme || DEFAULT_THEME_ID);
        restorePersistedTheme(persistedThemeRef.current);
      }
      throw error;
    }
  };

  useEffect(() => {
    persistedThemeRef.current = activeTheme;
  }, [activeTheme]);

  useEffect(() => () => {
    if (
      typeof document !== 'undefined'
      && document.documentElement.hasAttribute('data-theme-preview')
    ) {
      restorePersistedTheme(persistedThemeRef.current);
    }
  }, []);


  const verifySave = async () => {
    if (verificationBusy) return;
    setVerificationBusy(true);
    try {
      setVerification(await databaseConnection.verifySave());
    } catch (error) {
      setVerification({ exportReady: false, error: error.message || 'Verification failed.' });
    } finally {
      setVerificationBusy(false);
    }
  };

  const revealCompleteInterface = async () => {
    if (!player?.UUID || interfaceRevealBusy) return;
    setInterfaceRevealBusy(true);
    try {
      const result = await reconcileOpeningTrail(databaseConnection, player.UUID, { revealAll: true });
      setInterfaceRevealComplete(result.complete);
      invalidateDomains?.(['contributionRoad']);
    } finally {
      setInterfaceRevealBusy(false);
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!player) return;
    const updated = {
      ...player,
      username:    form.username    || player.username,
      wakeTime:    form.wakeTime,
      sleepTime:   form.sleepTime,
      wakeChecklist: normalizeRitualChecklist(form.wakeChecklist),
      sleepChecklist: normalizeRitualChecklist(form.sleepChecklist),
    };
    delete updated.description;
    setPlayer(await saveSharedRitualSettings(databaseConnection, player, {
      activePatch: updated,
      wakeChecklist: updated.wakeChecklist,
      sleepChecklist: updated.sleepChecklist,
    }));
    formDirtyRef.current = false;
    refreshApp();
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const runFolderAction = async (action) => {
    setFolderBusy(true);
    setFolderError('');
    setFolderMessage('');
    try {
      const result = await action();
      if (result?.direction === 'backup' && result.path) {
        setFolderMessage(`Backup created at ${result.path}`);
      } else if (result?.direction === 'download') {
        setFolderMessage(result.kind === 'backup' ? 'Verified backup downloaded.' : 'Compact save downloaded.');
      }
      refreshApp();
    } catch (error) {
      if (error?.name !== 'AbortError') setFolderError(error.message || 'Folder action failed.');
    } finally {
      setFolderBusy(false);
    }
  };

  const updateRecommenderSettings = async (patch) => {
    if (!player?.UUID) return;
    const next = await saveTaskRecommenderV12Settings(databaseConnection, player.UUID, {
      ...(recommenderSettings || {}),
      ...patch,
    });
    setRecommenderSettings(next);
    setRecommenderMessage('v12 settings saved.');
    setTimeout(() => setRecommenderMessage(''), 2200);
  };

  const handleTrainRecommender = async () => {
    if (!player?.UUID || recommenderBusy) return;
    setRecommenderBusy(true);
    setRecommenderMessage('');
    try {
      const result = await trainTaskRecommendationV12(databaseConnection, {
        requestId: uuid(),
        playerUUID: player.UUID,
        options: { force: true },
      });
      const checkpoint = await readTaskRecommendationV12Checkpoint(databaseConnection, player.UUID);
      setRecommenderCheckpoint(checkpoint);
      setRecommenderMessage(result?.status === 'candidate-ready'
        ? 'A new v12 candidate is ready for controlled evaluation.'
        : result?.status === 'deferred-insufficient-evidence'
          ? 'Training is waiting for enough resolved recommendations.'
          : result?.status === 'deferred-energy-sensitive-scheduling'
            ? 'Training is waiting for energy and thermal conditions to improve.'
          : 'v12 training completed.');
    } catch (error) {
      console.warn('[Settings] v12 recommender training failed:', error);
      setRecommenderMessage(error?.message || 'v12 training failed.');
    } finally {
      setRecommenderBusy(false);
    }
  };

  const downloadJson = (payload, filename) => {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadRecommenderCheckpoint = async () => {
    if (!player?.UUID) return;
    const payload = await readTaskRecommendationV12Checkpoint(databaseConnection, player.UUID);
    downloadJson(payload, `task-recommender-v12-checkpoint-${new Date().toISOString().slice(0, 10)}.json`);
  };

  const handleUploadRecommenderCheckpoint = async (file) => {
    if (!file || !player?.UUID) return;
    const checkpoint = await importTaskRecommendationV12Checkpoint(
      databaseConnection,
      player.UUID,
      await file.text(),
    );
    setRecommenderCheckpoint(checkpoint);
    setRecommenderMessage('v12 checkpoint imported.');
    refreshApp();
  };

  const handleDownloadRecommenderBundle = async () => {
    if (!player?.UUID) return;
    const payload = await exportTaskRecommendationV12Bundle(databaseConnection, player.UUID);
    downloadJson(payload, `task-recommender-v12-bundle-${new Date().toISOString().slice(0, 10)}.json`);
  };

  const handleUploadRecommenderBundle = async (file) => {
    if (!file || !player?.UUID || recommenderBusy) return;
    setRecommenderBusy(true);
    setRecommenderMessage('');
    try {
      const imported = await importTaskRecommendationV12Bundle(
        databaseConnection,
        player.UUID,
        await file.text(),
      );
      const checkpoint = await readTaskRecommendationV12Checkpoint(databaseConnection, player.UUID);
      setRecommenderCheckpoint(checkpoint);
      setRecommenderMessage(`Imported ${Number(imported.protocolEventsImported || 0).toLocaleString()} v12 events.`);
      refreshApp();
    } catch (error) {
      console.warn('[Settings] v12 recommender bundle import failed:', error);
      setRecommenderMessage(error?.message || 'v12 bundle import failed.');
    } finally {
      setRecommenderBusy(false);
    }
  };

  const rankPresentation = getPlayerRankPresentation(player, { glowSize: 20 });
  const {
    elo,
    hasVisibleRating,
    rank,
    rankLabel,
    rankProgress,
    rankGlow,
    rankClass,
  } = rankPresentation;

  const saveIdentityLoadout = async (index) => {
    if (!player) return;
    const loadouts = [...(player.identityLoadouts || [null, null])];
    loadouts[index] = normalizeCosmeticEquipment(player.activeCosmetics, { profileLayout: player.profilePersonalization?.skin });
    const updated = { ...player, identityLoadouts: loadouts.slice(0, 2) };
    setPlayer(await commitCurrentProfile(updated));
  };

  const applyIdentityLoadout = async (index) => {
    const loadout = player?.identityLoadouts?.[index];
    if (!player || !loadout) return;
    const updated = { ...player, activeCosmetics: normalizeCosmeticEquipment(loadout) };
    setPlayer(await commitCurrentProfile(updated));
    applyThemeToElement(document.documentElement, updated.activeCosmetics.appTheme);
  };

  return (
    <div className={`settings-page ${embedded ? 'settings-page--embedded' : ''}`}>
      <LocalSectionNav
        items={availableSettingsPages}
        value={presentedPageId}
        onChange={selectPage}
        label="Settings sections"
      />
      {/* Rank showcase */}
      {!embedded && <div className="settings-rank-hero">
        <div className="srh-bg" />
        <div className="srh-avatar-wrap" style={{ boxShadow: rankGlow }}>
          <ProfileIdentity identity={player} avatarOnly avatarSize={64} isViewer />
        </div>
        <div className="srh-rank-info">
          <div className={`srh-rank-icon rank-${rankClass}`}>
            {hasVisibleRating ? <RankIcon group={rank.group} sub={rank.sub} size={28} /> : '?'}
          </div>
          <div className="srh-rank-label-group">
            <span className={`srh-rank-name rank-${rankClass}`}>{rankLabel}</span>
            <span className="srh-elo">
              {hasVisibleRating ? `${elo} ELO` : 'Complete a rated competition to establish your rank'}
            </span>
            {player?.archivedAt && <span className="srh-archived-badge">Archived</span>}
          </div>
          <div className="srh-progress">
            <div className="srh-progress-track">
              <div
                className="srh-progress-fill"
                style={{
                  width: `${rankProgress}%`,
                  background: rank?.color || 'var(--border)',
                }}
              />
            </div>
            <span className="srh-progress-label">
              {hasVisibleRating ? `${rankProgress}% to next rank` : 'Unrated'}
            </span>
          </div>
        </div>
      </div>}

      <form className="settings-form" onSubmit={handleSave}>
        {/* Profile */}
        <SettingsSection page="general" activePage={presentedPageId} icon={<Icon name="profile" size={16} />} title="Profile">
          <SettingsRow label="Username">
            <input value={form.username} onChange={(e) => updateForm({ username: e.target.value })} placeholder={player?.username || 'Username'} className="settings-input" />
          </SettingsRow>
          <SettingsRow label="Wake Time">
            <input type="time" value={form.wakeTime} onChange={(e) => updateForm({ wakeTime: e.target.value })} className="settings-input settings-input--time" />
          </SettingsRow>
          <SettingsRow label="Bed Time" hint="Optional timing context; never a penalty gate">
            <input type="time" value={form.sleepTime} onChange={(e) => updateForm({ sleepTime: e.target.value })} className="settings-input settings-input--time" />
          </SettingsRow>
          <SettingsRow
            label="Wake Checklist"
            hint="Optional context. Check-ins do not grant rewards or multipliers."
            className="settings-row--checklist"
          >
            <textarea
              value={form.wakeChecklist}
              onChange={(e) => updateForm({ wakeChecklist: e.target.value })}
              placeholder={'Drink water\nOpen the curtains\nReview today\'s plan'}
              className="settings-input settings-input--checklist"
              rows={5}
            />
          </SettingsRow>
          <SettingsRow
            label="Sleep Checklist"
            hint="Optional handoff context. Missing it never removes coins."
            className="settings-row--checklist"
          >
            <textarea
              value={form.sleepChecklist}
              onChange={(e) => updateForm({ sleepChecklist: e.target.value })}
              placeholder={'Clear the desk\nPrepare tomorrow\nPut devices away'}
              className="settings-input settings-input--checklist"
              rows={5}
            />
          </SettingsRow>
          <div className="settings-save-row">
            <button type="submit" className="primary settings-save-btn">{saved ? '✓ SAVED' : 'SAVE CHANGES'}</button>
          </div>
        </SettingsSection>

        <SettingsSection page="notifications" activePage={presentedPageId} icon={<Icon name="settings" size={16} />} title="Notifications">
          <WebPushPanel databaseConnection={databaseConnection} />
          <SettingsRow label="Sound Effects" hint="Short cues for rewards, timers, matches, purchases, and panel actions">
            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={soundEnabled}
                onChange={(event) => handleSoundToggle(event.target.checked)}
              />
              <span>{soundEnabled ? 'ON' : 'OFF'}</span>
            </label>
          </SettingsRow>
          <SettingsRow label="Inbox Notifications" hint="Stops unread notification work while disabled">
            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={player?.inboxNotificationsEnabled !== false}
                onChange={(event) => handleInboxNotificationsToggle(event.target.checked)}
              />
              <span>{player?.inboxNotificationsEnabled !== false ? 'ON' : 'OFF'}</span>
            </label>
          </SettingsRow>
          <SettingsRow label="Presence Detail" hint="Controls the most specific fact other players can see during live work">
            <select
              className="settings-input"
              value={player?.presenceVisibilityPolicy || 'state-only'}
              onChange={(event) => savePlayerPolicy({ presenceVisibilityPolicy: event.target.value })}
            >
              <option value="state-only">State only</option>
              <option value="goal">Include linked Goal</option>
              <option value="task">Include exact task</option>
              <option value="private">Private</option>
            </select>
          </SettingsRow>
          <SettingsRow label="Proactive Prompt Budget" hint="Maximum delivered prompts per local day; defaults to two">
            <select
              className="settings-input"
              value={Math.max(0, Number(player?.notificationPolicy?.maximumPerDay ?? 2))}
              onChange={(event) => updateNotificationPolicy({ maximumPerDay: Number(event.target.value) })}
            >
              <option value="0">Off</option>
              <option value="1">1 per day</option>
              <option value="2">2 per day</option>
              <option value="3">3 per day</option>
            </select>
          </SettingsRow>
          {[
            ['planned-opportunity', 'Planned opportunities'],
            ['external-deadline', 'External deadlines'],
            ['shared-appointment', 'Shared appointments'],
            ['resolved-blocker', 'Resolved blockers'],
            ['reentry', 'Return after absence'],
          ].map(([category, label]) => (
            <SettingsRow key={category} label={label}>
              <label className="settings-toggle">
                <input
                  type="checkbox"
                  checked={player?.notificationPolicy?.categories?.[category] !== false}
                  onChange={(event) => updateNotificationPolicy({
                    categories: { [category]: event.target.checked },
                  })}
                />
                <span>{player?.notificationPolicy?.categories?.[category] !== false ? 'ON' : 'OFF'}</span>
              </label>
            </SettingsRow>
          ))}
        </SettingsSection>

        <SettingsSection page="privacy" activePage={presentedPageId} icon={<Icon name="profile" size={16} />} title="Privacy">
          <SettingsRow label="Presence detail">
            <select
              className="settings-input"
              value={player?.presenceVisibilityPolicy || 'state-only'}
              onChange={(event) => savePlayerPolicy({ presenceVisibilityPolicy: event.target.value })}
            >
              <option value="state-only">State only</option>
              <option value="goal">Include linked Goal</option>
              <option value="task">Include exact task</option>
              <option value="private">Private</option>
            </select>
          </SettingsRow>
          <SettingsRow label="Profile visibility">
            <select
              className="settings-input"
              value={player?.profileVisibility || 'fellows'}
              onChange={(event) => savePlayerPolicy({ profileVisibility: event.target.value })}
            >
              <option value="public">Public</option>
              <option value="fellows">Fellows</option>
              <option value="private">Private</option>
            </select>
          </SettingsRow>
          <SettingsRow label="Encounter memories" hint="Delete this profile’s “since last saw” receipts without deleting anyone’s underlying activity">
            <button type="button" className="danger" disabled={memoryBusy} onClick={deleteEncounterMemories}>{memoryBusy ? 'Deleting…' : 'Delete memories…'}</button>
          </SettingsRow>
          {privacyMessage && <p className="settings-inline-message" role="status">{privacyMessage}</p>}
        </SettingsSection>

        <SettingsSection page="accessibility" activePage={presentedPageId} icon={<Icon name="eye" size={16} />} title="Accessibility">
          <SettingsRow
            label="Complete interface"
            hint="Opening Trail reveals are optional presentation guidance; this never changes rewards or access to your records"
          >
            <button type="button" onClick={revealCompleteInterface} disabled={interfaceRevealBusy || interfaceRevealComplete}>
              {interfaceRevealComplete ? 'Interface revealed' : interfaceRevealBusy ? 'Revealing…' : 'Reveal complete interface now'}
            </button>
          </SettingsRow>
          <SettingsRow label="Reduced motion">
            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={player?.reducedMotion === true}
                onChange={(event) => {
                  const enabled = event.target.checked;
                  document.documentElement.toggleAttribute('data-reduced-motion', enabled);
                  savePlayerPolicy({ reducedMotion: enabled });
                }}
              />
              <span>{player?.reducedMotion ? 'On' : 'System'}</span>
            </label>
          </SettingsRow>
          <SettingsRow label="High contrast">
            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={player?.highContrast === true}
                onChange={(event) => {
                  const enabled = event.target.checked;
                  document.documentElement.toggleAttribute('data-high-contrast', enabled);
                  savePlayerPolicy({ highContrast: enabled });
                }}
              />
              <span>{player?.highContrast ? 'On' : 'Theme default'}</span>
            </label>
          </SettingsRow>
        </SettingsSection>

        <SettingsSection page="appearance" activePage={presentedPageId} icon={<Icon name="profile" size={16} />} title="Appearance Studio">
          <AppearanceStudio
            player={player}
            inventory={inventory}
            onEquip={setCosmetic}
            onReset={(slot) => setCosmetic(slot, DEFAULT_COSMETIC_EQUIPMENT[slot] ?? null)}
            onSaveLoadout={saveIdentityLoadout}
            onApplyLoadout={applyIdentityLoadout}
          />
        </SettingsSection>

        <SettingsSection page="advanced" activePage={presentedPageId} icon={<Icon name="tasks" size={16} />} title="Task Recommender v12">
          <SettingsRow
            label="Continuous Training"
            hint="Updates the active v12 checkpoint from recommendation outcomes"
          >
            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={recommenderSettings?.continuousTraining !== false}
                onChange={(event) => updateRecommenderSettings({ continuousTraining: event.target.checked })}
              />
              <span>{recommenderSettings?.continuousTraining !== false ? 'On' : 'Off'}</span>
            </label>
          </SettingsRow>
          <SettingsRow
            label="Checkpoint Status"
            hint={recommenderCheckpoint?.checkpoint?.manifest?.updatedAt
              ? `Updated ${new Date(recommenderCheckpoint.checkpoint.manifest.updatedAt).toLocaleString()}`
              : 'Using a v12 cold-start checkpoint'}
          >
            <div className="settings-folder-actions">
              <button type="button" disabled={recommenderBusy || !player?.UUID} onClick={handleTrainRecommender}>
                {recommenderBusy ? 'Training...' : 'Train now'}
              </button>
              <span className="settings-row-hint">
                {Number(recommenderCheckpoint?.checkpoint?.model?.posterior?.updateCount || 0).toLocaleString()} updates
              </span>
            </div>
          </SettingsRow>
          <SettingsRow label="Download Checkpoint" hint="Exports the active v12 model checkpoint">
            <button type="button" disabled={!player?.UUID} onClick={handleDownloadRecommenderCheckpoint}>Download</button>
          </SettingsRow>
          <SettingsRow label="Import Checkpoint" hint="Atomically replaces the active v12 checkpoint and keeps recovery evidence">
            <div className="settings-upload-row">
              <input
                type="file"
                accept=".json,application/json"
                id="recommender-checkpoint-upload"
                className="settings-file-input"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  await handleUploadRecommenderCheckpoint(file);
                  e.target.value = '';
                }}
              />
              <label htmlFor="recommender-checkpoint-upload" className="settings-file-label">CHOOSE FILE</label>
            </div>
          </SettingsRow>
          <SettingsRow
            label="v12 Bundle"
            hint="Exports or imports the checkpoint and authoritative recommendation outcomes together"
          >
            <div className="settings-upload-row">
              <button type="button" disabled={!player?.UUID} onClick={handleDownloadRecommenderBundle}>
                Download
              </button>
              <input
                type="file"
                accept=".json,application/json"
                id="recommender-bundle-upload"
                className="settings-file-input"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  await handleUploadRecommenderBundle(file);
                  e.target.value = '';
                }}
              />
              <label htmlFor="recommender-bundle-upload" className="settings-file-label">
                IMPORT
              </label>
            </div>
          </SettingsRow>
          {recommenderMessage && <div className="settings-sync-status">{recommenderMessage}</div>}
        </SettingsSection>

        {/* Data */}
        <SettingsSection page="data" activePage={presentedPageId} icon={<Icon name="journal" size={16} />} title="Data & Backup">
          <SyncAccountPanel databaseConnection={databaseConnection} />
          <SyncStatusPanel databaseConnection={databaseConnection} />
          <OfflineStoragePanel databaseConnection={databaseConnection} />
          {!mobileRestricted && <RecoveryPanel databaseConnection={databaseConnection} onRestored={refreshApp} />}
          {!mobileRestricted && <div className="settings-verification">
            <div className="settings-verification__status">
              <strong>{verification
                ? verification.exportReady ? 'Save verified' : 'Review required'
                : 'Not checked this session'}</strong>
              {verification?.verifiedAt && <span>{new Date(verification.verifiedAt).toLocaleString()}</span>}
            </div>
            <button type="button" className="primary" onClick={verifySave} disabled={verificationBusy}>
              {verificationBusy ? 'Verifying…' : 'Verify save'}
            </button>
          </div>}
          {!mobileRestricted && verification && !verification.error && (
            <div className="settings-verification__grid">
              <span>Schema<strong>{verification.lastMigration}</strong></span>
              <span>Integrity<strong>{verification.integrityStatus}</strong></span>
              <span>Foreign keys<strong>{verification.foreignKeyStatus}</strong></span>
              <span>Orphans<strong>{verification.orphanTotal}</strong></span>
              <span>Missing files<strong>{verification.missingResources.length}</strong></span>
              <span>Export<strong>{verification.exportReady ? 'Ready' : 'Blocked'}</strong></span>
            </div>
          )}
          {!mobileRestricted && verification?.error && <div className="settings-sync-error">{verification.error}</div>}
          <SettingsRow
            label="Storage"
            hint="Compact SQLite is the live store. Changes update only the affected rows."
          >
            <span className="settings-row-hint">SQLite · automatic</span>
          </SettingsRow>
          {!mobileRestricted && folderMessage && <div className="settings-sync-status">{folderMessage}</div>}
          {!mobileRestricted && folderError && <div className="settings-sync-error">{folderError}</div>}
          {!mobileRestricted && <SettingsRow label="Download Save" hint="Creates one compact verified package with SQLite, the current model, and referenced images">
            <button type="button" disabled={folderBusy} onClick={() => runFolderAction(() => databaseConnection.getSaveAsZip())}>Download</button>
          </SettingsRow>}
          {!mobileRestricted && <SettingsRow
            label="Create Backup"
            hint="Downloads an explicit verified backup of the current canonical data"
          >
            <button
              type="button"
              disabled={folderBusy}
              onClick={() => runFolderAction(() => databaseConnection.createCompactBackup())}
            >
              Create backup
            </button>
          </SettingsRow>}
          {!mobileRestricted && <SettingsRow label="Pre-migration backup">
            <button
              type="button"
              disabled={folderBusy || !verification?.lastBackup}
              onClick={() => runFolderAction(() => databaseConnection.downloadPreMigrationBackup())}
            >
              Download
            </button>
          </SettingsRow>}
          {!mobileRestricted && <SettingsRow label="Rebuild caches">
            <button
              type="button"
              disabled={folderBusy}
              onClick={() => runFolderAction(() => databaseConnection.rebuildDisposableCaches())}
            >
              Rebuild
            </button>
          </SettingsRow>}
          {!mobileRestricted && <SettingsRow label="Restore Save" hint="Choose either a save ZIP or an uncompressed Tapestry data folder">
            <div className="settings-upload-row">
              <input type="file" accept=".zip,application/zip" id="save-upload" className="settings-file-input"
                onChange={async (e) => {
                  const file = e.target.files[0];
                  if (!file) return;
                  await runFolderAction(() => databaseConnection.saveUpload(file));
                  e.target.value = '';
                }} />
              <label htmlFor="save-upload" className="settings-file-label">CHOOSE ZIP</label>
              <input
                type="file"
                id="save-folder-upload"
                className="settings-file-input"
                webkitdirectory=""
                directory=""
                multiple
                onChange={async (e) => {
                  const files = Array.from(e.target.files || []);
                  if (!files.length) return;
                  await runFolderAction(() => databaseConnection.saveFolderUpload(files));
                  e.target.value = '';
                }}
              />
              <label htmlFor="save-folder-upload" className="settings-file-label">CHOOSE FOLDER</label>
            </div>
          </SettingsRow>}
        </SettingsSection>
      </form>

    </div>
  );
}
