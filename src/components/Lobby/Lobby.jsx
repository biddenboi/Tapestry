import { useContext, useEffect, useState } from 'react';
import { v4 as uuid } from 'uuid';
import NiceModal from '@ebay/nice-modal-react';
import { AppContext } from '../../App.jsx';
import { EVENT, GAME_STATE, MATCH_STATUS, STORES } from '../../utils/Constants.js';
import { endWorkDay } from '../../utils/Helpers/Events.js';
import { buildGhostRoster } from '../../utils/Helpers/Match.js';
import { getRank, getRankLabel, getRankProgress, getRankGlow, getRankClass } from '../../utils/Helpers/Rank.js';
import EndDayConfirm from '../../Modals/EndDayConfirm/EndDayConfirm.jsx';
import MatchDetailsModal from '../../Modals/MatchDetailsModal/MatchDetailsModal.jsx';
import TaskCreationMenu from '../../Modals/TaskCreationMenu/TaskCreationMenu.jsx';
import ProfilePicture from '../ProfilePicture/ProfilePicture.jsx';
import './Lobby.css';

function RankDisplay({ elo }) {
  const rank       = getRank(elo);
  const label      = getRankLabel(elo);
  const progress   = getRankProgress(elo);
  const rankClass  = getRankClass(elo);

  return (
    <div className="rank-display">
      <div className={`rank-icon rank-${rankClass}`}>{rank.icon}</div>
      <div className="rank-info">
        <span className={`rank-name rank-${rankClass}`}>{label}</span>
        <div className="rank-progress-track">
          <div
            className="rank-progress-fill"
            style={{ width: `${progress}%`, background: rank.color }}
          />
        </div>
        <span className="rank-progress-label">{progress}% to next</span>
      </div>
    </div>
  );
}

