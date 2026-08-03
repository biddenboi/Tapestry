import DatabaseConnectionHost from '@data/persistence/DatabaseConnectionHost.js';

/**
 * Stable feature-facing database facade.
 *
 * New persistence behavior belongs in PersistenceRuntime, typed repositories,
 * or named services. This class intentionally contains no SQL, filesystem
 * traversal, migration parsing, or domain workflow logic.
 */
export class DatabaseConnection extends DatabaseConnectionHost {
  constructor(options = {}) {
    super(options);
  }
}

export default DatabaseConnection;
