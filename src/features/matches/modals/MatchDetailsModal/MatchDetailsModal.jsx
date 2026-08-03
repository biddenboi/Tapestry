import '@features/matches/modals/MatchDetailsModal/MatchDetailsModal.css';
import { useEffect, useMemo, useState } from 'react';
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import { useAppContext } from '@app/hooks/useAppContext.js';
import { getCurrentIGT, UTCStringToLocalDate, UTCStringToLocalTime } from '@domain/time/Time.js';
import { getMatchOutcomeForPlayer, hydrateMatchTeams } from '@domain/matches/Match.js';
import { buildCompetitionRankIdentity } from '@domain/matches/IGT.js';
import {
  getMatchDurationHours,
  isPairMatch,
} from '@domain/matches/MatchContracts.js';
import { getRankClass } from '@domain/rank/Rank.js';
import ProfileIdentity from '@shared/profile-identity/ProfileIdentity.jsx';
import ModalFrame from '@shared/ui/ModalFrame.jsx';
import TimelineList from '@shared/ui/TimelineList.jsx';

const EVENT_LABELS = {
  lead_change: 'Lead change',
  close_match: 'Close match',
  comeback_warning: 'Comeback',
  big_completion: 'Big completion',
  enemy_pending_score: 'Scoring threat',
  team_idle_warning: 'Activity alert',
  mvp_shift: 'MVP shift',
  endgame_pressure: 'Endgame',
};

const toFiniteNumber = (value, fallback = null) => {
  if (value == null || value === '') return fallback;
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
};

const formatSigned = (value) => {
  const number = toFiniteNumber(value);
  return number == null ? 'Pending' : `${number > 0 ? '+' : ''}${number}`;
};

