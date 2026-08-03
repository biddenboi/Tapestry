function normalizePortablePath(value) {
  const path = String(value || '').replaceAll('\\', '/').replace(/^\/+/, '');
  if (!path || path.split('/').includes('..')) {
    throw new Error(`Unsafe restore folder path: ${value || '(empty)'}`);
  }
  return path;
}

function fileRelativePath(file) {
  return normalizePortablePath(
    file?.webkitRelativePath
      || file?.relativePath
      || file?.name,
  );
}

export function addPortableFolderFiles(archive, fileList) {
  if (!archive?.file) throw new Error('A portable archive writer is required.');
  const files = Array.from(fileList || []).filter(Boolean);
  if (!files.length) throw new Error('The selected restore folder is empty.');

  let added = 0;
  for (const file of files) {
    const path = fileRelativePath(file);
    if (path.startsWith('__MACOSX/') || path.includes('/__MACOSX/')) continue;
    archive.file(path, file);
    added += 1;
  }
  if (!added) throw new Error('The selected restore folder contains no usable files.');
  return { archive, fileCount: added };
}

export default addPortableFolderFiles;
