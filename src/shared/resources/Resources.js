import { v4 as uuid } from 'uuid';
import { STORES } from '@domain/constants.js';

const RESOURCE_REF_TYPE = 'resource';
const resourceObjectUrlCache = new Map();
const resourceObjectUrlKeys = new Map();
const resourceObjectUrlListeners = new Set();
let resourceObjectUrlRevision = 0;
let remoteResourceResolver = null;
let remoteResourceCacheLimitBytes = 0;
const RESOURCE_ACCESS_KEY = 'tapestry.mobile.resource-access.v1';
const DEFAULT_IMAGE_TARGET_KB = 320;
const DEFAULT_IMAGE_MAX_DIM = 1600;
const RESOURCE_IMAGE_LIMITS = {
  avatar: { targetKB: 180, maxDim: 900 },
  profilePicture: { targetKB: 180, maxDim: 900 },
  banner: { targetKB: 320, maxDim: 1800 },
  eventBanner: { targetKB: 280, maxDim: 1600 },
  shopImage: { targetKB: 220, maxDim: 1400 },
  postImage: { targetKB: 240, maxDim: 1600 },
};
const RASTER_IMAGE_TYPES = new Set(['image/bmp', 'image/jpeg', 'image/jpg', 'image/png', 'image/webp']);

function resourceAccessTimes() {
  if (typeof localStorage === 'undefined') return {};
  try { return JSON.parse(localStorage.getItem(RESOURCE_ACCESS_KEY) || '{}'); }
  catch { return {}; }
}

function touchResource(resourceUUID) {
  if (!remoteResourceCacheLimitBytes || typeof localStorage === 'undefined') return;
  const access = resourceAccessTimes();
  access[resourceUUID] = Date.now();
  const entries = Object.entries(access).sort((left, right) => right[1] - left[1]).slice(0, 500);
  localStorage.setItem(RESOURCE_ACCESS_KEY, JSON.stringify(Object.fromEntries(entries)));
}

async function enforceRemoteResourceCache(databaseConnection, keepUUID = null) {
  if (!remoteResourceCacheLimitBytes) return;
  const resources = await databaseConnection.getAll(STORES.resource).catch(() => []);
  const remoteResources = resources.filter((record) => record.remoteCached === true);
  let total = remoteResources.reduce(
    (sum, record) => sum + Math.max(0, Number(record.sizeBytes || record.blob?.size) || 0),
    0,
  );
  if (total <= remoteResourceCacheLimitBytes) return;
  const access = resourceAccessTimes();
  const candidates = remoteResources
    .filter((record) => record.UUID !== keepUUID)
    .sort((left, right) => Number(access[left.UUID] || 0) - Number(access[right.UUID] || 0));
  for (const record of candidates) {
    if (total <= remoteResourceCacheLimitBytes) break;
    // These records are a rebuildable mobile cache; canonical metadata and
    // bytes remain in private cloud storage and can be downloaded again.
    // eslint-disable-next-line no-await-in-loop
    await databaseConnection.remove(STORES.resource, record.UUID).catch(() => false);
    total -= Math.max(0, Number(record.sizeBytes || record.blob?.size) || 0);
    delete access[record.UUID];
  }
  if (typeof localStorage !== 'undefined') localStorage.setItem(RESOURCE_ACCESS_KEY, JSON.stringify(access));
}

export function setRemoteResourceResolver(resolver, { cacheLimitBytes = 25 * 1024 * 1024 } = {}) {
  remoteResourceResolver = typeof resolver === 'function' ? resolver : null;
  remoteResourceCacheLimitBytes = remoteResourceResolver ? Math.max(0, Number(cacheLimitBytes) || 0) : 0;
  resourceObjectUrlRevision += 1;
  for (const listener of resourceObjectUrlListeners) listener();
}

export function isResourceRef(value) {
  return !!value
    && typeof value === 'object'
    && value.type === RESOURCE_REF_TYPE
    && typeof value.resourceUUID === 'string';
}

export function makeResourceRef(resourceUUID) {
  return { type: RESOURCE_REF_TYPE, resourceUUID };
}

