import {
  useCallback,
  useMemo,
  useRef,
  useState,
} from 'react';
import { buildPresencePresentation } from '@domain/social-world/PresencePresentation.js';
import {
  CAST_ROLE,
  PRESENCE_STATE,
} from '@domain/social-world/SocialWorldContracts.js';
import { buildTaverns } from '@domain/social-world/TavernProjection.js';
import { formatWorldIGT } from '@domain/time/Time.js';
import ProfileIdentity from '@shared/profile-identity/ProfileIdentity.jsx';
import InactiveCastRail from '../InactiveCastRail/InactiveCastRail.jsx';
import FellowContextCapsule from '@features/profile-context/components/FellowContextCapsule.jsx';
import WorldRecommendationRoute from '@features/navigation/components/WorldRecommendationRoute/WorldRecommendationRoute.jsx';
import { resolveWorldRouteLocationId } from '@features/navigation/services/WorldRouteHighlightService.js';
import SOCIAL_WORLD_SCENE_LAYOUT from './SocialWorldSceneLayout.js';
import {
  createOccupantFocusReturn,
  occupantFocusTargetId,
  occupantGroupHeadingId,
} from '../../navigation/OccupantFocusReturn.js';

function livePresence(presence, viewerIGT) {
  if (!presence) return null;
  if (![PRESENCE_STATE.current, PRESENCE_STATE.projected].includes(presence.state)) return presence;
  const started = Number(presence.startedIGT);
  if (!Number.isFinite(started)) return presence;
  const rawEnd = presence.endedIGT == null ? viewerIGT : Number(presence.endedIGT);
  const boundary = Number.isFinite(rawEnd) ? Math.min(viewerIGT, rawEnd) : viewerIGT;
  return { ...presence, elapsedHere: Math.max(0, boundary - started) };
}

function PresenceBadge({ member, viewerIGT }) {
  const presence = livePresence(member.presence, viewerIGT);
  const presentation = buildPresencePresentation(presence, viewerIGT);
  return (
    <span className="social-world-person__presence" data-state={presence?.state || PRESENCE_STATE.inactive}>
      <i aria-hidden="true" />
      {presentation.primary}
    </span>
  );
}

function PersonButton({ member, viewerIGT, projection, onInspectProfile }) {
  return (
    <button
      className="social-world-person"
      id={occupantFocusTargetId('social-world', member.profileId)}
      type="button"
      data-role={member.role}
      data-presence={member.presence.state}
      onClick={() => onInspectProfile?.(
        member.profileId,
        member,
        createOccupantFocusReturn({ surface: 'social-world', profileId: member.profileId }),
      )}
      aria-label={`Inspect ${member.identity.username}. Open profile.`}
    >
      <span className="social-world-person__copy">
        <ProfileIdentity
          identity={member.identity}
          compact
          avatarSize={42}
          isViewer={member.role === CAST_ROLE.self}
        />
        <PresenceBadge member={member} viewerIGT={viewerIGT} />
        {member.role !== CAST_ROLE.self && <FellowContextCapsule projection={projection} compact />}
      </span>
    </button>
  );
}

function TavernButton({ tavern, onInspectTavern }) {
  return (
    <button
      className="social-world-tavern"
      type="button"
      onClick={() => onInspectTavern?.(tavern.id)}
      aria-label={`Open ${tavern.count}-person Tavern roster.`}
    >
      <span className="social-world-tavern__stack" aria-hidden="true">
        {tavern.occupants.slice(0, 3).map((member) => (
          <ProfileIdentity
            key={member.profileId}
            identity={member.identity}
            avatarOnly
            avatarSize={34}
            isViewer={member.role === CAST_ROLE.self}
          />
        ))}
      </span>
      <span>
        <strong>Tavern active</strong>
        <small>{tavern.count} here</small>
      </span>
      <em>{tavern.count}</em>
    </button>
  );
}

