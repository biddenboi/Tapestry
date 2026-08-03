import assert from 'node:assert/strict';
import test from 'node:test';
import JSZip from 'jszip';
import { addPortableFolderFiles } from './PortableFolderPackage.js';

function folderFile(path, contents) {
  const bytes = new TextEncoder().encode(contents);
  Object.defineProperties(bytes, {
    name: { value: path.split('/').at(-1) },
    webkitRelativePath: { value: path },
  });
  return bytes;
}

test('uncompressed folder files retain their selected root and hidden Tapestry paths', async () => {
  const zip = new JSZip();
  const files = [
    folderFile(
      'Tapestry Data/.tapestry/.system-data/manifest.json',
      JSON.stringify({ format: 'tapestry-obsidian-save' }),
    ),
    folderFile('Tapestry Data/.tapestry/.player-data/players.json', '[]'),
    folderFile('__MACOSX/Tapestry Data/._junk', 'ignored'),
  ];

  const result = addPortableFolderFiles(zip, files);

  assert.equal(result.fileCount, 2);
  assert.equal(
    await zip.file('Tapestry Data/.tapestry/.system-data/manifest.json').async('string'),
    JSON.stringify({ format: 'tapestry-obsidian-save' }),
  );
  assert.equal(zip.file('__MACOSX/Tapestry Data/._junk'), null);
});

test('empty folder selections fail with a useful restore error', () => {
  assert.throws(
    () => addPortableFolderFiles(new JSZip(), []),
    /selected restore folder is empty/i,
  );
});
