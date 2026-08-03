import { VISIBILITY_TIER } from '@domain/social-world/SocialWorldContracts.js';
import { SEMANTIC_LOCATION_LABEL } from '@domain/social-world/PresencePresentation.js';
import ProfileIdentity from '@shared/profile-identity/ProfileIdentity.jsx';
import FellowContextCapsule from '@features/profile-context/components/FellowContextCapsule.jsx';
import {
  createOccupantFocusReturn,
  occupantFocusTargetId,
} from '../../navigation/OccupantFocusReturn.js';

function awayLabel(member) {
  const presence = member.presence;
  if (member.visibilityTier === VISIBILITY_TIER.dynamic) {
    const location = SEMANTIC_LOCATION_LABEL[presence.location];
    if (presence.lastActiveIGT != null) return location ? `Recently active · ${location}` : 'Recently active';
    return 'No recorded activity';
  }
  return presence.presentation?.primary || 'No recorded activity';
}

export default function InactiveCastRail({ members = [], contextProjections, onInspectProfile }) {
  return (
    <section className="social-world-rail" aria-label="Inactive social cast">
      <header className="social-world-rail__header">
        <span>
          <strong>Away from the live scene</strong>
          <small>{members.length ? `${members.length} cast member${members.length === 1 ? '' : 's'}` : 'No one is away'}</small>
        </span>
        <span className="social-world-rail__legend" aria-label="Presence claim legend">
          <i data-state="current" /> Current
          <i data-state="projected" /> Projected
          <i data-state="recent" /> Recent / away
        </span>
      </header>
      <div className="social-world-rail__people">
        {members.length ? members.map((member) => (
          <button
            key={member.profileId}
            className="social-world-rail-person"
            id={occupantFocusTargetId('social-world', member.profileId)}
            type="button"
            data-state={member.presence.state}
            onClick={() => onInspectProfile?.(
              member.profileId,
              member,
              createOccupantFocusReturn({ surface: 'social-world', profileId: member.profileId }),
            )}
            aria-label={`Inspect ${member.identity.username}. Open profile.`}
          >
            <span className="social-world-rail-person__copy">
              <ProfileIdentity
                identity={member.identity}
                compact
                avatarSize={34}
                isViewer={member.role === 'self'}
              />
              <small>{awayLabel(member)}</small>
              <FellowContextCapsule projection={contextProjections?.get(member.profileId)} compact />
            </span>
          </button>
        )) : (
          <p className="social-world-rail__empty">Everyone with a recorded location is in the live scene.</p>
        )}
      </div>
    </section>
  );
}
