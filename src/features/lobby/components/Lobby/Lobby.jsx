import { useCallback, useEffect, useState, useMemo, useRef } from 'react';
import { v4 as uuid } from 'uuid';
import NiceModal from '@ebay/nice-modal-react';
import { useAppContext } from '@app/hooks/useAppContext.js';
import { usePanelLifecycle } from '@app/panel-lifecycle/PanelLifecycleContext.jsx';
import { DOMAIN_INVALIDATION } from '@app/context/domainRevisions.js';
import {
  EVENT,
  GAME_STATE,
  MATCH_STATUS,
  STORES,
  SPECIAL_EVENT_IDS,
} from '@domain/constants.js';
import { fireFirstMatchIfDue, checkEntertainmentAndLog } from '@domain/events/Events.js';
import { completeWorkLifecycle } from '@domain/events/DailyLifecycleService.js';
import {
  buildGhostRoster,
  getMatchOutcomeForPlayer,
} from '@domain/matches/Match.js';
import { buildCompetitionRankIdentity } from '@domain/matches/IGT.js';
import {
  createPairMatchContextSnapshot,
  getMatchDurationHours,
  getMatchTeams,
  isPairMatch,
  PAIR_MATCH_RULESET_ID,
  withImmutableMatchSnapshots,
} from '@domain/matches/MatchContracts.js';
import { isRatedMatch } from '@domain/matches/RatingMode.js';
import {
  getPlayerRankPresentation,
  getRank,
  getRankLabel,
  getRankProgress,
  getRankClass,
} from '@domain/rank/Rank.js';
import ProfileIdentity from '@shared/profile-identity/ProfileIdentity.jsx';
import { cosmeticPresentationStyle } from '@domain/cosmetics/CosmeticCatalog.js';
import { RankIcon } from '@shared/icons/RankIcon.jsx';
import SharedEloChart from '@shared/elo-chart/EloChart.jsx';
import { createTaskDraft } from '@domain/tasks/Tasks.js';
import { getCurrentIGT } from '@domain/time/Time.js';
import { selectLobbyActivityPulses } from '@domain/social-world/LobbyPresencePulses.js';
import {
  MATERIALIZED_LEADERBOARDS_REBUILDING_EVENT,
  MATERIALIZED_LEADERBOARDS_UPDATED_EVENT,
  readLobbyMaterializedData,
} from '@domain/leaderboards/MaterializedLeaderboards.js';
import { loadBanModal } from '@features/profile/loaders.js';
import { useResourceUrl } from '@shared/resource-image/ResourceImage.jsx';
import { loadTaskCreationMenu } from '@features/tasks/loaders.js';
import { loadRankProgressModal } from '@features/achievements/loaders.js';
import { loadInsufficientPlayersModal, loadMatchDetailsModal } from '@features/matches/loaders.js';
import { loadEndDayConfirm } from '@features/events/loaders.js';
import { Icon } from '@shared/icons/Icon.jsx';
import SocialWorldSceneController from '@features/social-world/controllers/SocialWorldSceneController.js';
import SocialWorldProfileCardController from '@features/social-world/controllers/SocialWorldProfileCardController.js';
import { useLiveViewerScene } from '@features/social-world/hooks/useLiveViewerScene.js';
import PresencePulseStack from '@features/social-world/components/PresencePulseStack/PresencePulseStack.jsx';
import ProfilePresenceDrawer from '@features/social-world/components/ProfilePresenceDrawer/ProfilePresenceDrawer.jsx';
import '@features/lobby/components/Lobby/Lobby.css';

const showModal = async (loader, props = {}) => {
  const loaded = await loader();
  const Modal = loaded?.default || loaded;
  return NiceModal.show(Modal, props);
};
const showRankProgress = (elo) => showModal(loadRankProgressModal, { elo });
const showInsufficientPlayers = (props) => showModal(loadInsufficientPlayersModal, props);
const showMatchDetails = (props) => showModal(loadMatchDetailsModal, props);
const showTaskCreation = () => showModal(loadTaskCreationMenu);
const showEndDay = () => showModal(loadEndDayConfirm);
const showBanModal = () => showModal(loadBanModal);

