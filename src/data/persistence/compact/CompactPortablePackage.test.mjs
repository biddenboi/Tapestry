import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCompactManifest,
  collectDeduplicatedImages,
  findCompactPackageManifest,
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
  const image = {
    path: 'images/avatar.jpg',
    mimeType: 'image/jpeg',
    bytes: Uint8Array.from([255, 216, 255, 217]),
  };
  const manifest = await buildCompactManifest({
    snapshot: { byteArray: database, migrations: [] },
    images: [image],
  });
  const files = new Map([
    [manifest.database.path, database],
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
