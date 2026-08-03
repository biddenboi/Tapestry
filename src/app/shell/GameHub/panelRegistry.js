import { lazy } from 'react';
import { measureDynamicModule } from '@shared/performance/startupPerf.js';
import { loadMatchArena, loadPracticeDojo } from '@features/matches/loaders.js';
import { loadShop } from '@features/shop/loaders.js';
import { loadContributionPass } from '@features/contribution-pass/loaders.js';
import { loadInventory } from '@features/inventory/loaders.js';
import { loadProfile } from '@features/profile/loaders.js';
import { loadInbox } from '@features/inbox/loaders.js';

const measuredImport = (name, importer) => () => measureDynamicModule(name, importer);
const lazyFeature = (loader) => lazy(() => loader().then((Component) => ({ default: Component })));

export const loadLobby = measuredImport('lobby', () =>
  import('@features/lobby/components/Lobby/Lobby.jsx').then((module) => module.default));
export const loadTodoList = measuredImport('todo-list', () =>
  import('@features/tasks/components/TodoList/TodoList.jsx').then((module) => module.default));
export const loadEvents = measuredImport('events', () =>
  import('@features/events/pages/Events/Events.jsx').then((module) => module.default));
export const loadFeed = measuredImport('feed', () =>
  import('@features/feed/components/Feed/Feed.jsx').then((module) => module.default));
export const loadSocialWorldShell = measuredImport('social-world-shell', () =>
  import('@features/social-world/components/SocialWorldShell/SocialWorldShell.jsx').then((module) => module.default));
export const loadReminderModal = measuredImport('reminder-modal', () =>
  import('@features/reminders/modals/ReminderModal/ReminderModal.jsx').then((module) => module.default));
export const loadSettings = measuredImport('settings', () =>
  import('@features/settings/pages/Settings/Settings.jsx').then((module) => module.default));

export const Lobby = lazyFeature(loadLobby);
export const MatchArena = lazyFeature(loadMatchArena);
export const PracticeDojo = lazyFeature(loadPracticeDojo);
export const TodoList = lazyFeature(loadTodoList);
export const Shop = lazyFeature(loadShop);
export const ContributionPass = lazyFeature(loadContributionPass);
export const Inventory = lazyFeature(loadInventory);
export const Profile = lazyFeature(loadProfile);
export const Events = lazyFeature(loadEvents);
export const Inbox = lazyFeature(loadInbox);
export const Feed = lazyFeature(loadFeed);
export const SocialWorldShell = lazyFeature(loadSocialWorldShell);
export const Settings = lazyFeature(loadSettings);

export const GAME_HUB_DYNAMIC_BOUNDARIES = Object.freeze({
  lobby: '@features/lobby/components/Lobby/Lobby.jsx',
  match: '@features/matches/components/MatchArena/MatchArena.jsx',
  dojo: '@features/matches/components/PracticeDojo/PracticeDojo.jsx',
  tasks: '@features/tasks/components/TodoList/TodoList.jsx',
  shop: '@features/shop/pages/Shop/Shop.jsx',
  inventory: '@features/inventory/pages/Inventory/Inventory.jsx',
  profiles: '@features/profile/pages/Profile/Profile.jsx',
  events: '@features/events/pages/Events/Events.jsx',
  inbox: '@features/inbox/components/Inbox/Inbox.jsx',
  feed: '@features/feed/components/Feed/Feed.jsx',
  map: '@features/social-world/components/SocialWorldShell/SocialWorldShell.jsx',
  settings: '@features/settings/pages/Settings/Settings.jsx',
});
