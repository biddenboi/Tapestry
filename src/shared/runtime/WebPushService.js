import { ensureTapestryServiceWorker } from './PwaRuntime.js';

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
  const browserSupported = typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'Notification' in window;
  const ios = typeof navigator !== 'undefined'
    && /iPhone|iPad|iPod/i.test(navigator.userAgent || '');
  const standalone = typeof window !== 'undefined'
    && (window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true);
  const installRequired = ios && !standalone;
  return {
    supported: browserSupported && !installRequired,
    browserSupported,
    configured: VAPID_PUBLIC_KEY.length >= 32,
    permission: browserSupported ? Notification.permission : 'unsupported',
    homeScreenRecommended: ios,
    installRequired,
    standalone,
  };
}

export async function inspectWebPush() {
  const capability = getWebPushCapability();
  if (!capability.supported) return { ...capability, subscription: null };
  const registration = await ensureTapestryServiceWorker();
  if (!registration?.pushManager) {
    return { ...capability, supported: false, browserSupported: false, subscription: null };
  }
  const subscription = await registration.pushManager.getSubscription();
  return { ...capability, subscription: publicSubscription(subscription) };
}

export async function enableWebPush(transport) {
  const capability = getWebPushCapability();
  if (capability.installRequired) {
    throw new Error('On iPhone, add Tapestry to the Home Screen and open the installed app before enabling notifications.');
  }
  if (!capability.supported) throw new Error('Web Push is not supported in this browser.');
  if (!VAPID_PUBLIC_KEY) throw new Error('Push delivery has not been provisioned for this build.');
  if (!transport?.registerWebPushSubscription) {
    throw new Error('Private sync must be connected before enabling push delivery.');
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notification permission was not granted.');
  const registration = await ensureTapestryServiceWorker();
  if (!registration?.pushManager) throw new Error('Web Push is not available in this installed app.');
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
  const registration = await ensureTapestryServiceWorker();
  if (!registration?.pushManager) return { ...capability, supported: false, subscription: null };
  const subscription = await registration.pushManager.getSubscription();
  if (subscription) {
    await transport?.unregisterWebPushSubscription?.(subscription.endpoint);
    await subscription.unsubscribe();
  }
  return inspectWebPush();
}
