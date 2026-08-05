import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppContext } from '@app/hooks/useAppContext.js';
import {
  usePanelLifecycle,
  usePanelRequestScope,
} from '@app/panel-lifecycle/PanelLifecycleContext.jsx';
import { getCurrentIGT } from '@domain/time/Time.js';
import { recordAnalyticsEvent } from '@domain/analytics/AnalyticsEvents.js';
import {
  SOCIAL_WORLD_ANALYTICS_EVENT,
  SOCIAL_WORLD_EVALUATION_VERSION,
} from '@domain/social-world/SocialWorldEvaluation.js';
import { buildTaverns } from '@domain/social-world/TavernProjection.js';
import { buildProfileIdentity } from '@domain/profile/ProfileIdentity.js';
import SocialWorldSceneController from '@features/social-world/controllers/SocialWorldSceneController.js';
import SocialWorldProfileCardController from '@features/social-world/controllers/SocialWorldProfileCardController.js';
import { useLiveViewerScene } from '@features/social-world/hooks/useLiveViewerScene.js';
import ProfilePresenceDrawer from '../ProfilePresenceDrawer/ProfilePresenceDrawer.jsx';
import TavernDrawer from '../TavernDrawer/TavernDrawer.jsx';
import SocialWorldScene from './SocialWorldScene.jsx';
import SocialWorldStaticShell from './SocialWorldStaticShell.jsx';
import './SocialWorldShell.css';

