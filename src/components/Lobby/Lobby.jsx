import { useContext, useEffect, useState } from 'react';
import { v4 as uuid } from 'uuid';
import NiceModal from '@ebay/nice-modal-react';
import { AppContext } from '../../App.jsx';
import { EVENT, GAME_STATE, MATCH_STATUS, STORES } from '../../utils/Constants.js';
import { endWorkDay } from '../../utils/Helpers/Events.js';
import { buildGhostRoster } from '../../utils/Helpers/Match.js';
import EndDayConfirm from '../../Modals/EndDayConfirm/EndDayConfirm.jsx';
import MatchDetailsModal from '../../Modals/MatchDetailsModal/MatchDetailsModal.jsx';
import TaskCreationMenu from '../../Modals/TaskCreationMenu/TaskCreationMenu.jsx';
import ProfilePicture from '../ProfilePicture/ProfilePicture.jsx';
import './Lobby.css';

function getRankInfo(elo = 0) {
  if (elo < 200) return { label: 'INITIATE', color: '#4a5568', tier: 1 };
  if (elo < 500) return { label: 'NOVICE', color: 'var(--green)', tier: 2 };
  if (elo < 900) return { label: 'ADEPT', color: 'var(--accent-bright)', tier: 3 };
  if (elo < 1400) return { label: 'VETERAN', color: 'var(--purple)', tier: 4 };
  if (elo < 2000) return { label: 'ELITE', color: 'var(--gold)', tier: 5 };
  if (elo < 2700) return { label: 'MASTER', color: '#fb923c', tier: 6 };
  return { label: 'ASCENDANT', color: 'var(--red)', tier: 7 };
}

function RankBadge({ elo }) {
  const { label, color, tier } = getRankInfo(elo);
  return (
    <div className="rank-badge">
      <div className="rank-pip-row">{Array.from({ length: tier }).map((_, index) => <div key={index} className="rank-pip" style={{ background: color }} />)}</div>
      <span className="rank-label" style={{ color }}>{label}</span>
    </div>
  );
}

