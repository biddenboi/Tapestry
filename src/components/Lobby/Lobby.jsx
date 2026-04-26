import { useContext, useEffect, useState, useMemo } from 'react';
import { v4 as uuid } from 'uuid';
import NiceModal from '@ebay/nice-modal-react';
import { AppContext } from '../../App.jsx';
import { EVENT, GAME_STATE, MATCH_STATUS, STORES } from '../../utils/Constants.js';
import { endWorkDay, fireFirstMatchIfDue, checkEntertainmentAndLog } from '../../utils/Helpers/Events.js';
import { buildGhostRoster, hydrateMatchTeams } from '../../utils/Helpers/Match.js';
import { getRank, getRankLabel, getRankProgress, getRankGlow, getRankClass } from '../../utils/Helpers/Rank.js';
import EndDayConfirm from '../../Modals/EndDayConfirm/EndDayConfirm.jsx';
import BanModal from '../../Modals/BanModal/BanModal.jsx';
import MatchDetailsModal from '../../Modals/MatchDetailsModal/MatchDetailsModal.jsx';
import TaskCreationMenu from '../../Modals/TaskCreationMenu/TaskCreationMenu.jsx';
import ProfilePicture from '../ProfilePicture/ProfilePicture.jsx';
import { RankIcon } from '../Icons/RankIcon.jsx';
import './Lobby.css';

function RankDisplay({ elo }) {
  const rank = getRank(elo), label = getRankLabel(elo), progress = getRankProgress(elo), rankClass = getRankClass(elo);
  return (
    <div className="rank-display">
      <div className={`rank-icon rank-${rankClass}`}><RankIcon group={rank.group} sub={rank.sub} size={20} /></div>
      <div className="rank-info">
        <span className={`rank-name rank-${rankClass}`}>{label}</span>
        <div className="rank-progress-track"><div className="rank-progress-fill" style={{ width: `${progress}%`, background: rank.color }} /></div>
        <span className="rank-progress-label">{progress}% to next</span>
      </div>
    </div>
  );
}

function MatchHistoryRow({ match, currentPlayerUUID, onOpen }) {
  const team1 = match.teams?.[0] || [], team2 = match.teams?.[1] || [];
  const myOnTeam1 = team1.some((p) => p.UUID === currentPlayerUUID);
  const myTeam = myOnTeam1 ? team1 : team2, oppTeam = myOnTeam1 ? team2 : team1;
  const isLive = match.status === MATCH_STATUS.active, won = !isLive && !!match.result?.iWon;
  return (
    <button type="button" className={`mh-row ${won ? 'mh-win' : isLive ? 'mh-active' : 'mh-loss'}`} onClick={() => onOpen(match)}>
      <div className={`mh-outcome ${won ? 'win' : isLive ? 'active' : 'loss'}`}>{isLive ? 'LIVE' : won ? 'WIN' : 'LOSS'}</div>
      <div className="mh-teams">
        <span className="mh-team">{myTeam.map((p) => p.username || 'Unknown').join(', ')}</span>
        <span className="mh-vs">vs</span>
        <span className="mh-team muted">{oppTeam.map((p) => p.username || 'Unknown').join(', ')}</span>
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
        <div className="match-setup-header"><div className="mso-corner" />MATCHMAKING</div>
        <div className="match-setup-body">
          <p className="match-setup-title">Select Match Duration</p>
          <p className="match-setup-sub">Compete against ghost records of your past profiles. Complete tasks to earn points during the match window.</p>
          <div className="match-duration-row">
            {[2,3,4,5,6,8].map((h) => <button key={h} className={`duration-chip ${duration===h?'active':''}`} onClick={() => setDuration(h)}>{h}H</button>)}
          </div>
        </div>
        <div className="match-setup-footer">
          <button onClick={onClose}>CANCEL</button>
          <button className="primary" onClick={() => onStart(duration)} disabled={isLoading}>{isLoading ? 'FINDING MATCH…' : 'FIND MATCH →'}</button>
        </div>
      </div>
    </div>
  );
}