export default function SocialWorldRuntime() {
  const {
    databaseConnection,
    currentPlayer,
    domainRevisions,
    openPanel,
    timestamp,
    worldRoute,
  } = useAppContext();
  const { isActive } = usePanelLifecycle();
  const createRequestScope = usePanelRequestScope();
  const controller = useMemo(
    () => new SocialWorldSceneController({ gateway: databaseConnection }),
    [databaseConnection],
  );
  const profileCardController = useMemo(
    () => new SocialWorldProfileCardController({ gateway: databaseConnection }),
    [databaseConnection],
  );
  const [preparedScene, setPreparedScene] = useState(null);
  const [error, setError] = useState(null);
  const [selectedProfileId, setSelectedProfileId] = useState(null);
  const [profileCard, setProfileCard] = useState(null);
  const [profileCardError, setProfileCardError] = useState(null);
  const [contextProjections, setContextProjections] = useState(new Map());
  const [selectedTavernId, setSelectedTavernId] = useState(null);
  const [tavernCards, setTavernCards] = useState([]);
  const [tavernError, setTavernError] = useState(null);
  const tavernEncounterKeys = useRef(new Set());
  const runtimeActive = isActive;
  const viewerIGT = getCurrentIGT(currentPlayer, timestamp);
  const preparedViewerScene = preparedScene?.viewer?.profileId === currentPlayer?.UUID
    ? preparedScene
    : null;
  const scene = useLiveViewerScene(preparedViewerScene, { viewerIGT });
  const taverns = useMemo(() => buildTaverns(scene?.members || []), [scene]);
  const liveProfileCard = useMemo(() => (
    profileCard?.identity?.profileId === currentPlayer?.UUID
      ? { ...profileCard, identity: buildProfileIdentity(currentPlayer) }
      : profileCard
  ), [currentPlayer, profileCard]);
  const liveTavernCards = useMemo(() => tavernCards.map((card) => (
    card?.identity?.profileId === currentPlayer?.UUID
      ? { ...card, identity: buildProfileIdentity(currentPlayer) }
      : card
  )), [currentPlayer, tavernCards]);
  const selectedTavern = selectedTavernId
    ? taverns.find((tavern) => tavern.id === selectedTavernId) || null
    : null;
  const recordVisibleEncounter = useCallback(({ profileId, surface, visibleFacts = [] }) => {
    if (!currentPlayer?.UUID || !profileId || profileId === currentPlayer.UUID) return;
    const operationId = globalThis.crypto?.randomUUID?.()
      || `${surface}:${currentPlayer.UUID}:${profileId}:${Date.now()}:${Math.random()}`;
    profileCardController.recordEncounter({
      viewerId: currentPlayer.UUID,
      profileId,
      viewerIGT: getCurrentIGT(currentPlayer),
      surface,
      visibleFacts,
      operationId,
    }).catch((nextError) => {
      console.warn('[SocialWorld] Encounter memory could not be recorded:', nextError);
    });
  }, [currentPlayer, profileCardController]);

  useEffect(() => {
    if (!runtimeActive || !currentPlayer?.UUID) return undefined;
    const request = createRequestScope();
    setError(null);
    controller.load({
      viewerId: currentPlayer.UUID,
      viewerIGT: getCurrentIGT(currentPlayer),
      signal: request.signal,
    }).then((snapshot) => {
      if (request.isCurrent() && snapshot) setPreparedScene(snapshot);
    }).catch((nextError) => {
      if (request.isCurrent()) setError(nextError);
    }).finally(request.finish);
    return request.cancel;
  }, [
    controller,
    createRequestScope,
    currentPlayer?.UUID,
    domainRevisions.presence,
    domainRevisions.social,
    domainRevisions.socialWorld,
    domainRevisions.profiles,
    runtimeActive,
  ]);

  useEffect(() => {
    if (!runtimeActive || !scene || scene.viewer.profileId !== currentPlayer?.UUID) return;
    recordAnalyticsEvent(databaseConnection, currentPlayer, {
      eventName: SOCIAL_WORLD_ANALYTICS_EVENT.sceneViewed,
      surface: 'social-world',
      targetType: 'scene',
      targetUUID: currentPlayer.UUID,
      metadata: {
        evaluationVersion: SOCIAL_WORLD_EVALUATION_VERSION,
        castSize: scene.members.length,
      },
    }, { dedupeWindowMs: 30_000 }).catch((nextError) => {
      console.warn('[SocialWorld] Scene view could not be recorded:', nextError);
    });
  }, [currentPlayer, databaseConnection, runtimeActive, scene]);

  useEffect(() => {
    setSelectedProfileId(null);
    setProfileCard(null);
    setProfileCardError(null);
    setContextProjections(new Map());
    setSelectedTavernId(null);
    setTavernCards([]);
    setTavernError(null);
  }, [currentPlayer?.UUID]);

  useEffect(() => {
    if (!runtimeActive || !scene?.members?.length || !currentPlayer?.UUID) return undefined;
    let active = true;
    databaseConnection.getProfileContextProjections({
      viewerId: currentPlayer.UUID,
      subjects: scene.members.map((member) => ({
        subjectId: member.profileId,
        relationshipTier: member.visibilityTier,
      })),
      viewerIGT,
      revision: domainRevisions.profileContext,
    }).then((projections) => {
      if (active) setContextProjections(projections);
    }).catch((nextError) => {
      console.warn('[SocialWorld] Context capsules could not be projected:', nextError);
      if (active) setContextProjections(new Map());
    });
    return () => { active = false; };
  }, [
    currentPlayer?.UUID,
    databaseConnection,
    domainRevisions.profileContext,
    runtimeActive,
    scene,
    viewerIGT,
  ]);

  useEffect(() => {
    if (!runtimeActive || !selectedProfileId || !currentPlayer?.UUID) return undefined;
    const request = createRequestScope();
    setProfileCardError(null);
    profileCardController.load({
      viewerId: currentPlayer.UUID,
      profileId: selectedProfileId,
      viewerIGT: getCurrentIGT(currentPlayer),
      signal: request.signal,
    }).then((card) => {
      if (request.isCurrent()) setProfileCard(card);
    }).catch((nextError) => {
      if (request.isCurrent()) setProfileCardError(nextError);
    }).finally(request.finish);
    return request.cancel;
  }, [
    createRequestScope,
    currentPlayer?.UUID,
    domainRevisions.goals,
    domainRevisions.matches,
    domainRevisions.presence,
    domainRevisions.profileContext,
    domainRevisions.profiles,
    domainRevisions.social,
    domainRevisions.socialWorld,
    domainRevisions.tasks,
    profileCardController,
    runtimeActive,
    selectedProfileId,
  ]);

  useEffect(() => {
    if (selectedTavernId && scene && !selectedTavern) {
      setSelectedTavernId(null);
      setTavernCards([]);
      setTavernError(null);
    }
  }, [scene, selectedTavern, selectedTavernId]);

  useEffect(() => {
    if (!runtimeActive || !selectedTavern || !currentPlayer?.UUID) return undefined;
    const request = createRequestScope();
    setTavernError(null);
    if (!selectedTavern.occupants.length) {
      request.finish();
      return undefined;
    }
    const queryIGT = getCurrentIGT(currentPlayer);
    Promise.all(selectedTavern.occupants.map((member) => profileCardController.load({
      viewerId: currentPlayer.UUID,
      profileId: member.profileId,
      viewerIGT: queryIGT,
      signal: request.signal,
    }))).then((cards) => {
      if (request.isCurrent()) setTavernCards(cards.filter(Boolean));
    }).catch((nextError) => {
      if (request.isCurrent()) setTavernError(nextError);
    }).finally(request.finish);
    return request.cancel;
  }, [
    createRequestScope,
    currentPlayer?.UUID,
    domainRevisions.goals,
    domainRevisions.matches,
    domainRevisions.presence,
    domainRevisions.profiles,
    domainRevisions.social,
    domainRevisions.socialWorld,
    domainRevisions.tasks,
    profileCardController,
    runtimeActive,
    selectedTavern,
  ]);

  useEffect(() => {
    if (!runtimeActive || !selectedTavern || !tavernCards.length) return;
    for (const card of tavernCards) {
      if (card.identity.profileId === currentPlayer?.UUID) continue;
      const key = `${selectedTavern.id}:${card.identity.profileId}:${card.asOfIGT}`;
      if (tavernEncounterKeys.current.has(key)) continue;
      tavernEncounterKeys.current.add(key);
      recordVisibleEncounter({
        profileId: card.identity.profileId,
        surface: 'tavern-roster',
        visibleFacts: [],
      });
    }
  }, [currentPlayer?.UUID, recordVisibleEncounter, runtimeActive, selectedTavern, tavernCards]);

  if (!runtimeActive) return <SocialWorldStaticShell />;
  if (error) {
    return <SocialWorldStaticShell label="The world could not be prepared" />;
  }
  if (!scene || scene.viewer.profileId !== currentPlayer?.UUID) {
    return <SocialWorldStaticShell />;
  }

  const selectedMember = selectedProfileId ? scene.memberById.get(selectedProfileId) : null;
  const closeProfileCard = () => {
    setSelectedProfileId(null);
    setProfileCard(null);
    setProfileCardError(null);
  };
  const closeTavern = () => {
    setSelectedTavernId(null);
    setTavernCards([]);
    setTavernError(null);
  };
  const inspectProfile = (profileId) => {
    closeTavern();
    setSelectedProfileId(profileId);
  };
  return (
    <>
      <SocialWorldScene
        scene={scene}
        taverns={taverns}
        contextProjections={contextProjections}
        viewerIGT={viewerIGT}
        worldRoute={worldRoute}
        onInspectProfile={inspectProfile}
        onInspectTavern={(tavernId) => {
          closeProfileCard();
          setSelectedTavernId(tavernId);
        }}
      />
      <TavernDrawer
        open={Boolean(selectedTavernId && selectedTavern)}
        tavern={selectedTavern}
        cards={liveTavernCards}
        loading={Boolean(selectedTavern && selectedTavern.occupants.length
          && !tavernCards.length && !tavernError)}
        error={tavernError}
        viewerIGT={viewerIGT}
        onClose={closeTavern}
        onInspectProfile={inspectProfile}
      />
      <ProfilePresenceDrawer
        analyticsSurface="social-world"
        open={Boolean(selectedProfileId)}
        summary={selectedMember}
        card={liveProfileCard}
        loading={Boolean(selectedProfileId) && !profileCard && !profileCardError}
        error={profileCardError}
        viewerIGT={viewerIGT}
        onClose={closeProfileCard}
        onEncounterVisible={recordVisibleEncounter}
        onOpenProfile={(profileId) => {
          closeProfileCard();
          openPanel?.('profile', profileId);
        }}
      />
    </>
  );
}