export function isDirectMediaValue(value) {
  return typeof value === 'string'
    && (/^data:image\//i.test(value) || /^blob:/i.test(value) || /^https?:\/\//i.test(value));
}

function dataUrlToBlob(dataUrl) {
  const [header, payload = ''] = String(dataUrl || '').split(',');
  const mimeType = header.match(/^data:([^;,]+)/i)?.[1] || 'application/octet-stream';
  const binary = header.includes(';base64')
    ? atob(payload)
    : decodeURIComponent(payload);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mimeType });
}

async function sourceToBlob(source) {
  if (source instanceof Blob) return source;
  if (isDirectMediaValue(source) && String(source).startsWith('data:')) return dataUrlToBlob(source);
  if (typeof source === 'string') {
    const response = await fetch(source);
    return response.blob();
  }
  throw new Error('Unsupported media source.');
}

async function getImageDimensions(blob) {
  if (
    !blob?.type?.startsWith('image/')
    || typeof Image === 'undefined'
    || typeof URL === 'undefined'
    || !URL.createObjectURL
  ) {
    return { width: null, height: null };
  }
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
      image.src = url;
    });
    return { width: image.naturalWidth || null, height: image.naturalHeight || null };
  } catch {
    return { width: null, height: null };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function blobFromCanvas(canvas, type, quality) {
  return new Promise((resolve) => {
    if (!canvas?.toBlob) {
      resolve(null);
      return;
    }
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });
}

async function drawBlobToCanvas(blob, maxDim) {
  if (
    typeof Image === 'undefined'
    || typeof document === 'undefined'
    || typeof URL === 'undefined'
    || !URL.createObjectURL
  ) {
    return null;
  }
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
      image.src = url;
    });
    let width = image.naturalWidth || image.width || 0;
    let height = image.naturalHeight || image.height || 0;
    if (!width || !height) return null;
    if (width > height) {
      if (width > maxDim) {
        height = Math.round((height / width) * maxDim);
        width = maxDim;
      }
    } else if (height > maxDim) {
      width = Math.round((width / height) * maxDim);
      height = maxDim;
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(image, 0, 0, width, height);
    return canvas;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function imageLimitsForKind(kind) {
  const limits = RESOURCE_IMAGE_LIMITS[kind] || {};
  return {
    targetKB: Number(limits.targetKB || DEFAULT_IMAGE_TARGET_KB),
    maxDim: Number(limits.maxDim || DEFAULT_IMAGE_MAX_DIM),
  };
}

async function optimizeImageBlob(blob, options = {}) {
  const mimeType = String(blob?.type || '').toLowerCase();
  if (!RASTER_IMAGE_TYPES.has(mimeType) || options.optimizeImages === false) return blob;
  const { targetKB, maxDim } = {
    ...imageLimitsForKind(options.kind),
    ...options.imageLimits,
  };
  const targetBytes = Math.max(32, Number(targetKB || DEFAULT_IMAGE_TARGET_KB)) * 1024;
  if (blob.size <= targetBytes) return blob;
  const canvas = await drawBlobToCanvas(blob, Math.max(64, Number(maxDim || DEFAULT_IMAGE_MAX_DIM)));
  if (!canvas) return blob;

  let best = null;
  let low = 0.08;
  let high = 0.92;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const quality = (low + high) / 2;
    const candidate = await blobFromCanvas(canvas, 'image/webp', quality)
      || await blobFromCanvas(canvas, 'image/jpeg', quality);
    if (!candidate) break;
    if (!best || Math.abs(candidate.size - targetBytes) < Math.abs(best.size - targetBytes)) {
      best = candidate;
    }
    if (candidate.size > targetBytes) high = quality;
    else low = quality;
  }
  return best && best.size < blob.size ? best : blob;
}