function MatchHistoryRow({ match, currentPlayerUUID, onOpen }) {
  const team1 = match.teams?.[0] || [];
  const team2 = match.teams?.[1] || [];
  const myOnTeam1 = team1.some((p) => p.UUID === currentPlayerUUID);
  const myTeam  = myOnTeam1 ? team1 : team2;
  const oppTeam = myOnTeam1 ? team2 : team1;
  const isLive  = match.status === MATCH_STATUS.active;
  const won     = !isLive && !!match.result?.iWon;

  return (
    <button
      type="button"
      className={`mh-row ${won ? 'mh-win' : isLive ? 'mh-active' : 'mh-loss'}`}
      onClick={() => onOpen(match)}
    >
      <div className={`mh-outcome ${won ? 'win' : isLive ? 'active' : 'loss'}`}>
        {isLive ? 'LIVE' : won ? 'WIN' : 'LOSS'}
      </div>
      <div className="mh-teams">
        <span className="mh-team">{myTeam.map((p) => p.username).join(', ')}</span>
        <span className="mh-vs">vs</span>
        <span className="mh-team muted">{oppTeam.map((p) => p.username).join(', ')}</span>
      </div>
      <div className="mh-meta">
        <span>{match.duration}h</span>
        <span>{new Date(match.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
      </div>
    </button>
  );
}

function MatchSetupOverlay({ onStart, onClose, isLoading }) {
  const [duration, setDuration] = useState(4);
  return (
    <div className="match-setup-overlay">
      <div className="match-setup-card">
        <div className="match-setup-header">
          <div className="mso-corner" />
          MATCHMAKING
        </div>
        <div className="match-setup-body">
          <p className="match-setup-title">Select Match Duration</p>
          <p className="match-setup-sub">
            Compete against ghost records of your past profiles.
            Complete tasks to earn points during the match window.
          </p>
          <div className="match-duration-row">
            {[2, 3, 4, 5, 6, 8].map((h) => (
              <button
                key={h}
                className={`duration-chip ${duration === h ? 'active' : ''}`}
                onClick={() => setDuration(h)}
              >
                {h}H
              </button>
            ))}
          </div>
        </div>
        <div className="match-setup-footer">
          <button onClick={onClose}>CANCEL</button>
          <button className="primary" onClick={() => onStart(duration)} disabled={isLoading}>
            {isLoading ? 'FINDING MATCH…' : 'FIND MATCH →'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Lobby() {
  const {
    databaseConnection,
    currentPlayer,
    timestamp,
    refreshApp,
    openPanel,
    gameState: [, setGameState],
    activeMatch: [, setActiveMatch],
  } = useContext(AppContext);

  const [scheduleStage, setScheduleStage] = useState(null);
  const [matchHistory, setMatchHistory]   = useState([]);
  const [showSetup, setShowSetup]         = useState(false);
  const [loadingMatch, setLoadingMatch]   = useState(false);
  const [todayPoints, setTodayPoints]     = useState(0);

  useEffect(() => {
    const load = async () => {
      const stage = await databaseConnection.getLastEventType([EVENT.wake, EVENT.end_work, EVENT.sleep]);
      setScheduleStage(stage);
      if (!currentPlayer?.UUID) return;

      const matches = await databaseConnection.getMatchesForPlayer(currentPlayer.UUID);
      const sorted  = matches.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
      setMatchHistory(sorted.slice(0, 8));

      const midnight = new Date();
      midnight.setHours(0, 0, 0, 0);
      const todayTasks = await databaseConnection.getStoreFromRange(STORES.task, midnight.toISOString(), new Date().toISOString());
      setTodayPoints(todayTasks.filter((t) => t.parent === currentPlayer.UUID).reduce((s, t) => s + Number(t.points || 0), 0));

      const active = sorted.find((m) => m.status === MATCH_STATUS.active);
      if (active) { setActiveMatch(active); setGameState(GAME_STATE.match); }
    };
    load();
  }, [databaseConnection, currentPlayer, timestamp, setActiveMatch, setGameState]);

  const handleFindMatch = async (duration) => {
    if (!currentPlayer) return;
    setLoadingMatch(true);
    try {
      const allPlayers   = await databaseConnection.getAllPlayers();
      const { teammates, opponents } = await buildGhostRoster(databaseConnection, allPlayers, currentPlayer, duration);
      const match = {
        UUID: uuid(),
        createdAt: new Date().toISOString(),
        duration,
        parent: currentPlayer.UUID,
        status: MATCH_STATUS.active,
        teams: [
          [{ UUID: currentPlayer.UUID, username: currentPlayer.username, profilePicture: currentPlayer.profilePicture || null, elo: currentPlayer.elo || 0, isCurrentPlayer: true }, ...teammates],
          opponents,
        ],
        result: null,
      };
      await databaseConnection.add(STORES.match, match);
      setActiveMatch(match);
      setGameState(GAME_STATE.match);
      setShowSetup(false);
      refreshApp();
    } finally {
      setLoadingMatch(false);
    }
  };

  const openMatchDetails = (match) =>
    NiceModal.show(MatchDetailsModal, { match, currentPlayerUUID: currentPlayer?.UUID, onOpenProfile: (id) => openPanel('profile', id) });

  const isWorkDay  = scheduleStage?.type === EVENT.wake;
  const username   = currentPlayer?.username || 'AGENT';
  const elo        = currentPlayer?.elo || 0;
  const rankGlow   = getRankGlow(elo, 18);
  const rankClass  = getRankClass(elo);

  return (
    <div className="lobby">
      <div className="lobby-bg" aria-hidden="true" />

      <div className="lobby-layout">
        {/* ── Player card ──────────────────────────────────────── */}
        <aside className="lobby-player-card">
          <div className="lpc-avatar-area">
            <div className="lpc-avatar-ring" style={{ boxShadow: rankGlow }}>
              <ProfilePicture src={currentPlayer?.profilePicture} username={username} size={90} />
            </div>
            <div className={`lpc-rank-emblem rank-${rankClass}`}>
              {getRank(elo).icon}
            </div>
          </div>

          <div className="lpc-identity">
            <span className="lpc-username">{username}</span>
            <RankDisplay elo={elo} />
            <span className="lpc-elo">{elo} ELO</span>
          </div>

          <div className="lpc-stats">
            <div className="lpc-stat">
              <span className="lpc-stat-val">{todayPoints.toLocaleString()}</span>
              <span className="lpc-stat-lbl">TODAY PTS</span>
            </div>
            <div className="lpc-stat-sep" />
            <div className="lpc-stat">
              <span className="lpc-stat-val lpc-tokens">◈ {currentPlayer?.tokens || 0}</span>
              <span className="lpc-stat-lbl">TOKENS</span>
            </div>
          </div>

          <div className="lpc-actions">
            <button className="lpc-btn primary" onClick={() => NiceModal.show(TaskCreationMenu)}>+ NEW TASK</button>
            <button className="lpc-btn" onClick={() => openPanel('tasks')}>VIEW QUEUE</button>
            <button className="lpc-btn" onClick={() => openPanel('profile', currentPlayer?.UUID)}>PROFILE</button>
            <div className="lpc-divider" />
            {isWorkDay ? (
              <button className="lpc-btn" onClick={async () => { await endWorkDay(databaseConnection, currentPlayer); refreshApp(); }}>
                END WORK DAY
              </button>
            ) : (
              <button className="lpc-btn danger" onClick={() => NiceModal.show(EndDayConfirm)}>
                END DAY
              </button>
            )}
          </div>
        </aside>

        {/* ── Center ────────────────────────────────────────────── */}
        <section className="lobby-center">
          <div className="lobby-modes">
            <div className="lobby-mode-card" onClick={() => setGameState(GAME_STATE.practice)}>
              <div className="lmc-bg lmc-bg--practice" />
              <div className="lmc-content">
                <div className="lmc-icon">⬡</div>
                <h2 className="lmc-title">PRACTICE</h2>
                <p className="lmc-desc">Solo dojo. Complete tasks, earn points. No ELO at stake.</p>
                <button className="lmc-btn">ENTER →</button>
              </div>
              <div className="lmc-corner-tl" />
              <div className="lmc-corner-br" />
            </div>

            <div className="lobby-mode-card lobby-mode-card--match" onClick={() => setShowSetup(true)}>
              <div className="lmc-bg lmc-bg--match" />
              <div className="lmc-content">
                <div className="lmc-icon lmc-icon--match">⚔</div>
                <h2 className="lmc-title lmc-title--match">COMPETE</h2>
                <p className="lmc-desc">3v3 ghost match. Outperform your own past records.</p>
                <button className="lmc-btn lmc-btn--match">FIND MATCH →</button>
              </div>
              <div className="lmc-corner-tl" />
              <div className="lmc-corner-br" />
            </div>
          </div>

          {matchHistory.length > 0 && (
            <div className="lobby-history">
              <div className="lobby-history-title">RECENT MATCHES</div>
              <div className="lobby-history-list">
                {matchHistory.map((m) => (
                  <MatchHistoryRow key={m.UUID} match={m} currentPlayerUUID={currentPlayer?.UUID} onOpen={openMatchDetails} />
                ))}
              </div>
            </div>
          )}
        </section>
      </div>

      {showSetup && (
        <MatchSetupOverlay onStart={handleFindMatch} onClose={() => setShowSetup(false)} isLoading={loadingMatch} />
      )}
    </div>
  );
}
