import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import NiceModal from '@ebay/nice-modal-react';
import { useAppContext } from '@app/hooks/useAppContext.js';
import { DOMAIN_INVALIDATION } from '@app/context/domainRevisions.js';
import {
  GAME_STATE,
  MATCH_STATUS,
  THEME_ACCENT_COLORS,
} from '@domain/constants.js';
import { loadTaskCreationMenu, showTaskPreviewMenu } from '@features/tasks/loaders.js';
import ProfileIdentity from '@shared/profile-identity/ProfileIdentity.jsx';
import PlayerTitle from '@shared/player-title/PlayerTitle.jsx';
import {
  getMatchDurationMs,
  getMatchTeams,
  isPairMatch,
} from '@domain/matches/MatchContracts.js';
import { buildInMemoryMatchScores, loadMatchRuntimeInput } from '@domain/matches/MatchRuntime.js';
import { completeMatchPrimary } from '@domain/matches/MatchCompletionService.js';
import { getPlayerScoutingLabel } from '@domain/matches/MatchActivity.js';
import { buildMatchSnapshot } from '@domain/matches/MatchState.js';
import { deriveMatchEvents } from '@domain/matches/MatchDirector.js';
import { launchRecommendedTask } from '@domain/tasks/TaskRecommender.js';
import { timeAsHHMMSS } from '@domain/time/Time.js';
import { createTaskDraft } from '@domain/tasks/Tasks.js';
import { getRank, getRankLabel, getRankGroupIndex } from '@domain/rank/Rank.js';
import { getAchievementByKey } from '@domain/achievements/Achievements.js';
import AchievementBadge from '@features/achievements/components/AchievementBadge/AchievementBadge.jsx';
import { RankIcon } from '@shared/icons/RankIcon.jsx';
import { useResourceUrl } from '@shared/resource-image/ResourceImage.jsx';
import MatchEventFeed from '@features/matches/components/MatchArena/MatchEventFeed.jsx';
import MatchStatusPanel from '@features/matches/components/MatchArena/MatchStatusPanel.jsx';
import PlayerActivityBadge from '@features/matches/components/MatchArena/PlayerActivityBadge.jsx';
import ConfirmDialog from '@shared/ui/ConfirmDialog.jsx';
import { useInterval } from '@shared/hooks/useInterval.js';
import LocalSectionNav from '@shared/navigation/LocalSectionNav/LocalSectionNav.jsx';
import { cosmeticPresentationStyle } from '@domain/cosmetics/CosmeticCatalog.js';
import { useLocalSectionRoute } from '@shared/navigation/LocalSectionNav/LocalSectionRouteState.js';
import { useTaskSession } from '@features/tasks/context/TaskSessionProvider.jsx';
import { patchMatchStateCommand } from '@domain/matches/MatchSyncCommands.js';
import '@features/matches/components/MatchArena/MatchArena.css';

const MATCH_PAGES = Object.freeze([
  { id: 'arena', label: 'Arena', icon: 'match', description: 'Watch the complete live arena, score pressure, and activity feed.' },
  { id: 'current', label: 'Simple View', icon: 'tasks', description: 'Keep the live score and your next work action in a quieter view.' },
]);

/* ── Timer hook ──────────────────────────────────────────── */
function useMatchTimer(match) {
  const [remaining, setRemaining] = useState(null);
  const [elapsed, setElapsed]     = useState(0);

  const tick = useCallback(() => {
    if (!match) {
      setRemaining(null);
      setElapsed(0);
      return;
    }
    const startMs = new Date(match.lockedAt || match.createdAt).getTime();
    const durationMs = getMatchDurationMs(match);
    const endMs = startMs + durationMs;
    const now = Date.now();
    if (match.status !== MATCH_STATUS.active || !match.lockedAt) {
      setRemaining(durationMs);
      setElapsed(0);
      return;
    }
    setRemaining(Math.max(0, endMs - now));
    setElapsed(Math.max(0, Math.min(now - startMs, durationMs)));
  }, [match]);

  useEffect(() => {
    tick();
  }, [tick]);
  useInterval(tick, match?.status === MATCH_STATUS.active ? 1000 : null);

  return { remaining, elapsed };
}

/* ── Banner style helper ─────────────────────────────────── */
function getBannerStyle(cardBanner) {
  if (!cardBanner) return null;
  if (cardBanner.type === 'gradient') return { background: cardBanner.value };
  if (cardBanner.type === 'color')    return { background: cardBanner.value };
  if (cardBanner.type === 'image' && cardBanner.value) return { backgroundImage: `url(${cardBanner.value})`, backgroundSize: 'cover', backgroundPosition: 'center' };
  return null;
}

/* ── Rank tier: drives visual intensity ──────────────────── */
const RANK_TIERS = {
  Radiant: 'apex', Immortal: 'elite', Ascendant: 'high',
  Diamond: 'mid', Platinum: 'mid', Gold: 'low', Silver: 'low',
};
const getRankTier = (elo = 0) => RANK_TIERS[getRank(elo).group] || 'base';
const ACTIVE_NODE_STATUSES = new Set(['active', 'deep_focus', 'charging']);

/* ── Animated ELO counter ────────────────────────────────── */
function AnimatedElo({ from, to, duration = 1800 }) {
  const [display, setDisplay] = useState(from);
  useEffect(() => {
    const start = performance.now();
    const diff  = to - from;
    const frame = (now) => {
      const t    = Math.min(1, (now - start) / duration);
      const ease = 1 - Math.pow(1 - t, 3); // ease-out cubic
      setDisplay(Math.round(from + diff * ease));
      if (t < 1) requestAnimationFrame(frame);
    };
    const id = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(id);
  }, [from, to, duration]);
  return <>{display.toLocaleString()}</>;
}

