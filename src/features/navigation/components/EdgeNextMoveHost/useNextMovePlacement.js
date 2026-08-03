import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import NextMoveSurfacePreferenceRepository from '@data/persistence/repositories/NextMoveSurfacePreferenceRepository.js';
import {
  defaultNextMovePlacement,
  pixelsToPlacement,
  placementForCommand,
  placementToPixels,
} from '../../services/NextMovePlacementService.js';

function viewport() {
  return {
    width: typeof window === 'undefined' ? 1280 : window.innerWidth,
    height: typeof window === 'undefined' ? 800 : window.innerHeight,
  };
}

export function useNextMovePlacement({
  databaseConnection,
  playerUUID,
  panelRef,
  onAnnouncement,
} = {}) {
  const [placement, setPlacement] = useState(() => defaultNextMovePlacement(playerUUID || 'unknown'));
  const [viewportSize, setViewportSize] = useState(viewport);
  const saveQueueRef = useRef(Promise.resolve());
  const repository = useMemo(
    () => databaseConnection ? new NextMoveSurfacePreferenceRepository(databaseConnection) : null,
    [databaseConnection],
  );

  useEffect(() => {
    if (!repository || !playerUUID) return undefined;
    let active = true;
    repository.get(playerUUID).then((stored) => {
      if (active) setPlacement(stored || defaultNextMovePlacement(playerUUID));
    }).catch(() => {
      if (active) setPlacement(defaultNextMovePlacement(playerUUID));
    });
    return () => { active = false; };
  }, [playerUUID, repository]);

  useEffect(() => {
    const resize = () => setViewportSize(viewport());
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  const panel = {
    height: panelRef?.current?.getBoundingClientRect?.().height || 560,
  };
  const pixels = placementToPixels(placement, viewportSize, panel);
  const persist = useCallback((next, announcement = '') => {
    setPlacement(next);
    if (announcement) onAnnouncement?.(announcement);
    if (repository) {
      saveQueueRef.current = saveQueueRef.current
        .catch(() => undefined)
        .then(() => repository.save(next))
        .catch((error) => {
          console.warn('[NextMove] placement could not be persisted:', error);
        });
    }
    return next;
  }, [onAnnouncement, repository]);
  const moveByCommand = useCallback((command) => {
    const height = panelRef?.current?.getBoundingClientRect?.().height || 560;
    const next = placementForCommand(command, playerUUID, placement, viewport(), { height });
    const label = command.replaceAll('-', ' ');
    return persist(next, `Next Move moved to ${label}`);
  }, [panelRef, persist, placement, playerUUID]);
  const commitPixels = useCallback(({ x, y, dockEdge = null }) => {
    const next = pixelsToPlacement({
      playerUUID,
      x,
      y,
      width: pixels.width,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      panelHeight: panelRef?.current?.getBoundingClientRect?.().height || 560,
      dockEdge,
    });
    return persist(next, dockEdge
      ? `Next Move docked ${dockEdge}`
      : 'Next Move position saved');
  }, [panelRef, persist, pixels.width, playerUUID]);
  return {
    placement,
    pixels,
    moveByCommand,
    commitPixels,
  };
}

export default useNextMovePlacement;
