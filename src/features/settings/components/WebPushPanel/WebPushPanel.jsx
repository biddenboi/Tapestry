import { useEffect, useState } from 'react';
import {
  disableWebPush,
  enableWebPush,
  inspectWebPush,
} from '@shared/runtime/WebPushService.js';

export default function WebPushPanel({ databaseConnection }) {
  const [details, setDetails] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    void inspectWebPush().then(setDetails).catch((error) => setMessage(error.message));
  }, []);

  const change = async (enable) => {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      const transport = databaseConnection?.syncRuntime?.transport;
      const next = enable
        ? await enableWebPush(transport)
        : await disableWebPush(transport);
      setDetails(next);
      setMessage(enable ? 'Reminder and routine push delivery is enabled.' : 'Push delivery is disabled on this device.');
    } catch (error) {
      setMessage(error?.message || 'Push settings could not be changed.');
    } finally {
      setBusy(false);
    }
  };

  const enabled = Boolean(details?.subscription);
  const status = !details?.supported
    ? 'Unavailable in this browser'
    : enabled ? 'Enabled on this device'
      : details?.permission === 'denied' ? 'Blocked in browser settings'
        : 'Off';
  return (
    <div className="settings-offline-storage">
      <div>
        <strong>Home Screen push</strong>
        <span>{status}</span>
        {details?.homeScreenRecommended && !enabled && (
          <small>Add Tapestry to the iPhone Home Screen before enabling Web Push.</small>
        )}
      </div>
      <button
        type="button"
        disabled={busy || !details?.supported || (!enabled && !details?.configured)}
        onClick={() => change(!enabled)}
        title={!enabled && !details?.configured ? 'Push delivery key is not provisioned in this build' : undefined}
      >
        {busy ? 'Updating…' : enabled ? 'Disable' : 'Enable push'}
      </button>
      {message && <span className="settings-offline-storage__message">{message}</span>}
    </div>
  );
}