function MatchHistoryRow({ match, currentPlayerUUID, onOpen }) {
  const getNumber = (value) => {
    if (value == null || value === '') return null;
    const next = Number(value);
    return Number.isFinite(next) ? next : null;
  };
  const result = match.result || {};
  const viewerOutcome = match.viewerOutcome || getMatchOutcomeForPlayer(match, currentPlayerUUID);
  const isLive = viewerOutcome.status === 'live';
  const won = viewerOutcome.status === 'win';
  const outcome = viewerOutcome.status === 'forfeit'
    ? 'FORFEIT'
    : viewerOutcome.status === 'pending'
      ? 'PENDING'
      : viewerOutcome.status.toUpperCase();
  const outcomeTone = isLive || viewerOutcome.status === 'pending' ? 'active' : won ? 'win' : 'loss';
  const hasScore = viewerOutcome.playerScore != null && viewerOutcome.opponentScore != null;
  const myScore = viewerOutcome.playerScore;
  const oppScore = viewerOutcome.opponentScore;
  const eloChange = getNumber(result.eloChange);
  const hasEloChange = isRatedMatch(match) && eloChange != null;
  const matchDate = new Date(match.createdAt).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
  const teams = getMatchTeams(match);
  const viewerTeamIndex = teams.findIndex((team) => team.some((player) => String(player.UUID) === String(currentPlayerUUID)));
  const opponentTeam = viewerTeamIndex < 0 ? [] : teams[viewerTeamIndex === 0 ? 1 : 0] || [];
  const opponent = opponentTeam[0] || null;
  const opponentAtMatchStart = opponent ? buildCompetitionRankIdentity(match, opponent) : null;

  return (
    <button type="button" className={`mh-row mh-${outcomeTone}`} onClick={() => onOpen(match)}>
      <div className={`mh-outcome ${outcomeTone}`}>{outcome}</div>
      <div className="mh-main">
        <strong>
          {getMatchDurationHours(match)}h {isPairMatch(match) ? 'Pair Match' : 'Legacy Match'}
        </strong>
        <span>{matchDate}</span>
      </div>
      {opponent && (
        <ProfileIdentity
          identity={opponentAtMatchStart}
          compact
          rank="compact"
          meta={`Opponent${opponentTeam.length > 1 ? ` +${opponentTeam.length - 1}` : ''}`}
          snapshotAt={match.createdAt}
          className="mh-opponent-identity"
        />
      )}
      <div className="mh-result">
        <strong>{hasScore ? `${myScore.toLocaleString()} - ${oppScore.toLocaleString()}` : '--'}</strong>
        {!isLive && hasEloChange && (
          <span className={eloChange > 0 ? 'is-positive' : eloChange < 0 ? 'is-negative' : ''}>
            {eloChange > 0 ? '+' : ''}{eloChange} ELO
          </span>
        )}
      </div>
      <span className="mh-open">{isLive ? 'Open match' : 'View report'} →</span>
    </button>
  );
}

/**
 * Matchmaking tension overlay. Shown while handleFindMatch is running —
 * with a minimum hold time so it always reads as a deliberate beat even
 * when buildGhostRoster returns instantly. Cycles through phase text to
 * give the loading state visual life.
 *
 * Re-uses the existing .match-setup-overlay / .match-setup-card chrome
 * from the original duration-picker overlay (CSS unchanged), minus the
 * duration chips. Cancel returns the player to the lobby with no match
 * written.
 */
function MatchmakingOverlay({ rankLabel, onCancel }) {
  const { isActive } = usePanelLifecycle();
  const PHASES = [
    'SCANNING NETWORK',
    'LOCATING WORTHY OPPONENTS',
    'CALIBRATING ROSTER',
    'PREPARING THE MATCH',
  ];
  const [phaseIdx, setPhaseIdx] = useState(0);
  const [dots, setDots] = useState(0);

  // Cycle the phase headline every 700ms, and animate the trailing
  // ellipsis at 300ms for a separate, faster pulse rhythm.
  useEffect(() => {
    if (!isActive) return undefined;
    const phaseId = setInterval(() => setPhaseIdx((p) => (p + 1) % PHASES.length), 700);
    const dotsId = setInterval(() => setDots((d) => (d + 1) % 4), 300);
    return () => { clearInterval(phaseId); clearInterval(dotsId); };
  }, [isActive]);

  return (
    <div className="match-setup-overlay">
      <div className="match-setup-card">
        <div className="match-setup-header"><div className="mso-corner" />MATCHMAKING</div>
        <div className="match-setup-body">
          <p className="match-setup-title">{PHASES[phaseIdx]}{'.'.repeat(dots)}</p>
          <p className="match-setup-sub">
            Finding four rated players and balancing the two team-average ratings near
            {' '}{rankLabel ? <strong>{rankLabel}</strong> : 'your rank'}. Stay sharp.
          </p>
        </div>
        <div className="match-setup-footer">
          <button onClick={onCancel}>CANCEL</button>
        </div>
      </div>
    </div>
  );
}

function LeaderRow({ rank, player, value, label, isSelf, onClick }) {
  const rankPresentation = getPlayerRankPresentation(player);
  return (
    <button className={`leader-row${isSelf?' leader-row--self':''}`} onClick={onClick}>
      <span className={`leader-rank${rank<=3?` leader-rank--${rank}`:''}`}>#{rank}</span>
      <ProfileIdentity identity={player} avatarOnly avatarSize={26} isViewer={isSelf} />
      <div className="leader-info">
        <span className="leader-name">{player.username||'Unknown'}</span>
        <span className={`leader-tier rank-${rankPresentation.rankClass}`}>
          {rankPresentation.rankLabel}
        </span>
      </div>
      <span className="leader-value">{value} <span className="leader-label">{label}</span></span>
    </button>
  );
}

