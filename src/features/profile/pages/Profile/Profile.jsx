import '@features/profile/pages/Profile/Profile.css';
import '@features/profile-context/profile-context.css';
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { v4 as uuid } from 'uuid';
import NiceModal from '@ebay/nice-modal-react';
import { useAppContext } from '@app/hooks/useAppContext.js';
import { usePanelLifecycle } from '@app/panel-lifecycle/PanelLifecycleContext.jsx';
import { DOMAIN_INVALIDATION } from '@app/context/domainRevisions.js';
import { measureDynamicModule } from '@shared/performance/startupPerf.js';
import { THEME_REGISTRY, STORES } from '@domain/constants.js';
import { DEFAULT_THEME_ID, resolveThemeId } from '@domain/themes/ThemeRegistry.js';
import { cosmeticPresentationStyle } from '@domain/cosmetics/CosmeticCatalog.js';
import ProfileIdentity from '@shared/profile-identity/ProfileIdentity.jsx';
import { getCurrentIGT, formatInGameTime } from '@domain/time/Time.js';
import { getRank, getRankLabel, getRankProgress, getRankGlow, getRankClass } from '@domain/rank/Rank.js';
import { getRankFramePresentation } from '@domain/rank/RankFrame.js';
import { RankIcon } from '@shared/icons/RankIcon.jsx';
import TodoDetailModal from '@features/tasks/modals/TodoDetailModal/TodoDetailModal.jsx';
import JournalDetailModal from '@features/feed/modals/JournalDetailModal/JournalDetailModal.jsx';
import { loadMatchDetailsModal } from '@features/matches/loaders.js';
import EventDetailModal from '@features/events/modals/EventDetailModal/EventDetailModal.jsx';
import AchievementBadge from '@features/achievements/components/AchievementBadge/AchievementBadge.jsx';
import { getAchievementByKey, computeRarity, getRarityLabel } from '@domain/achievements/Achievements.js';
import {
  ACHIEVEMENT_EVENT_TYPE,
  createAchievementEvent,
  profileSignatureScore,
  queueAchievementEvent,
} from '@domain/achievements/AchievementProcessing.js';
import {
  buildProfileTimelineGroups,
  buildProfileViewModel,
} from '@domain/profile/Profile.js';
import { mergeDaybookPages } from '@domain/profile/ProfileDaybook.js';
import {
  clampProfileBlockColumns,
  clampProfileBlockHeight,
  buildProfileStyleVars,
  coerceProfilePersonalizationForInventory,
  getProfileBlockDefinition,
  getProfileSkin,
  isProfileBlockUnlocked,
  normalizeProfilePersonalization,
} from '@domain/profile/ProfilePersonalization.js';
import {
  buildContributionByGoal,
  getContributionTotal,
} from '@domain/contribution/Contribution.js';
import ContributionIcon from '@shared/icons/ContributionIcon.jsx';
import ConfirmDialog from '@shared/ui/ConfirmDialog.jsx';
import { findOrCreateResource } from '@shared/resources/Resources.js';
import { useResourceUrl } from '@shared/resource-image/ResourceImage.jsx';
import {
  canAccessProfileTab,
  filterProfileOverviewBlocks,
  resolveProfileVisibility,
} from '@domain/social-world/ProfileVisibility.js';
import {
  loadMaterializedProfileData,
  loadProfileAccessData,
  loadProfileInventoryData,
  loadProfileDaybookPage,
  loadProfilePresence,
  loadProfileMatchData,
  loadProfileSocialData,
  loadProfileTimelineData,
} from '@features/profile/pages/Profile/ProfileDataController.js';
import {
  ProfileBannerEditor,
  ProfileBlockComposer,
  ProfilePlayerSearch,
  ProfileSkinView,
  ProfileTabs,
  ProfileThemeCustomizer,
  PlayerRow,
  TimelineControls,
  DaybookChapterList,
  ProfilePresenceSummary,
  TimelineModeTabs,
  MilestoneList,
  ReplayPanel,
  MatchSummaryBand,
  MatchList,
  buildProfileBackgroundStyle,
  scorePlayerSearch,
} from '@features/profile/pages/Profile/ProfileView.jsx';
import LifeContextBlock from '@features/profile-context/components/LifeContextBlock.jsx';
import { useProfileContextController } from '@features/profile-context/hooks/useProfileContextController.js';
import { useLocalSectionRoute } from '@shared/navigation/LocalSectionNav/LocalSectionRouteState.js';
import { PROFILE_LOCAL_PAGES } from '@features/profile/pages/subpages/ProfilePages.js';

const Settings = lazy(() => measureDynamicModule('settings', () => import('@features/settings/pages/Settings/Settings.jsx')).then((module) => ({ default: module.default || module.Settings })));
const AchievementsModal = lazy(() => measureDynamicModule('achievements-modal', () =>
  import('@features/achievements/modals/AchievementsModal/AchievementsModal.jsx'))
  .then((module) => ({ default: module.default })));
const loadRankProgressModal = () => measureDynamicModule('rank-progress-modal', () =>
  import('@features/achievements/modals/RankProgressModal/RankProgressModal.jsx')).then((module) => module.default);

