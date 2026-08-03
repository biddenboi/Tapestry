import { buildProfileIdentity } from '@domain/profile/ProfileIdentity.js';
import { getRank, getRankGroupPresentation } from '@domain/rank/Rank.js';
import { getRankFramePresentation } from '@domain/rank/RankFrame.js';
import ProfilePicture from '@shared/profile-picture/ProfilePicture.jsx';
import PlayerTitle from '@shared/player-title/PlayerTitle.jsx';
import { getPresetCosmeticPresentation } from '@shared/cosmetics/PresetCosmeticSurface.jsx';
import './ProfileIdentity.css';

function frameId(frame) {
  const value = typeof frame === 'string' ? frame : frame?.id || frame?.type || frame?.key;
  return String(value || 'default').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').slice(0, 48);
}

export default function ProfileIdentity({
  identity: source,
  player = null,
  meta = null,
  compact = false,
  rank = 'none',
  snapshotAt = null,
  avatarSize = null,
  avatarOnly = false,
  hideAvatar = false,
  editable = false,
  onUpload = null,
  isViewer = false,
  className = '',
}) {
  const rawIdentity = source || player || {};
  const identity = buildProfileIdentity(rawIdentity, { snapshotAt });
  const rankPresentation = identity.hasVisibleRating
    ? rawIdentity.rankGroup
      ? getRankGroupPresentation(rawIdentity.rankGroup)
      : rawIdentity.elo != null
        ? getRank(identity.elo)
        : { color: 'var(--border)', glow: null }
    : { color: 'var(--border)', glow: null };
  const size = avatarSize || (compact ? 28 : 38);
  const rankFrame = identity.hasVisibleRating
    ? getRankFramePresentation({
        elo: identity.elo,
        rankGroup: rawIdentity.rankGroup,
        rankSub: rawIdentity.rankSub || rawIdentity.subTier,
      })
    : { id: 'unrated', notches: 0, sub: '' };
  const rankText = rank === 'full'
    ? identity.hasVisibleRating
      ? `${identity.rankLabel} · ${identity.elo.toLocaleString()} ELO`
      : 'Unrated'
    : rank === 'compact' ? identity.rankLabel : null;
  const cosmeticFrame = getPresetCosmeticPresentation('avatarFrame', frameId(identity.frame), compact ? 'compact' : 'default');

  const portrait = (
    <span className="profile-identity__portrait">
      <ProfilePicture
        src={identity.profilePicture}
        username={identity.username}
        size={size}
        editable={editable}
        onUpload={onUpload}
      />
      {cosmeticFrame.asset && cosmeticFrame.definition?.id !== 'default' && <img className="profile-identity__cosmetic-frame" src={cosmeticFrame.asset} alt="" aria-hidden="true" />}
    </span>
  );

  return (
    <span
      className={`profile-identity${compact ? ' profile-identity--compact' : ''}${isViewer ? ' profile-identity--viewer' : ''} ${className}`.trim()}
      data-profile-id={identity.profileId || undefined}
      data-profile-frame={frameId(identity.frame)}
      data-profile-theme={identity.theme || 'minimalist'}
      data-rank-frame={rankFrame.id}
      data-rank-notches={rankFrame.notches}
      data-rank-subtier={rankFrame.sub || undefined}
      data-snapshot-at={identity.snapshotAt || undefined}
      style={{
        '--profile-rank-color': rankPresentation.color,
        '--profile-rank-glow': rankPresentation.glow,
        '--profile-rank-shadow': rankPresentation.glow
          ? `0 0 9px ${rankPresentation.glow}`
          : 'none',
        '--profile-avatar-size': `${size}px`,
        '--profile-avatar-radius': `${size * 0.12}px`,
        '--profile-cosmetic-accent': cosmeticFrame.definition?.tokens?.accent || 'var(--accent)',
      }}
    >
      {!hideAvatar && portrait}
      {!avatarOnly && (
      <span className="profile-identity__copy">
        <span className="profile-identity__name-row">
          <strong>{identity.username}</strong>
          {isViewer && <em>YOU</em>}
        </span>
        <PlayerTitle titleId={identity.title} compact={compact} as="span" className="profile-identity__title" />
        {rankText && <small className="profile-identity__rank">{rankText}</small>}
        {meta && <small className="profile-identity__meta">{meta}</small>}
      </span>
      )}
    </span>
  );
}
