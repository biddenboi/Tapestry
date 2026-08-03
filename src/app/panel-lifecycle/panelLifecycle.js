export const PANEL_LIFECYCLE_STATE = Object.freeze({
  unloaded: 'unloaded',
  loading: 'loading',
  active: 'active',
  suspended: 'suspended',
  disposed: 'disposed',
});

export const PANEL_LIFECYCLE_EVENT = Object.freeze({
  request: 'request',
  ready: 'ready',
  suspend: 'suspend',
  resume: 'resume',
  dispose: 'dispose',
  reset: 'reset',
});

const TRANSITIONS = Object.freeze({
  [PANEL_LIFECYCLE_STATE.unloaded]: Object.freeze({
    [PANEL_LIFECYCLE_EVENT.request]: PANEL_LIFECYCLE_STATE.loading,
    [PANEL_LIFECYCLE_EVENT.dispose]: PANEL_LIFECYCLE_STATE.disposed,
  }),
  [PANEL_LIFECYCLE_STATE.loading]: Object.freeze({
    [PANEL_LIFECYCLE_EVENT.ready]: PANEL_LIFECYCLE_STATE.active,
    [PANEL_LIFECYCLE_EVENT.suspend]: PANEL_LIFECYCLE_STATE.suspended,
    [PANEL_LIFECYCLE_EVENT.dispose]: PANEL_LIFECYCLE_STATE.disposed,
    [PANEL_LIFECYCLE_EVENT.reset]: PANEL_LIFECYCLE_STATE.unloaded,
  }),
  [PANEL_LIFECYCLE_STATE.active]: Object.freeze({
    [PANEL_LIFECYCLE_EVENT.suspend]: PANEL_LIFECYCLE_STATE.suspended,
    [PANEL_LIFECYCLE_EVENT.dispose]: PANEL_LIFECYCLE_STATE.disposed,
    [PANEL_LIFECYCLE_EVENT.reset]: PANEL_LIFECYCLE_STATE.unloaded,
  }),
  [PANEL_LIFECYCLE_STATE.suspended]: Object.freeze({
    [PANEL_LIFECYCLE_EVENT.resume]: PANEL_LIFECYCLE_STATE.active,
    [PANEL_LIFECYCLE_EVENT.request]: PANEL_LIFECYCLE_STATE.loading,
    [PANEL_LIFECYCLE_EVENT.dispose]: PANEL_LIFECYCLE_STATE.disposed,
    [PANEL_LIFECYCLE_EVENT.reset]: PANEL_LIFECYCLE_STATE.unloaded,
  }),
  [PANEL_LIFECYCLE_STATE.disposed]: Object.freeze({
    [PANEL_LIFECYCLE_EVENT.request]: PANEL_LIFECYCLE_STATE.loading,
    [PANEL_LIFECYCLE_EVENT.reset]: PANEL_LIFECYCLE_STATE.unloaded,
  }),
});

export function transitionPanelLifecycle(state, event) {
  const current = Object.values(PANEL_LIFECYCLE_STATE).includes(state)
    ? state
    : PANEL_LIFECYCLE_STATE.unloaded;
  return TRANSITIONS[current]?.[event] || current;
}

export function createPanelLifecycleSnapshot(panelIds = []) {
  return Object.fromEntries(panelIds.map((panelId) => [panelId, PANEL_LIFECYCLE_STATE.unloaded]));
}

export function isPanelMounted(state) {
  return state !== PANEL_LIFECYCLE_STATE.unloaded
    && state !== PANEL_LIFECYCLE_STATE.disposed;
}

export function canPanelLoad(state) {
  return state === PANEL_LIFECYCLE_STATE.loading
    || state === PANEL_LIFECYCLE_STATE.active;
}

export function isPanelActive(state) {
  return state === PANEL_LIFECYCLE_STATE.active;
}

export function effectivePanelLifecycle(state, visible) {
  if (visible) {
    if (state === PANEL_LIFECYCLE_STATE.unloaded || state === PANEL_LIFECYCLE_STATE.disposed) {
      return PANEL_LIFECYCLE_STATE.loading;
    }
    if (state === PANEL_LIFECYCLE_STATE.suspended) return PANEL_LIFECYCLE_STATE.active;
    return state;
  }
  if (state === PANEL_LIFECYCLE_STATE.loading || state === PANEL_LIFECYCLE_STATE.active) {
    return PANEL_LIFECYCLE_STATE.suspended;
  }
  return state;
}
