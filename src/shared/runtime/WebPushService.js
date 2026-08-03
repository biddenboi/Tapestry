const VAPID_PUBLIC_KEY = String(import.meta.env?.VITE_WEB_PUSH_PUBLIC_KEY || '').trim();

function base64UrlBytes(value) {
  const normalized = String(value).replaceAll('-', '+').replaceAll('_', '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const raw = atob(padded);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

function publicSubscription(subscription) {
  if (!subscription) return null;
  const json = subscription.toJSON();
  return {
    endpoint: json.endpoint,
    expirationTime: json.expirationTime ?? null,
    keys: {
      p256dh: json.keys?.p256dh || '',
      auth: json.keys?.auth || '',
    },
  };
}

export function getWebPushCapability() {
  const supported = typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window;
  return {
    supported,
    configured: VAPID_PUBLIC_KEY.length >= 32,
    permission: supported ? Notification.permission : 'unsupported',
    homeScreenRecommended: typeof navigator !== 'undefined'
      && /iPhone|iPad|iPod/i.test(navigator.userAgent || ''),
  };
}

export async function inspectWebPush() {
  const capability = getWebPushCapability();
  if (!capability.supported) return { ...capability, subscription: null };
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  return { ...capability, subscription: publicSubscription(subscription) };
}

export async function enableWebPush(transport) {
  const capability = getWebPushCapability();
  if (!capability.supported) throw new Error('Web Push is not supported in this browser.');
  if (!VAPID_PUBLIC_KEY) throw new Error('Push delivery has not been provisioned for this build.');
  if (!transport?.registerWebPushSubscription) {
    throw new Error('Private sync must be connected before enabling push delivery.');
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notification permission was not granted.');
  const registration = await navigator.serviceWorker.ready;
  const current = await registration.pushManager.getSubscription();
  const subscription = current || await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: base64UrlBytes(VAPID_PUBLIC_KEY),
  });
  const serialized = publicSubscription(subscription);
  await transport.registerWebPushSubscription(serialized);
  return inspectWebPush();
}

export async function disableWebPush(transport) {
  const capability = getWebPushCapability();
  if (!capability.supported) return { ...capability, subscription: null };
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (subscription) {
    await transport?.unregisterWebPushSubscription?.(subscription.endpoint);
    await subscription.unsubscribe();
  }
  return inspectWebPush();
}
