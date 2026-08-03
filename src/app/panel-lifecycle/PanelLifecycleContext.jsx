import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  PANEL_LIFECYCLE_STATE,
  canPanelLoad,
  isPanelActive,
  transitionPanelLifecycle,
  PANEL_LIFECYCLE_EVENT,
} from '@app/panel-lifecycle/panelLifecycle.js';

const DEFAULT_LIFECYCLE = Object.freeze({
  panelId: 'unmanaged',
  state: PANEL_LIFECYCLE_STATE.active,
  canLoad: true,
  isActive: true,
  isSuspended: false,
  isDisposed: false,
});

const PanelLifecycleContext = createContext(DEFAULT_LIFECYCLE);

export function PanelLifecycleProvider({ panelId, state, children }) {
  const value = useMemo(() => ({
    panelId,
    state,
    canLoad: canPanelLoad(state),
    isActive: isPanelActive(state),
    isSuspended: state === PANEL_LIFECYCLE_STATE.suspended,
    isDisposed: state === PANEL_LIFECYCLE_STATE.disposed,
  }), [panelId, state]);
  return (
    <PanelLifecycleContext.Provider value={value}>
      {children}
    </PanelLifecycleContext.Provider>
  );
}

export function usePanelLifecycle() {
  return useContext(PanelLifecycleContext);
}

export function usePanelRequestScope() {
  const { canLoad } = usePanelLifecycle();
  const generationRef = useRef(0);
  const activeRef = useRef(canLoad);
  const controllersRef = useRef(new Set());

  const abortAll = useCallback(() => {
    for (const controller of controllersRef.current) controller.abort();
    controllersRef.current.clear();
  }, []);

  useEffect(() => {
    activeRef.current = canLoad;
    generationRef.current += 1;
    if (!canLoad) abortAll();
    return () => {
      activeRef.current = false;
      generationRef.current += 1;
      abortAll();
    };
  }, [abortAll, canLoad]);

  return useCallback(() => {
    const controller = new AbortController();
    const generation = generationRef.current;
    controllersRef.current.add(controller);
    const finish = () => controllersRef.current.delete(controller);
    const cancel = () => {
      controller.abort();
      finish();
    };
    return {
      signal: controller.signal,
      cancel,
      finish,
      isCurrent: () => (
        activeRef.current
        && generationRef.current === generation
        && !controller.signal.aborted
      ),
    };
  }, []);
}

export function useStandalonePanelLifecycle(panelId, visible, { disposeDelay = 32 } = {}) {
  const [state, setState] = useState(() => (
    visible ? PANEL_LIFECYCLE_STATE.loading : PANEL_LIFECYCLE_STATE.unloaded
  ));

  useEffect(() => {
    let activationTimer = null;
    let disposalTimer = null;
    if (visible) {
      setState((current) => {
        if (current === PANEL_LIFECYCLE_STATE.suspended) {
          return transitionPanelLifecycle(current, PANEL_LIFECYCLE_EVENT.resume);
        }
        return transitionPanelLifecycle(current, PANEL_LIFECYCLE_EVENT.request);
      });
      activationTimer = window.setTimeout(() => {
        setState((current) => (
          current === PANEL_LIFECYCLE_STATE.loading
            ? transitionPanelLifecycle(current, PANEL_LIFECYCLE_EVENT.ready)
            : current
        ));
      }, 0);
    } else {
      setState((current) => transitionPanelLifecycle(current, PANEL_LIFECYCLE_EVENT.suspend));
      disposalTimer = window.setTimeout(() => {
        setState((current) => transitionPanelLifecycle(current, PANEL_LIFECYCLE_EVENT.dispose));
      }, disposeDelay);
    }
    return () => {
      if (activationTimer != null) window.clearTimeout(activationTimer);
      if (disposalTimer != null) window.clearTimeout(disposalTimer);
    };
  }, [disposeDelay, visible]);

  return useMemo(() => ({
    panelId,
    state,
    canLoad: canPanelLoad(state),
    isActive: isPanelActive(state),
    isSuspended: state === PANEL_LIFECYCLE_STATE.suspended,
    isDisposed: state === PANEL_LIFECYCLE_STATE.disposed,
  }), [panelId, state]);
}