function LocationNode({
  location,
  scene,
  tavern,
  viewerIGT,
  contextProjections,
  destinationLocationId,
  registerLocation,
  onInspectProfile,
  onInspectTavern,
}) {
  const layout = SOCIAL_WORLD_SCENE_LAYOUT[location.id];
  const setLocationRef = useCallback((node) => {
    registerLocation(location.id, node);
  }, [location.id, registerLocation]);
  const occupants = location.occupants
    .map((profileId) => scene.memberById.get(profileId))
    .filter(Boolean);
  return (
    <article
      ref={setLocationRef}
      className="social-world-location"
      data-location={location.id}
      data-tone={layout.tone}
      data-occupied={occupants.length ? 'true' : 'false'}
      data-next-move-destination={destinationLocationId === location.id ? 'true' : undefined}
      style={{ '--world-x': `${layout.x}%`, '--world-y': `${layout.y}%` }}
      aria-labelledby={`social-world-location-${location.id}`}
    >
      <header className="social-world-location__header">
        <span className="social-world-location__glyph" aria-hidden="true">{layout.shortLabel.slice(0, 1)}</span>
        <span>
          <strong id={`social-world-location-${location.id}`}>{layout.label}</strong>
        </span>
        <em>{occupants.length || '—'}</em>
      </header>
      <div className="social-world-location__people">
        {tavern ? (
          <TavernButton tavern={tavern} onInspectTavern={onInspectTavern} />
        ) : occupants.length ? occupants.map((member) => (
          <PersonButton
            key={member.profileId}
            member={member}
            viewerIGT={viewerIGT}
            projection={contextProjections?.get(member.profileId)}
            onInspectProfile={onInspectProfile}
          />
        )) : null}
      </div>
    </article>
  );
}

export default function SocialWorldScene({
  scene,
  taverns,
  contextProjections,
  viewerIGT,
  worldRoute,
  onInspectProfile,
  onInspectTavern,
}) {
  const worldViewportRef = useRef(null);
  const locationElementsRef = useRef(new Map());
  const [, setLocationRegistryRevision] = useState(0);
  const registerLocation = useCallback((locationId, node) => {
    const existing = locationElementsRef.current.get(locationId);
    if (node && existing !== node) {
      locationElementsRef.current.set(locationId, node);
      setLocationRegistryRevision((revision) => revision + 1);
    } else if (!node && existing) {
      locationElementsRef.current.delete(locationId);
      setLocationRegistryRevision((revision) => revision + 1);
    }
  }, []);
  const destinationLocationId = resolveWorldRouteLocationId(worldRoute?.locationId);
  const originElement = locationElementsRef.current.get('commons') || null;
  const destinationElement = destinationLocationId
    ? locationElementsRef.current.get(destinationLocationId) || null
    : null;
  const projectedTaverns = useMemo(() => taverns || buildTaverns(scene.members), [scene, taverns]);
  const tavernByLocation = useMemo(() => new Map(
    projectedTaverns.map((tavern) => [tavern.location, tavern]),
  ), [projectedTaverns]);
  const activeMembers = useMemo(() => (
    scene.members.filter((member) => (
      member.presence.state === PRESENCE_STATE.current
      || member.presence.state === PRESENCE_STATE.projected
    ))
  ), [scene]);
  const inactiveMembers = useMemo(() => (
    scene.inactiveMembers.map((profileId) => scene.memberById.get(profileId)).filter(Boolean)
  ), [scene]);
  const activeOthers = activeMembers.filter((member) => member.profileId !== scene.viewer.profileId).length;
  return (
    <section ref={worldViewportRef} className="social-world-scene" aria-label="Tapestry social world">
      <div className="social-world-atmosphere" aria-hidden="true" />
      <header className="social-world-masthead">
        <span>Tapestry / Social World</span>
        <strong id={occupantGroupHeadingId('social-world')} tabIndex="-1">Social World</strong>
        <p>{activeOthers} active nearby · {scene.inactiveMembers.length} away</p>
      </header>

      <div className="social-world-clock" aria-live="polite">
        <span>Viewer IGT</span>
        <strong>{formatWorldIGT(viewerIGT)}</strong>
      </div>

      <svg className="social-world-paths" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <path d="M17 28 C25 15, 33 18, 40 21 S58 16, 68 25 S82 43, 77 64 S61 78, 50 76 S29 77, 23 66 S10 43, 17 28 Z" />
        <path d="M23 66 C32 55, 37 41, 40 21" />
        <path d="M50 76 C52 55, 61 39, 68 25" />
      </svg>

      <div className="social-world-locations">
        {scene.locations.map((location) => (
          <LocationNode
            key={location.id}
            location={location}
            scene={scene}
            tavern={tavernByLocation.get(location.id) || null}
            viewerIGT={viewerIGT}
            contextProjections={contextProjections}
            destinationLocationId={destinationLocationId}
            registerLocation={registerLocation}
            onInspectProfile={onInspectProfile}
            onInspectTavern={onInspectTavern}
          />
        ))}
      </div>

      <WorldRecommendationRoute
        route={worldRoute}
        worldViewportRef={worldViewportRef}
        originElement={originElement}
        destinationElement={destinationElement}
        visible={Boolean(worldRoute && destinationLocationId)}
      />

      <InactiveCastRail members={inactiveMembers} contextProjections={contextProjections} onInspectProfile={onInspectProfile} />

    </section>
  );
}
