import MigrationRunner from './MigrationRunner.js';
import SQLITE_MIGRATIONS from './migrations/index.js';
import SqliteRuntime from './SqliteRuntime.js';
import SqliteShadowDomainRuntime from './SqliteShadowDomainRuntime.js';
import InProcessSqliteClient from './testing/InProcessSqliteClient.js';
import SqliteShadowReadinessCoordinator, {
  SQLITE_SHADOW_PROJECTIONS,
} from '../services/SqliteShadowReadinessCoordinator.js';

export async function createShadowTestContext({ now = () => new Date('2026-07-12T18:00:00.000Z') } = {}) {
  const runtime = new SqliteRuntime({ now, logger: { warn() {} } });
  const client = new InProcessSqliteClient({ runtime });
  await client.initialize({ mode: 'memory' });
  await new MigrationRunner({ client, migrations: SQLITE_MIGRATIONS, applicationVersion: 'shadow-domain-test' }).run();
  const shadow = new SqliteShadowDomainRuntime({ client, now });
  const readiness = new SqliteShadowReadinessCoordinator({ sessionId: 'shadow-domain-test' });
  for (const domain of SQLITE_SHADOW_PROJECTIONS) {
    readiness.markReady(domain, {
      sourceFingerprint: 'sqlite-authoritative',
      runId: 'shadow-domain-test',
    });
  }
  return {
    runtime, client, shadow, readiness,
    close: () => client.close(),
  };
}
