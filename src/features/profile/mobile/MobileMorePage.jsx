import { useCallback, useEffect, useMemo, useState } from 'react';
import NiceModal from '@ebay/nice-modal-react';
import { v4 as uuid } from 'uuid';
import { useAppContext } from '@app/hooks/useAppContext.js';
import { DOMAIN_INVALIDATION } from '@app/context/domainRevisions.js';
import { GAME_STATE } from '@domain/constants.js';
import { createPairMatchCommand } from '@domain/matches/MatchmakingCommand.js';
import { getCurrentIGT } from '@domain/time/Time.js';
import { loadEndDayConfirm } from '@features/events/loaders.js';
import MobileSettingsPage from '@features/settings/mobile/MobileSettingsPage.jsx';
import ProfileIdentity from '@shared/profile-identity/ProfileIdentity.jsx';
import EloChart from '@shared/elo-chart/EloChart.jsx';
import { Icon } from '@shared/icons/Icon.jsx';
import MobileArenaPage from '@features/matches/mobile/MobileArenaPage.jsx';
import { queryMobileCompetition } from '@app/mobile/application/MobileCompetitionQueryService.js';
import { useMobileSurface } from '@app/mobile/MobileSurfaceContext.jsx';
import { queryResumableMobileMatch } from '@app/mobile/application/MobileMatchQueryService.js';

const RANKING_TYPES = Object.freeze([
  { id: 'elo', label: 'Match Elo' },
  { id: 'points', label: 'Points' },
  { id: 'contribution', label: 'Contribution' },
  { id: 'history', label: 'Elo history' },
]);