function MatchHistoryRow({ match, currentPlayerUUID, onOpen }) {
  const team1 = match.teams?.[0] || [];
  const team2 = match.teams?.[1] || [];
  const myOnTeam1 = team1.some((player) => player.UUID === currentPlayerUUID);
  const myTeam = myOnTeam1 ? team1 : team2;
  const oppTeam = myOnTeam1 ? team2 : team1;
  const isLive = match.status === MATCH_STATUS.active;
  const won = !isLive && !!match.result?.iWon;

  return (
    <button type="button" className={`mh-row ${won ? 'mh-win' : isLive ? 'mh-active' : 'mh-loss'}`} onClick={() => onOpen(match)}>
      <div className={`mh-outcome ${won ? 'win' : isLive ? 'active' : 'loss'}`}>{isLive ? 'LIVE' : won ? 'WIN' : 'LOSS'}</div>
      <div className="mh-teams">
        <span className="mh-team">{myTeam.map((player) => player.username).join(', ')}</span>
        <span className="mh-vs">vs</span>
        <span className="mh-team muted">{oppTeam.map((player) => player.username).join(', ')}</span>
      </div>
      <div className="mh-meta">
        <span>{match.duration}h match</span>
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
        <div className="match-setup-header">MATCHMAKING</div>
        <div className="match-setup-body">
          <p className="match-setup-title">Select Match Duration</p>
          <p className="match-setup-sub">
            You will compete against ghost records of your past profiles.
            Complete tasks to earn points during the match window.
          </p>
          <div className="match-duration-row">{[3, 4, 5, 6, 8, 10].map((hours) => <button key={hours} className={`duration-chip ${duration === hours ? 'active' : ''}`} onClick={() => setDuration(hours)}>{hours}h</button>)}</div>
          <p className="match-duration-label">{duration}-hour match selected</p>
        </div>
        <div className="match-setup-footer">
          <button onClick={onClose}>CANCEL</button>
          <button className="primary" onClick={() => onStart(duration)} disabled={isLoading}>{isLoading ? 'FINDING MATCH…' : 'FIND MATCH →'}</button>
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
  const [matchHistory, setMatchHistory] = useState([]);
  const [showSetup, setShowSetup] = useState(false);
  const [loadingMatch, setLoadingMatch] = useState(false);
  const [todayPoints, setTodayPoints] = useState(0);

  useEffect(() => {
    const load = async () => {
      const stage = await databaseConnection.getLastEventType([EVENT.wake, EVENT.end_work, EVENT.sleep]);
      setScheduleStage(stage);
      if (!currentPlayer?.UUID) return;

      const matches = await databaseConnection.getMatchesForPlayer(currentPlayer.UUID);
      const sortedMatches = matches.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
      setMatchHistory(sortedMatches.slice(0, 8));

      const midnight = new Date();
      midnight.setHours(0, 0, 0, 0);
      const todayTasks = await databaseConnection.getStoreFromRange(STORES.task, midnight.toISOString(), new Date().toISOString());
      setTodayPoints(todayTasks.filter((task) => task.parent === currentPlayer.UUID).reduce((sum, task) => sum + Number(task.points || 0), 0));

      const active = sortedMatches.find((match) => match.status === MATCH_STATUS.active);
      if (active) {
        setActiveMatch(active);
        setGameState(GAME_STATE.match);
      }
    };
    load();
  }, [databaseConnection, currentPlayer, timestamp, setActiveMatch, setGameState]);

  const handleFindMatch = async (duration) => {
    if (!currentPlayer) return;
    setLoadingMatch(true);
    try {
      const allPlayers = await databaseConnection.getAllPlayers();
      const { teammates, opponents } = await buildGhostRoster(databaseConnection, allPlayers, currentPlayer, duration);
      const match = {
        UUID: uuid(),
        createdAt: new Date().toISOString(),
        duration,
        parent: currentPlayer.UUID,
        status: MATCH_STATUS.active,
        teams: [[{ UUID: currentPlayer.UUID, username: currentPlayer.username, profilePicture: currentPlayer.profilePicture || null, elo: currentPlayer.elo || 0, isCurrentPlayer: true }, ...teammates], opponents],
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

  const openMatchDetails = (match) => {
    NiceModal.show(MatchDetailsModal, {
      match,
      currentPlayerUUID: currentPlayer?.UUID,
      onOpenProfile: (playerUUID) => openPanel('profile', playerUUID),
    });
  };

  const isWorkDay = scheduleStage?.type === EVENT.wake;
  const username = currentPlayer?.username || 'AGENT';

  return (
    <div className="lobby">
      <div className="lobby-bg-grid" aria-hidden="true" />
      <div className="lobby-layout">
        <aside className="lobby-player-card">
          <div className="lpc-top">
            <ProfilePicture src={currentPlayer?.profilePicture} username={username} size={96} className="lpc-avatar" />
            <div className="lpc-identity">
              <span className="lpc-username">{username}</span>
              <RankBadge elo={currentPlayer?.elo || 0} />
            </div>
          </div>

          <div className="lpc-stats">
            <div className="lpc-stat"><span className="lpc-stat-val">{todayPoints.toLocaleString()}</span><span className="lpc-stat-lbl">TODAY</span></div>
            <div className="lpc-stat-div" />
            <div className="lpc-stat"><span className="lpc-stat-val lpc-tokens">◈ {currentPlayer?.tokens || 0}</span><span className="lpc-stat-lbl">TOKENS</span></div>
            <div className="lpc-stat-div" />
            <div className="lpc-stat"><span className="lpc-stat-val">{currentPlayer?.elo || 0}</span><span className="lpc-stat-lbl">ELO</span></div>
          </div>

          <div className="lpc-actions">
            <button className="lpc-action-btn primary" onClick={() => NiceModal.show(TaskCreationMenu)}>+ NEW TASK</button>
            <button className="lpc-action-btn" onClick={() => openPanel('tasks')}>VIEW QUEUE</button>
            <button className="lpc-action-btn" onClick={() => openPanel('profile', currentPlayer?.UUID)}>VIEW PROFILE</button>
            <hr className="lpc-divider" />
            {isWorkDay ? (
              <button className="lpc-action-btn" onClick={async () => { await endWorkDay(databaseConnection, currentPlayer); refreshApp(); }}>END WORK DAY</button>
            ) : (
              <button className="lpc-action-btn danger" onClick={() => NiceModal.show(EndDayConfirm)}>END DAY</button>
            )}
          </div>
        </aside>

        <section className="lobby-center">
          <div className="lobby-mode-row">
            <div className="lobby-mode-card" onClick={() => setGameState(GAME_STATE.practice)}>
              <div className="mode-card-bg mode-bg-practice" />
              <div className="mode-card-content">
                <div className="mode-card-icon">⬡</div>
                <h2 className="mode-card-title">PRACTICE</h2>
                <p className="mode-card-sub">Solo dojo. Complete tasks, earn points. No ELO impact.</p>
                <button className="mode-card-btn">ENTER DOJO →</button>
              </div>
            </div>

            <div className="lobby-mode-card lobby-mode-card--match" onClick={() => setShowSetup(true)}>
              <div className="mode-card-bg mode-bg-match" />
              <div className="mode-card-content">
                <div className="mode-card-icon mode-card-icon--match">⚔</div>
                <h2 className="mode-card-title mode-title--match">COMPETE</h2>
                <p className="mode-card-sub">3v3 ghost match. Outperform your past profiles.</p>
                <button className="mode-card-btn mode-btn--match">FIND MATCH →</button>
              </div>
            </div>
          </div>

          {matchHistory.length > 0 && (
            <div className="lobby-history">
              <div className="lobby-history-header">MATCH HISTORY</div>
              <div className="lobby-history-list">
                {matchHistory.map((match) => (
                  <MatchHistoryRow key={match.UUID} match={match} currentPlayerUUID={currentPlayer?.UUID} onOpen={openMatchDetails} />
                ))}
              </div>
            </div>
          )}
        </section>
      </div>

      {showSetup && <MatchSetupOverlay onStart={handleFindMatch} onClose={() => setShowSetup(false)} isLoading={loadingMatch} />}
    </div>
  );
}
