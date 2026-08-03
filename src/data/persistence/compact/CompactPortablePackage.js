import { sha256Bytes } from '../resources/ResourceOperationService.js';

export const COMPACT_PACKAGE_FORMAT = 'tapestry-compact-sqlite';
export const COMPACT_PACKAGE_VERSION = 1;

const encoder = new TextEncoder();
const IMAGE_TYPES = Object.freeze({
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
});

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

export const stableJson = (value) => JSON.stringify(stable(value), null, 2);

export async function findCompactPackageManifest(zip) {
  const paths = Object.keys(zip?.files || {})
    .map((path) => String(path).replaceAll('\\', '/'))
    .filter((path) => (
      path === 'manifest.json'
      || (path.endsWith('/manifest.json')
        && !path.startsWith('__MACOSX/')
        && !path.includes('/__MACOSX/'))
    ))
    .sort((left, right) => (
      left === 'manifest.json' ? -1
        : right === 'manifest.json' ? 1
          : left.split('/').length - right.split('/').length
    ));
  for (const path of paths) {
    const file = zip.file(path);
    if (!file) continue;
    try {
      const manifest = JSON.parse(await file.async('string'));
      if (manifest?.format === COMPACT_PACKAGE_FORMAT) {
        return {
          manifest,
          root: path.slice(0, -'manifest.json'.length),
        };
      }
      if (path === 'manifest.json') return { manifest, root: '' };
    } catch {
      if (path === 'manifest.json') throw new Error('The Tapestry package manifest is not valid JSON.');
    }
  }
  return { manifest: null, root: '' };
}

function dataUrlBytes(value) {
  const match = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=\s]+)$/i.exec(String(value || ''));
  if (!match) return null;
  const decoded = atob(match[2].replace(/\s/g, ''));
  return {
    mimeType: match[1].toLowerCase(),
    bytes: Uint8Array.from(decoded, (character) => character.charCodeAt(0)),
  };
}

export async function collectDeduplicatedImages(records = []) {
  const images = new Map();
  const seen = new WeakSet();
  const visit = async (value) => {
    if (typeof value === 'string') {
      const image = dataUrlBytes(value);
      if (!image) return;
      const hash = await sha256Bytes(image.bytes);
      const extension = IMAGE_TYPES[image.mimeType];
      images.set(hash, {
        hash,
        mimeType: image.mimeType,
        path: `images/${hash}.${extension}`,
        bytes: image.bytes,
      });
      return;
    }
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (typeof Blob !== 'undefined' && value instanceof Blob && IMAGE_TYPES[value.type]) {
      const bytes = new Uint8Array(await value.arrayBuffer());
      const hash = await sha256Bytes(bytes);
      images.set(hash, {
        hash,
        mimeType: value.type,
        path: `images/${hash}.${IMAGE_TYPES[value.type]}`,
        bytes,
      });
      return;
    }
    for (const child of Array.isArray(value) ? value : Object.values(value)) await visit(child);
  };
  await visit(records);
  return [...images.values()].sort((left, right) => left.path.localeCompare(right.path));
}

function packModelValue(value, numbers) {
  if (Array.isArray(value) && value.length && value.every((entry) => Number.isFinite(entry))) {
    const offset = numbers.length;
    numbers.push(...value.map(Number));
    return { $f64: [offset, value.length] };
  }
  if (Array.isArray(value)) return value.map((entry) => packModelValue(entry, numbers));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !['trainingBuffer', 'replayBuffer', 'temporaryBatch'].includes(key))
      .map(([key, entry]) => [key, packModelValue(entry, numbers)]));
  }
  return value;
}

