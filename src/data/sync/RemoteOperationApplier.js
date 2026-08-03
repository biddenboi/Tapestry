import { SYNC_ORIGIN } from './SyncContracts.js';

export class RemoteOperationApplier {
  constructor({ connection, registry, operations, cursors, conflicts, now = () => new Date() } = {}) {
    if (!connection?.commitAtomicMutation) throw new Error('RemoteOperationApplier requires the database facade.');
    if (!registry?.buildRemoteMutation) throw new Error('RemoteOperationApplier requires a command registry.');
    this.connection = connection;
    this.registry = registry;
    this.operations = operations;
    this.cursors = cursors;
    this.conflicts = conflicts;
    this.now = now;
  }

  async apply(entries = [], { streamName = 'owner' } = {}) {
    const ordered = [...entries].sort(
      (left, right) => Number(left.serverSequence) - Number(right.serverSequence),
    );
    let applied = 0;
    let duplicates = 0;
    let conflicts = 0;
    let cursor = await this.cursors.get(streamName);
    for (const entry of ordered) {
      const serverSequence = Number(entry?.serverSequence);
      if (!Number.isInteger(serverSequence) || serverSequence <= cursor.serverSequence) continue;
      const operationId = String(entry?.operationId || '').trim();
      if (!operationId) throw new TypeError('Remote sync entries require an operation ID.');

      const localOperation = await this.operations.get(operationId);
      if (localOperation) {
        if (entry.status === 'accepted') {
          await this.operations.markAcceptedFromPull(operationId, entry);
        }
        await this.cursors.advance(streamName, serverSequence, this.now());
        cursor = { streamName, serverSequence };
        duplicates += 1;
        continue;
      }

      if (entry.status === 'conflict') {
        await this.conflicts.preserveUnsupportedRemote(entry, { streamName });
        cursor = { streamName, serverSequence };
        conflicts += 1;
        continue;
      }
      if (entry.status !== 'accepted') {
        await this.cursors.advance(streamName, serverSequence, entry.acceptedAt || this.now());
        cursor = { streamName, serverSequence };
        duplicates += 1;
        continue;
      }

      if (!this.registry.has(entry.commandType)) {
        if (!this.conflicts?.preserveUnsupportedRemote) {
          const error = new Error(`No remote sync handler is registered for ${entry.commandType || 'this command'}.`);
          error.code = 'sync-command-handler-missing';
          throw error;
        }
        await this.conflicts.preserveUnsupportedRemote(entry, { streamName });
        cursor = { streamName, serverSequence };
        conflicts += 1;
        continue;
      }

      const mutation = await this.registry.buildRemoteMutation(entry);
      const result = await this.connection.commitAtomicMutation({
        ...mutation,
        operationId,
        sync: {
          origin: SYNC_ORIGIN.remote,
          enqueueSync: false,
          cursor: {
            streamName,
            serverSequence,
            updatedAt: this.now(),
          },
        },
      });
      if (result?.duplicate) {
        await this.cursors.advance(streamName, serverSequence, this.now());
        duplicates += 1;
      } else {
        applied += 1;
      }
      cursor = { streamName, serverSequence };
    }
    return { applied, duplicates, conflicts, cursor };
  }
}

export default RemoteOperationApplier;
