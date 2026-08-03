import { SYNC_ORIGIN } from './SyncContracts.js';

export class SyncCommandRegistry {
  constructor() {
    this.handlers = new Map();
  }

  register(commandType, handler) {
    const type = String(commandType || '').trim();
    if (!type || typeof handler !== 'function') {
      throw new TypeError('A sync command type and handler are required.');
    }
    if (this.handlers.has(type)) throw new Error(`Sync command already registered: ${type}`);
    this.handlers.set(type, handler);
    return () => this.handlers.delete(type);
  }

  has(commandType) {
    return this.handlers.has(String(commandType || ''));
  }

  async buildRemoteMutation(entry) {
    const commandType = String(entry?.commandType || '').trim();
    const handler = this.handlers.get(commandType);
    if (!handler) {
      const error = new Error(`No remote sync handler is registered for ${commandType || 'this command'}.`);
      error.code = 'sync-command-handler-missing';
      throw error;
    }
    const mutation = await handler(Object.freeze({ ...entry }), Object.freeze({
      origin: SYNC_ORIGIN.remote,
      enqueueSync: false,
      operationId: entry.operationId,
      deviceId: entry.originDeviceId || entry.deviceId || null,
    }));
    if (!mutation || typeof mutation !== 'object') {
      throw new TypeError(`Remote sync handler ${commandType} did not return a mutation.`);
    }
    if (mutation.sync?.enqueueSync === true) {
      const error = new Error(`Remote sync handler ${commandType} attempted to enqueue another operation.`);
      error.code = 'sync-remote-reenqueue-forbidden';
      throw error;
    }
    return mutation;
  }
}

export default SyncCommandRegistry;
