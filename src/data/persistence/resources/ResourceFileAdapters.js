const HASH_RE = /^[0-9a-f]{64}$/;
const SAFE_SEGMENT_RE = /^[A-Za-z0-9._-]+$/;

export function validateResourcePath(value, { allowInternal = true } = {}) {
  const path = String(value ?? '').replaceAll('\\', '/').replace(/^\/+/, '');
  const parts = path.split('/');
  if (!path.startsWith('resources/') || parts.some((part) => !part || part === '.' || part === '..' || !SAFE_SEGMENT_RE.test(part))) {
    const error = new Error(`Unsafe resource path: ${value}`);
    error.code = 'unsafe-resource-path';
    throw error;
  }
  if (!allowInternal && parts.some((part) => part.startsWith('.'))) {
    const error = new Error(`Internal resource path is not allowed here: ${value}`);
    error.code = 'unsafe-resource-path';
    throw error;
  }
  return path;
}

export function resourceStoragePath(hash, extension) {
  if (!HASH_RE.test(String(hash))) throw new Error('Resource hashes must be lowercase SHA-256 hex.');
  return validateResourcePath(`resources/${hash.slice(0, 2)}/${hash}.${extension}`, { allowInternal: false });
}

export function resourceStagingPath(operationId, hash, extension) {
  const safeOperation = String(operationId).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 160) || 'operation';
  return validateResourcePath(`resources/.staging/${safeOperation}/${hash}.${extension}`);
}

export function resourceQuarantinePath(operationId, hash, extension = 'bin') {
  const safeOperation = String(operationId).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 160) || 'operation';
  return validateResourcePath(`resources/.quarantine/${safeOperation}/${hash}.${extension}`);
}

function bytes(value) {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  throw new TypeError('Resource file writes require bytes.');
}

export class MemoryResourceFileAdapter {
  constructor(entries = {}) {
    this.files = new Map(Object.entries(entries).map(([path, value]) => [validateResourcePath(path), bytes(value)]));
  }

  async readBytes(path) {
    const value = this.files.get(validateResourcePath(path));
    return value ? new Uint8Array(value) : null;
  }

  async writeBytes(path, value) {
    const normalized = validateResourcePath(path);
    const payload = bytes(value);
    this.files.set(normalized, payload);
    return { path: normalized, byteLength: payload.byteLength };
  }

  async remove(path) {
    return this.files.delete(validateResourcePath(path));
  }

  async list(prefix = 'resources/') {
    const normalized = String(prefix).replaceAll('\\', '/').replace(/^\/+/, '');
    return [...this.files.keys()].filter((path) => path.startsWith(normalized)).sort();
  }
}

async function getDirectory(root, segments, { create = false } = {}) {
  let directory = root;
  for (const segment of segments) directory = await directory.getDirectoryHandle(segment, { create });
  return directory;
}

export class DirectoryResourceFileAdapter {
  constructor({ rootHandle } = {}) {
    if (!rootHandle?.getDirectoryHandle) throw new Error('DirectoryResourceFileAdapter requires a directory handle.');
    this.rootHandle = rootHandle;
  }

  async _fileHandle(path, { create = false } = {}) {
    const normalized = validateResourcePath(path);
    const segments = normalized.split('/');
    const name = segments.pop();
    const directory = await getDirectory(this.rootHandle, segments, { create });
    return directory.getFileHandle(name, { create });
  }

  async readBytes(path) {
    try {
      const handle = await this._fileHandle(path);
      return new Uint8Array(await (await handle.getFile()).arrayBuffer());
    } catch (error) {
      if (error?.name === 'NotFoundError') return null;
      throw error;
    }
  }

  async writeBytes(path, value) {
    const normalized = validateResourcePath(path);
    const payload = bytes(value);
    const handle = await this._fileHandle(normalized, { create: true });
    const writable = await handle.createWritable({ keepExistingData: false });
    await writable.write(payload);
    await writable.close();
    return { path: normalized, byteLength: (await handle.getFile()).size };
  }

  async remove(path) {
    const normalized = validateResourcePath(path);
    const segments = normalized.split('/');
    const name = segments.pop();
    try {
      const directory = await getDirectory(this.rootHandle, segments);
      await directory.removeEntry(name);
      return true;
    } catch (error) {
      if (error?.name === 'NotFoundError') return false;
      throw error;
    }
  }

  async list(prefix = 'resources/') {
    const normalizedPrefix = String(prefix).replaceAll('\\', '/').replace(/^\/+/, '');
    const segments = normalizedPrefix.replace(/\/$/, '').split('/').filter(Boolean);
    let start;
    try { start = await getDirectory(this.rootHandle, segments); }
    catch (error) {
      if (error?.name === 'NotFoundError') return [];
      throw error;
    }
    const output = [];
    const walk = async (directory, parts) => {
      for await (const entry of directory.values()) {
        if (entry.kind === 'file') output.push([...parts, entry.name].join('/'));
        else if (entry.kind === 'directory') await walk(entry, [...parts, entry.name]);
      }
    };
    await walk(start, segments);
    return output.sort();
  }
}