export default function MobileMorePage() {
  const {
    databaseConnection,
    currentPlayer,
    domainRevisions,
    invalidateDomains,
    ensureDomainLoaded,
    gameState: [gameState, setGameState],
    activeMatch: [activeMatch, setActiveMatch],
  } = useAppContext();
  const { openSurface } = useMobileSurface();
  const [view, setView] = useState('root');
  const [competition, setCompetition] = useState(() => ({
    profiles: [],
    rankings: { elo: [], points: [], contribution: [] },
    neighborhoods: { elo: [], points: [], contribution: [] },
    metrics: { points: 0, contribution: 0, elo: 0 },
    eloHistory: [],
    unreadNotifications: 0,
  }));
  const [rankingIndex, setRankingIndex] = useState(0);
  const [matchmaking, setMatchmaking] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (player = currentPlayer) => {
    if (!player?.UUID) return;
    await ensureDomainLoaded?.(['profiles', 'leaderboards', 'social']);
    setCompetition(await queryMobileCompetition(databaseConnection, {
      playerUUID: player.UUID,
      viewerIGT: getCurrentIGT(player),
    }));
  }, [currentPlayer, databaseConnection, ensureDomainLoaded]);

  useEffect(() => { void load(); }, [load, domainRevisions.profiles, domainRevisions.tasks, domainRevisions.matches, domainRevisions.leaderboards, domainRevisions.social]);
  useEffect(() => {
    if ([GAME_STATE.dojo, GAME_STATE.match].includes(gameState)) setView('runtime');
  }, [gameState]);
  useEffect(() => {
    if (gameState !== GAME_STATE.match || activeMatch || !currentPlayer?.UUID) return;
    void queryResumableMobileMatch(databaseConnection, { playerUUID: currentPlayer.UUID })
      .then((match) => {
        if (match) setActiveMatch(match);
      })
      .catch((matchLoadError) => setError(matchLoadError?.message || 'The synced Match could not be resumed.'));
  }, [activeMatch, currentPlayer?.UUID, databaseConnection, gameState, setActiveMatch]);

  const metrics = useMemo(() => ({
    ...competition.metrics,
    coins: Math.floor(Number(currentPlayer?.tokens || 0)),
  }), [competition.metrics, currentPlayer?.tokens]);

  const ranking = RANKING_TYPES[rankingIndex];
  const visibleRanking = ranking.id === 'history' ? [] : competition.neighborhoods[ranking.id] || [];

  const enterDojo = () => {
    setError('');
    setGameState(GAME_STATE.dojo);
    setView('runtime');
  };

  const enterMatch = async () => {
    if (matchmaking) return;
    if (activeMatch && ['pending', 'active'].includes(activeMatch.status)) {
      setGameState(GAME_STATE.match);
      setView('runtime');
      return;
    }
    setMatchmaking(true);
    setError('');
    try {
      await ensureDomainLoaded?.(['matches', 'tasks', 'profiles', 'dailyLifecycle']);
      const resumable = await queryResumableMobileMatch(databaseConnection, {
        playerUUID: currentPlayer.UUID,
      });
      if (resumable) {
        setActiveMatch(resumable);
        setGameState(GAME_STATE.match);
        setView('runtime');
        return;
      }
      const result = await createPairMatchCommand(databaseConnection, currentPlayer, {
        operationId: uuid(),
        profileContextRevision: domainRevisions.profileContext || 0,
      });
      if (result.insufficient) {
        setError(`A new Match needs more match-ready profiles (${result.available || 0} available). A Match started on desktop will appear here after Private Sync.`);
        return;
      }
      setActiveMatch(result.match);
      setGameState(GAME_STATE.match);
      invalidateDomains(DOMAIN_INVALIDATION.matchWrite);
      databaseConnection.syncRuntime?.scheduleSync?.('mobile-match-created');
      setView('runtime');
    } catch (matchError) {
      setError(matchError?.message || 'The Match could not start.');
    } finally {
      setMatchmaking(false);
    }
  };

  if (view === 'runtime' && [GAME_STATE.dojo, GAME_STATE.match].includes(gameState)) {
    return <MobileArenaPage onBack={() => setView('root')} />;
  }
  if (view === 'settings') return <MobileSettingsPage onBack={() => setView('root')} />;

  const cycleRanking = (amount) => setRankingIndex((index) => (index + amount + RANKING_TYPES.length) % RANKING_TYPES.length);
  const endDay = async () => {
    const Modal = await loadEndDayConfirm();
    await NiceModal.show(Modal, { origin: 'mobile' });
  };

  return (
    <section className="mobile-page mobile-more-page">
      <header className="mobile-page-header mobile-more-header">
        <div><span>Daily lobby</span><h1>More</h1></div>
        <div>
          <button type="button" className="mobile-icon-button" aria-label={`Notifications${competition.unreadNotifications ? `, ${competition.unreadNotifications} unread` : ''}`} onClick={() => openSurface('notifications', { onRead: load })}><Icon name="bell" size={18} />{competition.unreadNotifications > 0 && <b>{Math.min(9, competition.unreadNotifications)}</b>}</button>
          <button type="button" className="mobile-icon-button" aria-label="Settings" onClick={() => setView('settings')}><Icon name="settings" size={18} /></button>
          <button type="button" className="mobile-avatar-button" aria-label="Current player summary" onClick={() => openSurface('player-sheet', { currentPlayer, profiles: competition.profiles, metrics })}><ProfileIdentity player={currentPlayer} compact avatarOnly avatarSize={38} /></button>
        </div>
      </header>
      <button type="button" className="mobile-current-player" aria-label="View current player" onClick={() => openSurface('player-sheet', { currentPlayer, profiles: competition.profiles, metrics })}><ProfileIdentity player={currentPlayer} rank="full" avatarSize={58} /><span>View player summary</span></button>
      <div className="mobile-competition-actions"><button type="button" className="primary" onClick={enterDojo}><Icon name="timer" size={20} /><strong>Dojo</strong></button><button type="button" className="primary" onClick={enterMatch} disabled={matchmaking}><Icon name="trophy" size={20} /><strong>{matchmaking ? 'Finding…' : activeMatch && ['pending', 'active'].includes(activeMatch.status) ? 'Resume Match' : 'Match'}</strong></button></div>
      {error && <div className="mobile-page-error" role="alert">{error}</div>}
      <section className="mobile-neighborhood">
        <header><button type="button" aria-label="Previous ranking" onClick={() => cycleRanking(-1)}>‹</button><h2>{ranking.label}</h2><button type="button" aria-label="Next ranking" onClick={() => cycleRanking(1)}>›</button></header>
        {ranking.id === 'history' ? <EloChart data={competition.eloHistory} viewerIGT={getCurrentIGT(currentPlayer)} timeBasis="igt" spans={[["week", "Week"], ["month", "Month"], ["all", "All"]]} seriesLabel={currentPlayer?.username || 'You'} className="mobile-elo-chart" /> : <div className="mobile-neighborhood-rows">{visibleRanking.map(({ profile, value, rank }) => <div key={profile.UUID} className={String(profile.UUID) === String(currentPlayer.UUID) ? 'is-current' : ''}><b>{rank}</b><ProfileIdentity player={profile} compact avatarOnly avatarSize={34} /><span>{profile.username || profile.name}</span><strong>{value}</strong></div>)}</div>}
      </section>
      <button type="button" className="mobile-end-day" onClick={endDay}>End day <span>Save the handoff and rest Tapestry</span></button>
    </section>
  );
}
