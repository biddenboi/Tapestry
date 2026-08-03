import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppContext } from '@app/hooks/useAppContext.js';
import { getCurrentIGT } from '@domain/time/Time.js';
import { projectDojoRoomRows } from '@domain/social-world/DojoRoom.js';
import { useTaskSession } from '@features/tasks/context/TaskSessionProvider.jsx';
import SocialWorldSceneController from '@features/social-world/controllers/SocialWorldSceneController.js';
import SocialWorldProfileCardController from '@features/social-world/controllers/SocialWorldProfileCardController.js';
import { useLiveViewerScene } from '@features/social-world/hooks/useLiveViewerScene.js';
import DojoRoomController from '@features/matches/controllers/DojoRoomController.js';

export default function useDojoRoomController({
  dojoSessionUUID,
  viewerSessionPoints,
  clockTick,
} = {}) {
  const {
    databaseConnection,
    currentPlayer,
    domainRevisions,
    openPanel,
  } = useAppContext();
  const { snapshot: liveTaskSnapshot } = useTaskSession();
  const sceneController = useMemo(
    () => new SocialWorldSceneController({ gateway: databaseConnection }),
    [databaseConnection],
  );
  const roomController = useMemo(
    () => new DojoRoomController({ gateway: databaseConnection }),
    [databaseConnection],
  );
  const profileCardController = useMemo(
    () => new SocialWorldProfileCardController({ gateway: databaseConnection }),
    [databaseConnection],
  );
  const [preparedScene, setPreparedScene] = useState(null);
  const [facts, setFacts] = useState([]);
  const [roomError, setRoomError] = useState(null);
  const [selectedProfileId, setSelectedProfileId] = useState(null);
  const [profileCard, setProfileCard] = useState(null);
  const [profileCardError, setProfileCardError] = useState(null);
  const viewerIGT = useMemo(
    () => getCurrentIGT(currentPlayer, Date.now()),
    [clockTick, currentPlayer],
  );
  const preparedViewerScene = preparedScene?.viewer?.profileId === currentPlayer?.UUID
    ? preparedScene
    : null;
  const scene = useLiveViewerScene(preparedViewerScene, { viewerIGT });

  useEffect(() => {
    if (!currentPlayer?.UUID) return undefined;
    const abortController = new AbortController();
    setRoomError(null);
    sceneController.load({
      viewerId: currentPlayer.UUID,
      viewerIGT: getCurrentIGT(currentPlayer),
      signal: abortController.signal,
    }).then((nextScene) => {
      if (!abortController.signal.aborted) setPreparedScene(nextScene);
    }).catch((error) => {
      if (!abortController.signal.aborted) {
        setPreparedScene(null);
        setRoomError(error);
      }
    });
    return () => abortController.abort();
  }, [
    currentPlayer?.UUID,
    domainRevisions.presence,
    domainRevisions.profiles,
    domainRevisions.social,
    domainRevisions.socialWorld,
    sceneController,
  ]);

  useEffect(() => {
    if (!scene || scene.viewer.profileId !== currentPlayer?.UUID) {
      setFacts([]);
      return undefined;
    }
    const abortController = new AbortController();
    roomController.load({
      scene,
      viewerIGT: getCurrentIGT(currentPlayer),
      dojoSessionUUID,
      signal: abortController.signal,
    }).then((nextFacts) => {
      if (!abortController.signal.aborted) setFacts(nextFacts);
    }).catch((error) => {
      if (!abortController.signal.aborted) {
        setFacts([]);
        setRoomError(error);
      }
    });
    return () => abortController.abort();
  }, [
    currentPlayer?.UUID,
    dojoSessionUUID,
    domainRevisions.tasks,
    roomController,
    scene,
  ]);

  useEffect(() => {
    if (!selectedProfileId || !currentPlayer?.UUID) return undefined;
    const abortController = new AbortController();
    setProfileCard(null);
    setProfileCardError(null);
    profileCardController.load({
      viewerId: currentPlayer.UUID,
      profileId: selectedProfileId,
      viewerIGT: getCurrentIGT(currentPlayer),
      signal: abortController.signal,
    }).then((card) => {
      if (!abortController.signal.aborted) setProfileCard(card);
    }).catch((error) => {
      if (!abortController.signal.aborted) setProfileCardError(error);
    });
    return () => abortController.abort();
  }, [
    currentPlayer?.UUID,
    domainRevisions.goals,
    domainRevisions.matches,
    domainRevisions.presence,
    domainRevisions.profiles,
    domainRevisions.social,
    domainRevisions.socialWorld,
    domainRevisions.tasks,
    profileCardController,
    selectedProfileId,
  ]);

  useEffect(() => {
    setSelectedProfileId(null);
    setProfileCard(null);
    setProfileCardError(null);
  }, [currentPlayer?.UUID]);

  const rows = useMemo(() => projectDojoRoomRows({
    scene,
    facts,
    viewerIGT,
    dojoSessionUUID,
    liveTaskSnapshot,
    viewerSessionPoints,
  }), [
    dojoSessionUUID,
    facts,
    liveTaskSnapshot,
    scene,
    viewerIGT,
    viewerSessionPoints,
  ]);
  const selectedMember = selectedProfileId ? scene?.memberById?.get(selectedProfileId) : null;

  const closeProfile = useCallback(() => {
    setSelectedProfileId(null);
    setProfileCard(null);
    setProfileCardError(null);
  }, []);
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
    }).catch((error) => console.warn('[PracticeDojo] encounter memory failed:', error));
  }, [currentPlayer, profileCardController]);
  const inspectProfile = useCallback((profileId) => {
    const member = scene?.memberById?.get(profileId);
    if (!member) {
      closeProfile();
      openPanel('profile', profileId);
      return;
    }
    setSelectedProfileId(profileId);
  }, [closeProfile, openPanel, scene]);
  const openFullProfile = useCallback((profileId) => {
    closeProfile();
    openPanel('profile', profileId);
  }, [closeProfile, openPanel]);

  return {
    closeProfile,
    error: roomError,
    inspectProfile,
    loading: !scene && !roomError,
    openFullProfile,
    profileCard,
    profileCardError,
    recordVisibleEncounter,
    rows,
    scene,
    selectedMember,
    selectedProfileId,
    viewerIGT,
  };
}
