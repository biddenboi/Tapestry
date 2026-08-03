import { validateJournalPath } from './CompactJournalMarkdown.js';

function normalize(path) {
  return validateJournalPath(path, { allowStaging: true });
}

export class MemoryJournalFileAdapter {
  constructor(entries = {}) {
    this.files = new Map(Object.entries(entries).map(([path, value]) => [normalize(path), String(value)]));
  }

  async readText(path) {
    const key = normalize(path);
    return this.files.has(key) ? this.files.get(key) : null;
  }

  async writeText(path, value) {
    const key = normalize(path);
    this.files.set(key, String(value));
    return { path: key, byteLength: new TextEncoder().encode(String(value)).byteLength };
  }

  async remove(path) {
    return this.files.delete(normalize(path));
  }

  async list(prefix = 'journals/') {
    const normalizedPrefix = String(prefix).replaceAll('\\', '/').replace(/^\/+/, '');
    return [...this.files.keys()].filter((path) => path.startsWith(normalizedPrefix)).sort();
  }
}

async function getDirectory(root, segments, { create = false } = {}) {
  let directory = root;
  for (const segment of segments) directory = await directory.getDirectoryHandle(segment, { create });
  return directory;
}

export class DirectoryJournalFileAdapter {
  constructor({ rootHandle } = {}) {
    if (!rootHandle?.getDirectoryHandle) throw new Error('DirectoryJournalFileAdapter requires a directory handle.');
    this.rootHandle = rootHandle;
  }

  async _fileHandle(path, { create = false } = {}) {
    const normalized = normalize(path);
    const segments = normalized.split('/');
    const name = segments.pop();
    const directory = await getDirectory(this.rootHandle, segments, { create });
    return directory.getFileHandle(name, { create });
  }

  async readText(path) {
    try {
      const handle = await this._fileHandle(path);
      return (await handle.getFile()).text();
    } catch (error) {
      if (error?.name === 'NotFoundError') return null;
      throw error;
    }
  }

  async writeText(path, value) {
    const normalized = normalize(path);
    const handle = await this._fileHandle(normalized, { create: true });
    const writable = await handle.createWritable({ keepExistingData: false });
    await writable.write(String(value));
    await writable.close();
    const file = await handle.getFile();
    return { path: normalized, byteLength: file.size };
  }

  async remove(path) {
    const normalized = normalize(path);
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

  async list(prefix = 'journals/') {
    const normalizedPrefix = String(prefix).replaceAll('\\', '/').replace(/^\/+/, '');
    const startSegments = normalizedPrefix.replace(/\/$/, '').split('/').filter(Boolean);
    let start;
    try { start = await getDirectory(this.rootHandle, startSegments); }
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
    await walk(start, startSegments);
    return output.sort();
  }
}
