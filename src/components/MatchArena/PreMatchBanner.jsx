import { useEffect, useRef, useState } from 'react';
import { getRank, getRankLabel, getRankClass } from '../../utils/Helpers/Rank.js';
import { THEME_ACCENT_COLORS } from '../../utils/Constants.js';
import ProfilePicture from '../ProfilePicture/ProfilePicture.jsx';
import './PreMatchBanner.css';

// Timeline (ms from mount):
//   0     — 'enter'   chips slide in
//   600   — 'hold'    countdown visible (3)
//   1600  — countdown 2
//   2600  — countdown 1
//   3600  — countdown 0 → ⚡
//   4400  — 'exit'    banner fades out
//   4900  — onComplete fires, parent flips to PLACEMENT
//
// All timers scheduled ONCE on mount, independent of reactive deps, so a
// state transition can't cancel the `done` timer before it fires.

const T = { hold: 600, cd2: 1600, cd1: 2600, cd0: 3600, exit: 4400, done: 4900 };

function bannerStyle(cb) {
  if (!cb) return null;
  if (cb.type === 'gradient') return { background: cb.value };
  if (cb.type === 'color')    return { background: cb.value };
  if (cb.type === 'image')    return { backgroundImage: `url(${cb.value})`, backgroundSize: 'cover', backgroundPosition: 'center' };
  return null;
}

export default function PreMatchBanner({ match, currentPlayerUUID, onComplete }) {
  const [state,     setState]     = useState('enter');
  const [countdown, setCountdown] = useState(3);

  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    const timers = [
      setTimeout(() => setState('hold'),          T.hold),
      setTimeout(() => setCountdown(2),           T.cd2),
      setTimeout(() => setCountdown(1),           T.cd1),
      setTimeout(() => setCountdown(0),           T.cd0),
      setTimeout(() => setState('exit'),          T.exit),
      setTimeout(() => onCompleteRef.current?.(), T.done),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  const [team1, team2] = match.teams ?? [[], []];
  const hours = match.duration;
  const durationLabel = hours === 1 ? '1 HOUR' : `${hours} HOURS`;

  return (
    <div className={`pmb pmb--${state}`}>
      <div className="pmb-bg" />

      <div className="pmb-team pmb-team--left">
        <div className="pmb-team-label pmb-team-label--left">YOUR SIDE</div>
        {team1.map((p, i) => (
          <PlayerCard key={p.UUID} player={p} side="left" isMe={p.UUID === currentPlayerUUID}
                      enterDelay={0.1 + i * 0.12} state={state} />
        ))}
      </div>

      <div className="pmb-center">
        <div className="pmb-vs">VS</div>
        <div className="pmb-duration">{durationLabel} MATCH</div>
        {state === 'hold' && (
          <div className="pmb-countdown">
            <span className={`pmb-cd-num pmb-cd-num--${countdown}`}>{countdown || '⚡'}</span>
          </div>
        )}
      </div>

      <div className="pmb-team pmb-team--right">
        <div className="pmb-team-label pmb-team-label--right">OPPOSITION</div>
        {team2.map((p, i) => (
          <PlayerCard key={p.UUID} player={p} side="right" isMe={false}
                      enterDelay={0.1 + i * 0.12} state={state} />
        ))}
      </div>
    </div>
  );
}

function PlayerCard({ player, side, isMe, enterDelay, state }) {
  const rank     = getRank(player.elo || 0);
  const rankCls  = getRankClass(player.elo || 0);
  const rankTxt  = getRankLabel(player.elo || 0);
  const theme    = player.playerTheme || player.activeCosmetics?.theme || 'default';
  const accent   = THEME_ACCENT_COLORS[theme] || THEME_ACCENT_COLORS.default;
  const bg       = bannerStyle(player.cardBanner || player.activeCosmetics?.cardBanner);
  const sideTint = side === 'left' ? 'rgba(56,189,248,' : 'rgba(248,113,113,';

  return (
    <div
      className={`pmb-card pmb-card--${side} rank-tier-${rankCls} ${isMe ? 'pmb-card--me' : ''}`}
      style={{
        '--pmb-rank':   rank.color,
        '--pmb-glow':   rank.glow,
        '--pmb-accent': accent,
        animationDelay: state === 'enter' ? '0s' : `${enterDelay}s`,
        boxShadow: `0 0 0 1px ${sideTint}0.22), 0 12px 40px -12px ${rank.glow}`,
      }}
    >
      {bg && <div className="pmb-card-banner" style={bg} />}
      <div className="pmb-card-shade" />

      <div className="pmb-card-avatar" style={{ borderColor: rank.color, boxShadow: `0 0 22px ${rank.glow}` }}>
        <ProfilePicture src={player.profilePicture} username={player.username} size={56} />
        <div className="pmb-card-rankicon">{rank.icon}</div>
      </div>

      <div className="pmb-card-body">
        <div className="pmb-card-name" style={{ color: rank.color, textShadow: `0 0 14px ${rank.glow}` }}>
          {player.username || 'AGENT'}
          {isMe && <span className="pmb-card-youtag">YOU</span>}
        </div>
        <div className={`pmb-card-rank rank-${rankCls}`}>{rankTxt}</div>
        <div className="pmb-card-elo"><span>{(player.elo || 0).toLocaleString()}</span> ELO</div>
      </div>
    </div>
  );
}
