import './MatchDetailsModal.css';
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import { UTCStringToLocalDate, UTCStringToLocalTime } from '../../utils/Helpers/Time.js';
import ProfilePicture from '../../components/ProfilePicture/ProfilePicture.jsx';

function TeamBlock({ title, players, onOpenProfile }) {
  return (
    <div className="match-detail-team">
      <div className="match-detail-team-title">{title}</div>
      <div className="match-detail-team-list">
        {players.map((player) => (
          <button key={player.UUID} className="match-detail-player" onClick={() => onOpenProfile?.(player.UUID)}>
            <ProfilePicture src={player.profilePicture} username={player.username} size={42} />
            <div className="match-detail-player-copy">
              <span>{player.username}</span>
              <small>{player.isGenerated ? 'Ghost' : `ELO ${player.elo || 0}`}</small>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

export default NiceModal.create(({ match, currentPlayerUUID, onOpenProfile }) => {
  const modal = useModal();
  const handleOpenProfile = (playerUUID) => {
    modal.hide();
    modal.remove();
    onOpenProfile?.(playerUUID);
  };
  if (!modal.visible || !match) return null;

  const team1 = match.teams?.[0] || [];
  const team2 = match.teams?.[1] || [];
  const myOnTeam1 = team1.some((player) => player.UUID === currentPlayerUUID);
  const winner = match.result?.winner;
  const outcome = winner == null ? 'In progress' : (winner === 1 && myOnTeam1) || (winner === 2 && !myOnTeam1) ? 'Victory' : 'Defeat';

  return (
    <div className="detail-overlay">
      <div className="blanker" onClick={() => { modal.hide(); modal.remove(); }} />
      <div className="detail-card match-detail-card">
        <div className="detail-header">
          <div>
            <div className="detail-eyebrow">MATCH REPORT</div>
            <h2 className="detail-title">{outcome}</h2>
          </div>
          <button className="close-btn" onClick={() => { modal.hide(); modal.remove(); }}>✕</button>
        </div>

        <div className="detail-body">
          <div className="detail-grid">
            <div><span className="detail-k">Started</span><strong>{UTCStringToLocalDate(match.createdAt)} {UTCStringToLocalTime(match.createdAt)}</strong></div>
            <div><span className="detail-k">Duration</span><strong>{match.duration}h</strong></div>
            {match.result?.team1Total != null && <div><span className="detail-k">Team 1</span><strong>{match.result.team1Total} pts</strong></div>}
            {match.result?.team2Total != null && <div><span className="detail-k">Team 2</span><strong>{match.result.team2Total} pts</strong></div>}
            {match.result?.eloChange != null && <div><span className="detail-k">ELO</span><strong>{match.result.eloChange > 0 ? '+' : ''}{match.result.eloChange}</strong></div>}
            {match.diagnostics?.balanceDelta != null && <div><span className="detail-k">Match Balance</span><strong>{match.diagnostics.balanceDelta}</strong></div>}
          </div>

          <TeamBlock title="Your Team" players={myOnTeam1 ? team1 : team2} onOpenProfile={handleOpenProfile} />
          <TeamBlock title="Opposition" players={myOnTeam1 ? team2 : team1} onOpenProfile={handleOpenProfile} />
        </div>
      </div>
    </div>
  );
});
