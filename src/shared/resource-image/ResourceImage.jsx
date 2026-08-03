import {
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from 'react';
import { AppContext } from '@app/context/AppContext.js';
import {
  isResourceRef,
  getResourceObjectUrlRevision,
  resolveResourceValue,
  revokeResourceObjectUrl,
  subscribeResourceObjectUrlRevision,
} from '@shared/resources/Resources.js';
import '@shared/resource-image/ResourceImage.css';

export function useResourceUrl(value, explicitDatabaseConnection = null) {
  const context = useContext(AppContext);
  const databaseConnection = explicitDatabaseConnection || context?.databaseConnection;
  const [url, setUrl] = useState(() => (typeof value === 'string' ? value : null));
  const cacheRevision = useSyncExternalStore(
    subscribeResourceObjectUrlRevision,
    getResourceObjectUrlRevision,
    getResourceObjectUrlRevision,
  );
  const valueKey = isResourceRef(value)
    ? `resource:${value.resourceUUID}`
    : `direct:${String(value || '')}`;

  useEffect(() => {
    let active = true;
    let objectUrl = null;
    if (!value) {
      setUrl(null);
      return undefined;
    }
    if (!isResourceRef(value)) {
      setUrl(typeof value === 'string' ? value : null);
      return undefined;
    }
    if (!databaseConnection) {
      setUrl(null);
      return undefined;
    }
    setUrl(null);
    resolveResourceValue(databaseConnection, value)
      .then((resolved) => {
        if (!active) {
          revokeResourceObjectUrl(resolved);
          return;
        }
        objectUrl = resolved;
        setUrl(resolved);
      })
      .catch(() => active && setUrl(null));
    return () => {
      active = false;
      revokeResourceObjectUrl(objectUrl);
    };
  }, [cacheRevision, databaseConnection, valueKey]);

  return url;
}

export default function ResourceImage({
  value,
  alt = '',
  className = '',
  fallback = null,
  loading = 'lazy',
  decoding = 'async',
  draggable = false,
}) {
  const url = useResourceUrl(value);
  const [failedUrl, setFailedUrl] = useState(null);
  useEffect(() => setFailedUrl(null), [url]);
  if (!url || failedUrl === url) return fallback;
  return (
    <img
      src={url}
      alt={alt}
      className={`resource-image ${className}`.trim()}
      loading={loading}
      decoding={decoding}
      draggable={draggable}
      onError={() => setFailedUrl(url)}
    />
  );
}
