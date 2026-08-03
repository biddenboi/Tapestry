import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

const MobileSurfaceContext = createContext(null);

function pushOverlayHistory(key) {
  if (typeof window === 'undefined') return false;
  window.history.pushState({
    ...(window.history.state || {}),
    tapestryMobileOverlay: key,
  }, '', window.location.href);
  return true;
}

export function MobileSurfaceProvider({ children }) {
  const [surface, setSurface] = useState(null);
  const [feedback, setFeedback] = useState([]);
  const [primaryAction, setPrimaryAction] = useState(null);
  const surfaceRef = useRef(null);
  const dismissGuardRef = useRef(null);
  const historyOwnedRef = useRef(false);
  const invokerRef = useRef(null);

  useEffect(() => { surfaceRef.current = surface; }, [surface]);

  const openSurface = useCallback((type, payload = {}) => {
    const next = { type, payload, key: `${type}:${Date.now()}:${Math.random()}` };
    if (!surfaceRef.current) {
      historyOwnedRef.current = pushOverlayHistory(next.key);
      invokerRef.current = typeof document === 'undefined' ? null : document.activeElement;
    }
    dismissGuardRef.current = null;
    surfaceRef.current = next;
    setSurface(next);
    return next.key;
  }, []);

  const closeSurface = useCallback(({ force = false, fromHistory = false } = {}) => {
    if (!force && dismissGuardRef.current && dismissGuardRef.current() === false) return false;
    dismissGuardRef.current = null;
    surfaceRef.current = null;
    setSurface(null);
    if (!fromHistory && historyOwnedRef.current && typeof window !== 'undefined') {
      historyOwnedRef.current = false;
      window.history.back();
    } else {
      historyOwnedRef.current = false;
    }
    const invoker = invokerRef.current;
    invokerRef.current = null;
    if (invoker?.focus && typeof window !== 'undefined') window.requestAnimationFrame(() => invoker.focus());
    return true;
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onPopState = () => {
      if (!surfaceRef.current) return;
      if (dismissGuardRef.current && dismissGuardRef.current() === false) {
        historyOwnedRef.current = pushOverlayHistory(surfaceRef.current.key);
        return;
      }
      closeSurface({ force: true, fromHistory: true });
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [closeSurface]);

  const registerDismissGuard = useCallback((guard) => {
    dismissGuardRef.current = typeof guard === 'function' ? guard : null;
    return () => {
      if (dismissGuardRef.current === guard) dismissGuardRef.current = null;
    };
  }, []);

  const presentFeedback = useCallback((event) => {
    if (!event?.id || !event?.type) return;
    setFeedback((events) => [...events.filter(({ id }) => id !== event.id), event].slice(-4));
    const duration = event.significance === 'major' ? 5200 : event.significance === 'meaningful' ? 3600 : 2400;
    const schedule = typeof window === 'undefined' ? setTimeout : window.setTimeout;
    schedule(() => {
      setFeedback((events) => events.filter(({ id }) => id !== event.id));
    }, duration);
  }, []);

  const dismissFeedback = useCallback((id) => {
    setFeedback((events) => events.filter((event) => event.id !== id));
  }, []);

  const registerPrimaryAction = useCallback((action) => {
    setPrimaryAction(action || null);
    return () => setPrimaryAction((current) => current === action ? null : current);
  }, []);

  const value = useMemo(() => ({
    surface,
    openSurface,
    closeSurface,
    registerDismissGuard,
    feedback,
    presentFeedback,
    dismissFeedback,
    primaryAction,
    registerPrimaryAction,
  }), [
    surface,
    openSurface,
    closeSurface,
    registerDismissGuard,
    feedback,
    presentFeedback,
    dismissFeedback,
    primaryAction,
    registerPrimaryAction,
  ]);

  return <MobileSurfaceContext.Provider value={value}>{children}</MobileSurfaceContext.Provider>;
}

export function useMobileSurface() {
  const value = useContext(MobileSurfaceContext);
  if (!value) throw new Error('useMobileSurface must be used inside MobileSurfaceProvider.');
  return value;
}

export default MobileSurfaceContext;
