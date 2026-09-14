const compactions = new WeakMap();

async function databaseSize(client) {
  return Number(await client.query({
    sql: 'SELECT page_count * page_size FROM pragma_page_count, pragma_page_size',
    result: 'value',
  }));
}

export function compactLocalDatabase(connection) {
  if (compactions.has(connection)) return compactions.get(connection);
  const request = (async () => {
    await connection.ready;
    await connection.flushWrites?.();
    const client = connection.syncRuntime?.client;
    if (!client?.query) throw new Error('Local storage is not ready.');
    const before = await databaseSize(client);
    const integrity = await client.query({ sql: 'PRAGMA quick_check', result: 'value' });
    if (integrity !== 'ok') throw new Error('Storage needs repair before it can be compacted.');
    // VACUUM copies live pages inside SQLite and preserves all tables, pending
    // edits, conflicts, and history. No sync or record deletion is required.
    await client.query({ sql: 'VACUUM', result: 'none' }, { timeoutMs: 60_000 });
    const verified = await client.query({ sql: 'PRAGMA quick_check', result: 'value' });
    if (verified !== 'ok') throw new Error('Storage verification did not pass after compaction.');
    const after = await databaseSize(client);
    return { before, after, reclaimedBytes: Math.max(0, before - after) };
  })().finally(() => compactions.delete(connection));
  compactions.set(connection, request);
  return request;
}
