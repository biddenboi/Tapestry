import assert from 'node:assert/strict';
import test from 'node:test';

import { createShadowTestContext } from './shadowDomainTestUtils.mjs';

test('migration 048 enforces one normalized routine per player, type, and day', async () => {
  const context = await createShadowTestContext();
  try {
    const tables = await context.client.query({
      sql: "SELECT name FROM sqlite_schema WHERE type='table' AND name IN ('routine_runs','routine_step_receipts') ORDER BY name",
      result: 'all',
    });
    assert.deepEqual(tables.map(({ name }) => name), ['routine_runs', 'routine_step_receipts']);
    const sql = await context.client.query({
      sql: "SELECT sql FROM sqlite_schema WHERE type='table' AND name='routine_runs'",
      result: 'value',
    });
    assert.match(sql, /UNIQUE\(player_id,routine_type,scheduled_for\)/);
    assert.match(sql, /STRICT/i);
  } finally {
    await context.close();
  }
});
