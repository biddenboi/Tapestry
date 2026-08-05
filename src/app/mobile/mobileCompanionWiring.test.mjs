import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (name) => readFile(new URL(name, import.meta.url), 'utf8');

test('mobile shell exposes exactly five product destinations with persistent tab state', async () => {
  const [shell, navigation] = await Promise.all([
    read('./MobileAppShell.jsx'),
    read('./MobileBottomNavigation.jsx'),
  ]);
  const destinations = [
    ['tasks', 'Today'],
    ['habits', 'Events'],
    ['chronicle', 'Chronicle'],
    ['shop', 'Shop'],
    ['profile', 'More'],
  ];
  for (const [id, label] of destinations) {
    assert.match(navigation, new RegExp(`id: '${id}', label: '${label}'`));
  }
  assert.equal((navigation.match(/id: '/g) || []).length, 5);
  assert.match(shell, /MobileChroniclePage = lazy/);
  assert.match(shell, /MobileHabitsPage = lazy/);
  assert.match(shell, /MobileMorePage = lazy/);
  assert.match(shell, /MobileShopPage = lazy/);
  assert.match(shell, /panels\.map/);
  assert.match(shell, /hidden=\{tab !== id\}/);
  assert.match(shell, /#\/m\//);
  assert.match(shell, /mobile-shell-fab/);
  assert.match(shell, /<MobileOverlayHost \/>/);
  assert.match(shell, /useVisualViewport\(\)/);
  assert.doesNotMatch(`${shell}\n${navigation}`, /Lobby|loadLobby|<Lobby|FeedPage|pages\/Shop\/Shop/);
});

test('mobile task and reminder editors are dedicated presentations over canonical commands', async () => {
  const [today, taskSheets, reminderSheets, desktopTaskEditor] = await Promise.all([
    read('./MobileTasksPage.jsx'),
    read('../../features/tasks/mobile/MobileTaskSheets.jsx'),
    read('../../features/reminders/mobile/MobileReminderSheets.jsx'),
    read('../../features/tasks/modals/TaskCreationMenu/TaskCreationMenu.jsx'),
  ]);
  assert.match(today, /queryMobileWorkspaceAgenda/);
  assert.match(today, /nearestApplicableReminder/);
  assert.match(today, /openSurface\('task-actions'/);
  assert.match(today, /openSurface\('create-menu'/);
  assert.match(today, /completeTodoNow/);
  assert.match(today, /origin: 'mobile'/);
  assert.doesNotMatch(today, /Search tasks and reminders|showTaskCreationMenu|showTaskPreviewMenu|Choose Date/);
  assert.match(taskSheets, /saveTaskDraftCommand/);
  assert.match(taskSheets, /parseCombinedInput/);
  assert.match(taskSheets, /explicit fields override parser output|dateExplicit/);
  assert.match(taskSheets, /type="number" min="1" max="1440" step="1"/);
  assert.doesNotMatch(taskSheets, /Duration \(minutes\)[\s\S]{0,180}step="5"/);
  assert.match(reminderSheets, /saveReminderCommand/);
  assert.match(reminderSheets, /transitionReminderCommand/);
  assert.match(desktopTaskEditor, /saveTaskDraftCommand/);
  assert.doesNotMatch(taskSheets, /TaskCreationMenu/);
  assert.match(taskSheets, /loadTaskSessionMenu/);
  assert.match(taskSheets, /NiceModal\.show\(TaskSessionMenu\)/);
  assert.match(taskSheets, /isPlanningRecordInWorkspace\(goal, DEFAULT_WORKSPACE_ID\)/);
  assert.match(desktopTaskEditor, /isPlanningRecordInWorkspace\(goal, DEFAULT_WORKSPACE_ID\)/);
});

test('mobile correctness uses workspace planning, boundary-only profile selection, and shared identity', async () => {
  const [tasks, goals, profile, agenda, goalQuery, profileSwitch, identity, identityModel, reminders] = await Promise.all([
    read('./MobileTasksPage.jsx'),
    read('../../features/goals/mobile/MobileGoalsPage.jsx'),
    read('../../features/profile/mobile/MobileMorePage.jsx'),
    read('./application/MobileAgendaQueryService.js'),
    read('./application/MobileGoalsQueryService.js'),
    read('./application/MobileProfileSwitchCommand.js'),
    read('../../shared/profile-identity/ProfileIdentity.jsx'),
    read('../../domain/profile/ProfileIdentity.js'),
    read('../../data/persistence/services/ReminderQueryService.js'),
  ]);
  assert.match(tasks, /queryMobileWorkspaceAgenda/);
  assert.match(goals, /queryMobileWorkspaceGoals/);
  assert.match(agenda, /getWorkspaceReminders/);
  assert.match(goalQuery, /getWorkspaceOverview/);
  assert.match(reminders, /getWorkspaceReminders/);
  assert.doesNotMatch(profile, /switchMobileProfile/);
  assert.match(profile, /<ProfileIdentity/);
  assert.match(profileSwitch, /databaseConnection\.switchProfile\(currentPlayer, targetId\)/);
  assert.match(profile, /Current player summary/);
  assert.doesNotMatch(profile, /Find Players|public profile|searchProfiles/i);
  assert.match(identity, /buildProfileIdentity/);
  assert.match(identityModel, /activeCosmetics/);
});

test('mobile Events, Goals, and Chronicle use dedicated mobile information architecture', async () => {
  const [habits, habitPage, goals, goalPresentation, goalUpdate, chronicle, chronicleSheets, chronicleDraft] = await Promise.all([
    read('../../features/events/mobile/MobileHabitsPage.jsx'),
    read('../../features/events/pages/Events/HabitPage.jsx'),
    read('../../features/goals/mobile/MobileGoalsPage.jsx'),
    read('../../features/goals/mobile/MobileGoalPresentation.js'),
    read('../../features/goals/mobile/MobileGoalUpdateSheet.jsx'),
    read('../../features/chronicle/mobile/MobileChroniclePage.jsx'),
    read('../../features/chronicle/mobile/MobileChronicleSheets.jsx'),
    read('../../features/chronicle/mobile/MobileChronicleDraft.js'),
  ]);
  assert.match(habits, /buildHabitPageModel/);
  assert.match(habits, /<HabitPage/);
  assert.match(habits, /<HabitEditor/);
  assert.match(habits, /loadTrackerOverview/);
  assert.match(habits, /onBackToHabits/);
  assert.match(habitPage, /onOpenGoals/);
  assert.match(goals, /← Events/);
  assert.match(goals, /selectMobileGoalCards/);
  assert.match(goalPresentation, /overview\?\.activeGoals/);
  assert.match(goals, /healthStatus === 'blocked'/);
  assert.match(goals, /getGoalDetail/);
  assert.match(goals, /openSurface\('goal-update'/);
  assert.doesNotMatch(goals, /completedGoals|Completed goals|completed count/i);
  assert.match(goalUpdate, /postUpdate/);
  assert.match(chronicle, /MobileChroniclePage/);
  assert.match(chronicle, /Quick capture/);
  assert.match(chronicle, /<ProfileIdentity/);
  assert.match(chronicle, /openSurface\('chronicle-entry'/);
  assert.doesNotMatch(chronicle, /Read entry|FeedPage|mobileRestricted/);
  assert.match(chronicleSheets, /ChronicleDraftService/);
  assert.match(chronicleDraft, /surface: MOBILE_CHRONICLE_DRAFT_SURFACE/);
  assert.match(chronicleDraft, /mobile-quick-capture/);
  assert.match(chronicleSheets, /pagehide/);
  assert.match(chronicleSheets, /persistDraft/);
  assert.match(chronicleSheets, /Add a comment/);
  assert.match(chronicleSheets, /STORES\.journalComment/);
});

test('mobile Shop and More retain gameplay without desktop administration', async () => {
  const [shop, more, moreSheets, settings, dataSettings, arena] = await Promise.all([
    read('../../features/shop/mobile/MobileShopPage.jsx'),
    read('../../features/profile/mobile/MobileMorePage.jsx'),
    read('../../features/profile/mobile/MobileMoreSheets.jsx'),
    read('../../features/settings/mobile/MobileSettingsPage.jsx'),
    read('../../features/settings/mobile/MobileDataBackupSettings.jsx'),
    read('../../features/matches/mobile/MobileArenaPage.jsx'),
  ]);
  assert.match(shop, /\['browse', 'inventory', 'cart'\]/);
  assert.doesNotMatch(shop, /Contribution Road|getContributionRoadProgress|claimAchievementPackNode|mode === 'road'/);
  assert.match(shop, /isConsumableInventoryItem/);
  assert.match(shop, /commitShopPurchase/);
  assert.match(shop, /money/);
  assert.match(shop, /\$\{/);
  assert.match(shop, /activateShopItemCommand/);
  assert.match(shop, /owned \? 'Owned'/);
  assert.match(more, /Notifications/);
  assert.match(more, /Current player summary/);
  assert.doesNotMatch(more, /View player summary/);
  assert.match(more, /createPairMatchCommand/);
  assert.match(more, /Dojo/);
  assert.match(more, /Elo history/);
  assert.match(moreSheets, /mobile-player-sheet-stats/);
  assert.doesNotMatch(moreSheets, /Profiles can only be changed during Start Day or End Day/);
  assert.doesNotMatch(moreSheets, /mobile-player-sheet-profiles/);
  assert.doesNotMatch(moreSheets, /onSwitch|Switching…/);
  assert.doesNotMatch(more, /See All|Find Players|public profile search/i);
  assert.match(settings, /\{ id: 'data', label: 'Data & Backup'/);
  assert.match(settings, /\{ id: 'notifications', label: 'Notifications'/);
  assert.match(settings, /\{ id: 'accessibility', label: 'Accessibility'/);
  assert.match(settings, /\{ id: 'privacy', label: 'Privacy'/);
  assert.equal((settings.match(/\{ id: '/g) || []).length, 4);
  assert.match(settings, /<WebPushPanel/);
  assert.doesNotMatch(settings, /AppearanceStudio|Appearance|theme selector/i);
  assert.doesNotMatch(settings, /SyncAccountPanel|RecoveryPanel/);
  assert.doesNotMatch(settings, /features\/settings\/pages\/Settings/);
  assert.match(settings, /role="alert"/);
  assert.match(dataSettings, /describeMobileSyncState/);
  assert.match(dataSettings, /createCompactBackup/);
  assert.match(arena, /MobileDojoRuntime/);
  assert.match(arena, /MobileMatchRuntime/);
  assert.doesNotMatch(arena, /components\/PracticeDojo\/PracticeDojo|components\/MatchArena\/MatchArena/);
  assert.doesNotMatch(arena, /Arena landing|GameHub|Lobby/);
});

test('mobile scaffold is split by responsibility, focus-safe, and keyboard-safe', async () => {
  const [shellCss, foundation, today, sheets, features, viewport, overlays, arena, dojo] = await Promise.all([
    read('./MobileAppShell.css'),
    read('./styles/MobileFoundation.css'),
    read('./styles/MobileToday.css'),
    read('./styles/MobileSheets.css'),
    read('./styles/MobileFeatures.css'),
    read('./useVisualViewport.js'),
    read('./MobileOverlayHost.jsx'),
    read('../../features/matches/mobile/MobileArenaPage.jsx'),
    read('../../features/matches/mobile/MobileDojoRuntime.jsx'),
  ]);
  for (const stylesheet of ['MobileFoundation.css', 'MobileToday.css', 'MobileSheets.css', 'MobileFeatures.css']) {
    assert.match(shellCss, new RegExp(stylesheet));
  }
  assert.match(foundation, /padding: max\(16px, env\(safe-area-inset-top\)\) max\(16px/);
  assert.match(foundation, /min-height: 44px/);
  assert.match(foundation, /font-size: 1rem/);
  assert.match(today, /mobile-task-checkbox/);
  assert.match(sheets, /--visual-viewport-height/);
  assert.match(sheets, /--keyboard-inset/);
  assert.match(sheets, /overflow-wrap: anywhere/);
  assert.match(features, /mobile-settings-menu/);
  assert.match(features, /grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(shellCss, /html\[data-high-contrast\] \.mobile-app-shell/);
  assert.match(shellCss, /--bg-primary: var\(--bg-void/);
  assert.match(shellCss, /--text-primary: var\(--text/);
  assert.match(viewport, /window\.visualViewport/);
  assert.match(viewport, /--keyboard-inset/);
  assert.match(overlays, /stage\?\.querySelector\('\[data-autofocus="true"\]/);
  assert.match(overlays, /tabIndex=\{-1\} aria-hidden="true"/);
  assert.match(overlays, /stage\.querySelectorAll/);
  assert.match(arena, /panel\.scrollTop = 0/);
  assert.match(features, /mobile-dojo-feed-shell/);
  assert.match(dojo, /DojoRecommendationFeed/);
  assert.match(dojo, /PracticeDojo\.css/);
  assert.match(features, /mobile-match-scoreboard/);
});

test('a clean mobile device uses password-authenticated cloud bootstrap instead of the desktop ZIP gate', async () => {
  const [app, gate, bootstrap, authService, syncPanel] = await Promise.all([
    read('../App.jsx'),
    read('./MobileCloudBootstrapGate.jsx'),
    read('../../data/sync/MobileReferenceSync.js'),
    read('../../data/sync/supabase/SupabaseAuthService.js'),
    read('../../features/settings/components/SyncAccountPanel/SyncAccountPanel.jsx'),
  ]);
  assert.match(app, /mobileCompanion \? \(/);
  assert.match(app, /<MobileCloudBootstrapGate onReady=\{handleDataSourceReady\}/);
  assert.match(app, /DATA_DOMAINS,\s+DOMAIN_INVALIDATION,/);
  assert.match(app, /invalidateDomains\(DOMAIN_INVALIDATION\.profileWrite\)/);
  assert.match(gate, /Sign in with password/);
  assert.match(gate, /Continue with Google/);
  assert.match(gate, /Email recovery link/);
  assert.match(authService, /signInWithPassword/);
  assert.match(authService, /signInWithGoogle/);
  assert.match(authService, /updateUser\(\{ password: secret \}\)/);
  assert.match(syncPanel, /Set\/change mobile password/);
  assert.match(gate, /restoreMobileBootstrapData/);
  assert.match(gate, /Use another account/);
  assert.match(gate, /mobile-clean-device-bootstrap/);
  assert.match(gate, /onProgress: setRestoreProgress/);
  assert.match(gate, /Downloaded.*records/);
  assert.match(gate, /role="status" aria-live="polite"/);
  assert.match(gate, /Recovery ZIP/);
  assert.doesNotMatch(gate, /Start new|Restore folder/);
  for (const recordType of [
    'profile', 'task', 'reminder', 'journal', 'action-session', 'match',
    'shop-catalog', 'inventory', 'routine-run', 'effect-interval',
  ]) {
    assert.match(bootstrap, new RegExp(`'${recordType}'`));
  }
  const referenceTypeBlock = bootstrap.match(
    /export const MOBILE_(?:REFERENCE|BOOTSTRAP)_RECORD_TYPES[\s\S]*?\]\);/g,
  )?.join('\n') || '';
  assert.doesNotMatch(
    referenceTypeBlock,
    /STORES\.(?:resource|derivedCache|analyticsEvent|recommenderEvent)/,
  );
  assert.match(bootstrap, /publishReferencedMobileResources/);
  assert.match(bootstrap, /\['profile', STORES\.player\]/);
  assert.match(bootstrap, /\['shop-catalog', STORES\.shop\]/);
  assert.match(bootstrap, /\['journal', STORES\.journal\]/);
  assert.match(bootstrap, /workspaceId/);
  assert.match(bootstrap, /WORKSPACE_DEFINITION_TYPES\.has\(recordType\) \? null/);
});
