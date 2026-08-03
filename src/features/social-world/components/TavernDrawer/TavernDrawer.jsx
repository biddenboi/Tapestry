import { useMemo } from 'react';
import { formatDuration } from '@domain/time/Time.js';
import { SEMANTIC_LOCATION_LABEL } from '@domain/social-world/PresencePresentation.js';
import { PRESENCE_STATE } from '@domain/social-world/SocialWorldContracts.js';
import ProfileIdentity from '@shared/profile-identity/ProfileIdentity.jsx';
import DrawerFrame from '@shared/ui/DrawerFrame.jsx';
import './TavernDrawer.css';
import {
  createOccupantFocusReturn,
  occupantFocusTargetId,
} from '../../navigation/OccupantFocusReturn.js';

function liveElapsed(card, viewerIGT) {
  if (!card?.now || ![PRESENCE_STATE.current, PRESENCE_STATE.projected].includes(card.now.state)) {
    return { elapsedHere: card?.now?.elapsedHere ?? null, activeElapsed: card?.now?.activeElapsed ?? null };
  }
  const end = card.now.endedIGT == null ? viewerIGT : Math.min(viewerIGT, card.now.endedIGT);
  const elapsedHere = card.now.startedIGT == null
    ? card.now.elapsedHere
    : Math.max(0, end - card.now.startedIGT);
  let activeElapsed = card.now.activeElapsed;
  if (card.now.state === PRESENCE_STATE.current && !card.now.paused && activeElapsed != null) {
    activeElapsed = Math.min(elapsedHere, activeElapsed + Math.max(0, viewerIGT - card.asOfIGT));
  }
  return { elapsedHere, activeElapsed };
}

export default function TavernDrawer({
  open,
  tavern,
  cards = [],
  loading,
  error,
  viewerIGT,
  onClose,
  onInspectProfile,
}) {
  const cardById = useMemo(() => new Map(
    cards.filter(Boolean).map((card) => [card.identity.profileId, card]),
  ), [cards]);
  const locationLabel = SEMANTIC_LOCATION_LABEL[tavern?.location] || 'Shared location';

  return (
    <DrawerFrame
      open={open}
      onClose={onClose}
      title={`${locationLabel} Tavern`}
      eyebrow="Social world / Tavern"
      width="min(520px, 100vw)"
      className="tavern-drawer"
    >
      <div className="tavern-drawer__intro">
        <span className="tavern-drawer__stack" aria-hidden="true">
          {(tavern?.occupants || []).slice(0, 4).map((member) => (
            <ProfileIdentity
              key={member.profileId}
              identity={member.identity}
              avatarOnly
              avatarSize={40}
              isViewer={member.role === 'self'}
            />
          ))}
        </span>
        <span>
          <strong>Shared activity, individual identity</strong>
          <small>This group exists only while at least two people are active here.</small>
        </span>
      </div>

      {error && <p className="tavern-drawer__notice" role="status">Some compact details could not be prepared.</p>}
      <div className="tavern-drawer__roster" aria-busy={loading ? 'true' : undefined}>
        {(tavern?.occupants || []).map((member) => {
          const card = cardById.get(member.profileId);
          const elapsed = liveElapsed(card, viewerIGT);
          const presenceState = card?.now.state || member.presence.state;
          return (
            <article
              key={member.profileId}
              className="tavern-roster-card"
              data-role={member.role}
            >
              <header>
                <ProfileIdentity
                  identity={card?.identity || member.identity}
                  avatarSize={46}
                  rank="compact"
                  isViewer={member.role === 'self'}
                />
                {presenceState !== PRESENCE_STATE.projected && (
                  <em data-state={presenceState}>
                    {card?.now.presentation?.statusLabel || member.presence.presentation?.statusLabel || 'Live'}
                  </em>
                )}
              </header>
              <p>{card?.now.activityLabel || member.presence.presentation?.primary || 'Preparing current activity…'}</p>
              <dl>
                <div><dt>Here</dt><dd>{elapsed.elapsedHere == null ? '—' : formatDuration(elapsed.elapsedHere)}</dd></div>
                {elapsed.activeElapsed != null && <div><dt>Focused</dt><dd>{formatDuration(elapsed.activeElapsed)}</dd></div>}
                <div><dt>Today</dt><dd>{card ? `${card.today.tasks} tasks` : '—'}</dd></div>
                <div><dt>Base points</dt><dd>{card ? Math.round(card.today.points) : '—'}</dd></div>
              </dl>
              <button
                type="button"
                id={occupantFocusTargetId('tavern', member.profileId)}
                onClick={() => onInspectProfile?.(
                  member.profileId,
                  member,
                  createOccupantFocusReturn({
                    surface: 'tavern',
                    profileId: member.profileId,
                    groupSurface: 'social-world',
                  }),
                )}
                aria-label={`Inspect ${member.identity.username}. Open profile.`}
              >
                Inspect profile moment
              </button>
            </article>
          );
        })}
      </div>
      {loading && <p className="tavern-drawer__notice" role="status">Preparing the bounded roster details…</p>}
    </DrawerFrame>
  );
}
