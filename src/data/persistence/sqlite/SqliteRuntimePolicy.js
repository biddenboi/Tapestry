export const SQLITE_RUNTIME_POLICY = Object.freeze({
  databaseFilename: '/tapestry.sqlite3',
  journalMode: 'DELETE',
  busyTimeoutMs: 750,
  writerLease: 'tapestry.sqlite.writer.v1',
});
