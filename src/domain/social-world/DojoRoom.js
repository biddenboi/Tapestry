import {
  PRESENCE_STATE,
  SEMANTIC_LOCATION,
} from './SocialWorldContracts.js';

export const MAX_DOJO_ROOM_OCCUPANTS = 16;

function asId(value) {
  return value == null ? '' : String(value);
}

function finite(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function isDojoOccupant(member, viewerIGT) {
  const presence = member?.presence;
  if (presence?.location !== SEMANTIC_LOCATION.dojo) return false;
  if (![PRESENCE_STATE.current, PRESENCE_STATE.projected].includes(presence.state)) return false;
  const endedIGT = presence.endedIGT == null ? null : finite(presence.endedIGT, null);
  return endedIGT == null || finite(viewerIGT) < endedIGT;
}

export function selectDojoRoomMembers(scene, viewerIGT = scene?.viewer?.inGameTime) {
  const viewerId = asId(scene?.viewer?.profileId);
  return Object.freeze((scene?.members || [])
    .filter((member) => isDojoOccupant(member, viewerIGT))
    .slice(0, MAX_DOJO_ROOM_OCCUPANTS)
    .map((member) => Object.freeze({
      ...member,
      isViewer: asId(member.profileId) === viewerId,
    }))
    .sort((left, right) => Number(right.isViewer) - Number(left.isViewer)));
}

export function buildDojoRoomFactRequest({ scene, viewerIGT, dojoSessionUUID } = {}) {
  return selectDojoRoomMembers(scene, viewerIGT)
    .map((member) => Object.freeze({
    profileId: asId(member.profileId),
    sessionId: member.isViewer
      ? asId(dojoSessionUUID || member.presence?.sourceId) || null
      : asId(member.presence?.sourceId) || null,
    }));
}

function projectElapsed(presence, sceneIGT, viewerIGT) {
  const startedIGT = finite(presence?.startedIGT, null);
  if (startedIGT == null) return null;
  const endedIGT = presence?.endedIGT == null ? null : finite(presence.endedIGT, null);
  const boundary = endedIGT == null
    ? finite(viewerIGT, startedIGT)
    : Math.min(finite(viewerIGT, startedIGT), endedIGT);
  return Math.max(0, boundary - startedIGT);
}

function projectFocused(presence, sceneIGT, viewerIGT, forcePaused = false) {
  if (presence?.activeElapsed == null) return null;
  const baseline = Math.max(0, finite(presence.activeElapsed));
  if (presence.paused || forcePaused) return baseline;
  const endedIGT = presence.endedIGT == null ? null : finite(presence.endedIGT, null);
  const boundary = endedIGT == null
    ? finite(viewerIGT, sceneIGT)
    : Math.min(finite(viewerIGT, sceneIGT), endedIGT);
  return baseline + Math.max(0, boundary - finite(sceneIGT));
}

function isLiveViewerTask(snapshot, dojoSessionUUID) {
  if (!snapshot || snapshot.sourceGameState !== 'dojo') return false;
  return !dojoSessionUUID
    || asId(snapshot.sourceDojoSessionUUID) === asId(dojoSessionUUID);
}

export function projectDojoRoomRows({
  scene,
  facts = [],
  viewerIGT = scene?.viewer?.inGameTime,
  dojoSessionUUID = null,
  liveTaskSnapshot = null,
  viewerSessionPoints = null,
} = {}) {
  const sceneIGT = finite(scene?.viewer?.inGameTime);
  const factByProfile = new Map((facts || []).map((fact) => [asId(fact.profileId), fact]));
  const liveViewerTask = isLiveViewerTask(liveTaskSnapshot, dojoSessionUUID)
    ? liveTaskSnapshot
    : null;

  return Object.freeze(selectDojoRoomMembers(scene, viewerIGT).map((member) => {
    const fact = factByProfile.get(asId(member.profileId)) || {};
    const expectedSessionId = member.isViewer
      ? asId(dojoSessionUUID || member.presence?.sourceId)
      : asId(member.presence?.sourceId);
    const factMatches = !expectedSessionId || asId(fact.sessionId) === expectedSessionId;
    const liveViewerPaused = Boolean(member.isViewer && liveViewerTask?.pausedAtMs != null);
    const presenceFocused = projectFocused(
      member.presence,
      sceneIGT,
      viewerIGT,
      liveViewerPaused,
    );
    const focusedMs = member.isViewer && liveViewerTask
      ? Math.max(presenceFocused || 0, Math.max(0, finite(liveViewerTask.elapsedMs)))
      : presenceFocused;
    const paused = member.isViewer && liveViewerTask
      ? liveViewerPaused
      : Boolean(member.presence?.paused);
    const sessionPoints = member.isViewer && viewerSessionPoints != null
      ? Math.max(0, finite(viewerSessionPoints))
      : Math.max(0, factMatches ? finite(fact.sessionPoints) : 0);
    const taskLabel = member.isViewer && liveViewerTask?.task?.name
      ? String(liveViewerTask.task.name)
      : factMatches && fact.taskLabel
        ? String(fact.taskLabel)
        : null;

    return Object.freeze({
      profileId: asId(member.profileId),
      presenceIntervalId: member.presence.intervalId || null,
      identity: member.identity,
      role: member.role,
      presenceState: member.presence.state,
      elapsedHere: projectElapsed(member.presence, sceneIGT, viewerIGT),
      focusedMs,
      sessionId: expectedSessionId || null,
      sessionPoints,
      taskLabel,
      isViewer: member.isViewer,
      paused,
      statusLabel: paused
        ? 'Paused in the room'
        : member.presence.state === PRESENCE_STATE.current
          ? 'Focusing now'
          : 'Recorded focus',
    });
  }));
}

export default projectDojoRoomRows;
