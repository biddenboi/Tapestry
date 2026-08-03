import { DATA_SCHEMA_VERSION, STORES } from '../../../domain/constants.js';

export const LEGACY_PACKAGE_FORMAT = 'tapestry-obsidian-save';
export const LEGACY_PACKAGE_VERSION = 1;

const LEGACY_MANIFEST_SUFFIX = '.tapestry/.system-data/manifest.json';
const LEGACY_PROFILE_IMAGE_DIRECTORY = '.resources/profile-images/';
const PROFILE_IMAGE_MIME_TYPES = Object.freeze({
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
});

function normalizePath(value) {
  const path = String(value || '').replaceAll('\\', '/').replace(/^\/+/, '');
  if (!path || path.split('/').includes('..')) {
    throw new Error(`Unsafe legacy save path: ${value || '(empty)'}`);
  }
  return path;
}

function findLegacyManifestPath(zip) {
  const candidates = Object.keys(zip?.files || {})
    .map((path) => String(path).replaceAll('\\', '/'))
    .filter((path) => !path.startsWith('__MACOSX/'))
    .filter((path) => path === LEGACY_MANIFEST_SUFFIX || path.endsWith(`/${LEGACY_MANIFEST_SUFFIX}`));
  if (candidates.length !== 1) {
    throw new Error(candidates.length
      ? 'This zip contains more than one legacy Tapestry data root.'
      : 'This zip is missing its legacy Tapestry manifest.');
  }
  return candidates[0];
}

function legacyRootForManifest(manifestPath) {
  return manifestPath.slice(0, -'.system-data/manifest.json'.length);
}

async function readZipText(zip, path, { required = true } = {}) {
  const entry = zip.file(normalizePath(path));
  if (!entry) {
    if (!required) return null;
    throw new Error(`Legacy save is missing ${path}.`);
  }
  return entry.async('string');
}

