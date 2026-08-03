export const NEXT_MOVE_DEFAULT_WIDTH = 392;
export const NEXT_MOVE_MIN_WIDTH = 340;
export const NEXT_MOVE_MAX_WIDTH = 480;
export const NEXT_MOVE_EDGE_SNAP_PX = 32;

export function defaultNextMovePlacement(playerUUID) {
  return Object.freeze({
    UUID: String(playerUUID),
    parent: String(playerUUID),
    playerUUID: String(playerUUID),
    mode: 'docked',
    dockEdge: 'right',
    normalizedX: 1,
    normalizedY: 0.5,
    width: NEXT_MOVE_DEFAULT_WIDTH,
    updatedAt: new Date().toISOString(),
  });
}

export function clampNextMovePosition({
  x = 0,
  y = 0,
  width = NEXT_MOVE_DEFAULT_WIDTH,
  height = 560,
  viewportWidth = 1280,
  viewportHeight = 800,
  safeLeft = 76,
  safeTop = 12,
  safeRight = 12,
  safeBottom = 12,
} = {}) {
  const maxX = Math.max(safeLeft, viewportWidth - width - safeRight);
  const maxY = Math.max(safeTop, viewportHeight - Math.min(height, viewportHeight - safeTop - safeBottom) - safeBottom);
  return {
    x: Math.max(safeLeft, Math.min(maxX, Number(x) || 0)),
    y: Math.max(safeTop, Math.min(maxY, Number(y) || 0)),
  };
}

export function placementToPixels(placement, viewport, panel = {}) {
  const width = Math.max(
    NEXT_MOVE_MIN_WIDTH,
    Math.min(NEXT_MOVE_MAX_WIDTH, Number(placement?.width) || NEXT_MOVE_DEFAULT_WIDTH),
  );
  const availableX = Math.max(1, viewport.width - width);
  const availableY = Math.max(1, viewport.height - Number(panel.height || 560));
  const raw = placement?.mode === 'floating'
    ? {
        x: (Number(placement.normalizedX) || 0) * availableX,
        y: (Number(placement.normalizedY) || 0) * availableY,
      }
    : {
        x: placement?.dockEdge === 'left' ? 76 : viewport.width - width,
        y: Math.max(12, (viewport.height - Number(panel.height || 560)) / 2),
      };
  return { ...clampNextMovePosition({
    ...raw,
    width,
    height: panel.height,
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
  }), width };
}

export function pixelsToPlacement({
  playerUUID,
  x,
  y,
  width,
  viewportWidth,
  viewportHeight,
  panelHeight = 560,
  dockEdge = null,
} = {}) {
  const mode = dockEdge ? 'docked' : 'floating';
  const clamped = clampNextMovePosition({
    x,
    y,
    width,
    height: panelHeight,
    viewportWidth,
    viewportHeight,
  });
  return Object.freeze({
    UUID: String(playerUUID),
    parent: String(playerUUID),
    playerUUID: String(playerUUID),
    mode,
    dockEdge: dockEdge || undefined,
    normalizedX: mode === 'floating'
      ? clamped.x / Math.max(1, viewportWidth - width)
      : dockEdge === 'left' ? 0 : 1,
    normalizedY: clamped.y / Math.max(1, viewportHeight - panelHeight),
    width,
    updatedAt: new Date().toISOString(),
  });
}

export function placementForCommand(command, playerUUID, current, viewport, panel = {}) {
  const width = Number(current?.width) || NEXT_MOVE_DEFAULT_WIDTH;
  if (command === 'dock-left' || command === 'dock-right') {
    return pixelsToPlacement({
      playerUUID,
      x: command === 'dock-left' ? 76 : viewport.width - width,
      y: viewport.height / 2,
      width,
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      panelHeight: panel.height,
      dockEdge: command === 'dock-left' ? 'left' : 'right',
    });
  }
  if (command === 'reset') return defaultNextMovePlacement(playerUUID);
  const positions = {
    'top-left': [76, 12],
    'top-right': [viewport.width - width - 12, 12],
    'bottom-left': [76, viewport.height - Number(panel.height || 560) - 12],
    'bottom-right': [viewport.width - width - 12, viewport.height - Number(panel.height || 560) - 12],
    center: [(viewport.width - width) / 2, (viewport.height - Number(panel.height || 560)) / 2],
  };
  const [x, y] = positions[command] || positions.center;
  return pixelsToPlacement({
    playerUUID,
    x,
    y,
    width,
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    panelHeight: panel.height,
  });
}