function EloChart({ data, friends, allPlayers }) {
  const [span, setSpan] = useState('all');
  const W = 460, H = 200, PAD = { top: 16, right: 16, bottom: 30, left: 50 };
  const plotW = W - PAD.left - PAD.right, plotH = H - PAD.top - PAD.bottom;

  // Filter + aggregate data based on span
  const displayData = useMemo(() => {
    if (!data || data.length === 0) return data;
    const now = Date.now();
    const cutoffs = { today: 86400000, week: 7*86400000, month: 30*86400000, quarter: 90*86400000 };
    const cutoff = cutoffs[span] ? now - cutoffs[span] : 0;
    const filtered = data.filter((d) => d.t >= cutoff);
    const base = filtered.length >= 2 ? filtered : data;

    // For week+ spans, collapse to one point per calendar day (last value of that day)
    if (span === 'week' || span === 'month' || span === 'quarter') {
      const dayMap = new Map();
      for (const pt of base) {
        const dayKey = new Date(pt.t).toLocaleDateString('en-CA'); // YYYY-MM-DD
        dayMap.set(dayKey, pt); // last point per day wins
      }
      const daily = [...dayMap.values()];
      return daily.length >= 2 ? daily : base;
    }
    return base;
  }, [data, span]);

  const SPANS = [['today','Today'],['week','Week'],['month','Month'],['quarter','Quarter'],['all','All']];

  if (!data || data.length < 2) {
    return (
      <div className="elo-chart-empty">
        <span className="elo-empty-icon">◈</span>
        <span>Play matches to build your ELO history.</span>
      </div>
    );
  }

  const elos = displayData.map((d) => d.elo);
  const eloSpread = Math.max(Math.max(...elos) - Math.min(...elos), 100);
  const minElo = Math.max(0, Math.min(...elos) - eloSpread * 0.4);
  const maxElo = Math.max(...elos) + eloSpread * 0.4;
  const minT = displayData[0].t, maxT = displayData[displayData.length - 1].t;
  const toX = (t) => PAD.left + ((t - minT) / (maxT - minT || 1)) * plotW;
  const toY = (e) => PAD.top + plotH - ((e - minElo) / (maxElo - minElo || 1)) * plotH;
  const linePath = displayData.map((d, i) => `${i===0?'M':'L'}${toX(d.t).toFixed(1)},${toY(d.elo).toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L${toX(displayData[displayData.length-1].t).toFixed(1)},${(PAD.top+plotH).toFixed(1)} L${toX(displayData[0].t).toFixed(1)},${(PAD.top+plotH).toFixed(1)} Z`;
  const yTicks = [Math.round(minElo), Math.round((minElo+maxElo)/2), Math.round(maxElo)];
  const friendColors = ['rgba(0,214,143,0.85)','rgba(255,184,0,0.85)','rgba(167,139,250,0.85)','rgba(34,211,238,0.85)'];

  const friendData = friends.slice(0,4).map((fid, i) => {
    const fp = allPlayers.find((p) => p.UUID === fid);
    if (!fp) return null;
    const y = toY(fp.elo || 0);
    const inRange = y >= PAD.top && y <= PAD.top + plotH;
    return { fid, fp, y, inRange, color: friendColors[i], above: (fp.elo || 0) > maxElo };
  }).filter(Boolean);

  const inRangeFriends  = friendData.filter((f) => f.inRange);
  const outRangeFriends = friendData.filter((f) => !f.inRange);

  return (
    <div className="elo-chart-wrap">
      <div className="elo-span-tabs">
        {SPANS.map(([id, lbl]) => (
          <button key={id} type="button"
            className={`elo-span-btn ${span === id ? 'active' : ''}`}
            onClick={() => setSpan(id)}>{lbl}</button>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="elo-chart-svg" preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id="eloGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="eloLine" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.4" />
            <stop offset="100%" stopColor="var(--accent-bright)" stopOpacity="1" />
          </linearGradient>
        </defs>

        {yTicks.map((tick) => (
          <line key={tick} x1={PAD.left} y1={toY(tick)} x2={W-PAD.right} y2={toY(tick)} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
        ))}

        {inRangeFriends.map(({ fid, fp, y, color }) => (
          <g key={fid}>
            <line x1={PAD.left} y1={y} x2={W-PAD.right-2} y2={y} stroke={color} strokeWidth="1" strokeDasharray="4,3" />
            <text x={W-PAD.right-4} y={y-3} fontSize="8" fill={color} textAnchor="end">
              {fp.username?.slice(0,8)} {fp.elo}
            </text>
          </g>
        ))}

        {outRangeFriends.map(({ fid, fp, color, above }, idx) => {
          const bx = PAD.left + 8 + idx * 70;
          const by = above ? PAD.top + 2 : PAD.top + plotH - 2;
          return (
            <g key={fid}>
              <text x={bx} y={by + (above ? 9 : -3)} fontSize="8" fill={color}>
                {above ? '▲' : '▼'} {fp.username?.slice(0,6)} {fp.elo}
              </text>
            </g>
          );
        })}

        <path d={areaPath} fill="url(#eloGrad)" />
        <path d={linePath} fill="none" stroke="url(#eloLine)" strokeWidth="2" strokeLinejoin="round" />

        {displayData.map((d, i) => (
          <circle key={i} cx={toX(d.t)} cy={toY(d.elo)}
            r={i===displayData.length-1?4:2.5}
            fill={i===displayData.length-1?'var(--accent-bright)':'var(--accent)'}
            stroke={i===displayData.length-1?'var(--bg-void)':'none'} strokeWidth="1.5" />
        ))}

        {yTicks.map((tick) => (
          <text key={tick} x={PAD.left-5} y={toY(tick)+4} fontSize="9" fill="rgba(255,255,255,0.3)" textAnchor="end">{tick}</text>
        ))}

        {[displayData[0], displayData[displayData.length-1]].map((d, i) => (
          <text key={i} x={toX(d.t)} y={H-4} fontSize="9" fill="rgba(255,255,255,0.3)" textAnchor={i===0?'start':'end'}>
            {new Date(d.t).toLocaleDateString('en-US', { month:'short', day:'numeric' })}
          </text>
        ))}
      </svg>
    </div>
  );
}


function LeaderRow({ rank, player, value, label, isSelf, onClick }) {
  const rankClass = getRankClass(player.elo || 0);
  return (
    <button className={`leader-row${isSelf?' leader-row--self':''}`} onClick={onClick}>
      <span className={`leader-rank${rank<=3?` leader-rank--${rank}`:''}`}>#{rank}</span>
      <ProfilePicture src={player.profilePicture} username={player.username||'?'} size={26} />
      <div className="leader-info">
        <span className="leader-name">{player.username||'Unknown'}</span>
        <span className={`leader-tier rank-${rankClass}`}>{getRankLabel(player.elo||0)}</span>
      </div>
      <span className="leader-value">{value} <span className="leader-label">{label}</span></span>
    </button>
  );
}

export default function Lobby() {
  const {
    databaseConnection, currentPlayer, timestamp, refreshApp, openPanel,
    gameState:   [, setGameState],
    activeMatch: [, setActiveMatch],
  } = useContext(AppContext);

  const [scheduleStage, setScheduleStage] = useState(null);
  const [matchHistory, setMatchHistory]   = useState([]);
  const [showSetup, setShowSetup]         = useState(false);
  const [loadingMatch, setLoadingMatch]   = useState(false);
  const [todayPoints, setTodayPoints]     = useState(0);
  const [eloHistory, setEloHistory]       = useState([]);
  const [allPlayers, setAllPlayers]       = useState([]);
  const [playerPoints, setPlayerPoints]   = useState({});
  const [friendUUIDs, setFriendUUIDs]     = useState(new Set());
  const [leaderTab, setLeaderTab]         = useState('elo');

  useEffect(() => {
    const load = async () => {
      const stage = currentPlayer?.UUID
        ? await databaseConnection.getLastEventType([EVENT.wake, EVENT.end_work, EVENT.sleep], currentPlayer.UUID)
        : null;
      setScheduleStage(stage);
      if (!currentPlayer?.UUID) return;

      const [matches, allTasks, allPlayerData, friendships] = await Promise.all([
        databaseConnection.getMatchesForPlayer(currentPlayer.UUID),
        databaseConnection.getAll(STORES.task),
        databaseConnection.getAllPlayers(),
        databaseConnection.getFriendshipsForPlayer(currentPlayer.UUID),
      ]);

      const sorted = matches.sort((a, b) => String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
      setMatchHistory(sorted.slice(0, 4));
      const active = sorted.find((m) => m.status === MATCH_STATUS.active);
      if (active) { setActiveMatch(active); setGameState(GAME_STATE.match); }

      const midnight = new Date(); midnight.setHours(0,0,0,0);
      const todayTasks = await databaseConnection.getStoreFromRange(STORES.task, midnight.toISOString(), new Date().toISOString());
      setTodayPoints(todayTasks.filter((t) => t.parent === currentPlayer.UUID).reduce((s, t) => s + Number(t.points||0), 0));

      // ELO history from match results (oldest first)
      const withResult = sorted.filter((m) => m.result?.eloChange != null).reverse();
      const totalChange = withResult.reduce((s, m) => s + m.result.eloChange, 0);
      let runElo = Math.max(0, (currentPlayer.elo||0) - totalChange);
      const eloPoints = withResult.map((m) => {
        runElo = Math.max(0, runElo + m.result.eloChange);
        return { t: new Date(m.createdAt).getTime(), elo: runElo };
      });
      eloPoints.push({ t: Date.now(), elo: currentPlayer.elo||0 });
      setEloHistory(eloPoints);

      // Points per player
      const pts = {};
      allTasks.filter((t) => t.completedAt && t.parent).forEach((t) => { pts[t.parent] = (pts[t.parent]||0) + (t.points||0); });
      setPlayerPoints(pts);
      setAllPlayers(allPlayerData);

      const accepted = friendships.filter((f) => f.status === 'accepted');
      setFriendUUIDs(new Set(accepted.flatMap((f) => f.players).filter((id) => id !== currentPlayer.UUID)));
    };
    load();
  }, [databaseConnection, currentPlayer, timestamp, setActiveMatch, setGameState]);

  const handleFindMatch = async (duration) => {
    if (!currentPlayer) return;
    setLoadingMatch(true);
    try {
      const allP = await databaseConnection.getAllPlayers();
      const { teammates, opponents } = await buildGhostRoster(databaseConnection, allP, currentPlayer, duration);
      const match = {
        UUID: uuid(), createdAt: new Date().toISOString(), duration,
        parent: currentPlayer.UUID, status: MATCH_STATUS.active,
        teams: [[{ UUID: currentPlayer.UUID, username: currentPlayer.username, profilePicture: currentPlayer.profilePicture||null,
          elo: currentPlayer.elo||0, isCurrentPlayer: true,
          cardBanner: currentPlayer.activeCosmetics?.cardBanner||null,
          playerTheme: currentPlayer.activeCosmetics?.theme||'default',
          selectedAchievements: currentPlayer.selectedAchievements||[] }, ...teammates], opponents],
        result: null,
      };
      await databaseConnection.add(STORES.match, match);
      // Fire the First Match-of-the-Day special event if applicable. Idempotent
      // for the IGT day — only fires once. Failures here must not block the
      // match from starting.
      try {
        await fireFirstMatchIfDue(databaseConnection, currentPlayer, Date.now());
      } catch (err) {
        console.warn('[Lobby] first-match buff failed:', err);
      }
      setActiveMatch(match); setGameState(GAME_STATE.match); setShowSetup(false); refreshApp();
    } finally { setLoadingMatch(false); }
  };

  const openMatchDetails = (match) =>
    NiceModal.show(MatchDetailsModal, { match, currentPlayerUUID: currentPlayer?.UUID, onOpenProfile: (id) => openPanel('profile', id) });

  // Players keyed by UUID for snapshot-fallback lookups on match rosters.
  const playersByUUID = useMemo(
    () => Object.fromEntries((allPlayers || []).map((p) => [p.UUID, p])),
    [allPlayers]
  );

  // Hydrate match history so stripped snapshots self-heal against the live
  // player store (e.g., after a data-only import without the profile file).
  const hydratedMatchHistory = useMemo(
    () => matchHistory.map((m) => hydrateMatchTeams(m, playersByUUID)),
    [matchHistory, playersByUUID]
  );

  const leaderGlobal  = useMemo(() => [...allPlayers].sort((a,b) => (b.elo||0)-(a.elo||0)).slice(0,10), [allPlayers]);
  const leaderFriends = useMemo(() => allPlayers.filter((p) => friendUUIDs.has(p.UUID)).sort((a,b) => (b.elo||0)-(a.elo||0)), [allPlayers, friendUUIDs]);
  const leaderPoints  = useMemo(() => [...allPlayers].sort((a,b) => (playerPoints[b.UUID]||0)-(playerPoints[a.UUID]||0)).slice(0,10), [allPlayers, playerPoints]);

  const isWorkDay = scheduleStage?.type === EVENT.wake;
  const username = currentPlayer?.username || 'AGENT';
  const elo = currentPlayer?.elo || 0;
  const rankGlow = getRankGlow(elo, 18), rankClass = getRankClass(elo);
  const friendsArr = [...friendUUIDs];

  const lb = currentPlayer?.activeCosmetics?.lobbyBanner;
  const bannerStyle = lb
    ? lb.type==='image'    ? { backgroundImage:`url(${lb.value})` }
    : lb.type==='gradient' ? { background:lb.value }
    : lb.type==='color'    ? { background:lb.value } : {} : {};

  return (
    <div className="lobby">
      <div className="lobby-bg" aria-hidden="true" />
      <div className="lobby-layout">

        {/* ── Player card ─────────────────────────────────── */}
        <aside className={`lobby-player-card${lb?' has-banner':''}`} style={bannerStyle}>
          <div className="lpc-avatar-area">
            <div className="lpc-avatar-ring" style={{ boxShadow: rankGlow }}>
              <ProfilePicture src={currentPlayer?.profilePicture} username={username} size={90} />
            </div>
            <div className={`lpc-rank-emblem rank-${rankClass}`}><RankIcon group={getRank(elo).group} sub={getRank(elo).sub} size={28} /></div>
          </div>
          <div className="lpc-identity">
            <span className="lpc-username">{username}</span>
            <RankDisplay elo={elo} />
            <span className="lpc-elo">{elo} ELO</span>
          </div>
          <div className="lpc-stats">
            <div className="lpc-stat"><span className="lpc-stat-val">{todayPoints.toLocaleString()}</span><span className="lpc-stat-lbl">TODAY PTS</span></div>
            <div className="lpc-stat-sep" />
            <div className="lpc-stat"><span className="lpc-stat-val lpc-tokens">◈ {currentPlayer?.tokens||0}</span><span className="lpc-stat-lbl">TOKENS</span></div>
          </div>
          <div className="lpc-actions">
            <button className="lpc-btn primary" onClick={() => NiceModal.show(TaskCreationMenu)}>+ NEW TASK</button>
            <button className="lpc-btn" onClick={() => openPanel('tasks')}>VIEW QUEUE</button>
            <button className="lpc-btn" onClick={() => openPanel('profile', currentPlayer?.UUID)}>PROFILE</button>
            <div className="lpc-divider" />
            {isWorkDay
              ? <button className="lpc-btn" onClick={async () => {
                  await endWorkDay(databaseConnection, currentPlayer);
                  // Evaluate Work Day Discipline immediately after end_work fires
                  // so the buff is live for any post-work matches today.
                  try { await checkEntertainmentAndLog(databaseConnection, currentPlayer); }
                  catch (err) { console.warn('[Lobby] entertainment check failed:', err); }
                  refreshApp();
                }}>END WORK DAY</button>
              : <button className="lpc-btn danger" onClick={() => NiceModal.show(EndDayConfirm)}>END DAY</button>
            }
            {/* ── Ban / wipe profile ─────────────────────────────
                Quietly distinct from the action stack above — its
                own hairline divider and a muted-red border — so it
                reads as a different class of action without
                shouting. */}
            <div className="lpc-ban-zone">
              <button
                className="lpc-btn lpc-btn-ban"
                onClick={() => NiceModal.show(BanModal)}
                title="Permanently wipe this profile"
              >
                <span className="lpc-btn-ban-glyph" aria-hidden="true">⊗</span>
                <span>BAN</span>
              </button>
            </div>
          </div>
        </aside>

        {/* ── Center ──────────────────────────────────────── */}
        <section className="lobby-center">

          {/* Mode cards */}
          <div className="lobby-modes">
            <div className="lobby-mode-card lobby-mode-card--match" onClick={() => setShowSetup(true)}>
              <div className="lmc-bg lmc-bg--match" />
              <div className="lmc-content">
                <div className="lmc-icon lmc-icon--match">⚔</div>
                <h2 className="lmc-title lmc-title--match">COMPETE</h2>
                <p className="lmc-desc">3v3 ghost match. Outperform your past records and earn ELO.</p>
                <button className="lmc-btn lmc-btn--match">FIND MATCH →</button>
              </div>
              <div className="lmc-corner-tl" /><div className="lmc-corner-br" />
            </div>

            <div className="lobby-mode-card lobby-mode-card--dojo" onClick={() => setGameState(GAME_STATE.dojo)}>
              <div className="lmc-bg lmc-bg--dojo" />
              <div className="lmc-content">
                <div className="lmc-icon lmc-icon--dojo">⚡</div>
                <h2 className="lmc-title lmc-title--dojo">DOJO</h2>
                <p className="lmc-desc">Open-ended training. No time limit — build focus and momentum.</p>
                <button className="lmc-btn lmc-btn--dojo">ENTER DOJO →</button>
              </div>
              <div className="lmc-corner-tl" /><div className="lmc-corner-br" />
            </div>
          </div>

          {/* Match history */}
          {hydratedMatchHistory.length > 0 && (
            <div className="lobby-history">
              <div className="lobby-history-title">RECENT MATCHES</div>
              <div className="lobby-history-list">
                {hydratedMatchHistory.map((m) => <MatchHistoryRow key={m.UUID} match={m} currentPlayerUUID={currentPlayer?.UUID} onOpen={openMatchDetails} />)}
              </div>
            </div>
          )}

          {/* Data Hub */}
          <div className="data-hub">
            <div className="data-hub-header">
              <span className="data-hub-title">◈ DATA HUB</span>
              <span className="data-hub-sub">Performance analytics</span>
            </div>

            <div className="data-hub-grid">
              {/* ELO chart */}
              <div className="data-card data-card--chart">
                <div className="data-card-header">
                  <span className="data-card-title">ELO JOURNEY</span>
                  {friendsArr.length > 0 && <span className="data-card-note">friends shown as dashed lines</span>}
                </div>
                <EloChart data={eloHistory} friends={friendsArr} allPlayers={allPlayers} />
                <div className="elo-current-badge">
                  <span className="ecb-val">{elo}</span>
                  <span className="ecb-lbl">CURRENT ELO</span>
                </div>
              </div>

              {/* Leaderboards */}
              <div className="data-card data-card--leader">
                <div className="leader-tabs">
                  {[['elo','GLOBAL ELO'],['friends','FRIENDS'],['points','TOP POINTS']].map(([id, lbl]) => (
                    <button key={id} className={`leader-tab${leaderTab===id?' active':''}`} onClick={() => setLeaderTab(id)}>{lbl}</button>
                  ))}
                </div>
                <div className="leader-list">
                  {leaderTab === 'elo' && (leaderGlobal.length === 0
                    ? <div className="leader-empty">No profiles yet.</div>
                    : leaderGlobal.map((p, i) => <LeaderRow key={p.UUID} rank={i+1} player={p} value={(p.elo||0).toLocaleString()} label="ELO" isSelf={p.UUID===currentPlayer?.UUID} onClick={() => openPanel('profile',p.UUID)} />)
                  )}
                  {leaderTab === 'friends' && (leaderFriends.length === 0
                    ? <div className="leader-empty">Add friends to see their ranks.</div>
                    : leaderFriends.map((p, i) => <LeaderRow key={p.UUID} rank={i+1} player={p} value={(p.elo||0).toLocaleString()} label="ELO" isSelf={p.UUID===currentPlayer?.UUID} onClick={() => openPanel('profile',p.UUID)} />)
                  )}
                  {leaderTab === 'points' && (leaderPoints.length === 0
                    ? <div className="leader-empty">No points earned yet.</div>
                    : leaderPoints.map((p, i) => <LeaderRow key={p.UUID} rank={i+1} player={p} value={(playerPoints[p.UUID]||0).toLocaleString()} label="PTS" isSelf={p.UUID===currentPlayer?.UUID} onClick={() => openPanel('profile',p.UUID)} />)
                  )}
                </div>
              </div>
            </div>
          </div>

        </section>
      </div>

      {showSetup && <MatchSetupOverlay onStart={handleFindMatch} onClose={() => setShowSetup(false)} isLoading={loadingMatch} />}
    </div>
  );
}