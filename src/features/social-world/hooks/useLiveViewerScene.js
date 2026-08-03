import { useMemo } from 'react';
import { useAppContext } from '@app/hooks/useAppContext.js';
import { resolveSemanticLocation } from '@domain/social-world/SemanticLocationPolicy.js';
import { withLiveViewerPresence } from '@domain/social-world/SocialWorldScene.js';
import { getCurrentIGT } from '@domain/time/Time.js';
import { buildProfileIdentity } from '@domain/profile/ProfileIdentity.js';

/**
 * Makes the running application's semantic location authoritative for the
 * active player before a prepared historical scene reaches the UI.
 */
export function useLiveViewerScene(scene, { viewerIGT = null } = {}) {
  const {
    currentPlayer,
    timestamp,
    activeTask: [activeTask],
    gameState: [gameState],
    activePanel: [activePanel],
  } = useAppContext();
  const cursor = viewerIGT == null
    ? getCurrentIGT(currentPlayer, timestamp)
    : Math.max(0, Math.trunc(Number(viewerIGT) || 0));
  const location = resolveSemanticLocation({
    gameState,
    activeTask,
    activePanel,
  });

  const livePanelSource = location === 'commons' && activePanel
    ? { sourceType: 'panel', sourceId: activePanel }
    : { sourceType: null, sourceId: null };

  return useMemo(() => {
    const live = withLiveViewerPresence(scene, {
      profileId: currentPlayer?.UUID,
      location,
      viewerIGT: cursor,
      ...livePanelSource,
    });
    if (!live || !currentPlayer?.UUID) return live;
    const members = Object.freeze(live.members.map((member) => (
      member.profileId === currentPlayer.UUID
        ? Object.freeze({ ...member, identity: buildProfileIdentity(currentPlayer) })
        : member
    )));
    return Object.freeze({
      ...live,
      members,
      memberById: new Map(members.map((member) => [member.profileId, member])),
    });
  }, [
    activePanel,
    activeTask?.createdAt,
    currentPlayer?.UUID,
    currentPlayer?.username,
    currentPlayer?.profilePicture,
    currentPlayer?.activeCosmetics,
    cursor,
    gameState,
    location,
    livePanelSource.sourceId,
    livePanelSource.sourceType,
    scene,
  ]);
}

export default useLiveViewerScene;