export default function Profile({ uuid: targetUUID }) {
  const {
    databaseConnection,
    timestamp,
    currentPlayer,
    ensureDomainLoaded,
    domainRevisions,
    invalidateDomains,
    notify,
    openPanel,
    routeIntent,
    consumeRouteIntent,
    reportLocalSubpage,
    commitCurrentProfile,
  } = useAppContext();
  const { canLoad, isActive } = usePanelLifecycle();
  const [player, setPlayer]       = useState(null);
  const [friends, setFriends]     = useState([]);
  const [history, setHistory]     = useState([]);
  const [playerSearch, setPlayerSearch] = useState('');
  const [players, setPlayers]     = useState([]);
  const [matches, setMatches]     = useState([]);
  const [friendship, setFriendship] = useState(null);
  const [friendRequestBusy, setFriendRequestBusy] = useState(false);
  const [friendRequestSent, setFriendRequestSent] = useState(false);
  const [profileAccess, setProfileAccess] = useState(null);
  const [confirmEndFriendship, setConfirmEndFriendship] = useState(false);
  const [ownedPassIds, setOwnedPassIds] = useState(new Set());
  const [showBannerEditor, setShowBannerEditor] = useState(false);
  const [showAchievements, setShowAchievements] = useState(false);
  const [allPlayersForRarity, setAllPlayersForRarity] = useState([]);
  const [contributions, setContributions] = useState([]);
  const [goals, setGoals] = useState([]);
  const [profileSummary, setProfileSummary] = useState(null);
  const [profileRating, setProfileRating] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [profileLoadError, setProfileLoadError] = useState(false);
  const [profileUnavailable, setProfileUnavailable] = useState(false);
  const [timelineLoaded, setTimelineLoaded] = useState(false);
  const [daybookPage, setDaybookPage] = useState(null);
  const [daybookLoading, setDaybookLoading] = useState(false);
  const [presence, setPresence] = useState(null);
  const [matchesLoaded, setMatchesLoaded] = useState(false);
  const [socialLoaded, setSocialLoaded] = useState(false);
  const [inventoryLoaded, setInventoryLoaded] = useState(false);
  const [profileNarrative, setProfileNarrative] = useState({
    milestones: [],
    arc: { type: 'unavailable', title: 'Recorded milestones', description: 'Open Milestones to evaluate recorded activity.' },
  });
  const {
    activePageId: activeTab,
    selectPage: setActiveTab,
  } = useLocalSectionRoute({
    sectionId: 'profile',
    pages: PROFILE_LOCAL_PAGES,
    profileUUID: currentPlayer?.UUID,
    databaseConnection,
    routeIntent: routeIntent?.panel === 'profile' ? routeIntent : null,
    defaultPageId: 'overview',
    onIntentConsumed: consumeRouteIntent,
    onPageChange: reportLocalSubpage,
  });
  const [timelineType, setTimelineType] = useState('all');
  const [timelineSearch, setTimelineSearch] = useState('');
  const [timelineSort, setTimelineSort] = useState('newest');
  const [timelinePinnedOnly, setTimelinePinnedOnly] = useState(false);
  const [timelineMode, setTimelineMode] = useState('activity');
  const [replayIGT, setReplayIGT] = useState(0);
  const [replayMaxIGT, setReplayMaxIGT] = useState(1);
  const [replaySnapshot, setReplaySnapshot] = useState(null);
  const [replayLoading, setReplayLoading] = useState(false);
  const [showReplayLoading, setShowReplayLoading] = useState(false);
  const [draftPersonalization, setDraftPersonalization] = useState(null);
  const [profileBlockEditorOpen, setProfileBlockEditorOpen] = useState(false);
  const [profileBlockAddMenuOpen, setProfileBlockAddMenuOpen] = useState(false);
  const [profilePersonalizationSaving, setProfilePersonalizationSaving] = useState(false);
  const [draggedBlockId, setDraggedBlockId] = useState(null);
  const [resizingBlockId, setResizingBlockId] = useState(null);
  const resizeCleanupRef = useRef(null);
  const daybookRequestRef = useRef(0);
  const summaryRequestRef = useRef(0);
  const lastDaybookQueryRef = useRef('');
  const viewerIGT = getCurrentIGT(currentPlayer, timestamp);
  const viewerIGTBucket = Math.floor(viewerIGT / 60000);

  const resolvedProfileUUID = targetUUID || currentPlayer?.UUID || null;
  const access = useMemo(() => (
    profileAccess?.viewerId === String(currentPlayer?.UUID || '')
      && profileAccess?.profileId === String(resolvedProfileUUID || '')
      ? profileAccess
      : resolveProfileVisibility({
          viewerId: currentPlayer?.UUID,
          profileId: resolvedProfileUUID,
        })
  ), [currentPlayer?.UUID, profileAccess, resolvedProfileUUID]);
  const profileContext = useProfileContextController({
    databaseConnection,
    ensureDomainLoaded,
    invalidateDomains,
    ownerId: resolvedProfileUUID,
    viewerId: currentPlayer?.UUID,
    relationshipTier: access.tier,
    viewerIGT,
    revision: domainRevisions.profileContext,
    enabled: canLoad,
  });
  const daybookQuery = useMemo(() => ({
    type: timelineType,
    search: timelineSearch,
    pinnedOnly: timelinePinnedOnly,
    sort: timelineSort,
  }), [timelinePinnedOnly, timelineSearch, timelineSort, timelineType]);
  const daybookSourceRevision = [
    domainRevisions.tasks,
    domainRevisions.journals,
    domainRevisions.matches,
    domainRevisions.dailyLifecycle,
    domainRevisions.shop,
    domainRevisions.competitiveArenas,
    domainRevisions.profileSummaries,
    domainRevisions.presence,
    domainRevisions.socialWorld,
  ].join(':');
  const daybookQueryKey = JSON.stringify([
    resolvedProfileUUID,
    viewerIGTBucket,
    daybookQuery,
    daybookSourceRevision,
  ]);

  const loadMaterializedSummary = useCallback(() => (
    loadMaterializedProfileData({
      databaseConnection,
      ensureDomainLoaded,
      currentPlayer,
      profileUUID: resolvedProfileUUID,
      viewerIGT,
    })
  ), [currentPlayer, databaseConnection, ensureDomainLoaded, resolvedProfileUUID, viewerIGTBucket]);

  const applyMaterializedSummary = useCallback((data) => {
    if (!data) return;
    setProfileSummary(data.summary);
    setProfileRating(data.ratingProjection);
    setPlayer(data.player);
    setPlayers(data.players);
    setAllPlayersForRarity(data.players);
    setHistory(data.history);
    setMatches(data.matches);
    setFriends(data.friends);
    setFriendship(data.friendship);
    // Local visibility is owned exclusively by the canonical Social World access
    // query below. Materialized summaries refresh on IGT/profile revisions and
    // must never overwrite an already-resolved fellow/friend tier with their
    // incomplete fallback access projection.
    setOwnedPassIds(data.ownedPassIds);
    setContributions([]);
    setGoals([]);
  }, []);

  useEffect(() => {
    if (!canLoad) return undefined;
    let cancelled = false;
    const requestId = summaryRequestRef.current + 1;
    summaryRequestRef.current = requestId;
    setSummaryLoading(true);
    setProfileLoadError(false);
    setProfileUnavailable(false);
    loadMaterializedSummary()
      .then((data) => {
        if (cancelled || summaryRequestRef.current !== requestId) return;
        if (!data) {
          setProfileUnavailable(true);
          return;
        }
        applyMaterializedSummary(data);
      })
      .catch((error) => {
        if (!cancelled && summaryRequestRef.current === requestId) {
          setProfileLoadError(true);
          console.warn('[Profile] summary load failed:', error);
        }
      })
      .finally(() => {
        if (!cancelled && summaryRequestRef.current === requestId) setSummaryLoading(false);
      });
    return () => { cancelled = true; };
  }, [
    applyMaterializedSummary,
    canLoad,
    domainRevisions.profileSummaries,
    domainRevisions.social,
    domainRevisions.socialWorld,
    loadMaterializedSummary,
  ]);

  useEffect(() => {
    if (!canLoad || !currentPlayer?.UUID || !resolvedProfileUUID) return undefined;
    let cancelled = false;
    loadProfileAccessData({
      databaseConnection,
      ensureDomainLoaded,
      currentPlayer,
      profileUUID: resolvedProfileUUID,
    }).then((nextAccess) => {
      if (!cancelled && nextAccess) setProfileAccess(nextAccess);
    }).catch((error) => console.warn('[Profile] access policy load failed:', error));
    return () => { cancelled = true; };
  }, [
    canLoad,
    currentPlayer,
    databaseConnection,
    domainRevisions.social,
    domainRevisions.socialWorld,
    ensureDomainLoaded,
    resolvedProfileUUID,
  ]);

  const loadTimelineProfile = useCallback(async () => {
    if (!resolvedProfileUUID || timelineLoaded) return;
    const requestId = daybookRequestRef.current + 1;
    daybookRequestRef.current = requestId;
    setDaybookLoading(true);
    try {
      const data = await loadProfileTimelineData({
        databaseConnection,
        ensureDomainLoaded,
        currentPlayer,
        profileUUID: resolvedProfileUUID,
        viewerIGT,
        daybookQuery,
      });
      if (daybookRequestRef.current !== requestId) return;
      if (data.player) setPlayer(data.player);
      setHistory(data.history);
      setContributions(data.contributions);
      setGoals(data.goals);
      setDaybookPage(data.daybook);
      setPresence(data.presence);
      lastDaybookQueryRef.current = daybookQueryKey;
      setTimelineLoaded(true);
    } finally {
      if (daybookRequestRef.current === requestId) setDaybookLoading(false);
    }
  }, [currentPlayer, databaseConnection, daybookQuery, daybookQueryKey, ensureDomainLoaded, resolvedProfileUUID, timelineLoaded, viewerIGT]);

  const loadProfileMatches = useCallback(async () => {
    if (!resolvedProfileUUID || matchesLoaded) return;
    const matchList = await loadProfileMatchData({
      databaseConnection,
      ensureDomainLoaded,
      currentPlayer,
      profileUUID: resolvedProfileUUID,
    });
    setMatches(matchList);
    setMatchesLoaded(true);
  }, [currentPlayer, databaseConnection, ensureDomainLoaded, matchesLoaded, resolvedProfileUUID]);

  const loadSocialProfile = useCallback(async () => {
    if (!resolvedProfileUUID) return null;
    if (socialLoaded) return friendship;
    const data = await loadProfileSocialData({
      databaseConnection,
      ensureDomainLoaded,
      currentPlayer,
      profileUUID: resolvedProfileUUID,
      players,
    });
    setFriends(data.friends);
    setFriendship(data.friendship);
    setSocialLoaded(true);
    return data.friendship;
  }, [currentPlayer, databaseConnection, ensureDomainLoaded, friendship, players, resolvedProfileUUID, socialLoaded]);

  const loadProfileInventory = useCallback(async () => {
    if (!currentPlayer?.UUID || inventoryLoaded) return;
    const passIds = await loadProfileInventoryData({
      databaseConnection,
      ensureDomainLoaded,
      currentPlayer,
    });
    setOwnedPassIds(passIds);
    setInventoryLoaded(true);
  }, [currentPlayer, databaseConnection, ensureDomainLoaded, inventoryLoaded]);

  useEffect(() => {
    daybookRequestRef.current += 1;
    lastDaybookQueryRef.current = '';
    setTimelineLoaded(false);
    setDaybookPage(null);
    setPresence(null);
    setDaybookLoading(false);
    setMatchesLoaded(false);
    setSocialLoaded(false);
    setInventoryLoaded(false);
    setFriendship(null);
    setFriendRequestBusy(false);
    setProfileAccess(null);
    setProfileRating(null);
    setProfileUnavailable(false);
    setActiveTab('overview');
  }, [resolvedProfileUUID]);

  useEffect(() => {
    if (!isActive || activeTab !== 'history' || !timelineLoaded || access.daybookScope !== 'full') return undefined;
    if (lastDaybookQueryRef.current === daybookQueryKey) return undefined;
    const timer = window.setTimeout(() => {
      const requestId = daybookRequestRef.current + 1;
      daybookRequestRef.current = requestId;
      setDaybookLoading(true);
      Promise.all([
        loadProfileDaybookPage({
          databaseConnection,
          ensureDomainLoaded,
          currentPlayer,
          profileUUID: resolvedProfileUUID,
          viewerIGT,
          query: daybookQuery,
        }),
        loadProfilePresence({
          databaseConnection,
          ensureDomainLoaded,
          currentPlayer,
          profileUUID: resolvedProfileUUID,
          viewerIGT,
        }),
      ]).then(([page, nextPresence]) => {
        if (daybookRequestRef.current !== requestId) return;
        setDaybookPage(page);
        setPresence(nextPresence);
        lastDaybookQueryRef.current = daybookQueryKey;
      }).catch((error) => {
        if (daybookRequestRef.current === requestId) {
          console.warn('[Profile] Daybook query failed:', error);
        }
      }).finally(() => {
        if (daybookRequestRef.current === requestId) setDaybookLoading(false);
      });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [access.daybookScope, activeTab, currentPlayer, databaseConnection, daybookQuery, daybookQueryKey, ensureDomainLoaded, isActive, resolvedProfileUUID, timelineLoaded, viewerIGT]);

  useEffect(() => {
    if (!isActive) return;
    if (activeTab === 'history' && access.daybookScope !== 'none') {
      loadTimelineProfile().catch((error) => console.warn('[Profile] timeline load failed:', error));
    }
    if (activeTab === 'competition' && access.matchScope === 'full') {
      loadProfileMatches().catch((error) => console.warn('[Profile] match load failed:', error));
    }
    if (activeTab === 'context' && access.socialScope === 'full') {
      loadSocialProfile().catch((error) => console.warn('[Profile] social load failed:', error));
    }
    if (access.settingsScope === 'full' && (activeTab === 'identity' || profileBlockEditorOpen || showBannerEditor)) {
      loadProfileInventory().catch((error) => console.warn('[Profile] inventory load failed:', error));
    }
  }, [
    access.daybookScope,
    access.matchScope,
    access.settingsScope,
    access.socialScope,
    activeTab,
    currentPlayer?.UUID,
    isActive,
    loadProfileMatches,
    loadTimelineProfile,
    loadProfileInventory,
    loadSocialProfile,
    player?.UUID,
    profileBlockEditorOpen,
    showBannerEditor,
  ]);

  const searchResults = useMemo(() => {
    const query = playerSearch.trim();
    if (!query) return [];
    return players
      .filter((entry) => entry.UUID !== player?.UUID)
      .map((entry) => ({ entry, score: scorePlayerSearch(entry, query) }))
      .filter(({ score }) => score >= 0)
      .sort((left, right) => right.score - left.score
        || Number(right.entry.elo || 0) - Number(left.entry.elo || 0)
        || String(left.entry.username || '').localeCompare(String(right.entry.username || '')))
      .slice(0, 5)
      .map(({ entry }) => entry);
  }, [players, player, playerSearch]);

  const isSelf        = player?.UUID === currentPlayer?.UUID;
  const accepted      = friendship?.status === 'accepted';
  const isPending     = friendship?.status === 'pending';
  const friendshipRequesterId = friendship?.requestedBy
    || friendship?.requesterId
    || friendship?.requesterUUID
    || null;
  const iRequested    = (isPending && friendshipRequesterId === currentPlayer?.UUID)
    || friendRequestSent;
  const theyRequested = isPending && friendshipRequesterId === player?.UUID && !friendRequestSent;
  const hasBannerPass = ownedPassIds.has('cosmetic_profile_banner') || ownedPassIds.has('profile_banner');
  const personalization = useMemo(
    () => normalizeProfilePersonalization(player?.profilePersonalization),
    [player?.profilePersonalization],
  );
  const editablePersonalization = useMemo(
    () => coerceProfilePersonalizationForInventory(personalization, ownedPassIds),
    [personalization, ownedPassIds],
  );
  const customizationPersonalization = draftPersonalization || editablePersonalization;
  const displayPersonalization = draftPersonalization || (isSelf ? editablePersonalization : personalization);
  const visiblePersonalization = useMemo(
    () => filterProfileOverviewBlocks(displayPersonalization, access),
    [access, displayPersonalization],
  );
  const hasPersonalizationChanges = useMemo(
    () => !!draftPersonalization && JSON.stringify(customizationPersonalization) !== JSON.stringify(editablePersonalization),
    [draftPersonalization, customizationPersonalization, editablePersonalization],
  );
  const profileStyleVars = useMemo(
    () => buildProfileStyleVars(visiblePersonalization),
    [visiblePersonalization],
  );
  const projectedViewedPlayer = useMemo(
    () => players.find((entry) => entry.UUID === player?.UUID) || player,
    [players, player],
  );
  const computedProfileView = useMemo(() => buildProfileViewModel({
    player: projectedViewedPlayer,
    history,
    matches,
    allPlayers: allPlayersForRarity,
    currentPlayerUUID: currentPlayer?.UUID,
    viewerIGT,
  }), [projectedViewedPlayer, history, matches, allPlayersForRarity, currentPlayer?.UUID, viewerIGTBucket]);
  const profileView = useMemo(() => {
    const base = profileSummary?.profileView || computedProfileView;
    if (!base) return base;
    const hasVisibleRating = profileRating?.hasVisibleRating ?? base.hasVisibleRating ?? false;
    const displayElo = hasVisibleRating
      ? Number(profileRating?.elo ?? base.displayElo ?? 0)
      : null;
    return {
      ...base,
      hasVisibleRating,
      displayElo,
      eloSeries: profileRating?.eloHistory || base.eloSeries || [],
      eloNote: hasVisibleRating ? '' : 'Complete a rated competition to establish your Elo.',
      summaryStats: (base.summaryStats || []).map((stat) => (
        stat.id === 'elo'
          ? { ...stat, label: 'Current Elo', value: hasVisibleRating ? displayElo.toLocaleString() : 'Unrated' }
          : stat
      )),
    };
  }, [computedProfileView, profileRating, profileSummary?.profileView]);
  const daybookChapters = daybookPage?.chapters || [];
  const recentTimelineEntries = useMemo(() => (
    profileSummary?.recentTimelineEntries
    || buildProfileTimelineGroups(profileView?.timelineEntries || [], { type: 'all', sort: 'newest' })
      .flatMap((group) => group.entries)
      .slice(0, 5)
  ), [profileSummary?.recentTimelineEntries, profileView?.timelineEntries]);
  const totalContribution = timelineLoaded
    ? getContributionTotal(contributions, player?.UUID)
    : Number(profileSummary?.contributionTotal || 0);
  const contributionDistribution = timelineLoaded
    ? buildContributionByGoal(contributions, goals, player?.UUID)
    : (profileSummary?.contributionDistribution || []);
  const profileMilestones = profileNarrative.milestones;
  const profileArc = profileNarrative.arc;
  const profileBanner = player?.activeCosmetics?.profileBanner;
  const profileBannerUrl = useResourceUrl(
    profileBanner?.type === 'image' ? profileBanner.value : null,
    databaseConnection,
  );

  useEffect(() => {
    if (!canAccessProfileTab(access, activeTab)) setActiveTab('overview');
  }, [access, activeTab]);

  useEffect(() => {
    if (activeTab !== 'overview') setProfileBlockAddMenuOpen(false);
  }, [activeTab]);

  useEffect(() => {
    const initialReplayIGT = Math.max(1, viewerIGT);
    setFriendRequestSent(false);
    setDraftPersonalization(null);
    setProfileBlockEditorOpen(false);
    setProfileBlockAddMenuOpen(false);
    setDraggedBlockId(null);
    setResizingBlockId(null);
    setTimelineMode('activity');
    setReplayIGT(initialReplayIGT);
    setReplayMaxIGT(initialReplayIGT);
    setReplaySnapshot(null);
  }, [player?.UUID]);

  useEffect(() => {
    if (!isActive || access.daybookScope !== 'full' || activeTab !== 'history' || timelineMode !== 'milestones' || !timelineLoaded || !projectedViewedPlayer) return undefined;
    let cancelled = false;
    import('@domain/profile/ProfileNarrativeLabels.js')
      .then(({ buildOptionalProfileNarrative }) => buildOptionalProfileNarrative({
        player: projectedViewedPlayer,
        profileView,
        history,
        matches,
        allPlayers: allPlayersForRarity,
        contributions,
        viewerIGT,
      }))
      .then((next) => { if (!cancelled) setProfileNarrative(next); })
      .catch((error) => console.warn('[Profile] optional narrative load failed:', error));
    return () => { cancelled = true; };
  }, [access.daybookScope, activeTab, allPlayersForRarity, contributions, history, isActive, matches, profileView, projectedViewedPlayer, timelineMode, timelineLoaded, viewerIGTBucket]);

  useEffect(() => {
    if (!isActive || !replayLoading) {
      setShowReplayLoading(false);
      return undefined;
    }
    const timer = window.setTimeout(() => setShowReplayLoading(true), 220);
    return () => window.clearTimeout(timer);
  }, [isActive, replayLoading]);

  useEffect(() => {
    if (!isActive || access.daybookScope !== 'full' || activeTab !== 'history' || timelineMode !== 'replay' || !player?.UUID) return undefined;
    let active = true;
    setReplayLoading(true);
    Promise.all([loadTimelineProfile(), loadProfileMatches()])
      .then(() => import('@domain/profile/ProfileBiography.js'))
      .then(({ buildProfileSnapshotAtIGT }) => buildProfileSnapshotAtIGT(databaseConnection, player.UUID, replayIGT))
      .then((snapshot) => {
        if (active) setReplaySnapshot(snapshot);
      })
      .catch((err) => console.warn('[Profile] replay snapshot failed:', err))
      .finally(() => {
        if (active) setReplayLoading(false);
      });
    return () => {
      active = false;
      setReplayLoading(false);
    };
  }, [access.daybookScope, activeTab, timelineMode, replayIGT, player?.UUID, databaseConnection, isActive, loadProfileMatches, loadTimelineProfile]);

  useEffect(() => {
    if (isActive) return;
    resizeCleanupRef.current?.();
    resizeCleanupRef.current = null;
  }, [isActive]);

  useEffect(() => () => {
    resizeCleanupRef.current?.();
    resizeCleanupRef.current = null;
  }, []);

  // Send a friend request (pending)
  const handleAddFriend = async () => {
    if (!player || !currentPlayer || isSelf || accepted || isPending || friendRequestBusy) return;
    setFriendRequestBusy(true);
    try {
      const existingRelationship = await loadSocialProfile();
      if (existingRelationship?.status === 'accepted' || existingRelationship?.status === 'pending') {
        setFriendship(existingRelationship);
        setFriendRequestSent(
          existingRelationship.status === 'pending'
          && (existingRelationship.requestedBy
            || existingRelationship.requesterId
            || existingRelationship.requesterUUID) === currentPlayer.UUID,
        );
        return;
      }
      const now = new Date().toISOString();
      const senderIGT = getCurrentIGT(currentPlayer);
      const friendshipId = uuid();
      const result = await databaseConnection.requestSocialFriendship({
        friendshipId,
        requesterId: currentPlayer.UUID,
        recipientId: player.UUID,
        notificationId: uuid(),
        operationId: uuid(),
        createdAt: now,
        inGameTimestamp: senderIGT,
        title: 'Friend Request',
        message: `${currentPlayer.username} wants to be your friend.`,
      });
      const pendingFriendship = {
        UUID: friendshipId,
        players: [currentPlayer.UUID, player.UUID],
        status: 'pending',
        createdAt: now,
        inGameTimestamp: senderIGT,
        ...(result?.friendship || {}),
        requestedBy: result?.friendship?.requestedBy
          || result?.friendship?.requesterId
          || result?.friendship?.requesterUUID
          || currentPlayer.UUID,
      };
      setFriendship(pendingFriendship);
      setFriendRequestSent(true);
      invalidateDomains(DOMAIN_INVALIDATION.socialWrite);
      notify({
        title: 'Request sent',
        message: `Friend request sent to ${player.username}.`,
        kind: 'info',
        persist: false,
      });
    } catch (error) {
      if (error?.code === 'friendship-exists') {
        notify({
          title: 'Request already exists',
          message: `A friendship or pending request with ${player.username} already exists.`,
          kind: 'info',
          persist: false,
        });
        return;
      }
      console.warn('[Profile] friend request failed:', error);
      notify({
        title: 'Request failed',
        message: `The friend request to ${player.username} could not be sent.`,
        kind: 'error',
        persist: false,
      });
    } finally {
      setFriendRequestBusy(false);
    }
  };

  // Accept an incoming request
  const handleAccept = async () => {
    if (!friendship || !currentPlayer || !player) return;
    const now = new Date().toISOString();
    const accepterIGT = getCurrentIGT(currentPlayer);
    try {
      const result = await databaseConnection.acceptSocialFriendship({
        friendshipId: friendship.UUID,
        accepterId: currentPlayer.UUID,
        notificationId: uuid(),
        operationId: uuid(),
        acceptedAt: now,
        inGameTimestamp: accepterIGT,
        title: 'Friend Request Accepted',
        message: `${currentPlayer.username} accepted your friend request. (${formatInGameTime(accepterIGT)})`,
      });
      setFriendship(result.friendship);
      invalidateDomains(DOMAIN_INVALIDATION.socialWrite);
      notify({ title: 'Friends!', message: `${player.username} now has a persistent friend place in your world.`, kind: 'success', persist: false });
    } catch (error) {
      if (error?.code === 'friend-cap-reached') {
        notify({
          title: 'Three friend places are full',
          message: 'End an existing friendship explicitly before accepting another.',
          kind: 'warning',
          persist: false,
        });
        return;
      }
      throw error;
    }
  };

  // Decline an incoming request
  const handleDecline = async () => {
    if (!friendship || !currentPlayer) return;
    await databaseConnection.closeSocialFriendship({
      friendshipId: friendship.UUID,
      actorId: currentPlayer.UUID,
      operationId: uuid(),
      closedAt: new Date().toISOString(),
    });
    setFriendship(null);
    setFriendRequestSent(false);
    invalidateDomains(DOMAIN_INVALIDATION.socialWrite);
    notify({ title: 'Request declined', message: `You declined ${player.username}'s friend request.`, kind: 'info', persist: false });
  };

  const handleEndFriendship = async () => {
    if (!friendship || !currentPlayer || !accepted) return;
    await databaseConnection.closeSocialFriendship({
      friendshipId: friendship.UUID,
      actorId: currentPlayer.UUID,
      operationId: uuid(),
      closedAt: new Date().toISOString(),
    });
    setConfirmEndFriendship(false);
    setFriendship(null);
    setFriendRequestSent(false);
    invalidateDomains(DOMAIN_INVALIDATION.socialWrite);
    notify({
      title: 'Friend place opened',
      message: `${player.username} is no longer a friend. Their encounter history remains recorded.`,
      kind: 'info',
      persist: false,
    });
  };

  const openHistoryItem = (item) => {
    if (item.type === 'journal') { NiceModal.show(JournalDetailModal, { item }); return; }
    if (item.type === 'task')    { NiceModal.show(TodoDetailModal, { item }); return; }
    if (item.type === 'match')   { openMatchDetails(item); return; }
    /* item_use and wake/end_work/sleep events all use the generic event modal */
    NiceModal.show(EventDetailModal, { item });
  };

  const openMatchDetails = (match) => {
    loadMatchDetailsModal()
      .then((MatchDetailsModal) => NiceModal.show(MatchDetailsModal, {
        match,
        currentPlayerUUID: player?.UUID,
        onOpenProfile: (id) => openPanel('profile', id),
      }))
      .catch((error) => console.warn('[Profile] match details load failed:', error));
  };

  const openHighlight = (card) => {
    if (card.action === 'match' && card.item) { openMatchDetails(card.item); return; }
    if (card.action === 'journal' && card.item) { NiceModal.show(JournalDetailModal, { item: card.item }); return; }
    if (card.action === 'task' && card.item) { NiceModal.show(TodoDetailModal, { item: card.item }); return; }
    if (card.action === 'achievements') setShowAchievements(true);
  };

  // Pin / unpin one of the viewer's own journal entries on their own profile
  const handleTogglePin = async (item) => {
    if (!item || item.type !== 'journal') return;
    const ownsEntry = item.parent && currentPlayer?.UUID && item.parent === currentPlayer.UUID;
    const onOwnProfile = player?.UUID === currentPlayer?.UUID;
    if (!ownsEntry || !onOwnProfile) return;
    const updated = { ...item, pinned: !item.pinned };
    /* Strip timeline-only synthesised fields before persisting back to STORES.journal */
    delete updated.type;
    delete updated.sortAt;
    await databaseConnection.add(STORES.journal, updated);
    invalidateDomains(DOMAIN_INVALIDATION.journalWrite);
  };

  const loadMoreDaybook = async () => {
    if (access.daybookScope !== 'full' || !daybookPage?.hasMore || daybookLoading || !resolvedProfileUUID) return;
    const requestId = daybookRequestRef.current + 1;
    daybookRequestRef.current = requestId;
    setDaybookLoading(true);
    try {
      const page = await loadProfileDaybookPage({
        databaseConnection,
        ensureDomainLoaded,
        currentPlayer,
        profileUUID: resolvedProfileUUID,
        viewerIGT,
        query: {
          ...daybookQuery,
          beforeDay: timelineSort === 'oldest' ? null : daybookPage.nextBeforeDay,
          afterDay: timelineSort === 'oldest' ? daybookPage.nextAfterDay : null,
        },
      });
      if (daybookRequestRef.current !== requestId) return;
      setDaybookPage((current) => mergeDaybookPages(current, page));
      lastDaybookQueryRef.current = daybookQueryKey;
    } catch (error) {
      if (daybookRequestRef.current === requestId) {
        console.warn('[Profile] earlier Daybook page failed:', error);
      }
    } finally {
      if (daybookRequestRef.current === requestId) setDaybookLoading(false);
    }
  };

  if (summaryLoading) return <div className="profile-page"><div className="profile-empty">Loading profile summary…</div></div>;
  if (profileUnavailable) return <div className="profile-page"><div className="profile-empty">Public profile unavailable.</div></div>;
  if (profileLoadError) return <div className="profile-page"><div className="profile-empty">Profile unavailable.</div></div>;
  if (!player) return <div className="profile-page"><div className="profile-empty">Profile not found.</div></div>;

  const elo       = player.elo || 0;
  const hasVisibleRating = profileView?.hasVisibleRating === true;
  const visibleElo = hasVisibleRating
    ? Number(profileView.displayElo ?? profileRating?.elo ?? projectedViewedPlayer?.elo ?? elo)
    : Number(player.igtBaseElo ?? elo);
  const rank      = getRank(visibleElo);
  const rankLabel = hasVisibleRating ? getRankLabel(visibleElo) : 'Unrated';
  const rankProg  = getRankProgress(visibleElo);
  const rankClass = hasVisibleRating ? getRankClass(visibleElo) : 'unrated';
  const rankGlow  = hasVisibleRating ? getRankGlow(visibleElo, 20) : 'none';
  const rankFrame = hasVisibleRating ? getRankFramePresentation({ elo: visibleElo }) : { id: 'unrated', notches: 0 };
  const skin       = getProfileSkin(player?.activeCosmetics?.profileLayout || displayPersonalization.skin);
  const openRankProgress = () => {
    if (!hasVisibleRating) return;
    loadRankProgressModal()
      .then((RankProgressModal) => NiceModal.show(RankProgressModal, { elo: visibleElo }))
      .catch((error) => console.warn('[Profile] rank progress load failed:', error));
  };
  const displayedProfileIdentity = {
    ...(isSelf ? currentPlayer : player),
    elo: visibleElo,
    hasVisibleRating,
    rankLabel,
  };
  const handleRankKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openRankProgress();
    }
  };

  const profileTheme = resolveThemeId(player?.activeCosmetics?.profileTheme || player?.activeCosmetics?.appTheme || player?.activeCosmetics?.theme || DEFAULT_THEME_ID);
  const profileUsesLightTheme = THEME_REGISTRY.find((theme) => theme.id === profileTheme)?.dark === false;
  const resolvedProfileBanner = profileBanner?.type === 'image'
    ? { ...profileBanner, value: profileBannerUrl }
    : profileBanner;
  const profileBackdropId = player?.activeCosmetics?.profileBackdrop || 'default';
  const profilePageStyle = {
    ...profileStyleVars,
    ...cosmeticPresentationStyle('profileBackdrop', profileBackdropId),
    ...buildProfileBackgroundStyle(resolvedProfileBanner),
  };

  const queueProfileAchievementUpdate = async (updated, sourceUUID) => {
    await ensureDomainLoaded?.('achievements');
    await queueAchievementEvent(databaseConnection, createAchievementEvent({
      type: ACHIEVEMENT_EVENT_TYPE.profileUpdated,
      parent: updated.UUID,
      sourceUUID,
      payload: {
        signatureScore: profileSignatureScore(updated),
        elo: Number(updated.elo || 0),
      },
    }), {
      onEarned: (keys) => keys.forEach((key) => {
        const achievement = getAchievementByKey(key);
        if (achievement) notify({ title: 'Achievement Unlocked', message: achievement.label, kind: 'success', persist: false });
      }),
    });
  };

  const saveBanner = async (val) => {
    if (!player || !isSelf) return;
    const updated = { ...player, activeCosmetics: { ...(player.activeCosmetics || {}), profileBanner: val } };
    await commitCurrentProfile(updated);
    await queueProfileAchievementUpdate(updated, `profile-banner:${updated.UUID}:${Date.now()}`);
    setPlayer(updated);
    invalidateDomains(DOMAIN_INVALIDATION.profileWrite);
    setShowBannerEditor(false);
  };

  const savePersonalization = async (nextPrefs) => {
    if (!player || !isSelf || profilePersonalizationSaving) return;
    setProfilePersonalizationSaving(true);
    try {
      const legalPrefs = coerceProfilePersonalizationForInventory(nextPrefs, ownedPassIds);
      const updated = {
        ...player,
        profilePersonalization: legalPrefs,
      };
      await commitCurrentProfile(updated);
      await queueProfileAchievementUpdate(updated, `profile-personalization:${updated.UUID}:${Date.now()}`);
      setPlayer(updated);
      setDraftPersonalization(null);
      setProfileBlockEditorOpen(false);
      setProfileBlockAddMenuOpen(false);
      invalidateDomains(DOMAIN_INVALIDATION.profileWrite);
      notify({ title: 'Profile saved', message: 'Personalization updated.', kind: 'success', persist: false });
    } finally {
      setProfilePersonalizationSaving(false);
    }
  };

  const handlePersonalizationDraftChange = (nextPrefs) => {
    setDraftPersonalization(coerceProfilePersonalizationForInventory(nextPrefs, ownedPassIds));
  };

  const updateProfileBlocks = (updater) => {
    const currentBlocks = customizationPersonalization.blocks || [];
    const nextBlocks = typeof updater === 'function' ? updater(currentBlocks) : updater;
    handlePersonalizationDraftChange({
      ...customizationPersonalization,
      blocks: nextBlocks,
    });
  };

  const handleAddProfileBlock = (type) => {
    const definition = getProfileBlockDefinition(type);
    if (!definition || !isProfileBlockUnlocked(type, ownedPassIds)) return;
    if (type !== 'text' && customizationPersonalization.blocks.some((block) => block.type === type)) return;
    const block = {
      id: uuid(),
      type,
      columns: definition.defaultColumns,
      height: definition.defaultHeight,
      ...(type === 'text' ? { title: 'Text Block', content: '' } : {}),
    };
    updateProfileBlocks((blocks) => [...blocks, block]);
    setProfileBlockEditorOpen(true);
    setProfileBlockAddMenuOpen(false);
  };

  const handleMoveProfileBlock = (blockId, direction) => {
    updateProfileBlocks((blocks) => {
      const fromIndex = blocks.findIndex((block) => block.id === blockId);
      const toIndex = fromIndex + direction;
      if (fromIndex < 0 || toIndex < 0 || toIndex >= blocks.length) return blocks;
      const next = [...blocks];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  };

  const handleDropProfileBlock = (targetId) => {
    if (!draggedBlockId || draggedBlockId === targetId) return;
    updateProfileBlocks((blocks) => {
      const fromIndex = blocks.findIndex((block) => block.id === draggedBlockId);
      const toIndex = blocks.findIndex((block) => block.id === targetId);
      if (fromIndex < 0 || toIndex < 0) return blocks;
      const next = [...blocks];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
    setDraggedBlockId(null);
  };

  const handleResizeProfileBlockStart = (event, blockId, corner) => {
    if (!isActive) return;
    const block = customizationPersonalization.blocks.find((entry) => entry.id === blockId);
    const canvas = event.currentTarget.closest('.profile-skin-view');
    if (!block || !canvas) return;

    event.preventDefault();
    event.stopPropagation();
    const canvasRect = canvas.getBoundingClientRect();
    const canvasStyle = window.getComputedStyle(canvas);
    const columnGap = Number.parseFloat(canvasStyle.columnGap) || 0;
    const columnWidth = (canvasRect.width - (columnGap * 11)) / 12;
    const columnStep = Math.max(1, columnWidth + columnGap);
    const startX = event.clientX;
    const startY = event.clientY;
    const startColumns = block.columns;
    const startHeight = block.height;
    const horizontalDirection = corner.includes('e') ? 1 : -1;
    const verticalDirection = corner.includes('s') ? 1 : -1;
    setResizingBlockId(blockId);

    const handlePointerMove = (moveEvent) => {
      const columns = clampProfileBlockColumns(
        startColumns + Math.round(((moveEvent.clientX - startX) * horizontalDirection) / columnStep),
      );
      const height = clampProfileBlockHeight(
        startHeight + ((moveEvent.clientY - startY) * verticalDirection),
      );
      handlePersonalizationDraftChange({
        ...customizationPersonalization,
        blocks: customizationPersonalization.blocks.map((entry) => (
          entry.id === blockId ? { ...entry, columns, height } : entry
        )),
      });
    };

    const cleanupPointerListeners = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
      setResizingBlockId(null);
      if (resizeCleanupRef.current === cleanupPointerListeners) resizeCleanupRef.current = null;
    };
    const handlePointerUp = () => cleanupPointerListeners();

    resizeCleanupRef.current?.();
    resizeCleanupRef.current = cleanupPointerListeners;
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
  };

  const handleUpdateTextBlock = (blockId, patch) => {
    updateProfileBlocks((blocks) => blocks.map((block) => (
      block.id === blockId && block.type === 'text' ? { ...block, ...patch } : block
    )));
  };

  const handleRemoveProfileBlock = (blockId) => {
    updateProfileBlocks((blocks) => blocks.filter((block) => block.id !== blockId));
  };

  return (
    <div
      className={`profile-page profile-skin-page profile-skin-page--${skin.id} profile-skin-layout--${skin.layout} ${profileUsesLightTheme ? 'profile-page--light-theme' : ''} ${profileBanner ? 'profile-page--has-background' : ''} ${profileBackdropId !== 'default' ? 'profile-page--has-preset-backdrop' : ''}`}
      data-theme={isSelf ? undefined : profileTheme}
      data-theme-mode={isSelf ? undefined : (profileUsesLightTheme ? 'light' : 'dark')}
      data-profile-theme-scope={isSelf ? 'self' : 'owner'}
      data-profile-backdrop={profileBackdropId}
      data-rank-frame={rankFrame.id}
      data-rank-notches={rankFrame.notches}
      style={{ ...profilePageStyle, '--profile-rank-color': rank.color, '--profile-rank-glow': rank.glow }}
    >
      {/* ── Hero ── */}
      <div
        className={`profile-hero ${profileBanner ? 'profile-hero--has-banner' : ''} ${profileBanner?.type === 'image' ? 'profile-hero--has-image' : ''}`}
        data-rank-frame={rankFrame.id}
        data-rank-notches={rankFrame.notches}
      >
        <div className={`profile-hero-overlay ${profileBanner ? 'profile-hero-overlay--strong' : ''}`} />
        {false && isSelf && hasBannerPass && (
          <button className="profile-banner-edit-btn" onClick={() => setShowBannerEditor(true)}>
            Edit banner
          </button>
        )}
        <div className="profile-hero-content">
          <div className="profile-avatar-wrap" style={{ boxShadow: rankGlow }}>
            <ProfileIdentity
              identity={displayedProfileIdentity}
              avatarOnly
              avatarSize={88}
              isViewer={isSelf}
              editable={isSelf}
              onUpload={async (base64) => {
                const profilePicture = await findOrCreateResource(databaseConnection, base64, {
                  parent: player.UUID,
                  kind: 'profilePicture',
                  usedBy: [{ store: STORES.player, UUID: player.UUID, field: 'profilePicture' }],
                });
                const updated = { ...player, profilePicture };
                await commitCurrentProfile(updated);
                await queueProfileAchievementUpdate(updated, `profile-picture:${updated.UUID}:${Date.now()}`);
                setPlayer(updated);
                invalidateDomains(DOMAIN_INVALIDATION.profileWrite);
              }}
            />
          </div>
          <div className="profile-hero-info">
            <div className="profile-name-row">
              <div className="profile-identity-stack">
                <ProfileIdentity
                  identity={displayedProfileIdentity}
                  hideAvatar
                  rank="full"
                  isViewer={isSelf}
                  className="profile-hero-identity"
                />
              </div>
              <div
                className={`profile-rank-badge rank-${rankClass}`}
                role={hasVisibleRating ? 'button' : undefined}
                tabIndex={hasVisibleRating ? 0 : -1}
                title={hasVisibleRating ? 'View rank progress' : 'Complete a rated competition to establish your rank'}
                aria-disabled={!hasVisibleRating}
                onClick={openRankProgress}
                onKeyDown={handleRankKeyDown}
              >
                <span className="prb-icon">
                  {hasVisibleRating ? <RankIcon group={rank.group} sub={rank.sub} size={16} /> : '?'}
                </span>
                <span className="prb-label">{rankLabel}</span>
              </div>
              {player.archivedAt && <span className="profile-archived-badge">Archived</span>}
              <span className={`profile-visibility-pill profile-visibility-pill--${access.tier}`}>
                {access.label}
              </span>
              {/* Achievement bar */}
              <button
                className={`profile-ach-bar ${isSelf ? 'profile-ach-bar--editable' : ''}`}
                onClick={() => { if (access.tier !== 'outside') setShowAchievements(true); }}
                title={access.tier === 'outside' ? 'Selected public achievements' : 'View achievements'}
              >
                {[0, 1, 2].map((i) => {
                  const recognition = player.selectedRecognitions?.[i] || null;
                  const showcased = player.selectedAchievementsV2?.length
                    ? player.selectedAchievementsV2
                    : player.selectedAchievements;
                  const key = recognition?.kind === 'achievement' ? recognition.id : recognition ? null : showcased?.[i] || null;
                  const a   = key ? getAchievementByKey(key) : null;
                  const rarityPct = key ? computeRarity(key, allPlayersForRarity) : 0;
                  if (recognition && recognition.kind !== 'achievement') {
                    return (
                      <span key={i} className={`profile-recognition profile-recognition--${recognition.kind}`} title={`${recognition.type || 'Road recognition'} · ${recognition.label}`}>
                        <i>{recognition.kind === 'legacy' ? '✦' : '⬡'}</i>
                        <b>{recognition.label}</b>
                      </span>
                    );
                  }
                  return (
                    <AchievementBadge
                      key={i}
                      achievementKey={key}
                      size={26}
                      empty={!a}
                      rarity={key ? getRarityLabel(rarityPct) : null}
                      showTooltip={!!a}
                      className="profile-ach-bar-badge"
                    />
                  );
                })}
              </button>
              <ProfilePlayerSearch
                value={playerSearch}
                onChange={setPlayerSearch}
                results={searchResults}
                onSelect={(profileUUID) => {
                  setPlayerSearch('');
                  openPanel('profile', profileUUID);
                }}
              />
            </div>
            {displayPersonalization.tagline && <p className="profile-desc">{displayPersonalization.tagline}</p>}
            {access.tier !== 'outside' && (
              <>
                <div className="profile-contribution-total">
                  <ContributionIcon size={19} />
                  <strong>{totalContribution.toLocaleString()}</strong>
                  <span>Contribution</span>
                </div>
                <div className="profile-rank-progress">
                  {hasVisibleRating && (
                    <div className="prp-track">
                      <div className="prp-fill" style={{ width: `${rankProg}%`, background: rank.color }} />
                    </div>
                  )}
                  <span className="prp-label">{hasVisibleRating
                    ? `${rankProg}% to next rank · ${visibleElo} ELO`
                    : 'Rank: Unrated · Complete a rated competition to establish your rank.'}</span>
                </div>
              </>
            )}
          </div>
          {!isSelf && (
            <div className="profile-friend-actions">
              {accepted && (
                <button className="profile-friend-btn profile-friend-btn--decline" onClick={() => setConfirmEndFriendship(true)}>
                  End friendship
                </button>
              )}
              {iRequested && (
                <button className="profile-friend-btn profile-friend-btn--pending" disabled>
                  <span aria-hidden="true">✓</span>
                  Request sent
                </button>
              )}
              {theyRequested && (
                <>
                  <button
                    className="primary profile-friend-btn"
                    onClick={handleAccept}
                    disabled={access.isFriendCapacityFull}
                  >
                    {access.isFriendCapacityFull ? '3 friend places full' : 'Accept'}
                  </button>
                  <button className="profile-friend-btn profile-friend-btn--decline" onClick={handleDecline}>Decline</button>
                  {access.isFriendCapacityFull && (
                    <span className="profile-friend-cap-note">End a friendship first. No one is replaced automatically.</span>
                  )}
                </>
              )}
              {!accepted && !isPending && !friendRequestSent && (
                <button
                  className="primary profile-friend-btn"
                  onClick={handleAddFriend}
                  disabled={friendRequestBusy}
                  aria-busy={friendRequestBusy}
                >
                  {friendRequestBusy ? 'Sending…' : 'Add friend'}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Hub body ──────────────────────────────────────── */}
      <div className="profile-grid">
        <ProfileTabs
          activeTab={activeTab}
          onChange={setActiveTab}
          access={access}
        />

        {activeTab === 'overview' && (
          <div className="profile-tab-panel profile-overview-panel">
            <ProfileSkinView
              player={player}
              prefs={visiblePersonalization}
              profileView={profileView}
              recentTimelineEntries={recentTimelineEntries}
              allPlayersForRarity={allPlayersForRarity}
              elo={visibleElo}
              rankLabel={rankLabel}
              hasVisibleRating={hasVisibleRating}
              viewerIGT={viewerIGT}
              currentPlayerUUID={currentPlayer?.UUID}
              onOpenHistoryItem={openHistoryItem}
              onTogglePin={handleTogglePin}
              onOpenHighlight={openHighlight}
              onOpenAchievements={access.tier === 'outside' ? undefined : () => setShowAchievements(true)}
              onViewTimeline={canAccessProfileTab(access, 'history') ? () => setActiveTab('history') : undefined}
              isEditing={profileBlockEditorOpen}
              draggedBlockId={draggedBlockId}
              resizingBlockId={resizingBlockId}
              onDragStart={(event, blockId) => {
                setDraggedBlockId(blockId);
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', blockId);
              }}
              onDragEnd={() => setDraggedBlockId(null)}
              onDropBlock={handleDropProfileBlock}
              onMoveBlock={handleMoveProfileBlock}
              onResizeStart={handleResizeProfileBlockStart}
              onUpdateTextBlock={handleUpdateTextBlock}
              onRemoveBlock={handleRemoveProfileBlock}
              contributionDistribution={contributionDistribution}
              totalContribution={totalContribution}
              lifeContext={(
                <LifeContextBlock
                  ownerId={resolvedProfileUUID}
                  isOwner={isSelf}
                  projection={profileContext.projection}
                  ownerState={profileContext.ownerState}
                  people={players.filter((entry) => entry.UUID !== resolvedProfileUUID)}
                  loading={profileContext.loading}
                  saving={profileContext.saving}
                  onSaveQuick={profileContext.saveQuick}
                  onRefreshSuggestions={profileContext.refreshSuggestions}
                  onResolveSuggestion={profileContext.resolveSuggestion}
                  onRevoke={profileContext.revokeItem}
                  onPreview={profileContext.preview}
                  onSavePreferences={profileContext.savePreferences}
                />
              )}
            />
          </div>
        )}

        {activeTab === 'history' && (
          <section className="profile-tab-panel profile-panel">
            <div className="profile-panel-header profile-panel-header--stacked">
              <div>
                <span className="profile-card-title">DAYBOOK</span>
                <p className="profile-panel-sub">
                  {access.daybookScope === 'recent'
                    ? 'A limited five-day window from this current cast profile.'
                    : 'Read recorded activity by IGT day, inspect milestones, or replay history at the same coordinate.'}
                </p>
              </div>
              {access.daybookScope === 'full' && (
                <TimelineModeTabs
                  value={timelineMode}
                  onChange={(nextMode) => {
                    setTimelineMode(nextMode);
                    if (nextMode === 'replay' && replayIGT === 0) {
                      const initialReplayIGT = Math.max(1, viewerIGT);
                      setReplayMaxIGT(initialReplayIGT);
                      setReplayIGT(initialReplayIGT);
                    }
                  }}
                />
              )}
              {access.daybookScope === 'full' && timelineMode === 'activity' && (
                <TimelineControls
                  type={timelineType}
                  search={timelineSearch}
                  sort={timelineSort}
                  pinnedOnly={timelinePinnedOnly}
                  onTypeChange={setTimelineType}
                  onSearchChange={setTimelineSearch}
                  onSortChange={setTimelineSort}
                  onPinnedOnlyChange={setTimelinePinnedOnly}
                />
              )}
            </div>
            <div className="profile-tab-scroll">
              {timelineMode === 'activity' && (
                <>
                  <ProfilePresenceSummary presence={presence} />
                  <DaybookChapterList
                    chapters={daybookChapters}
                    currentPlayerUUID={currentPlayer?.UUID}
                    profileUUID={player.UUID}
                    onOpen={openHistoryItem}
                    onTogglePin={handleTogglePin}
                    hasMore={access.daybookScope === 'full' && Boolean(daybookPage?.hasMore)}
                    loading={daybookLoading}
                    sort={timelineSort}
                    onLoadMore={access.daybookScope === 'full' ? loadMoreDaybook : undefined}
                  />
                </>
              )}
              {timelineMode === 'milestones' && (
                <MilestoneList milestones={profileMilestones} arc={profileArc} />
              )}
              {timelineMode === 'replay' && (
                <ReplayPanel
                  snapshot={replaySnapshot}
                  replayIGT={replayIGT}
                  maxIGT={replayMaxIGT}
                  loading={showReplayLoading}
                  milestones={profileMilestones}
                  onChange={(value) => setReplayIGT(Math.min(replayMaxIGT, Math.max(0, Number(value) || 0)))}
                />
              )}
            </div>
          </section>
        )}

        {activeTab === 'competition' && (
          <div className="profile-tab-panel profile-matches-panel">
            <MatchSummaryBand summary={profileView.matchSummary} />
            {access.matchScope === 'full' && <section className="profile-panel">
              <div className="profile-panel-header">
                <div>
                  <span className="profile-card-title">MATCHES</span>
                  <p className="profile-panel-sub">Recorded match outcomes and ELO movement.</p>
                </div>
              </div>
              <div className="profile-tab-scroll">
                <MatchList matches={matches} profileUUID={player.UUID} onOpen={openMatchDetails} />
              </div>
            </section>}
          </div>
        )}

        {activeTab === 'context' && (
          <div className="profile-tab-panel profile-social-panel profile-context-panel">
            <LifeContextBlock
              ownerId={resolvedProfileUUID}
              isOwner={isSelf}
              projection={profileContext.projection}
              ownerState={profileContext.ownerState}
              people={players.filter((entry) => entry.UUID !== resolvedProfileUUID)}
              loading={profileContext.loading}
              saving={profileContext.saving}
              onSaveQuick={profileContext.saveQuick}
              onRefreshSuggestions={profileContext.refreshSuggestions}
              onResolveSuggestion={profileContext.resolveSuggestion}
              onRevoke={profileContext.revokeItem}
              onPreview={profileContext.preview}
              onSavePreferences={profileContext.savePreferences}
            />
            <section className="profile-panel">
              <div className="profile-panel-header">
                <div>
                  <span className="profile-card-title">FRIENDS</span>
                  <p className="profile-panel-sub">
                    {isSelf
                      ? `${access.friendCount} of 3 persistent friend places filled. Empty places stay empty.`
                      : 'Accepted social links for this profile.'}
                  </p>
                </div>
              </div>
              <div className="profile-friends-list">
                {friends.length === 0
                  ? <div className="profile-empty-row">No friends yet.</div>
                  : friends.map((f) => (
                    <PlayerRow key={f.UUID} entry={f} active={f.UUID === player.UUID} onClick={() => openPanel('profile', f.UUID)} />
                  ))
                }
              </div>
            </section>
          </div>
        )}

        {activeTab === 'identity' && isSelf && (
          <div className="profile-tab-panel profile-settings-panel">
            <ProfileThemeCustomizer
              prefs={customizationPersonalization}
              ownedCosmeticIds={ownedPassIds}
              hasBannerPass={false}
              onChange={handlePersonalizationDraftChange}
              onEditBanner={() => {}}
            />
            <Suspense fallback={<div className="profile-empty-row">Loading settings.</div>}>
              <Settings embedded />
            </Suspense>
          </div>
        )}
      </div>

      {activeTab === 'overview' && isSelf && (
        <ProfileBlockComposer
          prefs={customizationPersonalization}
          ownedCosmeticIds={ownedPassIds}
          isEditing={profileBlockEditorOpen}
          isAddOpen={profileBlockAddMenuOpen}
          hasChanges={hasPersonalizationChanges}
          saving={profilePersonalizationSaving}
          onToggleEditing={() => setProfileBlockEditorOpen((open) => !open)}
          onToggleAdd={() => setProfileBlockAddMenuOpen((open) => !open)}
          onCloseAdd={() => setProfileBlockAddMenuOpen(false)}
          onSave={() => savePersonalization(customizationPersonalization)}
          onAdd={handleAddProfileBlock}
        />
      )}

      {/* Inline banner editor for profile hero */}
      {false && showBannerEditor && (
        <ProfileBannerEditor
          current={profileBanner}
          databaseConnection={databaseConnection}
          ownerUUID={player.UUID}
          onSave={saveBanner}
          onClose={() => setShowBannerEditor(false)}
        />
      )}

      {/* Achievements modal */}
      {showAchievements && (
        <Suspense fallback={null}>
          <AchievementsModal
            player={player}
            isSelf={isSelf}
            databaseConnection={databaseConnection}
            onClose={() => setShowAchievements(false)}
            onSaved={() => {
              setShowAchievements(false);
              invalidateDomains(DOMAIN_INVALIDATION.achievementWrite);
            }}
          />
        </Suspense>
      )}
      <ConfirmDialog
        open={confirmEndFriendship}
        title="End this friendship?"
        message="This opens one friend place without replacing anyone. Recorded encounters and observed history are preserved."
        target={player?.username}
        confirmLabel="End friendship"
        destructive
        onCancel={() => setConfirmEndFriendship(false)}
        onConfirm={handleEndFriendship}
      />
    </div>
  );
}