function getReminderDate(reminder) {
  const raw = reminder?.snoozedUntil || reminder?.remindAt;
  const date = raw ? new Date(raw) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

function formatLobbyReminderTime(reminder) {
  const date = getReminderDate(reminder);
  if (!date) return 'Due now';
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const sameDay = date.toDateString() === today.toDateString();
  const nextDay = date.toDateString() === tomorrow.toDateString();
  const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (sameDay) return `Today ${time}`;
  if (nextDay) return `Tomorrow ${time}`;
  return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
}

function LobbyReminderCapsules({ reminders = [], onOpen, onDismiss }) {
  if (!reminders.length) return null;
  return (
    <div className="lobby-reminder-strip" aria-label="Upcoming reminders">
      {reminders.map((reminder) => (
        <article key={reminder.UUID} className="lobby-reminder-capsule">
          <button type="button" className="lobby-reminder-main" onClick={() => onOpen?.(reminder)}>
            <Icon name="bell" size={17} />
            <span>{formatLobbyReminderTime(reminder)}</span>
            <strong>{reminder.title || 'Reminder'}</strong>
          </button>
          {onDismiss && (
            <button
              type="button"
              className="lobby-reminder-dismiss"
              onClick={() => onDismiss(reminder)}
              aria-label="Dismiss reminder"
            >
              x
            </button>
          )}
        </article>
      ))}
    </div>
  );
}

export default function Lobby({ reminders = [], onOpenReminder, onDismissReminder }) {
  const {
    databaseConnection, currentPlayer, domainRevisions, invalidateDomains, openPanel, playSound, ensureDomainLoaded, notify, timestamp,
    gameState:   [, setGameState],
    activeMatch: [, setActiveMatch],
    activeTask:  [, setActiveTask],
  } = useAppContext();
  const { canLoad, isActive } = usePanelLifecycle();

  const [scheduleStage, setScheduleStage] = useState(null);
  const [matchHistory, setMatchHistory]   = useState([]);
  const [loadingMatch, setLoadingMatch]   = useState(false);
  // Cancel flag for the matchmaking tension overlay. If the player clicks
  // CANCEL while matchmaking is in flight, this flips true and the post-
  // await branch in handleFindMatch bails before writing the match record.
  const matchmakingCancelRef             = useRef(false);
  const matchmakingDelayTimerRef         = useRef(null);
  const matchmakingDelayResolveRef       = useRef(null);
  const [totalPoints, setTotalPoints]     = useState(0);
  const [eloHistory, setEloHistory]       = useState([]);
  const [fellowRatings, setFellowRatings] = useState([]);
  const [viewerRating, setViewerRating]   = useState(null);
  const [viewerHasVisibleRating, setViewerHasVisibleRating] = useState(false);
  const [allPlayers, setAllPlayers]       = useState([]);
  const [playerPoints, setPlayerPoints]   = useState({});
  const [playerContribution, setPlayerContribution] = useState({});
  const [leaderTab, setLeaderTab]         = useState('elo');
  const [rankedUUIDs, setRankedUUIDs]     = useState({ global: [], friends: [], points: [], contribution: [] });
  const [leaderboardRefresh, setLeaderboardRefresh] = useState(0);
  const [leaderboardsUpdating, setLeaderboardsUpdating] = useState(false);
  const [preparedSocialScene, setPreparedSocialScene] = useState(null);
  const [selectedProfileId, setSelectedProfileId] = useState(null);
  const [profileCard, setProfileCard] = useState(null);
  const [profileCardError, setProfileCardError] = useState(null);
  const socialSceneController = useMemo(
    () => new SocialWorldSceneController({ gateway: databaseConnection }),
    [databaseConnection],
  );
  const profileCardController = useMemo(
    () => new SocialWorldProfileCardController({ gateway: databaseConnection }),
    [databaseConnection],
  );
  const lobbyViewerIGT = getCurrentIGT(currentPlayer, timestamp);
  const preparedViewerScene = preparedSocialScene?.viewer?.profileId === currentPlayer?.UUID
    ? preparedSocialScene
    : null;
  const socialScene = useLiveViewerScene(preparedViewerScene, {
    viewerIGT: lobbyViewerIGT,
  });
  const lobbyViewerIGTBucket = Math.floor(lobbyViewerIGT / 60000);

  const clearMatchmakingDelay = useCallback(() => {
    if (matchmakingDelayTimerRef.current != null) {
      window.clearTimeout(matchmakingDelayTimerRef.current);
      matchmakingDelayTimerRef.current = null;
    }
    const resolve = matchmakingDelayResolveRef.current;
    matchmakingDelayResolveRef.current = null;
    resolve?.();
  }, []);

  useEffect(() => {
    if (!canLoad || !currentPlayer?.UUID) return undefined;
    let cancelled = false;
    const load = async () => {
      const data = await readLobbyMaterializedData(databaseConnection, currentPlayer.UUID, lobbyViewerIGT);
      if (cancelled) return;
      setScheduleStage(data.scheduleStage);
      setMatchHistory(data.matchHistory);
      setTotalPoints(data.totalPoints);
      setEloHistory(data.eloHistory);
      setFellowRatings(data.fellowRatings || []);
      setViewerRating(data.viewerRating);
      setViewerHasVisibleRating(data.viewerHasVisibleRating);
      setAllPlayers(data.participants);
      setPlayerPoints(data.match.pointsByPlayer || {});
      setPlayerContribution(data.contribution.totalsByPlayer || {});
      setRankedUUIDs({
        global: data.globalRankedUUIDs || [],
        friends: data.friendRankedUUIDs || [],
        points: data.match.pointsRankedUUIDs || [],
        contribution: data.contribution.rankedUUIDs || [],
      });

      // Active-match ownership is part of the compact lobby snapshot. Only an
      // actual resumable match escalates to the complete Match domain.
      if (data.activeMatchUUID) {
        await ensureDomainLoaded(['matches', 'profiles', 'tasks', 'dailyLifecycle']);
        if (cancelled) return;
        const active = await databaseConnection.get(STORES.match, data.activeMatchUUID);
        if (
          cancelled
          || ![MATCH_STATUS.pending, MATCH_STATUS.active].includes(active?.status)
        ) return;
        setActiveMatch(active);
        setGameState(GAME_STATE.match);
      }
    };
    load().catch((error) => console.warn('[Lobby] materialized snapshot load failed:', error));
    return () => { cancelled = true; };
  }, [
    canLoad,
    databaseConnection,
    currentPlayer?.UUID,
    domainRevisions.leaderboards,
    ensureDomainLoaded,
    leaderboardRefresh,
    lobbyViewerIGTBucket,
    setActiveMatch,
    setGameState,
  ]);

  // Lobby projects its bounded pulses from the same Fellow scene as the map.
  useEffect(() => {
    if (!canLoad || !currentPlayer?.UUID) return undefined;
    let cancelled = false;
    socialSceneController.load({
      viewerId: currentPlayer.UUID,
      viewerIGT: getCurrentIGT(currentPlayer),
    }).then((scene) => {
      if (!cancelled) setPreparedSocialScene(scene);
    }).catch((error) => {
      if (!cancelled) {
        setPreparedSocialScene(null);
        console.warn('[Lobby] social presence snapshot load failed:', error);
      }
    });
    return () => { cancelled = true; };
  }, [
    canLoad,
    currentPlayer?.UUID,
    domainRevisions.presence,
    domainRevisions.profiles,
    domainRevisions.social,
    domainRevisions.socialWorld,
    socialSceneController,
  ]);

  useEffect(() => {
    if (isActive || !selectedProfileId) return;
    setSelectedProfileId(null);
    setProfileCard(null);
    setProfileCardError(null);
  }, [isActive, selectedProfileId]);

  useEffect(() => {
    if (!isActive || !selectedProfileId || !currentPlayer?.UUID) return undefined;
    let cancelled = false;
    setProfileCard(null);
    setProfileCardError(null);
    profileCardController.load({
      viewerId: currentPlayer.UUID,
      profileId: selectedProfileId,
      viewerIGT: getCurrentIGT(currentPlayer),
    }).then((card) => {
      if (!cancelled) setProfileCard(card);
    }).catch((error) => {
      if (!cancelled) setProfileCardError(error);
    });
    return () => { cancelled = true; };
  }, [
    currentPlayer?.UUID,
    domainRevisions.goals,
    domainRevisions.matches,
    domainRevisions.presence,
    domainRevisions.profiles,
    domainRevisions.social,
    domainRevisions.socialWorld,
    domainRevisions.tasks,
    isActive,
    profileCardController,
    selectedProfileId,
  ]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handleRebuilding = () => setLeaderboardsUpdating(true);
    const handleUpdated = () => {
      setLeaderboardsUpdating(false);
      setLeaderboardRefresh((revision) => revision + 1);
    };
    window.addEventListener(MATERIALIZED_LEADERBOARDS_REBUILDING_EVENT, handleRebuilding);
    window.addEventListener(MATERIALIZED_LEADERBOARDS_UPDATED_EVENT, handleUpdated);
    return () => {
      window.removeEventListener(MATERIALIZED_LEADERBOARDS_REBUILDING_EVENT, handleRebuilding);
      window.removeEventListener(MATERIALIZED_LEADERBOARDS_UPDATED_EVENT, handleUpdated);
    };
  }, []);

  useEffect(() => {
    if (isActive) return;
    matchmakingCancelRef.current = true;
    clearMatchmakingDelay();
    setLoadingMatch(false);
  }, [clearMatchmakingDelay, isActive]);

  useEffect(() => () => clearMatchmakingDelay(), [clearMatchmakingDelay]);

  const handleFindMatch = async () => {
    if (!currentPlayer || loadingMatch) return;
    matchmakingCancelRef.current = false;
    setLoadingMatch(true);
    playSound?.('matchmaking', { volume: 0.9, throttleMs: 650 });
    try {
      await ensureDomainLoaded(['matches', 'tasks', 'profiles', 'dailyLifecycle']);
      const matchStartIGT = getCurrentIGT(currentPlayer);
      const allP = await databaseConnection.getPlayersAtIGT(matchStartIGT);
      const matchmakingPlayer = allP.find((player) => player.UUID === currentPlayer.UUID) || currentPlayer;
      const duration = 1;

      // Race buildGhostRoster against a minimum-hold timer. Whichever finishes
      // last gates the transition into the match — so even when matchmaking
      // resolves instantly (small DB, cached candidates), the tension overlay
      // sits on screen long enough to read as a deliberate "match starting"
      // beat rather than a confusing flash.
      const MATCHMAKING_MIN_MS = 2000;
      const minimumBeat = new Promise((resolve) => {
        matchmakingDelayResolveRef.current = resolve;
        matchmakingDelayTimerRef.current = window.setTimeout(() => {
          matchmakingDelayTimerRef.current = null;
          matchmakingDelayResolveRef.current = null;
          resolve();
        }, MATCHMAKING_MIN_MS);
      });
      const [result] = await Promise.all([
        buildGhostRoster(databaseConnection, allP, matchmakingPlayer, duration, { viewerIGT: matchStartIGT }),
        minimumBeat,
      ]);

      // User cancelled while we were waiting — abort silently. No match
      // record, no insufficient modal, just back to the lobby.
      if (matchmakingCancelRef.current) return;

      // At Silver+, if the real candidate pool is too small to fill 3 slots,
      // matchmaking is blocked. No match record is written; a friction modal
      // explains the rule and points the player at profile creation.
      if (result.insufficient) {
        playSound?.('warning', { volume: 0.9, throttleMs: 500 });
        await showInsufficientPlayers({
          available: result.available,
          rankLabel: getPlayerRankPresentation(matchmakingPlayer).rankLabel,
        });
        return;
      }

      const { teammates, opponents } = result;
      if (matchmakingCancelRef.current) return;

      const createdAt = new Date().toISOString();
      const viewerSnapshot = {
        ...matchmakingPlayer,
        username: currentPlayer.username,
        profilePicture: currentPlayer.profilePicture || null,
        isCurrentPlayer: true,
        cardBanner: currentPlayer.activeCosmetics?.cardBanner || null,
        playerTheme: currentPlayer.activeCosmetics?.profileTheme || currentPlayer.activeCosmetics?.appTheme || currentPlayer.activeCosmetics?.theme || 'minimalist',
        profileTheme: currentPlayer.activeCosmetics?.profileTheme || currentPlayer.activeCosmetics?.appTheme || currentPlayer.activeCosmetics?.theme || 'minimalist',
        avatarFrame: currentPlayer.activeCosmetics?.avatarFrame || 'default',
        matchCard: currentPlayer.activeCosmetics?.matchCard || 'default',
        standingsRow: currentPlayer.activeCosmetics?.standingsRow || 'default',
        activeTitle: currentPlayer.activeCosmetics?.title || null,
        frame: currentPlayer.activeCosmetics?.profileFrame
          || currentPlayer.activeCosmetics?.cardFrame
          || currentPlayer.activeCosmetics?.frame
          || null,
        selectedAchievements: currentPlayer.selectedAchievements || [],
      };
      const teams = [[viewerSnapshot, ...teammates], opponents];
      let contextProjections = new Map();
      try {
        contextProjections = await databaseConnection.getProfileContextProjections({
          viewerId: currentPlayer.UUID,
          subjects: teams.flat()
            .filter((player) => String(player.UUID) !== String(currentPlayer.UUID))
            .map((player) => ({
              subjectId: player.UUID,
              relationshipTier: teammates.some((teammate) => teammate.UUID === player.UUID)
                ? 'friend'
                : 'dynamic',
            })),
          viewerIGT: matchStartIGT,
          revision: domainRevisions.profileContext || 0,
        });
      } catch (contextError) {
        console.warn('[Lobby] Pair Match context snapshots could not be projected:', contextError);
      }
      const contextSnapshot = createPairMatchContextSnapshot({
        viewerUUID: currentPlayer.UUID,
        teams,
        projections: contextProjections,
        createdAt,
      });
      const match = withImmutableMatchSnapshots({
        UUID: uuid(),
        createdAt,
        rulesetId: PAIR_MATCH_RULESET_ID,
        parent: currentPlayer.UUID,
        status: MATCH_STATUS.pending,
        phase: 'team-reveal',
        lockedAt: null,
        inGameTimestamp: matchStartIGT,
        teams,
        contextSnapshot,
        result: null,
      });
      if (matchmakingCancelRef.current) return;
      await databaseConnection.add(STORES.match, match);
      // Fire the First Match-of-the-Day special event if applicable. Idempotent
      // for the IGT day — only fires once. Failures here must not block the
      // match from starting.
      try {
        await fireFirstMatchIfDue(databaseConnection, currentPlayer, Date.now());
      } catch (err) {
        console.warn('[Lobby] first-match timing log failed:', err);
      }
      setActiveMatch(match); setGameState(GAME_STATE.match); invalidateDomains(DOMAIN_INVALIDATION.matchWrite);
    } catch (error) {
      console.error('[Lobby] matchmaking failed:', error);
      try {
        await notify?.({
          title: 'Match could not start',
          message: 'The local data required for matchmaking could not be loaded. Reload the app and try again.',
          kind: 'error',
          persist: false,
        });
      } catch (notificationError) {
        console.warn('[Lobby] matchmaking error notification failed:', notificationError);
      }
    } finally {
      clearMatchmakingDelay();
      setLoadingMatch(false);
    }
  };

  const handleCancelMatchmaking = () => {
    matchmakingCancelRef.current = true;
    // Don't flip loadingMatch off here — handleFindMatch's `finally` does
    // that, ensuring the overlay stays up until the in-flight promise
    // resolves. Otherwise we'd risk re-rendering the lobby underneath a
    // half-finished buildGhostRoster and triggering double-writes.
  };

  const openMatchDetails = async (match) => {
    await ensureDomainLoaded('matches');
    const fullMatch = await databaseConnection.get(STORES.match, match.UUID) || match;
    return showMatchDetails({
      match: fullMatch,
      currentPlayerUUID: currentPlayer?.UUID,
      onOpenProfile: (id) => openPanel('profile', id),
    }).catch((error) => console.warn('[Lobby] match details load failed:', error));
  };

  const recordVisibleEncounter = useCallback(({ profileId, surface, visibleFacts = [] }) => {
    if (!currentPlayer?.UUID || !profileId || profileId === currentPlayer.UUID) return;
    const operationId = globalThis.crypto?.randomUUID?.()
      || `${surface}:${currentPlayer.UUID}:${profileId}:${Date.now()}:${Math.random()}`;
    profileCardController.recordEncounter({
      viewerId: currentPlayer.UUID,
      profileId,
      viewerIGT: getCurrentIGT(currentPlayer),
      surface,
      visibleFacts,
      operationId,
    }).catch((error) => console.warn('[Lobby] profile encounter could not be recorded:', error));
  }, [currentPlayer, profileCardController]);

  const closeProfileCard = useCallback(() => {
    setSelectedProfileId(null);
    setProfileCard(null);
    setProfileCardError(null);
  }, []);

  const inspectOccupant = useCallback((profileId) => {
    setSelectedProfileId(profileId);
  }, []);

  const playersByUUID = useMemo(
    () => new Map((allPlayers || []).map((player) => [String(player.UUID), player])),
    [allPlayers],
  );
  const rankedPlayers = useCallback(
    (ids) => (ids || []).map((id) => playersByUUID.get(String(id))).filter(Boolean),
    [playersByUUID],
  );

  const leaderGlobalAll = useMemo(() => rankedPlayers(rankedUUIDs.global), [rankedPlayers, rankedUUIDs.global]);
  const leaderGlobal = useMemo(() => leaderGlobalAll.slice(0, 10), [leaderGlobalAll]);
  const leaderFriendsAll = useMemo(() => rankedPlayers(rankedUUIDs.friends), [rankedPlayers, rankedUUIDs.friends]);
  const leaderFriends = useMemo(() => leaderFriendsAll.slice(0, 10), [leaderFriendsAll]);
  const leaderPointsAll = useMemo(() => rankedPlayers(rankedUUIDs.points), [rankedPlayers, rankedUUIDs.points]);
  const leaderPoints = useMemo(() => leaderPointsAll.slice(0, 10), [leaderPointsAll]);
  const leaderContributionAll = useMemo(
    () => rankedPlayers(rankedUUIDs.contribution),
    [rankedPlayers, rankedUUIDs.contribution],
  );
  const leaderContribution = useMemo(
    () => leaderContributionAll.filter((player) => (playerContribution[player.UUID] || 0) > 0).slice(0, 10),
    [leaderContributionAll, playerContribution],
  );

  const renderLeaderRows = (visibleRows, allRows, valueFor, label, emptyMessage) => {
    if (!visibleRows.length) return <div className="leader-empty">{emptyMessage}</div>;
    const currentIndex = currentPlayer?.UUID
      ? allRows.findIndex((player) => player.UUID === currentPlayer.UUID)
      : -1;
    const currentOutsideTopTen = currentIndex >= 10 ? allRows[currentIndex] : null;
    return (
      <>
        {visibleRows.map((p, i) => (
          <LeaderRow
            key={p.UUID}
            rank={i + 1}
            player={p}
            value={valueFor(p)}
            label={label}
            isSelf={p.UUID === currentPlayer?.UUID}
            onClick={() => openPanel('profile', p.UUID)}
          />
        ))}
        {currentOutsideTopTen && (
          <>
            <div className="leader-current-separator"><span>Your rank</span></div>
            <LeaderRow
              key={`current-${currentOutsideTopTen.UUID}`}
              rank={currentIndex + 1}
              player={currentOutsideTopTen}
              value={valueFor(currentOutsideTopTen)}
              label={label}
              isSelf
              onClick={() => openPanel('profile', currentOutsideTopTen.UUID)}
            />
          </>
        )}
      </>
    );
  };

  const isWorkDay = scheduleStage?.type === EVENT.wake;
  const username = currentPlayer?.username || 'AGENT';
  const displayedCurrentPlayer = playersByUUID.get(String(currentPlayer?.UUID || '')) || currentPlayer;
  const internalElo = Number(currentPlayer?.elo || 0);
  const elo = Number(viewerRating ?? displayedCurrentPlayer?.elo ?? internalElo);
  const rankClass = viewerHasVisibleRating ? getRankClass(elo) : 'unrated';
  const lobbyIdentity = {
    ...currentPlayer,
    elo,
    hasVisibleRating: viewerHasVisibleRating,
    rankLabel: viewerHasVisibleRating ? getRankLabel(elo) : 'Unrated',
  };
  const activityPulses = useMemo(() => selectLobbyActivityPulses(socialScene, {
    excludeProfileId: currentPlayer?.UUID,
    limit: 3,
  }), [currentPlayer?.UUID, socialScene]);
  const visibleFellowRatings = useMemo(() => {
    const fellowIds = new Set((socialScene?.members || [])
      .map((member) => String(member?.profileId || ''))
      .filter((profileId) => profileId && profileId !== String(currentPlayer?.UUID || '')));
    return fellowRatings.filter((rating) => fellowIds.has(String(rating.UUID)));
  }, [currentPlayer?.UUID, fellowRatings, socialScene]);
  const selectedMember = selectedProfileId
    ? socialScene?.memberById?.get(selectedProfileId) || null
    : null;
  const socialViewerIGT = lobbyViewerIGT;

  const lb = currentPlayer?.activeCosmetics?.lobbyBanner;
  const lobbyBannerUrl = useResourceUrl(lb?.type === 'image' ? lb.value : null);
  const lobbyBannerDampener = 'linear-gradient(180deg, color-mix(in srgb, var(--bg-void) 34%, transparent), color-mix(in srgb, var(--bg-void) 68%, transparent))';
  const bannerStyle = lb
    ? lb.type==='image'    ? { backgroundImage:`${lobbyBannerDampener}, url(${lobbyBannerUrl || ''})` }
    : lb.type==='gradient' ? { backgroundImage:`${lobbyBannerDampener}, ${lb.value}` }
    : lb.type==='color'    ? { backgroundImage:`${lobbyBannerDampener}, linear-gradient(${lb.value}, ${lb.value})` } : {} : {};
  const lobbyCardId = currentPlayer?.activeCosmetics?.lobbyCard || 'default';
  const lobbyCardStyle = cosmeticPresentationStyle('lobbyCard', lobbyCardId);

  const openTaskCreationPopup = async () => {
    await ensureDomainLoaded('tasks');
    setActiveTask(createTaskDraft());
    requestAnimationFrame(() => {
      showTaskCreation().catch((error) => console.warn('[Lobby] task editor load failed:', error));
    });
  };

  return (
    <div className="lobby">
      <div className="lobby-bg" aria-hidden="true" />
      <div className="lobby-layout">

        {/* ── Player card ─────────────────────────────────── */}
        <aside className={`lobby-player-card${lb?' has-banner':''}`} data-cosmetic-lobby-card={lobbyCardId} style={{ ...lobbyCardStyle, ...bannerStyle }}>
          <div className="lpc-avatar-area">
            <div className="lpc-avatar-ring">
              <ProfileIdentity identity={lobbyIdentity} avatarOnly avatarSize={90} isViewer />
            </div>
            <button
              type="button"
              className={`lpc-rank-emblem rank-${rankClass}`}
              title={viewerHasVisibleRating ? 'View rank progress' : 'Complete a rated competition to establish your rank'}
              aria-label={viewerHasVisibleRating ? `View ${getRankLabel(elo)} progress` : 'Unrated'}
              disabled={!viewerHasVisibleRating}
              onClick={() => showRankProgress(elo).catch((error) => console.warn('[Lobby] rank modal load failed:', error))}
            >
              {viewerHasVisibleRating
                ? <RankIcon group={getRank(elo).group} sub={getRank(elo).sub} size={18} />
                : <span aria-hidden="true">?</span>}
            </button>
          </div>
          <div className="lpc-identity">
            <ProfileIdentity identity={lobbyIdentity} hideAvatar rank="full" isViewer compact />
          </div>
          <div className="lpc-stats">
            <div className="lpc-stat"><span className="lpc-stat-val">{Math.floor(totalPoints).toLocaleString()}</span><span className="lpc-stat-lbl">POINTS</span></div>
            <div className="lpc-stat-sep" />
            <div className="lpc-stat"><span className="lpc-stat-val lpc-tokens">◈ {currentPlayer?.tokens||0}</span><span className="lpc-stat-lbl">TOKENS</span></div>
          </div>
          <div className="lpc-actions">
            <button
              className="lpc-btn primary"
              onClick={openTaskCreationPopup}
            >
              Add task
            </button>
            <button className="lpc-btn" onClick={() => openPanel('tasks')}>Open tasks</button>
            <button className="lpc-btn" onClick={() => openPanel('profile', currentPlayer?.UUID)}>View profile</button>
            <div className="lpc-divider" />
            {isWorkDay
              ? <button className="lpc-btn" onClick={async () => {
                  await ensureDomainLoaded(['dailyLifecycle', 'profiles']);
                  await completeWorkLifecycle(databaseConnection, currentPlayer);
                  // Record the end-work lifecycle event immediately.
                  try { await checkEntertainmentAndLog(databaseConnection, currentPlayer); }
                  catch (err) { console.warn('[Lobby] entertainment check failed:', err); }
                  invalidateDomains(DOMAIN_INVALIDATION.dailyLifecycleWrite);
                }}>End work day</button>
              : (
                <button
                  className="lpc-btn danger"
                  onClick={async () => {
                    await ensureDomainLoaded(['dailyLifecycle', 'profiles']);
                    return showEndDay().catch((error) => console.warn('[Lobby] end-day modal load failed:', error));
                  }}
                >
                  End day
                </button>
              )
            }
            {/* ── Penalty / wipe profile ─────────────────────────
                Quietly distinct from the action stack above — its
                own hairline divider and an amber border — so it
                reads as a different class of action without
                shouting. */}
            <div className="lpc-ban-zone">
              <button
                className="lpc-btn lpc-btn-penalty"
                onClick={async () => {
                  await ensureDomainLoaded(['profiles', 'tasks', 'journals', 'feed', 'events', 'matches', 'shop']);
                  return showBanModal().catch((error) => console.warn('[Lobby] penalty modal load failed:', error));
                }}
                title="Issue a penalty strike for this profile"
              >
                <span>Issue penalty</span>
              </button>
            </div>
          </div>
        </aside>

        {/* ── Center ──────────────────────────────────────── */}
        <section className="lobby-center">

          <div className="lobby-action-grid">
            <article
              className="lobby-action-card lobby-action-card--compete"
              data-disabled={loadingMatch ? 'true' : 'false'}
            >
              <button
                type="button"
                className="lobby-action-card__main"
                onClick={handleFindMatch}
                disabled={loadingMatch}
              >
                <span className="lobby-action-icon"><Icon name="events" size={24} /></span>
                <strong>{loadingMatch ? 'Finding Pair Match' : 'Pair Match'}</strong>
                <p>60 minutes · rated · 2v2</p>
                <span className="lobby-action-cta">{loadingMatch ? 'Matching...' : 'Queue'}</span>
              </button>
              <PresencePulseStack
                members={activityPulses.match}
                label="Players active in Match"
                surface="lobby-match"
                onInspectProfile={inspectOccupant}
              />
            </article>

            <article className="lobby-action-card lobby-action-card--dojo">
              <button
                type="button"
                className="lobby-action-card__main"
                onClick={() => setGameState(GAME_STATE.dojo)}
              >
                <span className="lobby-action-icon"><Icon name="tasks" size={24} /></span>
                <strong>Enter dojo</strong>
                <span className="lobby-action-cta">Start training</span>
              </button>
              <PresencePulseStack
                members={activityPulses.dojo}
                label="Players active in Dojo"
                surface="lobby-dojo"
                onInspectProfile={inspectOccupant}
              />
            </article>
          </div>

          <LobbyReminderCapsules
            reminders={reminders}
            onOpen={onOpenReminder}
            onDismiss={onDismissReminder}
          />

          {/* Data Hub */}
          <div className="data-hub">
            <div className="data-hub-header">
              <span className="data-hub-title">◈ DATA HUB</span>
              <span className="data-hub-sub">{leaderboardsUpdating ? 'Refreshing cached rankings…' : 'Performance history'}</span>
            </div>

            <div className="lobby-data-summary">
              <div className="lobby-status-card">
                <span className="lobby-status-kicker">Rank progress</span>
                <strong>{viewerHasVisibleRating ? getRankLabel(elo) : 'Unrated'}</strong>
                <p>{viewerHasVisibleRating
                  ? `${getRankProgress(elo)}% to the next competitive level`
                  : 'Complete a rated competition to establish your rank.'}</p>
              </div>
              {matchHistory[0] ? (
                <div className="lobby-latest-match">
                  <div className="lobby-history-title">LATEST MATCH</div>
                  <MatchHistoryRow
                    match={matchHistory[0]}
                    currentPlayerUUID={currentPlayer?.UUID}
                    onOpen={openMatchDetails}
                  />
                </div>
              ) : (
                <div className="lobby-status-card">
                  <span className="lobby-status-kicker">MATCH RECORD</span>
                  <strong>No recent activity</strong>
                  <p>Finish a match to see your latest result here.</p>
                </div>
              )}
            </div>

            <div className="data-hub-grid">
              {/* ELO chart */}
              <div className="data-card data-card--chart">
                <div className="data-card-header">
                  <span className="data-card-title">ELO JOURNEY</span>
                  {viewerHasVisibleRating && (
                    <span className="data-card-note">
                      You{visibleFellowRatings.length > 0
                        ? ` + ${visibleFellowRatings.length} Fellow ${visibleFellowRatings.length === 1 ? 'journey' : 'journeys'}`
                        : ''} · through current IGT
                    </span>
                  )}
                </div>
                <SharedEloChart
                  data={eloHistory}
                  comparisonRatings={viewerHasVisibleRating ? visibleFellowRatings : []}
                  viewerIGT={lobbyViewerIGT}
                  timeBasis="igt"
                  seriesLabel={`${username} (You)`}
                  emptyMessage="Complete a rated competition to establish your Elo."
                />
                <div className="elo-current-badge">
                  <span className="ecb-val">{viewerHasVisibleRating ? elo : 'UNRATED'}</span>
                  <span className="ecb-lbl">CURRENT ELO</span>
                </div>
              </div>

              {/* Leaderboards */}
              <div className="data-card data-card--leader">
                <div className="leader-tabs">
                  {[['elo','GLOBAL ELO'],['friends','FRIENDS'],['points','TOP POINTS'],['contribution','CONTRIBUTION']].map(([id, lbl]) => (
                    <button key={id} className={`leader-tab${leaderTab===id?' active':''}`} onClick={() => setLeaderTab(id)}>{lbl}</button>
                  ))}
                </div>
                <div className="leader-list">
                  {leaderTab === 'elo' && renderLeaderRows(
                    leaderGlobal,
                    leaderGlobalAll,
                    (p) => (p.elo || 0).toLocaleString(),
                    'ELO',
                    'No rated competitors are visible at this IGT yet.',
                  )}
                  {leaderTab === 'friends' && renderLeaderRows(
                    leaderFriends,
                    leaderFriendsAll,
                    (p) => (p.elo || 0).toLocaleString(),
                    'ELO',
                    'No visible rated friends at this IGT yet.',
                  )}
                  {leaderTab === 'points' && renderLeaderRows(
                    leaderPoints,
                    leaderPointsAll,
                    (p) => Math.floor(playerPoints[p.UUID] || 0).toLocaleString(),
                    'PTS',
                    'No points earned yet.',
                  )}
                  {leaderTab === 'contribution' && renderLeaderRows(
                    leaderContribution,
                    leaderContributionAll,
                    (p) => (playerContribution[p.UUID] || 0).toLocaleString(),
                    'Contribution',
                    'No Goal Contribution yet.',
                  )}
                </div>
              </div>
            </div>
          </div>

        </section>
      </div>

      {loadingMatch && (
        <MatchmakingOverlay
          rankLabel={viewerHasVisibleRating ? getRankLabel(elo) : 'Unrated'}
          onCancel={handleCancelMatchmaking}
        />
      )}
      <ProfilePresenceDrawer
        analyticsSurface="lobby"
        open={Boolean(selectedProfileId)}
        summary={selectedMember}
        card={profileCard}
        loading={Boolean(selectedProfileId) && !profileCard && !profileCardError}
        error={profileCardError}
        viewerIGT={socialViewerIGT}
        onClose={closeProfileCard}
        onEncounterVisible={recordVisibleEncounter}
        onOpenProfile={(profileId) => {
          closeProfileCard();
          openPanel('profile', profileId);
        }}
      />
    </div>
  );
}