export function buildCompactModelArtifacts(appSettings = []) {
  const checkpoint = [...appSettings]
    .filter((record) => /recommender.*checkpoint|checkpoint.*recommender/i.test(String(record?.UUID || '')))
    .sort((left, right) => String(right?.value?.manifest?.updatedAt || '').localeCompare(
      String(left?.value?.manifest?.updatedAt || ''),
    ))[0] || null;
  const numbers = [];
  let checkpointMetadata = null;
  if (checkpoint) {
    const value = checkpoint.value || {};
    const sameTarget = value.model != null
      && value.targetModel != null
      && stableJson(value.model) === stableJson(value.targetModel);
    checkpointMetadata = {
      UUID: checkpoint.UUID,
      manifest: value.manifest || null,
      model: packModelValue(value.model || null, numbers),
      targetModel: sameTarget
        ? { $ref: 'model' }
        : packModelValue(value.targetModel || null, numbers),
    };
  }
  const bytes = new Uint8Array(8 + numbers.length * 8);
  bytes.set(encoder.encode('TPM1'), 0);
  new DataView(bytes.buffer).setUint32(4, numbers.length, true);
  numbers.forEach((number, index) => new DataView(bytes.buffer).setFloat64(8 + index * 8, number, true));
  return {
    bytes,
    metadata: {
      format: 'tapestry-model-f64',
      version: 1,
      numericEncoding: 'float64-le',
      numericValueCount: numbers.length,
      checkpoint: checkpointMetadata,
    },
  };
}

export async function buildCompactManifest({
  snapshot,
  model,
  images,
  createdAt = new Date().toISOString(),
  kind = 'save',
  durability = null,
}) {
  const modelMetadataBytes = encoder.encode(stableJson(model.metadata));
  return {
    format: COMPACT_PACKAGE_FORMAT,
    version: COMPACT_PACKAGE_VERSION,
    kind,
    createdAt,
    database: {
      path: 'tapestry.sqlite',
      byteLength: snapshot.byteArray.byteLength,
      sha256: await sha256Bytes(snapshot.byteArray),
      migrations: snapshot.migrations,
    },
    model: {
      binaryPath: 'model/model.bin',
      binaryByteLength: model.bytes.byteLength,
      binarySha256: await sha256Bytes(model.bytes),
      metadataPath: 'model/metadata.json',
      metadataByteLength: modelMetadataBytes.byteLength,
      metadataSha256: await sha256Bytes(modelMetadataBytes),
    },
    ...(durability ? { durability } : {}),
    images: await Promise.all(images.map(async (image) => ({
      path: image.path,
      mimeType: image.mimeType,
      byteLength: image.bytes.byteLength,
      sha256: await sha256Bytes(image.bytes),
    }))),
  };
}

export async function verifyCompactEntries({ manifest, readBytes, verifySnapshot }) {
  if (manifest?.format !== COMPACT_PACKAGE_FORMAT || manifest?.version !== COMPACT_PACKAGE_VERSION) {
    throw new Error('Unsupported compact Tapestry package.');
  }
  const verifyFile = async ({ path, byteLength, sha256 }) => {
    const bytes = await readBytes(path);
    if (!bytes || bytes.byteLength !== byteLength || await sha256Bytes(bytes) !== sha256) {
      throw new Error(`Compact package hash mismatch: ${path}`);
    }
    return bytes;
  };
  const database = await verifyFile(manifest.database);
  await verifyFile({
    path: manifest.model.binaryPath,
    byteLength: manifest.model.binaryByteLength,
    sha256: manifest.model.binarySha256,
  });
  await verifyFile({
    path: manifest.model.metadataPath,
    byteLength: manifest.model.metadataByteLength,
    sha256: manifest.model.metadataSha256,
  });
  const images = [];
  for (const image of manifest.images || []) {
    images.push({
      ...image,
      bytes: await verifyFile(image),
    });
  }
  const verification = await verifySnapshot({ byteArray: database });
  if (verification.quickCheck !== 'ok'
    || verification.integrityCheck !== 'ok'
    || verification.foreignKeyViolations?.length) {
    throw new Error('Compact package SQLite integrity verification failed.');
  }
  return { database, images, verification };
}
