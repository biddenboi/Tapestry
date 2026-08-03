import { useCallback, useEffect, useRef, useState } from 'react';
import {
  PANEL_LIFECYCLE_EVENT,
  PANEL_LIFECYCLE_STATE,
  createPanelLifecycleSnapshot,
  isPanelMounted,
  transitionPanelLifecycle,
} from '@app/panel-lifecycle/panelLifecycle.js';

export function usePanelLifecycleRegistry(panelIds, { disposeDelay = 32 } = {}) {
  const stableIdsRef = useRef(panelIds);
  const [states, setStates] = useState(() => createPanelLifecycleSnapshot(stableIdsRef.current));
  const statesRef = useRef(states);
  const desiredActiveRef = useRef(new Set());
  const disposalTimersRef = useRef(new Map());

  useEffect(() => {
    statesRef.current = states;
  }, [states]);

  const clearDisposal = useCallback((panelId) => {
    const timer = disposalTimersRef.current.get(panelId);
    if (timer != null) window.clearTimeout(timer);
    disposalTimersRef.current.delete(panelId);
  }, []);

  const update = useCallback((panelId, event) => {
    setStates((current) => {
      const previous = current[panelId] || PANEL_LIFECYCLE_STATE.unloaded;
      const next = transitionPanelLifecycle(previous, event);
      if (next === previous) return current;
      const updated = { ...current, [panelId]: next };
      statesRef.current = updated;
      return updated;
    });
  }, []);

  const activate = useCallback((panelId) => {
    desiredActiveRef.current.add(panelId);
    clearDisposal(panelId);
    setStates((current) => {
      const previous = current[panelId] || PANEL_LIFECYCLE_STATE.unloaded;
      const event = previous === PANEL_LIFECYCLE_STATE.suspended
        ? PANEL_LIFECYCLE_EVENT.resume
        : PANEL_LIFECYCLE_EVENT.request;
      const next = transitionPanelLifecycle(previous, event);
      if (next === previous) return current;
      const updated = { ...current, [panelId]: next };
      statesRef.current = updated;
      return updated;
    });
  }, [clearDisposal]);

  const ready = useCallback((panelId) => {
    clearDisposal(panelId);
    setStates((current) => {
      const previous = current[panelId] || PANEL_LIFECYCLE_STATE.unloaded;
      if (!desiredActiveRef.current.has(panelId)) {
        const suspended = transitionPanelLifecycle(previous, PANEL_LIFECYCLE_EVENT.suspend);
        if (suspended === previous) return current;
        const updated = { ...current, [panelId]: suspended };
        statesRef.current = updated;
        return updated;
      }
      const next = previous === PANEL_LIFECYCLE_STATE.suspended
        ? transitionPanelLifecycle(previous, PANEL_LIFECYCLE_EVENT.resume)
        : transitionPanelLifecycle(previous, PANEL_LIFECYCLE_EVENT.ready);
      if (next === previous) return current;
      const updated = { ...current, [panelId]: next };
      statesRef.current = updated;
      return updated;
    });
  }, [clearDisposal]);

  const suspend = useCallback((panelId, { dispose = true } = {}) => {
    desiredActiveRef.current.delete(panelId);
    clearDisposal(panelId);
    const currentState = statesRef.current[panelId] || PANEL_LIFECYCLE_STATE.unloaded;
    if (!isPanelMounted(currentState)) return;
    update(panelId, PANEL_LIFECYCLE_EVENT.suspend);
    if (!dispose) return;
    const timer = window.setTimeout(() => {
      disposalTimersRef.current.delete(panelId);
      if (!desiredActiveRef.current.has(panelId)) {
        update(panelId, PANEL_LIFECYCLE_EVENT.dispose);
      }
    }, disposeDelay);
    disposalTimersRef.current.set(panelId, timer);
  }, [clearDisposal, disposeDelay, update]);

  const dispose = useCallback((panelId) => {
    desiredActiveRef.current.delete(panelId);
    clearDisposal(panelId);
    update(panelId, PANEL_LIFECYCLE_EVENT.dispose);
  }, [clearDisposal, update]);

  useEffect(() => () => {
    for (const timer of disposalTimersRef.current.values()) window.clearTimeout(timer);
    disposalTimersRef.current.clear();
  }, []);

  return {
    states,
    activate,
    ready,
    suspend,
    dispose,
    isMounted: (panelId) => isPanelMounted(states[panelId]),
  };
}