function formatEventTime(event) {
  if (!event) return null;
  const directElapsedMs = toFiniteNumber(event.matchElapsedMs);
  if (directElapsedMs == null || directElapsedMs < 0) return null;
  const totalSeconds = Math.floor(directElapsedMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function TeamBlock({
  title,
  players,
  score,
  isWinner,
  tone,
  onOpenProfile,
  playerScores,
  mvpUUID,
  currentPlayerUUID,
  match,
}) {
  return (
    <div className={`match-detail-team match-detail-team--${tone}${isWinner ? ' match-detail-team--winner' : ''}`}>
      <div className="match-detail-team-head">
        <div>
          <div className="match-detail-team-title">{title}</div>
          {isWinner && <span className="match-detail-team-badge">Winner</span>}
        </div>
        {score != null && <strong className="match-detail-team-score">{score.toLocaleString()} pts</strong>}
      </div>
      <div className="match-detail-team-list">
        {players.map((player, index) => {
          const competitionIdentity = buildCompetitionRankIdentity(match, player);
          const rankClass = getRankClass(competitionIdentity.elo || 0);
          const playerScore = toFiniteNumber(playerScores?.[player.UUID]);
          const isMvp = String(player.UUID) === String(mvpUUID);
          const isCurrentPlayer = String(player.UUID) === String(currentPlayerUUID);
          return (
            <button
              key={player.UUID || `${title}-${index}`}
              className="match-detail-player"
              onClick={() => onOpenProfile?.(player.UUID)}
              disabled={!player.UUID}
            >
              <ProfileIdentity identity={competitionIdentity} avatarSize={42} rank="full" isViewer={isCurrentPlayer} />
              <div className="match-detail-player-copy">
                <span>
                  {isCurrentPlayer && <em>YOU</em>}
                  {isMvp && <em className="is-mvp">MVP</em>}
                </span>
                <small>
                  <span className={`match-detail-player-rank rank-${rankClass}`}>
                    {player.isGenerated ? 'Deterministic Fellow · rank at match start' : 'Rank at match start'}
                  </span>
                  {playerScore != null && <span>{playerScore.toLocaleString()} pts</span>}
                </small>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default NiceModal.create(({ match, currentPlayerUUID, onOpenProfile }) => {
  const modal = useModal();
  const { databaseConnection, currentPlayer } = useAppContext();
  const [players, setPlayers] = useState([]);
  const [replayedMatch, setReplayedMatch] = useState(null);
  const viewerUUID = currentPlayerUUID || currentPlayer?.UUID;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const viewerIGT = getCurrentIGT(currentPlayer);
      const [all, visibleMatches] = await Promise.all([
        databaseConnection.getPlayersAtIGT(viewerIGT),
        viewerUUID
          ? databaseConnection.getVisibleMatchesForPlayer(viewerUUID, viewerIGT)
          : Promise.resolve([]),
      ]);
      if (cancelled) return;
      setPlayers(all);
      setReplayedMatch(
        visibleMatches.find((candidate) => String(candidate.UUID) === String(match?.UUID))
        || null
      );
    })();
    return () => { cancelled = true; };
  }, [
    databaseConnection,
    match?.UUID,
    viewerUUID,
    currentPlayer?.createdAt,
  ]);

  const playersByUUID = useMemo(
    () => Object.fromEntries((players || []).map((player) => [player.UUID, player])),
    [players]
  );

  const hydrated = useMemo(() => {
    const source = replayedMatch || match;
    return source ? hydrateMatchTeams(source, playersByUUID) : null;
  }, [match, replayedMatch, playersByUUID]);

  const handleOpenProfile = (playerUUID) => {
    modal.hide();
    modal.remove();
    onOpenProfile?.(playerUUID);
  };

  const close = () => {
    modal.hide();
    modal.remove();
  };

  if (!modal.visible || !hydrated) return null;

  const result = hydrated.result || {};
  const highlights = result.highlights || null;
  const team1 = hydrated.teams?.[0] || [];
  const team2 = hydrated.teams?.[1] || [];
  const allMatchPlayers = [...team1, ...team2];
  const viewerOutcome = getMatchOutcomeForPlayer(hydrated, viewerUUID);
  const myTeamIdx = viewerOutcome.playerTeamIdx;
  const winnerTeamIdx = viewerOutcome.winnerTeamIdx;
  const didWin = viewerOutcome.won;
  const forfeitedByCurrentPlayer = viewerOutcome.forfeited;
  const outcome = viewerOutcome.status === 'live'
    ? 'In progress'
    : viewerOutcome.status === 'pending'
      ? 'Pending'
      : viewerOutcome.status === 'forfeit'
        ? 'Forfeit'
        : didWin ? 'Victory' : 'Defeat';
  const outcomeTone = ['live', 'pending'].includes(viewerOutcome.status)
    ? 'pending'
    : didWin ? 'victory' : 'defeat';
  const myTeamScore = viewerOutcome.playerScore;
  const oppTeamScore = viewerOutcome.opponentScore;
  const scoreMargin = viewerOutcome.margin;
  const myTeamWon = didWin;

  const playerEloResult = result.playerEloChanges?.[viewerUUID] || null;
  const eloChange = toFiniteNumber(playerEloResult?.change, toFiniteNumber(result.eloChange));
  const oldElo = toFiniteNumber(playerEloResult?.oldElo, toFiniteNumber(result.oldElo));
  const newElo = toFiniteNumber(playerEloResult?.newElo, toFiniteNumber(result.newElo));
  const eloBreakdown = playerEloResult?.breakdown || result.eloBreakdown || [];

  const mvpUUID = highlights?.mvpUUID || null;
  const mvp = allMatchPlayers.find((player) => String(player.UUID) === String(mvpUUID));
  const currentPlayerScore = toFiniteNumber(
    result.playerScores?.[viewerUUID],
    String(hydrated.parent) === String(viewerUUID)
      ? toFiniteNumber(highlights?.currentPlayerScore)
      : null
  );
  const biggestCompletion = highlights?.biggestCompletion || null;
  const biggestPlayer = allMatchPlayers.find((player) => (
    String(player.UUID) === String(biggestCompletion?.playerUUID)
  ));
  const recordedEventHistory = Array.isArray(result.postMatchInput?.eventHistory)
    ? result.postMatchInput.eventHistory
    : [];
  const notableEvents = (recordedEventHistory.length > 0
    ? recordedEventHistory
    : Array.isArray(highlights?.notableEvents) ? highlights.notableEvents : []
  )
    .filter((event) => event?.message)
    .sort((a, b) => {
      const aElapsed = toFiniteNumber(a?.matchElapsedMs);
      const bElapsed = toFiniteNumber(b?.matchElapsedMs);
      if (aElapsed == null && bElapsed == null) return 0;
      if (aElapsed == null) return 1;
      if (bElapsed == null) return -1;
      return bElapsed - aElapsed;
    })
    .slice(0, 20);

  const resultCaption = ['live', 'pending'].includes(viewerOutcome.status)
    ? 'Awaiting final scores'
    : forfeitedByCurrentPlayer
      ? 'Forfeit recorded'
      : didWin ? 'Rating secured' : 'Review the breakdown';
  const pairMatch = isPairMatch(hydrated);
  const ratingExplanation = result.ratingExplanation || null;

  const getEventContext = (event) => {
    const player = allMatchPlayers.find((candidate) => (
      String(candidate.UUID) === String(event?.playerUUID)
    ));
    const teamLabel = event?.teamIdx == null
      ? null
      : event.teamIdx === myTeamIdx ? 'Your team' : 'Opposition';
    return [player?.username, teamLabel].filter(Boolean).join(' · ');
  };

  return (
    <ModalFrame
      onClose={close}
      title={outcome}
      subtitle={resultCaption}
      eyebrow="Match report"
      size="xl"
      accent="var(--color-match)"
      className="match-detail-card"
    >
      <div className="detail-body match-detail-body">
          <div className={`match-detail-summary match-detail-summary--${outcomeTone}`}>
            <div className="match-detail-summary-copy">
              <span className="match-detail-summary-k">{resultCaption}</span>
              <div className="match-detail-scoreline">
                <strong>{myTeamScore?.toLocaleString() ?? '--'}</strong>
                <span>vs</span>
                <strong>{oppTeamScore?.toLocaleString() ?? '--'}</strong>
              </div>
              <div className="match-detail-score-labels">
                <span>Your team</span>
                <span>Opposition</span>
              </div>
            </div>
            <div className="match-detail-rating">
              <span className="match-detail-rating-k">ELO</span>
              <strong className={eloChange > 0 ? 'is-positive' : eloChange < 0 ? 'is-negative' : ''}>
                {formatSigned(eloChange)}
              </strong>
              {oldElo != null && newElo != null && (
                <small>{oldElo.toLocaleString()} → {newElo.toLocaleString()}</small>
              )}
            </div>
          </div>

          <div className="detail-grid match-detail-stats">
            <div><span className="detail-k">Started</span><strong>{UTCStringToLocalDate(hydrated.createdAt)} {UTCStringToLocalTime(hydrated.createdAt)}</strong></div>
            <div><span className="detail-k">Duration</span><strong>{getMatchDurationHours(hydrated)}h</strong></div>
            <div>
              <span className="detail-k">Rules</span>
              <strong>{pairMatch ? 'Pair Match · fixed' : 'Legacy contract'}</strong>
            </div>
            {scoreMargin != null && <div><span className="detail-k">Margin</span><strong>{scoreMargin.toLocaleString()} pts</strong></div>}
            {result.wasForfeited && (
              <div>
                <span className="detail-k">Forfeit</span>
                <strong>{forfeitedByCurrentPlayer ? 'Your team' : 'Opposition'}</strong>
              </div>
            )}
          </div>

          {highlights && (
            <section className="match-detail-section">
              <div className="match-detail-section-title">MATCH HIGHLIGHTS</div>
              <div className="match-detail-highlight-grid">
                <div className="match-detail-highlight">
                  <span>MVP</span>
                  <strong>{mvp?.username || 'Unknown'}</strong>
                  <small>{toFiniteNumber(highlights.mvpScore, 0).toLocaleString()} pts</small>
                </div>
                <div className="match-detail-highlight">
                  <span>Your contribution</span>
                  <strong>{toFiniteNumber(currentPlayerScore, 0).toLocaleString()} pts</strong>
                  <small>Final recorded score</small>
                </div>
                <div className="match-detail-highlight">
                  <span>Biggest completion</span>
                  <strong>
                    {toFiniteNumber(biggestCompletion?.points) == null
                      ? 'None recorded'
                      : `+${Math.round(biggestCompletion.points).toLocaleString()}`}
                  </strong>
                  <small>
                    {biggestCompletion
                      ? `${biggestPlayer?.username || biggestCompletion.playerName || 'Unknown'} · ${biggestCompletion.taskName || 'Task'}`
                      : 'No structured completion data'}
                  </small>
                </div>
                <div className="match-detail-highlight">
                  <span>Lead changes</span>
                  <strong>{toFiniteNumber(highlights.leadChanges, 0)}</strong>
                  <small>{highlights.leadChanges ? 'Momentum changed hands' : 'Leader stayed stable'}</small>
                </div>
              </div>
            </section>
          )}

          {(oldElo != null || newElo != null || eloBreakdown.length > 0) && (
            <section className="match-detail-section">
              <div className="match-detail-section-title">ELO BREAKDOWN</div>
              <div className="match-detail-elo-panel">
                <div className="match-detail-elo-transition">
                  <div>
                    <small>Before</small>
                    <strong>{oldElo?.toLocaleString() ?? '--'}</strong>
                  </div>
                  <span aria-hidden="true">→</span>
                  <div>
                    <small>After</small>
                    <strong>{newElo?.toLocaleString() ?? '--'}</strong>
                  </div>
                  <div className={`match-detail-elo-delta ${eloChange > 0 ? 'is-positive' : eloChange < 0 ? 'is-negative' : ''}`}>
                    <small>Change</small>
                    <strong>{formatSigned(eloChange)}</strong>
                  </div>
                </div>
                {eloBreakdown.length > 0 && (
                  <div className="match-detail-elo-breakdown">
                    {eloBreakdown.map((item, index) => (
                      <div key={`${item.label}-${index}`}>
                        <span>{item.label}</span>
                        <strong className={item.value > 0 ? 'is-positive' : item.value < 0 ? 'is-negative' : ''}>
                          {formatSigned(item.value)}
                        </strong>
                      </div>
                    ))}
                  </div>
                )}
                {pairMatch && ratingExplanation && (
                  <p className="match-detail-rating-policy">
                    Rating used team averages of
                    {' '}{Math.round(ratingExplanation.teamAverageRatings?.[0] || 0)}
                    {' '}and {Math.round(ratingExplanation.teamAverageRatings?.[1] || 0)} ELO.
                    Both teammates received the same base delta; individual point share did not alter it.
                  </p>
                )}
              </div>
            </section>
          )}

          <div className="match-detail-teams">
            <TeamBlock
              title="Your Team"
              players={hydrated.teams?.[viewerOutcome.playerTeamIdx] || []}
              score={myTeamScore}
              isWinner={myTeamWon}
              tone="mine"
              onOpenProfile={handleOpenProfile}
              playerScores={result.playerScores}
              mvpUUID={mvpUUID}
              currentPlayerUUID={viewerUUID}
              match={hydrated}
            />
            <TeamBlock
              title="Opposition"
              players={hydrated.teams?.[viewerOutcome.opponentTeamIdx] || []}
              score={oppTeamScore}
              isWinner={winnerTeamIdx != null && !myTeamWon}
              tone="opposition"
              onOpenProfile={handleOpenProfile}
              playerScores={result.playerScores}
              mvpUUID={mvpUUID}
              currentPlayerUUID={viewerUUID}
              match={hydrated}
            />
          </div>

          {notableEvents.length > 0 && (
            <section className="match-detail-section">
              <div className="match-detail-section-title">Match timeline</div>
              <TimelineList
                className="match-detail-events"
                items={notableEvents.map((event, index) => ({
                  id: event.id || `${event.type}-${event.matchElapsedMs}-${index}`,
                  time: formatEventTime(event) || 'Time not recorded',
                  title: EVENT_LABELS[event.type] || 'Match update',
                  description: event.message,
                  meta: getEventContext(event),
                  color: event.severity === 'critical'
                    ? 'var(--color-danger)'
                    : event.severity === 'warning'
                      ? 'var(--color-warning)'
                      : event.severity === 'success'
                        ? 'var(--color-success)'
                        : 'var(--color-match)',
                }))}
              />
            </section>
          )}
      </div>
    </ModalFrame>
  );
});