/* ── Match End Screen overlay ────────────────────────────── */
function MatchEndScreen({ match, currentPlayer, onReturn }) {
  const result   = match.result || {};
  const team1    = getMatchTeams(match)?.[0] || [];
  const team2    = getMatchTeams(match)?.[1] || [];
  // Use String coercion to match concludeMatch logic
  const myOnT1   = team1.some(p => String(p.UUID) === String(currentPlayer?.UUID));
  // Derive outcome from stored value; if undefined/null fall back to score comparison
  const myTeamScoreRaw  = myOnT1 ? result.team1Total : result.team2Total;
  const oppTeamScoreRaw = myOnT1 ? result.team2Total : result.team1Total;
  const iWon     = result.iWon ?? (myTeamScoreRaw >= oppTeamScoreRaw);
  const myTeam       = myOnT1 ? team1 : team2;
  const oppTeam      = myOnT1 ? team2 : team1;
  const viewerSnapshot = [...team1, ...team2].find((player) => (
    String(player.UUID) === String(currentPlayer?.UUID)
  )) || null;
  const myTeamScore  = myTeamScoreRaw;
  const oppTeamScore = oppTeamScoreRaw;

  const viewerEloChange = result.playerEloChanges?.[String(currentPlayer?.UUID || '')] || null;
  const oldElo   = Number(viewerEloChange?.oldElo ?? result.oldElo ?? (Number(currentPlayer?.elo || 0) - Number(result.eloChange || 0)));
  const newElo   = Number(viewerEloChange?.newElo ?? result.newElo ?? (oldElo + Number(viewerEloChange?.change ?? result.eloChange ?? 0)));
  const breakdown = viewerEloChange?.breakdown || result.eloBreakdown || [];
  const highlights = result.highlights?.cards || [];
  const matchScoreBreakdowns = result.matchScoreBreakdowns || [];

  const rankBefore = getRank(oldElo);
  const rankAfter  = getRank(newElo);
  const rankedUp   = rankAfter.minElo > rankBefore.minElo;
  const rankColor  = rankAfter.color;

  return (
    <div className={`end-screen ${iWon ? 'end-screen-win' : 'end-screen-loss'}`}>
      <div className="end-screen-scanlines" aria-hidden="true" />
      <div className="end-screen-content">

        {/* Outcome banner */}
        <div className={`end-outcome-banner ${iWon ? 'eob-win' : 'eob-loss'}`}>
          <span className="eob-icon">{iWon ? '▲' : '▼'}</span>
          <span className="eob-label">
            {iWon ? 'VICTORY' : (result.wasForfeited ? 'FORFEIT' : 'DEFEAT')}
          </span>
        </div>

        {/* Team score breakdown */}
        <div className="end-score-vs">
          <div className="esv-side esv-mine">
            <div className="esv-team-label">YOUR TEAM</div>
            <div className="esv-score">{(myTeamScore || 0).toLocaleString()}</div>
            <div className="esv-players">
              {myTeam.map(p => (
                <span key={p.UUID} className={`esv-player ${p.UUID === currentPlayer?.UUID ? 'esv-player-you' : ''}`}>
                  {p.username || 'Unknown'}
                </span>
              ))}
            </div>
          </div>

          <div className={`esv-vs-circle ${iWon ? 'esv-circle-win' : 'esv-circle-loss'}`}>VS</div>

          <div className="esv-side esv-opp">
            <div className="esv-team-label">OPPOSITION</div>
            <div className="esv-score esv-score-opp">{(oppTeamScore || 0).toLocaleString()}</div>
            <div className="esv-players">
              {oppTeam.map(p => (
                <span key={p.UUID} className="esv-player">{p.username || 'Unknown'}</span>
              ))}
            </div>
          </div>
        </div>

        {highlights.length > 0 && (
          <div className="end-highlights">
            {highlights.slice(0, 5).map((item) => (
              <div key={`${item.type}-${item.label}`} className={`end-highlight end-highlight-${item.type}`}>
                <span className="eh-label">{item.label}</span>
                <strong className="eh-value">{item.value}</strong>
                {item.detail && <span className="eh-detail">{item.detail}</span>}
              </div>
            ))}
          </div>
        )}

        {matchScoreBreakdowns.length > 0 && (
          <section className="end-match-score-breakdown" aria-label="Match score ledger">
            <header>
              <span>MATCH SCORE LEDGER</span>
              <strong>{matchScoreBreakdowns.reduce((sum, item) => sum + Number(item.points || 0), 0).toLocaleString()} pts</strong>
            </header>
            {matchScoreBreakdowns.map((item) => (
              <div key={item.scoreEventUUID || item.actionSessionUUID}>
                <span>{Math.floor(Number(item.eligibleActiveMs || 0) / 60000).toLocaleString()}m active</span>
                <strong>{Number(item.points || 0).toLocaleString()} pts</strong>
                <small>
                  {Number(item.promisedMs || 0) <= 0
                    ? 'No duration promise'
                    : item.promiseMet ? 'Promise honored' : 'Promise missed · no duration bonus'}
                </small>
              </div>
            ))}
          </section>
        )}

        {/* Player ELO card */}
        <div
          className={`end-player-card rank-tier-${getRankTier(newElo)}`}
          data-cosmetic-match-card={viewerSnapshot?.matchCard || 'default'}
          style={{
            ...cosmeticPresentationStyle('matchCard', viewerSnapshot?.matchCard || 'default'),
            '--rank-color': rankColor,
          }}
        >
          <div className="epc-avatar-frame">
            <ProfileIdentity
              identity={viewerSnapshot}
              avatarOnly
              avatarSize={72}
              isViewer
              snapshotAt={match.createdAt}
            />
            <div className="epc-rank-icon"><RankIcon group={rankAfter.group} sub={rankAfter.sub} size={22} /></div>
          </div>

          <div className="epc-body">
            <div className="epc-username" style={{ color: rankColor, textShadow: `0 0 24px ${rankColor}99` }}>
              {viewerSnapshot?.username || 'Unknown'}
            </div>
            <PlayerTitle player={viewerSnapshot} compact className="epc-title" />

            {rankedUp && (
              <div className="epc-rankup">
                ✦ RANK UP — {rankAfter.group.toUpperCase()}{rankAfter.sub ? ` ${rankAfter.sub}` : ''}
              </div>
            )}

            <div className="epc-elo-transition">
              <span className="epc-elo-old">{oldElo.toLocaleString()}</span>
              <span className="epc-elo-arrow">→</span>
              <span className="epc-elo-new" style={{ color: rankColor }}>
                <AnimatedElo from={oldElo} to={newElo} />
              </span>
            </div>

            <div className="epc-breakdown">
              {breakdown.map((item, i) => (
                <div
                  key={i}
                  className={`epc-bd-row ${item.value >= 0 ? 'bd-positive' : 'bd-negative'}`}
                  style={{ animationDelay: `${0.35 + i * 0.08}s` }}
                >
                  <span className="bd-value">{item.value > 0 ? '+' : ''}{item.value}</span>
                  <span className="bd-label">{item.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <button className="primary end-return-btn" onClick={onReturn}>
          RETURN TO LOBBY →
        </button>
      </div>
    </div>
  );
}

/* ── Player node ─────────────────────────────────────────── */
function ArenaPlayerNode({ player, score, isCurrentPlayer, isActive, side, activity }) {
  const rank       = getRank(player.elo || 0);
  const rankTier   = getRankTier(player.elo || 0);
  const accentColor = THEME_ACCENT_COLORS[player.playerTheme || 'minimalist'] || '#4f8cff';
  const bannerUrl = useResourceUrl(player.cardBanner?.type === 'image' ? player.cardBanner.value : null);
  const bannerStyle = getBannerStyle(player.cardBanner?.type === 'image'
    ? { ...player.cardBanner, value: bannerUrl }
    : player.cardBanner);
  const nodeActive = isActive || ACTIVE_NODE_STATUSES.has(activity?.status);
  const matchCardId = player.matchCard || 'default';

  // Outer glow scales with rank tier
  const glowAlpha = { base: 0, low: 0.18, mid: 0.35, high: 0.55, elite: 0.72, apex: 0.9 }[rankTier];
  const cardGlow  = glowAlpha > 0
    ? `0 0 ${8 + glowAlpha * 22}px ${rank.glow}`
    : undefined;
  const badges = (player.selectedAchievementsV2?.length
    ? player.selectedAchievementsV2
    : player.selectedAchievements || []).filter(Boolean);

  return (
    <div
      className={`apn apn-${side} rank-tier-${rankTier} ${isCurrentPlayer ? 'apn-self' : ''} ${nodeActive ? 'apn-active' : ''}`}
      data-cosmetic-match-card={matchCardId}
      style={{
        ...cosmeticPresentationStyle('matchCard', matchCardId),
        '--apn-accent': accentColor,
        '--rank-color': rank.color,
        '--rank-glow':  rank.glow,
        ...(cardGlow ? { boxShadow: cardGlow } : {}),
        ...(bannerStyle || {}),
      }}
    >
      {bannerStyle && <div className="apn-banner-overlay" />}
      <div className="apn-avatar-wrap">
        <ProfileIdentity identity={player} avatarOnly avatarSize={48} isViewer={isCurrentPlayer} />
        {nodeActive && <div className="apn-pulse-ring" />}
      </div>
      <div className="apn-info">
        <div className="apn-identity-row">
          <div className="apn-identity">
            <div className="apn-name-row">
              <span className="apn-rank-mark" title={rank.group}>
                <RankIcon group={rank.group} sub={rank.sub} size={17} />
              </span>
              <span
                className="apn-name"
                style={{
                  color: rank.color,
                  textShadow: glowAlpha > 0.3 ? `0 0 10px ${rank.glow}` : undefined,
                }}
              >
                {player.username || 'Unknown'}
              </span>
              {isCurrentPlayer && <span className="apn-tag apn-tag-you">YOU</span>}
              {player.isGenerated && <span className="apn-tag apn-tag-ghost">GHOST</span>}
            </div>
            <PlayerTitle player={player} compact className="apn-title" />
          </div>
          {badges.length > 0 && (
            <div className={`apn-achievements apn-achievements--${side}`}>
              {badges.map((key) => (
                <AchievementBadge
                  key={key}
                  achievementKey={key}
                  size={18}
                  showTooltip={false}
                />
              ))}
            </div>
          )}
        </div>
        <div className="apn-score">{score.toLocaleString()} <span className="apn-pts">pts</span></div>
        <PlayerActivityBadge activity={activity} />
      </div>
    </div>
  );
}

/* ── SVG connector lines ─────────────────────────────────── */
function ArenaConnector({ team1Pct }) {
  const W = 1000, H = 520;
  const leftX = 230, rightX = 770, centerX = 500, centerY = 260;
  const playerYs  = [90, 260, 430];
  const myOpacity  = Math.max(0.2, team1Pct / 100);
  const oppOpacity = Math.max(0.2, (100 - team1Pct) / 100);

  return (
    <svg className="arena-connector-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      <defs>
        {playerYs.map((y, i) => (
          <linearGradient key={`gl${i}`} id={`gl${i}`} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#4da3ff" stopOpacity={myOpacity} />
            <stop offset="100%" stopColor="#4da3ff" stopOpacity={myOpacity * 0.15} />
          </linearGradient>
        ))}
        {playerYs.map((y, i) => (
          <linearGradient key={`gr${i}`} id={`gr${i}`} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#ff3d57" stopOpacity={oppOpacity * 0.15} />
            <stop offset="100%" stopColor="#ff3d57" stopOpacity={oppOpacity} />
          </linearGradient>
        ))}
      </defs>
      {playerYs.map((y, i) => (
        <line key={`l${i}`} x1={leftX} y1={y} x2={centerX} y2={centerY} stroke={`url(#gl${i})`} strokeWidth="1.5" />
      ))}
      {playerYs.map((y, i) => (
        <line key={`r${i}`} x1={centerX} y1={centerY} x2={rightX} y2={y} stroke={`url(#gr${i})`} strokeWidth="1.5" />
      ))}
      <polygon
        points={`${centerX},${centerY-52} ${centerX+52},${centerY} ${centerX},${centerY+52} ${centerX-52},${centerY}`}
        fill="none" stroke="rgba(77,163,255,0.2)" strokeWidth="1"
      />
    </svg>
  );
}

function VsPlayerCard({ player, side, currentPlayerUUID }) {
  const rank = getRank(player.elo || 0);
  const rankTier = getRankTier(player.elo || 0);
  const isMe = String(player.UUID) === String(currentPlayerUUID);
  const accentColor = THEME_ACCENT_COLORS[player.playerTheme || 'minimalist'] || '#4f8cff';
  const bannerUrl = useResourceUrl(player.cardBanner?.type === 'image' ? player.cardBanner.value : null);
  const bannerStyle = getBannerStyle(player.cardBanner?.type === 'image'
    ? { ...player.cardBanner, value: bannerUrl }
    : player.cardBanner);
  const badges = (player.selectedAchievementsV2?.length
    ? player.selectedAchievementsV2
    : player.selectedAchievements || []).filter(Boolean);
  const scoutingLabel = getPlayerScoutingLabel(player);
  const glowAlpha = { base: 0, low: 0.18, mid: 0.35, high: 0.55, elite: 0.72, apex: 0.9 }[rankTier];
  const matchCardId = player.matchCard || 'default';

  return (
    <div
      className={`vs-player vs-player--${side} rank-tier-${rankTier}${isMe ? ' vs-player--self' : ''}`}
      data-cosmetic-match-card={matchCardId}
      style={{
        ...cosmeticPresentationStyle('matchCard', matchCardId),
        '--apn-accent': accentColor,
        '--rank-color': rank.color,
        '--rank-glow': rank.glow,
        ...(bannerStyle || {}),
      }}
    >
      {bannerStyle && <div className="vs-player-banner-overlay" />}
      <div className="vs-player-avatar">
        <ProfileIdentity identity={player} avatarOnly avatarSize={56} isViewer={isMe} />
      </div>
      <div className="vs-player-info">
        <div className="vs-player-identity-row">
          <div className="vs-player-identity">
            <div className="vs-player-name-row">
              <span className="vs-player-rank-mark" title={rank.group}>
                <RankIcon group={rank.group} sub={rank.sub} size={17} />
              </span>
              <span
                className="vs-player-name"
                style={{
                  color: rank.color,
                  textShadow: glowAlpha > 0.3 ? `0 0 10px ${rank.glow}` : undefined,
                }}
              >
                {player.username || 'Unknown'}
              </span>
              {isMe && <span className="vs-player-tag">YOU</span>}
            </div>
            <PlayerTitle player={player} compact className="vs-player-title" />
          </div>
          {badges.length > 0 && (
            <div className={`vs-player-achievements vs-player-achievements--${side}`}>
              {badges.map((key) => (
                <AchievementBadge key={key} achievementKey={key} size={16} showTooltip={false} />
              ))}
            </div>
          )}
        </div>
        <div className="vs-player-scout">{scoutingLabel}</div>
      </div>
    </div>
  );
}

/* ── Center score diamond ─────────────────────────────────── */
function CenterNode({ team1Total, team2Total, myOnTeam1 }) {
  const grand   = team1Total + team2Total;
  const myTotal = myOnTeam1 ? team1Total : team2Total;
  const myPct   = grand > 0 ? Math.round(myTotal / grand * 100) : 50;
  const isLeading = myPct > 50;

  return (
    <div className="arena-center-node">
      <div className={`acn-pct ${isLeading ? 'acn-lead' : 'acn-trail'}`}>
        {myPct}<span className="acn-pct-sym">%</span>
      </div>
      <div className="acn-label">{isLeading ? 'in the lead' : 'behind'}</div>
      <div className="acn-bar">
        <div className="acn-bar-blue" style={{ width: `${myPct}%` }} />
        <div className="acn-bar-red" />
      </div>
      <div className="acn-score-split">
        <span className="acn-team-score acn-mine">{myTotal.toLocaleString()}</span>
        <span className="acn-vs">vs</span>
        <span className="acn-team-score acn-opp">{(grand - myTotal).toLocaleString()}</span>
      </div>
    </div>
  );
}

function matchContextSummary(player) {
  return player?.matchContext?.chapter?.text
    || player?.matchContext?.capsule?.[0]?.text
    || null;
}

/* ── Fixed Pair Match reveal and readiness ───────────────── */
function PairMatchStaging({
  match,
  currentPlayer,
  busy,
  onContinue,
  onReady,
  onLeave,
}) {
  const team1   = getMatchTeams(match)?.[0] || [];
  const team2   = getMatchTeams(match)?.[1] || [];
  const myOnT1  = team1.some((p) => String(p.UUID) === String(currentPlayer?.UUID));
  const myTeam  = myOnT1 ? team1 : team2;
  const oppTeam = myOnT1 ? team2 : team1;
  const readyPhase = match.phase === 'ready';
  const teamAverage = (team) => Math.round(
    team.reduce((sum, player) => sum + Number(player.elo || 0), 0) / Math.max(1, team.length),
  );
  const teammate = myTeam.find((player) => String(player.UUID) !== String(currentPlayer?.UUID));
  const teammateContext = matchContextSummary(teammate);

  return (
    <div className="vs-screen pair-match-staging">
      <div className="vs-screen-scanlines" aria-hidden="true" />
      <div className="vs-content">
        <div className="vs-team vs-team--left">
          <div className="vs-team-label">Your Team · avg {teamAverage(myTeam)} ELO</div>
          {myTeam.map((player) => (
            <VsPlayerCard key={player.UUID} player={player} side="left" currentPlayerUUID={currentPlayer?.UUID} />
          ))}
        </div>
        <div className="vs-centre">
          <div className="vs-badge">VS</div>
          <div className="vs-match-badge">PAIR · 60M</div>
        </div>
        <div className="vs-team vs-team--right">
          <div className="vs-team-label">Opposition · avg {teamAverage(oppTeam)} ELO</div>
          {oppTeam.map((player) => (
            <VsPlayerCard key={player.UUID} player={player} side="right" currentPlayerUUID={currentPlayer?.UUID} />
          ))}
        </div>
      </div>
      <div className="pair-staging-contract">
        <span>{readyPhase ? 'READY CHECK' : 'TEAM REVEAL'}</span>
        <strong>2v2 · 60 minutes · rated · live scores</strong>
        {teammate && teammateContext && (
          <p className="pair-staging-context">
            <b>{teammate.username || 'Teammate'}:</b> {teammateContext}
          </p>
        )}
        <div className="pair-staging-actions">
          <button type="button" onClick={onLeave} disabled={busy}>Leave queue</button>
          <button
            type="button"
            className="primary"
            onClick={readyPhase ? onReady : onContinue}
            disabled={busy}
          >
            {busy ? 'Saving…' : readyPhase ? 'Ready · lock match' : 'Continue to ready check'}
          </button>
        </div>
      </div>
    </div>
  );
}

function PairMatchDock({
  match,
  currentPlayer,
  scores,
  snapshot,
  remaining,
  inTask,
  currentTaskName,
  startingNext,
  onStartNext,
  onAddTask,
  onOpenQueue,
  onForfeit,
}) {
  const teams = getMatchTeams(match);
  const myTeamIndex = teams.findIndex((team) => team.some((player) => (
    String(player.UUID) === String(currentPlayer?.UUID)
  )));
  const myTeam = teams[myTeamIndex] || [];
  const opponents = teams[myTeamIndex === 0 ? 1 : 0] || [];
  const teamTotal = (team) => team.reduce((sum, player) => sum + Number(scores[player.UUID] || 0), 0);
  const teammate = myTeam.find((player) => String(player.UUID) !== String(currentPlayer?.UUID));
  const teammateContext = matchContextSummary(teammate);
  const renderTeam = (label, team, tone) => (
    <section className="pair-dock-team" data-tone={tone}>
      <header><span>{label}</span><strong>{teamTotal(team).toLocaleString()}</strong></header>
      {team.map((player) => (
        <div className="pair-dock-player" key={player.UUID}>
          <ProfileIdentity
            identity={player}
            compact
            avatarSize={30}
            isViewer={String(player.UUID) === String(currentPlayer?.UUID)}
          />
          <span>{snapshot?.playerStatesByUUID?.[player.UUID]?.label || 'Ready'}</span>
          <strong>{Number(scores[player.UUID] || 0).toLocaleString()}</strong>
        </div>
      ))}
    </section>
  );

  return (
    <main className="pair-match-dock" aria-label="Pair Match work dock">
      <header className="pair-dock-header">
        <span>PAIR MATCH · LIVE</span>
        <strong>{timeAsHHMMSS(remaining || 0)}</strong>
      </header>
      <div className="pair-dock-scoreboard">
        {renderTeam('Your team', myTeam, 'ally')}
        <span className="pair-dock-vs">VS</span>
        {renderTeam('Opposition', opponents, 'opponent')}
      </div>
      <section className="pair-dock-work">
        <span>{inTask ? 'IN SESSION' : 'READY FOR WORK'}</span>
        <strong>{currentTaskName || 'Choose the next eligible task'}</strong>
        <div>
          <button type="button" onClick={onAddTask} disabled={inTask}>Add task</button>
          <button type="button" onClick={onOpenQueue}>Open queue</button>
          <button
            type="button"
            className="primary"
            onClick={onStartNext}
            disabled={inTask || startingNext}
          >
            {startingNext ? 'Finding…' : 'Start next'}
          </button>
        </div>
      </section>
      {teammateContext && (
        <section className="pair-dock-context">
          <span>Teammate context</span>
          <p>{teammateContext}</p>
        </section>
      )}
      <footer className="pair-dock-footer">
        <button type="button" className="danger" onClick={onForfeit}>Forfeit</button>
      </footer>
    </main>
  );
}
/* ── Main component ──────────────────────────────────────── */
export default function MatchArena() {
  const {
    databaseConnection, domainRevisions, currentPlayer, invalidateDomains, notify, emitRewardEvent, playSound,
    gameState: [, setGameState],
    activeMatch: [activeMatch, setActiveMatch],
    activeTask:  [activeTask, setActiveTask],
    openPanel,
  } = useAppContext();
  const { finalizeMatchBoundary } = useTaskSession();

  const { remaining, elapsed } = useMatchTimer(activeMatch);
  const [scores, setScores]               = useState({});
  const [planningTodos, setPlanningTodos] = useState([]);
  const [planningHistory, setPlanningHistory] = useState([]);
  const [scoreEvents, setScoreEvents] = useState([]);
  const [startingNext, setStartingNext]   = useState(false);
  const [isConcluding, setIsConcluding]   = useState(false);
  const [showEndScreen, setShowEndScreen] = useState(false);
  const [confirmForfeit, setConfirmForfeit] = useState(false);
  const [stagingBusy, setStagingBusy] = useState(false);
  const [matchSnapshot, setMatchSnapshot] = useState(null);
  const [matchEvents, setMatchEvents]     = useState([]);
  const previousSnapshotRef               = useRef(null);
  const matchEventsRef                    = useRef([]);
  const matchEventHistoryRef              = useRef([]);
  const concludingRef                     = useRef(false);
  const { activePageId: matchPage, selectPage: setMatchPage } = useLocalSectionRoute({
    sectionId: 'match',
    pages: MATCH_PAGES,
    profileUUID: currentPlayer?.UUID,
    databaseConnection,
    defaultPageId: 'current',
  });

  // Match identity and rules come exclusively from the immutable creation
  // snapshots. The arena never hydrates live profile records while running.
  const displaySource = useMemo(() => {
    if (!activeMatch) return null;
    return { ...activeMatch, teams: getMatchTeams(activeMatch) };
  }, [activeMatch]);

  useEffect(() => {
    previousSnapshotRef.current = null;
    matchEventsRef.current = [];
    matchEventHistoryRef.current = [];
    setMatchSnapshot(null);
    setMatchEvents([]);
  }, [activeMatch?.UUID]);

  useEffect(() => {
    matchEventsRef.current = matchEvents;
  }, [matchEvents]);

  const refreshRuntimeInput = useCallback(async () => {
    if (!activeMatch || !currentPlayer?.UUID) return;
    const runtime = await loadMatchRuntimeInput(databaseConnection, activeMatch, currentPlayer.UUID);
    setScores(runtime.scores);
    setPlanningTodos(runtime.todos);
    setPlanningHistory(runtime.taskHistory);
    setScoreEvents(runtime.scoreEvents);
  }, [activeMatch, currentPlayer?.UUID, databaseConnection]);

  useEffect(() => { refreshRuntimeInput(); }, [
    refreshRuntimeInput,
    domainRevisions.tasks,
    domainRevisions.matches,
  ]);

  // The one-second loop is deliberately pure: scores are recomputed from the
  // immutable participant snapshot and already-hydrated task history only.
  useEffect(() => {
    if (!activeMatch || !currentPlayer || activeMatch.status !== MATCH_STATUS.active) return;
    setScores(buildInMemoryMatchScores({
      match: activeMatch,
      currentPlayerUUID: currentPlayer.UUID,
      taskHistory: planningHistory,
      scoreEvents,
      now: Date.now(),
    }));
  }, [activeMatch, currentPlayer?.UUID, elapsed, planningHistory, scoreEvents]);

  useEffect(() => {
    if (!activeMatch || !currentPlayer || !displaySource) return;

    const now = Date.now();
    const previousSnapshot = previousSnapshotRef.current;
    const snapshot = buildMatchSnapshot({
      match: displaySource,
      teams: displaySource.teams || [],
      scores,
      currentPlayerUUID: currentPlayer.UUID,
      elapsedMs: elapsed,
      remainingMs: remaining,
      activeTask,
      previousSnapshot,
      now,
    });

    setMatchSnapshot(snapshot);

    if (activeMatch.status === MATCH_STATUS.active) {
      const recentForDedupe = [...matchEventsRef.current, ...matchEventHistoryRef.current];
      const nextEvents = deriveMatchEvents(previousSnapshot, snapshot, recentForDedupe, { now });
      if (nextEvents.length) {
        if (previousSnapshot) {
          playSound?.('match-event', { volume: 0.56, throttleMs: 650 });
        }
        matchEventHistoryRef.current = [...nextEvents, ...matchEventHistoryRef.current].slice(0, 120);
        setMatchEvents((prev) => {
          const merged = [...nextEvents, ...prev]
            .filter((event) => now - event.createdAt < (event.ttlMs || 60000))
            .slice(0, 20);
          matchEventsRef.current = merged;
          return merged;
        });
      } else {
        setMatchEvents((prev) => {
          const filtered = prev.filter((event) => now - event.createdAt < (event.ttlMs || 60000));
          if (filtered.length === prev.length) return prev;
          matchEventsRef.current = filtered;
          return filtered;
        });
      }
    }

    previousSnapshotRef.current = snapshot;
  }, [activeMatch, currentPlayer, displaySource, scores, elapsed, remaining, activeTask, playSound]);

  // Auto-show endscreen when match completes (give arena a beat to render first)
  useEffect(() => {
    if (activeMatch?.status === MATCH_STATUS.complete) {
      const timer = setTimeout(() => setShowEndScreen(true), 600);
      return () => clearTimeout(timer);
    }
  }, [activeMatch?.status]);

  const concludeMatch = useCallback(async (forcedLoss = false) => {
    if (
      !activeMatch
      || !currentPlayer
      || concludingRef.current
      || activeMatch.status !== MATCH_STATUS.active
    ) return;
    concludingRef.current = true;
    setIsConcluding(true);
    try {
      const concludedAt = new Date().toISOString();
      const boundaryResult = await finalizeMatchBoundary(activeMatch, concludedAt);
      const finalScoreEvents = boundaryResult?.scoreEvent
        && !scoreEvents.some((event) => event.UUID === boundaryResult.scoreEvent.UUID)
        ? [...scoreEvents, boundaryResult.scoreEvent]
        : scoreEvents;
      if (finalScoreEvents !== scoreEvents) setScoreEvents(finalScoreEvents);
      const finalScores = buildInMemoryMatchScores({
        match: activeMatch,
        currentPlayerUUID: currentPlayer.UUID,
        taskHistory: planningHistory,
        scoreEvents: finalScoreEvents,
        now: Date.now(),
      });
      setScores(finalScores);
      const completedTasks = (planningHistory || []).filter((task) => (
        String(task?.parent) === String(currentPlayer.UUID)
        && task?.completedAt
        && String(task.completedAt) >= String(activeMatch.lockedAt || activeMatch.createdAt || '')
        && String(task.completedAt) <= concludedAt
      ));
      const primary = await completeMatchPrimary({
        databaseConnection,
        match: activeMatch,
        currentPlayer,
        finalScores,
        forcedLoss,
        concludedAt,
        eventHistory: matchEventHistoryRef.current,
        completedTasks,
        scoreEvents: finalScoreEvents,
      });
      if (!primary) return;

      // Publish the result immediately. Durable secondary work is queued only
      // after the authoritative match/player transaction has committed.
      setActiveMatch(primary.match);
      const { scoreDelta, eloChange: eloDelta, oldElo, newElo } = primary.immediateReward;
      playSound?.(primary.result.iWon ? 'victory' : 'defeat', {
        volume: primary.result.iWon ? 1.08 : 0.92,
        throttleMs: 800,
      });
      emitRewardEvent?.([
        { label: `${scoreDelta >= 0 ? '+' : ''}${scoreDelta.toLocaleString()} match point diff`, kind: scoreDelta >= 0 ? 'points' : 'event-penalty' },
        eloDelta !== 0 ? { amount: eloDelta, unit: 'ELO', kind: eloDelta >= 0 ? 'points' : 'event-penalty' } : null,
      ].filter(Boolean), { source: 'match-end' });

      const oldGroupIdx = getRankGroupIndex(oldElo);
      const newGroupIdx = getRankGroupIndex(newElo);
      if (newGroupIdx > oldGroupIdx) {
        const newGroup = getRank(newElo).group;
        const newRankLabel = getRankLabel(newElo);
        setTimeout(() => {
          import('@features/achievements/modals/RankUpModal/RankUpModal.jsx')
            .then(({ default: RankUpModal }) => NiceModal.show(RankUpModal, { newGroup, newRankLabel }))
            .catch((error) => console.warn('[MatchArena] rank-up modal could not be loaded:', error));
        }, 2200);
      }

      import('@domain/matches/MatchPostMatchJobs.js')
        .then(({ queuePostMatchJobs }) => queuePostMatchJobs(databaseConnection, primary.match, {
          onAchievementEarned: (keys) => keys.forEach((key) => {
            const achievement = getAchievementByKey(key);
            if (achievement) notify({
              title: 'Achievement Unlocked',
              message: achievement.label,
              kind: 'success',
              persist: false,
            });
          }),
        }))
        .catch((error) => {
          console.warn('[MatchArena] post-match jobs could not be queued:', error);
      });
      invalidateDomains(DOMAIN_INVALIDATION.matchWrite);
    } catch (error) {
      console.error('[MatchArena] match conclusion failed:', error);
      notify?.({
        title: forcedLoss ? 'Forfeit could not be saved' : 'Match could not be completed',
        message: 'The match is still active. Try again.',
        kind: 'error',
        persist: false,
      });
    } finally {
      concludingRef.current = false;
      setIsConcluding(false);
    }
  }, [
    activeMatch,
    currentPlayer,
    planningHistory,
    scoreEvents,
    finalizeMatchBoundary,
    databaseConnection,
    invalidateDomains,
    setActiveMatch,
    notify,
    emitRewardEvent,
    playSound,
  ]);

  useEffect(() => {
    if (!activeMatch || activeMatch.status !== MATCH_STATUS.active || remaining === null) return;
    if (remaining === 0) concludeMatch(false);
  }, [remaining, activeMatch, concludeMatch]);

  if (!activeMatch) return null;

  // Use hydrated snapshots for all display-layer reads. Writes still go
  // through activeMatch to keep the canonical record authoritative.
  const team1      = displaySource.teams?.[0] || [];
  const team2      = displaySource.teams?.[1] || [];
  const matchEnded = activeMatch.status === MATCH_STATUS.complete;
  const pairMatch = isPairMatch(activeMatch);
  const displayScores = scores;
  const t1Total    = team1.reduce((s, p) => s + Number(displayScores[p.UUID] || 0), 0);
  const t2Total    = team2.reduce((s, p) => s + Number(displayScores[p.UUID] || 0), 0);
  const grand      = t1Total + t2Total;
  const team1Pct   = grand > 0 ? Math.round(t1Total / grand * 100) : 50;
  const inTask     = !!activeTask?.createdAt;
  const myOnT1     = team1.some((p) => p.UUID === currentPlayer?.UUID);
  const iWon       = matchEnded && activeMatch.result?.iWon;
  const currentTaskName = inTask ? (activeTask.name || null) : null;
  const viewerSnapshot = [...team1, ...team2].find((player) => (
    String(player.UUID) === String(currentPlayer?.UUID)
  ));
  const matchTheme = viewerSnapshot?.theme || viewerSnapshot?.playerTheme || 'minimalist';
  const matchThemeAccent = THEME_ACCENT_COLORS[matchTheme] || THEME_ACCENT_COLORS.minimalist || '#4f8cff';

  const openTaskCreationPopup = () => {
    if (inTask) return;
    setActiveTask(createTaskDraft());
    requestAnimationFrame(() => {
      loadTaskCreationMenu()
        .then((TaskCreationMenu) => NiceModal.show(TaskCreationMenu))
        .catch((error) => console.warn('[MatchArena] task editor load failed:', error));
    });
  };

  const handleStartNext = async () => {
    if (inTask || startingNext || !planningTodos.length) return;
    setStartingNext(true);
    try {
      const launched = await launchRecommendedTask(databaseConnection, currentPlayer, {
        todos: planningTodos,
        history: planningHistory,
        source: 'match',
        mode: 'normal',
        observationSessionUUID: activeMatch.UUID,
      });
      if (!launched?.task) return;
      setActiveTask({
        ...launched.task,
        todoCreatedAt: launched.task.todoCreatedAt || launched.task.createdAt || null,
        createdAt: null,
        sessionRequestedAt: null,
        originalDuration: Number(launched.task.estimatedDuration || 0),
      });
      requestAnimationFrame(() => {
        showTaskPreviewMenu().catch((error) => console.warn('[MatchArena] task preview load failed:', error));
      });
    } finally {
      setStartingNext(false);
    }
  };

  const handleReturn = () => {
    setShowEndScreen(false);
    setActiveMatch(null);
    setGameState(GAME_STATE.idle);
    invalidateDomains(DOMAIN_INVALIDATION.matchWrite);
  };

  const persistMatchPatch = async (patch) => {
    const updated = await patchMatchStateCommand(databaseConnection, activeMatch, patch, {
      origin: 'desktop',
    });
    setActiveMatch(updated);
    invalidateDomains(DOMAIN_INVALIDATION.matchWrite);
    return updated;
  };

  const handleContinueToReady = async () => {
    if (stagingBusy) return;
    setStagingBusy(true);
    try {
      await persistMatchPatch({ phase: 'ready' });
    } finally {
      setStagingBusy(false);
    }
  };

  const handleReadyAndLock = async () => {
    if (stagingBusy) return;
    setStagingBusy(true);
    try {
      const lockedAt = new Date().toISOString();
      const participantUUIDs = getMatchTeams(activeMatch).flat().map((player) => player.UUID);
      await persistMatchPatch({
        status: MATCH_STATUS.active,
        phase: 'work',
        lockedAt,
        readyParticipantUUIDs: participantUUIDs,
        readyState: Object.fromEntries(participantUUIDs.map((participantUUID) => (
          [participantUUID, { ready: true, readyAt: lockedAt }]
        ))),
      });
      playSound?.('match-start', { volume: 0.9, throttleMs: 700 });
    } finally {
      setStagingBusy(false);
    }
  };

  const handleLeaveQueue = async () => {
    if (stagingBusy) return;
    setStagingBusy(true);
    try {
      await patchMatchStateCommand(databaseConnection, activeMatch, {
        status: 'cancelled',
        phase: 'cancelled',
      }, { origin: 'desktop' });
      setActiveMatch(null);
      setGameState(GAME_STATE.idle);
      invalidateDomains(DOMAIN_INVALIDATION.matchWrite);
    } finally {
      setStagingBusy(false);
    }
  };

  if (pairMatch && activeMatch.status === MATCH_STATUS.pending) {
    return (
      <PairMatchStaging
        match={displaySource}
        currentPlayer={currentPlayer}
        busy={stagingBusy}
        onContinue={handleContinueToReady}
        onReady={handleReadyAndLock}
        onLeave={handleLeaveQueue}
      />
    );
  }

  if (pairMatch && activeMatch.status === MATCH_STATUS.active && matchPage === 'current') {
    return (
      <div className="match-section-shell">
        <LocalSectionNav items={MATCH_PAGES} value={matchPage} onChange={setMatchPage} label="Match sections" />
        <PairMatchDock
          match={displaySource}
          currentPlayer={currentPlayer}
          scores={scores}
          snapshot={matchSnapshot}
          remaining={remaining}
          inTask={inTask}
          currentTaskName={currentTaskName}
          startingNext={startingNext}
          onStartNext={handleStartNext}
          onAddTask={openTaskCreationPopup}
          onOpenQueue={() => openPanel('queue')}
          onForfeit={() => setConfirmForfeit(true)}
        />
        <ConfirmDialog
          open={confirmForfeit}
          title="Forfeit this Pair Match?"
          message="Your team will lose and both teammates receive the same losing ELO delta."
          confirmLabel="Forfeit"
          destructive
          onCancel={() => setConfirmForfeit(false)}
          onConfirm={async () => {
            setConfirmForfeit(false);
            await concludeMatch(true);
          }}
        />
      </div>
    );
  }

  return (
    <div
      className={`match-arena ${matchEnded ? 'arena-ended' : ''}`}
      data-match-theme={matchTheme}
      style={{ '--match-theme-accent': matchThemeAccent }}
    >
      <div className="arena-scanlines" aria-hidden="true" />
      <LocalSectionNav items={MATCH_PAGES} value={matchPage} onChange={setMatchPage} label="Match sections" />

      {/* Header */}
      <div className="arena-header">
        <div className="arena-header-left">
          <div className="arena-status-dot" />
          <span className="arena-eyebrow">{matchEnded ? 'Match complete' : 'Match in progress'}</span>
          <span className="arena-duration-badge">
            PAIR MATCH · RATED · 60M
          </span>
        </div>
        <div className="arena-timer-wrap">
          {matchEnded ? (
            <span className={`arena-result-label ${iWon ? 'result-win' : 'result-loss'}`}>
              {iWon ? '▲ VICTORY' : (activeMatch.result?.wasForfeited ? '▼ FORFEIT' : '▼ DEFEAT')}
              {activeMatch.result?.eloChange != null && (
                <span className="result-elo">
                  {activeMatch.result.eloChange > 0 ? '+' : ''}{activeMatch.result.eloChange} ELO
                </span>
              )}
            </span>
          ) : (
            <>
              <span className="arena-timer-label">Time left</span>
              <span className="arena-timer">{timeAsHHMMSS(remaining || 0)}</span>
            </>
          )}
        </div>
        <div className="arena-header-right">
          {!matchEnded ? (
            <>
              <button onClick={openTaskCreationPopup} disabled={inTask}>Add task</button>
              <button onClick={() => openPanel('queue')}>Open queue</button>
              <button
                className="primary"
                onClick={handleStartNext}
                disabled={!planningTodos.length || inTask || startingNext}
                title="Open the next recommended task"
              >
                {startingNext ? 'Finding...' : 'Start next'}
              </button>
              <button className="danger" onClick={() => setConfirmForfeit(true)} disabled={isConcluding}>
                Forfeit
              </button>
            </>
          ) : (
            <button className="primary" onClick={() => setShowEndScreen(true)}>
              View results
            </button>
          )}
        </div>
      </div>

      {/* Score bar */}
      <div className="arena-score-bar">
        <span className={`asb-total ${myOnT1 ? 'asb-my' : 'asb-opp'}`}>{t1Total.toLocaleString()}</span>
        <div className="asb-track">
          <div className="asb-fill-blue" style={{ width: `${team1Pct}%` }} />
          <div className="asb-fill-red" />
        </div>
        <span className={`asb-total ${!myOnT1 ? 'asb-my' : 'asb-opp'}`}>{t2Total.toLocaleString()}</span>
      </div>

      {/* Field */}
      <div className="arena-field">
        <ArenaConnector team1Pct={team1Pct} />

        <div className="arena-side arena-side--left">
          <div className="arena-side-label">YOUR TEAM</div>
          <div className="arena-player-stack">
            {team1.map((player) => {
              const isMe = player.UUID === currentPlayer?.UUID;
              return (
                <ArenaPlayerNode key={player.UUID} player={player} score={Number(displayScores[player.UUID] || 0)}
                  isCurrentPlayer={isMe} isActive={isMe && inTask}
                  side="left"
                  activity={matchSnapshot?.playerStatesByUUID?.[player.UUID]}
                />
              );
            })}
          </div>
        </div>

        <div className="arena-field-center">
          <CenterNode team1Total={t1Total} team2Total={t2Total} myOnTeam1={myOnT1} />
          <MatchStatusPanel snapshot={matchSnapshot} />
          {inTask && (
            <div className="arena-in-session-badge">
              <div className="arena-session-dot" />
              {currentTaskName ? currentTaskName.slice(0, 20) : 'SESSION ACTIVE'}
            </div>
          )}
          <MatchEventFeed events={matchEvents} />
        </div>

        <div className="arena-side arena-side--right">
          <div className="arena-side-label arena-side-label--right">
            OPPOSITION
          </div>
          <div className="arena-player-stack">
            {team2.map((player) => {
              const isMe = player.UUID === currentPlayer?.UUID;
              return (
                <ArenaPlayerNode key={player.UUID} player={player} score={Number(displayScores[player.UUID] || 0)}
                  isCurrentPlayer={isMe}
                  isActive={isMe && inTask}
                  side="right"
                  activity={matchSnapshot?.playerStatesByUUID?.[player.UUID]}
                />
              );
            })}
          </div>
        </div>
      </div>

      {/* End screen overlay */}
      {showEndScreen && matchEnded && (
        <MatchEndScreen match={displaySource} currentPlayer={currentPlayer} onReturn={handleReturn} />
      )}
      <ConfirmDialog
        open={confirmForfeit}
        title="Forfeit this match?"
        message="The match will end and you will lose ELO."
        confirmLabel="Forfeit"
        destructive
        onCancel={() => setConfirmForfeit(false)}
        onConfirm={async () => {
          setConfirmForfeit(false);
          await concludeMatch(true);
        }}
      />
    </div>
  );
}
