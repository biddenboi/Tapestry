function focusIdentifier(value) {
  return encodeURIComponent(String(value || 'unknown').trim());
}

export function occupantFocusTargetId(surface, profileId) {
  return `occupant-${focusIdentifier(surface)}-${focusIdentifier(profileId)}`;
}

export function occupantGroupHeadingId(surface) {
  return `occupant-group-${focusIdentifier(surface)}`;
}

export function createOccupantFocusReturn({
  surface,
  profileId,
  groupSurface = surface,
} = {}) {
  if (!surface || !profileId || !groupSurface) return null;
  return Object.freeze({
    targetId: occupantFocusTargetId(surface, profileId),
    groupId: occupantGroupHeadingId(groupSurface),
  });
}

function focusElement(root, id) {
  const element = id ? root?.getElementById?.(id) : null;
  if (!element || typeof element.focus !== 'function') return false;
  element.focus({ preventScroll: false });
  return 'activeElement' in root ? root.activeElement === element : true;
}

export function restoreOccupantFocus(focusReturn, {
  root = globalThis.document,
  schedule = globalThis.requestAnimationFrame?.bind(globalThis)
    || ((callback) => globalThis.setTimeout(callback, 0)),
  maxAttempts = 18,
} = {}) {
  if (!focusReturn?.targetId || !focusReturn?.groupId || !root) return false;
  let attempt = 0;
  const restore = () => {
    if (focusElement(root, focusReturn.targetId)) return;
    if (attempt < maxAttempts) {
      attempt += 1;
      schedule(restore);
      return;
    }
    focusElement(root, focusReturn.groupId);
  };
  schedule(restore);
  return true;
}
