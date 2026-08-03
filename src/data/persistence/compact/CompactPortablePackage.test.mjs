import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCompactManifest,
  buildCompactModelArtifacts,
  collectDeduplicatedImages,
  findCompactPackageManifest,
  stableJson,
  verifyCompactEntries,
} from './CompactPortablePackage.js';
import JSZip from 'jszip';

const ONE_PIXEL_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

test('compact packages deduplicate repeated images by content hash', async () => {
  const images = await collectDeduplicatedImages([
    { profilePicture: ONE_PIXEL_PNG },
    { bannerImageUrl: ONE_PIXEL_PNG },
  ]);
  assert.equal(images.length, 1);
  assert.match(images[0].path, /^images\/[a-f0-9]+\.png$/);
});

test('compact model binary does not duplicate identical target weights', () => {
  const model = { layers: [{ weights: [0.25, -0.5, 1.5] }], posterior: { updateCount: 3 } };
  const artifacts = buildCompactModelArtifacts([{
    UUID: 'task-recommender-v12-checkpoint:player-a',
    value: {
      model,
      targetModel: structuredClone(model),
      manifest: { updatedAt: '2026-07-16T00:00:00.000Z' },
    },
  }]);
  assert.equal(new TextDecoder().decode(artifacts.bytes.slice(0, 4)), 'TPM1');
  assert.equal(artifacts.metadata.numericValueCount, 3);
  assert.deepEqual(artifacts.metadata.checkpoint.targetModel, { $ref: 'model' });
});

test('compact saves remain restorable when Finder wraps them in a top-level folder', async () => {
  const zip = new JSZip();
  zip.file('__MACOSX/Tapestry Data/manifest.json', '{not-json');
  zip.file('Tapestry Data/manifest.json', JSON.stringify({
    format: 'tapestry-compact-sqlite',
    version: 1,
  }));
  zip.file('Tapestry Data/tapestry.sqlite', Uint8Array.from([1, 2, 3]));

  const located = await findCompactPackageManifest(zip);

  assert.equal(located.root, 'Tapestry Data/');
  assert.equal(located.manifest.format, 'tapestry-compact-sqlite');
  assert.deepEqual(
    [...await zip.file(`${located.root}tapestry.sqlite`).async('uint8array')],
    [1, 2, 3],
  );
});

test('compact verification returns the checked image bytes needed to repair resource payloads', async () => {
  const database = Uint8Array.from([83, 81, 76]);
  const model = {
    bytes: Uint8Array.from([1, 2, 3, 4]),
    metadata: { format: 'test-model', version: 1 },
  };
  const image = {
    path: 'images/avatar.jpg',
    mimeType: 'image/jpeg',
    bytes: Uint8Array.from([255, 216, 255, 217]),
  };
  const manifest = await buildCompactManifest({
    snapshot: { byteArray: database, migrations: [] },
    model,
    images: [image],
  });
  const files = new Map([
    [manifest.database.path, database],
    [manifest.model.binaryPath, model.bytes],
    [manifest.model.metadataPath, new TextEncoder().encode(stableJson(model.metadata))],
    [image.path, image.bytes],
  ]);

  const verified = await verifyCompactEntries({
    manifest,
    readBytes: async (path) => files.get(path) || null,
    verifySnapshot: async () => ({
      quickCheck: 'ok',
      integrityCheck: 'ok',
      foreignKeyViolations: [],
    }),
  });

  assert.equal(verified.images.length, 1);
  assert.equal(verified.images[0].sha256, manifest.images[0].sha256);
  assert.deepEqual([...verified.images[0].bytes], [...image.bytes]);
});