async function readZipJson(zip, path, options) {
  const text = await readZipText(zip, path, options);
  if (text == null) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Legacy save contains invalid JSON at ${path}.`, { cause: error });
  }
}

function assertRecordArray(value, path) {
  if (!Array.isArray(value)) throw new Error(`Legacy store ${path} must contain a JSON array.`);
  for (const [index, record] of value.entries()) {
    if (!record || typeof record !== 'object' || Array.isArray(record) || !record.UUID) {
      throw new Error(`Legacy store ${path} has an invalid record at index ${index}.`);
    }
  }
  return value;
}

function metadataValue(lines, key) {
  const prefix = `> ${key}:`;
  const line = lines.find((candidate) => candidate.startsWith(prefix));
  return line ? line.slice(prefix.length).trim() : '';
}

export function parseLegacyJournal(markdown, {
  manifestEntry = {},
  supplementalMetadata = {},
} = {}) {
  const normalized = String(markdown || '').replaceAll('\r\n', '\n').replaceAll('\r', '\n');
  const lines = normalized.split('\n');
  let cursor = 0;
  while (lines[cursor]?.startsWith('> ')) cursor += 1;
  while (lines[cursor] === '') cursor += 1;

  const UUID = metadataValue(lines, 'uuid') || manifestEntry.uuid || supplementalMetadata.UUID;
  const parent = metadataValue(lines, 'player')
    || supplementalMetadata.parent
    || supplementalMetadata.playerUUID;
  const createdAt = metadataValue(lines, 'createdAt')
    || supplementalMetadata.createdAt
    || supplementalMetadata.localCreatedAt;
  const editedAt = metadataValue(lines, 'editedAt') || supplementalMetadata.updatedAt || null;
  const rawIGT = metadataValue(lines, 'inGameTimestamp');
  const inGameTimestamp = rawIGT === '' ? null : Number(rawIGT);
  const titleLine = lines[cursor] || '';
  const title = titleLine.startsWith('# ') ? titleLine.slice(2).trim() : '';
  if (titleLine.startsWith('# ')) cursor += 1;
  if (lines[cursor] === '') cursor += 1;

  if (!UUID || !parent || !createdAt || Number.isNaN(Date.parse(createdAt))) {
    throw new Error(`Legacy journal ${manifestEntry.path || UUID || '(unknown)'} is missing required metadata.`);
  }
  if (editedAt && Number.isNaN(Date.parse(editedAt))) {
    throw new Error(`Legacy journal ${manifestEntry.path || UUID} has an invalid editedAt value.`);
  }
  if (inGameTimestamp != null && !Number.isFinite(inGameTimestamp)) {
    throw new Error(`Legacy journal ${manifestEntry.path || UUID} has an invalid in-game timestamp.`);
  }

  const entry = lines.slice(cursor).join('\n').replace(/\n+$/u, '');
  return {
    ...supplementalMetadata,
    UUID: String(UUID),
    parent: String(parent),
    authorUUID: String(parent),
    title: title || 'Untitled journal',
    entry,
    type: supplementalMetadata.type || supplementalMetadata.postType || 'post',
    postType: supplementalMetadata.postType || supplementalMetadata.type || 'post',
    tags: Array.isArray(supplementalMetadata.tags) ? supplementalMetadata.tags : [],
    images: Array.isArray(supplementalMetadata.images) ? supplementalMetadata.images : [],
    votes: supplementalMetadata.votes && typeof supplementalMetadata.votes === 'object'
      ? supplementalMetadata.votes
      : {},
    createdAt: new Date(createdAt).toISOString(),
    updatedAt: editedAt ? new Date(editedAt).toISOString() : new Date(createdAt).toISOString(),
    inGameTimestamp,
    legacyFilePath: manifestEntry.path || supplementalMetadata.journalFilePath || null,
  };
}

function metadataByJournal(metadata = []) {
  const byId = new Map();
  const byPath = new Map();
  for (const record of metadata) {
    if (record?.UUID) byId.set(String(record.UUID), record);
    const path = record?.journalFilePath || record?.filePath || record?.path;
    if (path) byPath.set(normalizePath(path), record);
  }
  return { byId, byPath };
}

async function readOptionalJsonWithFallback(zip, root, preferred, fallback) {
  const preferredPath = preferred ? `${root}${normalizePath(preferred)}` : null;
  if (preferredPath && zip.file(preferredPath)) return readZipJson(zip, preferredPath);
  const fallbackPath = `${root}${normalizePath(fallback)}`;
  return readZipJson(zip, fallbackPath, { required: false });
}

async function loadLegacyJournals(zip, root, manifest, journalMetadata) {
  const metadata = metadataByJournal(journalMetadata);
  const journals = [];
  const shadowJournals = [];
  for (const manifestEntry of manifest.journalFiles || []) {
    const path = normalizePath(manifestEntry?.path);
    const markdown = await readZipText(zip, `${root}${path}`);
    const supplementalMetadata = metadata.byId.get(String(manifestEntry.uuid || ''))
      || metadata.byPath.get(path)
      || {};
    journals.push(parseLegacyJournal(markdown, { manifestEntry, supplementalMetadata }));
    shadowJournals.push({ path, manifestEntry, markdown });
  }
  return { journals, shadowJournals };
}

async function loadLegacyResources(zip, root, resourceMetadata = []) {
  const resources = [];
  for (const metadata of resourceMetadata) {
    if (!metadata?.UUID) throw new Error('Legacy resource metadata contains a record without a UUID.');
    const path = normalizePath(metadata.path || `.resources/managed/${metadata.UUID}`);
    const entry = zip.file(`${root}${path}`);
    if (!entry) throw new Error(`Legacy resource ${metadata.UUID} is missing ${path}.`);
    resources.push({ ...metadata, bytes: await entry.async('uint8array') });
  }
  return resources;
}

function linkManagedProfilePictures(players, resources) {
  const playersById = new Map(players.map((player) => [String(player.UUID), player]));
  for (const resource of resources) {
    if (resource?.kind !== 'profilePicture' || !resource?.parent) continue;
    const player = playersById.get(String(resource.parent));
    if (player && !player.profilePicture) {
      player.profilePicture = {
        type: 'resource',
        resourceUUID: String(resource.UUID),
      };
    }
  }
  return playersById;
}

async function loadLegacyProfileImageSidecars(zip, root, players, resources) {
  const playersById = linkManagedProfilePictures(players, resources);
  const resourceIds = new Set(resources.map((resource) => String(resource.UUID)));
  const prefix = `${root}${LEGACY_PROFILE_IMAGE_DIRECTORY}`;
  const paths = Object.keys(zip?.files || {})
    .map((path) => String(path).replaceAll('\\', '/'))
    .filter((path) => path.startsWith(prefix) && !zip.files[path]?.dir)
    .sort();

  for (const path of paths) {
    const filename = path.slice(prefix.length);
    if (!filename || filename.includes('/')) continue;
    const extension = filename.includes('.') ? filename.split('.').pop().toLowerCase() : '';
    const mimeType = PROFILE_IMAGE_MIME_TYPES[extension];
    if (!mimeType) continue;
    const playerUUID = filename.slice(0, -(extension.length + 1));
    const player = playersById.get(playerUUID);
    if (!player || player.profilePicture) continue;

    let resourceUUID = `legacy-profile-picture-${playerUUID}`;
    let suffix = 2;
    while (resourceIds.has(resourceUUID)) {
      resourceUUID = `legacy-profile-picture-${playerUUID}-${suffix}`;
      suffix += 1;
    }
    const entry = zip.file(path);
    const bytes = await entry.async('uint8array');
    resources.push({
      UUID: resourceUUID,
      mimeType,
      sizeBytes: bytes.byteLength,
      createdAt: entry.date instanceof Date && Number.isFinite(entry.date.getTime())
        ? entry.date.toISOString()
        : player.createdAt || new Date(0).toISOString(),
      parent: playerUUID,
      kind: 'profilePicture',
      usedBy: [{ store: STORES.player, UUID: playerUUID, field: 'profilePicture' }],
      path: `${LEGACY_PROFILE_IMAGE_DIRECTORY}${filename}`,
      bytes,
    });
    resourceIds.add(resourceUUID);
    player.profilePicture = { type: 'resource', resourceUUID };
  }
}

export async function parseLegacyPortablePackage(zip, {
  currentSchemaVersion = DATA_SCHEMA_VERSION,
} = {}) {
  const manifestPath = findLegacyManifestPath(zip);
  const root = legacyRootForManifest(manifestPath);
  const manifest = await readZipJson(zip, manifestPath);
  if (manifest?.format !== LEGACY_PACKAGE_FORMAT || Number(manifest?.version) !== LEGACY_PACKAGE_VERSION) {
    throw new Error('This is not a supported legacy Tapestry save.');
  }

  const schema = await readZipJson(zip, `${root}schema.json`, { required: false });
  const schemaVersion = Number(schema?.schemaVersion ?? manifest.dataSchemaVersion);
  if (!Number.isInteger(schemaVersion) || schemaVersion < 1) {
    throw new Error('Legacy save does not declare a valid data schema version.');
  }
  if (schemaVersion > currentSchemaVersion) {
    throw new Error(`This save uses schema ${schemaVersion}, newer than this app supports (${currentSchemaVersion}).`);
  }

  const stores = Object.fromEntries(Object.values(STORES).map((store) => [store, []]));
  for (const [legacyStoreKey, dataName] of Object.entries(manifest.stores || {})) {
    const currentStore = STORES[legacyStoreKey];
    if (!currentStore || currentStore === STORES.journal || currentStore === STORES.resource) continue;
    const relativePath = manifest.dataFiles?.[dataName];
    if (!relativePath) continue;
    const path = `${root}${normalizePath(relativePath)}`;
    stores[currentStore] = assertRecordArray(await readZipJson(zip, path), path);
  }

  const journalMetadata = assertRecordArray(
    (await readOptionalJsonWithFallback(
      zip,
      root,
      manifest.journalMetadataFile,
      '.system-data/journalMetadata.json',
    )) || [],
    'journalMetadata',
  );
  const { journals, shadowJournals } = await loadLegacyJournals(zip, root, manifest, journalMetadata);
  stores[STORES.journal] = journals;

  const resourceMetadata = assertRecordArray(
    (await readOptionalJsonWithFallback(
      zip,
      root,
      manifest.resourceMetadataFile,
      '.system-data/resources.json',
    )) || [],
    'resources',
  );
  stores[STORES.resource] = await loadLegacyResources(zip, root, resourceMetadata);
  await loadLegacyProfileImageSidecars(
    zip,
    root,
    stores[STORES.player],
    stores[STORES.resource],
  );

  const appState = await readZipJson(zip, `${root}${normalizePath(manifest.appStateFile)}`);
  const economyState = await readZipJson(zip, `${root}${normalizePath(manifest.economyFile)}`);
  const modelSettingsPath = manifest.modelArtifactFiles?.recommenderSettings;
  const modelSettings = modelSettingsPath
    ? await readZipJson(zip, `${root}${normalizePath(modelSettingsPath)}`)
    : [];
  if (!Array.isArray(modelSettings)) throw new Error('Legacy recommender settings must be a JSON array.');

  return {
    format: LEGACY_PACKAGE_FORMAT,
    manifest,
    schemaVersion,
    stores,
    appState: appState && typeof appState === 'object' ? appState : {},
    economyState: economyState && typeof economyState === 'object' ? economyState : {},
    journalMetadata,
    shadowJournals,
    modelSettings,
    recordCount: Object.values(stores).reduce((total, records) => total + records.length, 0),
  };
}

export default parseLegacyPortablePackage;
