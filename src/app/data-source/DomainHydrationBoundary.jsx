import { useEffect, useMemo, useState } from 'react';
import { useAppContext } from '@app/hooks/useAppContext.js';
import { normalizeHydrationDomains } from '@data/db/domainHydration.js';

function hydrationErrorMessage(error) {
  return error?.message || 'The required panel data could not be loaded.';
}

export default function DomainHydrationBoundary({
  domains,
  enabled = true,
  fallback = null,
  onReady,
  children,
}) {
  const { ensureDomainLoaded, isDomainLoaded } = useAppContext();
  const normalized = useMemo(
    () => normalizeHydrationDomains(domains),
    [domains],
  );
  const domainKey = normalized.join('|');
  const alreadyLoaded = normalized.every((domain) => isDomainLoaded(domain));
  const [status, setStatus] = useState(alreadyLoaded ? 'ready' : 'idle');
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    if (!enabled) {
      setStatus(alreadyLoaded ? 'ready' : 'idle');
      setError(null);
      return () => { cancelled = true; };
    }
    if (alreadyLoaded || normalized.length === 0) {
      setStatus('ready');
      setError(null);
      onReady?.();
      return () => { cancelled = true; };
    }

    setStatus('loading');
    setError(null);
    ensureDomainLoaded(normalized)
      .then(() => {
        if (cancelled) return;
        setStatus('ready');
        onReady?.();
      })
      .catch((nextError) => {
        if (cancelled) return;
        console.warn('[DomainHydration] panel domain load failed:', domainKey, nextError);
        setError(nextError);
        setStatus('error');
      });
    return () => { cancelled = true; };
  }, [alreadyLoaded, attempt, domainKey, enabled, ensureDomainLoaded, normalized, onReady]);

  if (status === 'ready') return children;
  if (status === 'error') {
    return (
      <div className="domain-hydration-error" role="alert">
        <strong>Panel data could not be loaded</strong>
        <span>{hydrationErrorMessage(error)}</span>
        <span>Retry the SQLite read. Restore a verified save if the problem persists.</span>
        <button type="button" onClick={() => setAttempt((value) => value + 1)}>Retry</button>
      </div>
    );
  }
  return fallback;
}
