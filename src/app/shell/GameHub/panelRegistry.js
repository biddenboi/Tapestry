import { lazy } from 'react';
import { measureDynamicModule } from '@shared/performance/startupPerf.js';
import { loadMatchArena } from '@features/matches/loaders.js';
import { loadShop } from '@features/shop/loaders.js';
import { loadContributionPass } from '@features/contribution-pass/loaders.js';
import { loadInventory } from '@features/inventory/loaders.js';
import { loadProfile } from '@features/profile/loaders.js';
import { loadGate } from '@features/gate/loaders.js';
import { loadInbox } from '@features/inbox/loaders.js';

const measuredImport = (name, importer) => () => measureDynamicModule(name, importer);
const lazyFeature = (loader) => lazy(() => loader().then((Component) => ({ default: Component })));

export const loadLobby = measuredImport('lobby', () =>
  import('@features/lobby/components/Lobby/Lobby.jsx').then((module) => module.default));
export const loadTodoList = measuredImport('todo-list', () =>
  import('@features/tasks/components/TodoList/TodoList.jsx').then((module) => module.default));
export const loadFeed = measuredImport('feed', () =>
  import('@features/feed/pages/FeedPage/FeedPage.jsx').then((module) => module.default));
export const loadSocialWorldPlaceholder = measuredImport('social-world-placeholder', () =>
  import('@features/social-world/SocialWorldPlaceholder.jsx').then((module) => module.default));
export const loadReminderModal = measuredImport('reminder-modal', () =>
  import('@features/reminders/modals/ReminderModal/ReminderModal.jsx').then((module) => module.default));
export const loadSettings = measuredImport('settings', () =>
  import('@features/settings/pages/Settings/Settings.jsx').then((module) => module.default));

export const Lobby = lazyFeature(loadLobby);
export const MatchArena = lazyFeature(loadMatchArena);
export const TodoList = lazyFeature(loadTodoList);
export const Shop = lazyFeature(loadShop);
export const ContributionPass = lazyFeature(loadContributionPass);
export const Inventory = lazyFeature(loadInventory);
export const Profile = lazyFeature(loadProfile);
export const Gate = lazyFeature(loadGate);
export const Inbox = lazyFeature(loadInbox);
export const Feed = lazyFeature(loadFeed);
export const SocialWorldPlaceholder = lazyFeature(loadSocialWorldPlaceholder);
export const Settings = lazyFeature(loadSettings);

export const GAME_HUB_DYNAMIC_BOUNDARIES = Object.freeze({
  lobby: '@features/lobby/components/Lobby/Lobby.jsx',
  match: '@features/matches/components/MatchArena/MatchArena.jsx',
  tasks: '@features/tasks/components/TodoList/TodoList.jsx',
  shop: '@features/shop/pages/Shop/Shop.jsx',
  inventory: '@features/inventory/pages/Inventory/Inventory.jsx',
  profiles: '@features/profile/pages/Profile/Profile.jsx',
  gate: '@features/gate/components/Gate/Gate.jsx',
  inbox: '@features/inbox/components/Inbox/Inbox.jsx',
  feed: '@features/feed/pages/FeedPage/FeedPage.jsx',
  map: '@features/social-world/SocialWorldPlaceholder.jsx',
  settings: '@features/settings/pages/Settings/Settings.jsx',
});
