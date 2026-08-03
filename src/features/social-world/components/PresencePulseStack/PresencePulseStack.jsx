import ProfileIdentity from '@shared/profile-identity/ProfileIdentity.jsx';
import './PresencePulseStack.css';
import {
  createOccupantFocusReturn,
  occupantFocusTargetId,
  occupantGroupHeadingId,
} from '../../navigation/OccupantFocusReturn.js';

export default function PresencePulseStack({
  members = [],
  label,
  surface,
  onInspectProfile,
}) {
  return (
    <div className="presence-pulse-stack" aria-labelledby={occupantGroupHeadingId(surface)}>
      <h3
        className="presence-pulse-stack__heading"
        id={occupantGroupHeadingId(surface)}
        tabIndex="-1"
      >
        {label}
      </h3>
      <div className="presence-pulse-stack__members">
        {members.map((member) => (
          <button
            type="button"
            key={member.profileId}
            id={occupantFocusTargetId(surface, member.profileId)}
            className="presence-pulse"
            data-state={member.presence.state}
            onClick={() => onInspectProfile?.(
              member.profileId,
              member,
              createOccupantFocusReturn({ surface, profileId: member.profileId }),
            )}
            aria-label={`Inspect ${member.identity.username}. Open profile.`}
          >
            <ProfileIdentity
              identity={member.identity}
              avatarOnly
              avatarSize={24}
              isViewer={member.role === 'self'}
            />
          </button>
        ))}
      </div>
    </div>
  );
}