async function hashBlob(blob) {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function fileToResourceRecord(file, options = {}) {
  const sourceBlob = await sourceToBlob(file);
  const blob = await optimizeImageBlob(sourceBlob, options);
  const [{ width, height }, hash] = await Promise.all([
    getImageDimensions(blob),
    hashBlob(blob),
  ]);
  return {
    UUID: options.UUID || uuid(),
    hash,
    mimeType: blob.type || options.mimeType || 'application/octet-stream',
    sizeBytes: blob.size,
    originalSizeBytes: sourceBlob.size > blob.size ? sourceBlob.size : undefined,
    width,
    height,
    blob,
    createdAt: options.createdAt || new Date().toISOString(),
    parent: options.parent || null,
    kind: options.kind || 'image',
    usedBy: Array.isArray(options.usedBy) ? options.usedBy : [],
  };
}

export async function dataUrlToResourceRecord(dataUrl, options = {}) {
  return fileToResourceRecord(dataUrl, options);
}

export async function findOrCreateResource(databaseConnection, source, options = {}) {
  if (!source) return null;
  if (isResourceRef(source)) return source;
  const record = await fileToResourceRecord(source, options);
  const existing = typeof databaseConnection.findResourceByHash === 'function'
    ? await databaseConnection.findResourceByHash(record.hash)
    : (await databaseConnection.getAll(STORES.resource)).find((entry) => entry.hash === record.hash);
  if (existing?.UUID) return makeResourceRef(existing.UUID);
  await databaseConnection.add(STORES.resource, record);
  return makeResourceRef(record.UUID);
}

export async function getResourceObjectUrl(databaseConnection, resourceUUID) {
  if (!resourceUUID) return null;
  const existing = resourceObjectUrlCache.get(resourceUUID);
  if (existing?.url) {
    existing.refCount += 1;
    return existing.url;
  }
  if (existing?.promise) {
    existing.refCount += 1;
    return existing.promise;
  }

  const entry = { url: null, promise: null, refCount: 1 };
  entry.promise = (async () => {
    let record = await databaseConnection.get(STORES.resource, resourceUUID);
    if (!record && remoteResourceResolver) {
      const downloaded = await remoteResourceResolver(resourceUUID);
      if (downloaded?.UUID && (downloaded.blob instanceof Blob || downloaded.dataUrl)) {
        await databaseConnection.add(STORES.resource, downloaded);
        record = downloaded;
        touchResource(resourceUUID);
        void enforceRemoteResourceCache(databaseConnection, resourceUUID);
      }
    }
    if (!record) {
      resourceObjectUrlCache.delete(resourceUUID);
      return null;
    }
    if (record.blob instanceof Blob) {
      touchResource(resourceUUID);
      const url = URL.createObjectURL(record.blob);
      entry.url = url;
      resourceObjectUrlKeys.set(url, resourceUUID);
      return url;
    }
    if (record.dataUrl) {
      resourceObjectUrlCache.delete(resourceUUID);
      return record.dataUrl;
    }
    resourceObjectUrlCache.delete(resourceUUID);
    return null;
  })();
  resourceObjectUrlCache.set(resourceUUID, entry);
  try {
    return await entry.promise;
  } catch (error) {
    resourceObjectUrlCache.delete(resourceUUID);
    throw error;
  } finally {
    entry.promise = null;
    if (entry.url && entry.refCount <= 0) {
      resourceObjectUrlCache.delete(resourceUUID);
      resourceObjectUrlKeys.delete(entry.url);
      URL.revokeObjectURL(entry.url);
    }
  }
}

export function revokeResourceObjectUrl(url) {
  if (typeof url !== 'string' || !url.startsWith('blob:')) return;
  const resourceUUID = resourceObjectUrlKeys.get(url);
  if (!resourceUUID) {
    URL.revokeObjectURL(url);
    return;
  }
  const entry = resourceObjectUrlCache.get(resourceUUID);
  if (!entry) {
    resourceObjectUrlKeys.delete(url);
    URL.revokeObjectURL(url);
    return;
  }
  entry.refCount -= 1;
  if (entry.refCount > 0 || entry.promise) return;
  resourceObjectUrlCache.delete(resourceUUID);
  resourceObjectUrlKeys.delete(url);
  URL.revokeObjectURL(url);
}

export function clearResourceObjectUrlCache() {
  for (const entry of resourceObjectUrlCache.values()) {
    if (entry?.url) URL.revokeObjectURL(entry.url);
  }
  resourceObjectUrlCache.clear();
  resourceObjectUrlKeys.clear();
  resourceObjectUrlRevision += 1;
  for (const listener of resourceObjectUrlListeners) listener();
}

export function getResourceObjectUrlRevision() {
  return resourceObjectUrlRevision;
}

export function subscribeResourceObjectUrlRevision(listener) {
  resourceObjectUrlListeners.add(listener);
  return () => resourceObjectUrlListeners.delete(listener);
}

export async function resolveResourceValue(databaseConnection, value) {
  if (isResourceRef(value)) return getResourceObjectUrl(databaseConnection, value.resourceUUID);
  return isDirectMediaValue(value) ? value : null;
}
