const CHANNEL_NAME = 'tapestry.instance-handoff.v1';
const INSTANCE_ID = globalThis.crypto?.randomUUID?.()
  || `instance:${Date.now()}:${Math.random().toString(36).slice(2)}`;

function handoffId() {
  return globalThis.crypto?.randomUUID?.()
    || `handoff:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

export function isWriterLeaseError(error) {
  return error?.code === 'sqlite-writer-lease-unavailable'
    || /storage is already open|open in another tab|writer lease/i.test(error?.message || error || '');
}

export function installInstanceHandoffResponder({ release, onStandby } = {}) {
  if (typeof BroadcastChannel === 'undefined' || typeof release !== 'function') {
    return () => undefined;
  }
  const channel = new BroadcastChannel(CHANNEL_NAME);
  let releasing = null;
  channel.onmessage = ({ data }) => {
    if (data?.type !== 'request-control' || data?.from === INSTANCE_ID || !data?.requestId) return;
    if (!releasing) {
      releasing = Promise.resolve()
        .then(() => onStandby?.())
        .then(() => release())
        .then(() => {
          channel.postMessage({
            type: 'control-released',
            requestId: data.requestId,
            from: INSTANCE_ID,
          });
        })
        .catch((error) => {
          channel.postMessage({
            type: 'control-release-failed',
            requestId: data.requestId,
            from: INSTANCE_ID,
            message: error?.message || 'The active Tapestry window could not release storage.',
          });
          releasing = null;
        });
    }
  };
  return () => channel.close();
}

export function requestInstanceControl({ timeoutMs = 12_000 } = {}) {
  if (typeof BroadcastChannel === 'undefined') {
    return Promise.resolve({ released: false, reason: 'broadcast-unavailable' });
  }
  const requestId = handoffId();
  const channel = new BroadcastChannel(CHANNEL_NAME);
  return new Promise((resolve, reject) => {
    const timer = globalThis.setTimeout(() => {
      channel.close();
      resolve({ released: false, reason: 'handoff-timeout' });
    }, timeoutMs);
    channel.onmessage = ({ data }) => {
      if (data?.requestId !== requestId) return;
      if (data.type === 'control-released') {
        globalThis.clearTimeout(timer);
        channel.close();
        resolve({ released: true });
      } else if (data.type === 'control-release-failed') {
        globalThis.clearTimeout(timer);
        channel.close();
        reject(new Error(data.message || 'The active Tapestry window could not release storage.'));
      }
    };
    channel.postMessage({ type: 'request-control', requestId, from: INSTANCE_ID });
  });
}

export async function continueInThisInstance({ windowRef = globalThis.window } = {}) {
  await requestInstanceControl();
  windowRef?.location?.reload?.();
}

export default installInstanceHandoffResponder;
