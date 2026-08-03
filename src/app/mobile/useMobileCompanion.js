import { useEffect, useState } from 'react';

const SURFACE_OVERRIDE_KEY = 'tapestry.surface-override.v1';

function explicitMode(windowRef = window) {
  const search = new URLSearchParams(windowRef.location.search);
  if (search.get('mobile') === '1') return true;
  if (search.get('desktop') === '1') return false;
  return null;
}

function storedMode(windowRef = window) {
  const value = windowRef.localStorage?.getItem(SURFACE_OVERRIDE_KEY);
  return value === 'mobile' ? true : value === 'desktop' ? false : null;
}

export function setMobileSurfaceOverride(mode, windowRef = window) {
  if (mode == null || mode === 'auto') windowRef.localStorage?.removeItem(SURFACE_OVERRIDE_KEY);
  else windowRef.localStorage?.setItem(SURFACE_OVERRIDE_KEY, mode === true || mode === 'mobile' ? 'mobile' : 'desktop');
  windowRef.dispatchEvent?.(new Event('tapestry:surface-override'));
}

export function detectMobileCompanion(windowRef = window) {
  const explicit = explicitMode(windowRef);
  if (explicit != null) return explicit;
  const stored = storedMode(windowRef);
  if (stored != null) return stored;
  const standalone = windowRef.matchMedia?.('(display-mode: standalone)').matches
    || windowRef.navigator?.standalone === true;
  if (standalone && windowRef.matchMedia?.('(max-width: 900px)').matches) return true;
  const compactTouch = windowRef.matchMedia?.('(pointer: coarse)').matches
    && windowRef.matchMedia?.('(max-width: 900px)').matches;
  if (compactTouch) return true;
  return Boolean(windowRef.matchMedia?.('(max-width: 760px)').matches);
}

export function useMobileCompanion() {
  const [mobile, setMobile] = useState(() => (
    typeof window !== 'undefined' && detectMobileCompanion(window)
  ));

  useEffect(() => {
    const queries = [
      window.matchMedia('(display-mode: standalone)'),
      window.matchMedia('(pointer: coarse)'),
      window.matchMedia('(max-width: 900px)'),
      window.matchMedia('(max-width: 760px)'),
    ];
    const update = () => setMobile(detectMobileCompanion(window));
    queries.forEach((query) => query.addEventListener?.('change', update));
    window.addEventListener('tapestry:surface-override', update);
    update();
    return () => {
      queries.forEach((query) => query.removeEventListener?.('change', update));
      window.removeEventListener('tapestry:surface-override', update);
    };
  }, []);

  return mobile;
}

export default useMobileCompanion;
