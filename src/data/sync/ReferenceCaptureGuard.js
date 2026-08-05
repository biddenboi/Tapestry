import { SYNC_ORIGIN } from './SyncContracts.js';

const DISABLE_CAPTURE = Object.freeze({
  sql: `UPDATE sync_reference_capture_state
        SET enabled=0,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE singleton_id=1`,
  result: 'changes',
});

const ENABLE_CAPTURE = Object.freeze({
  sql: `UPDATE sync_reference_capture_state
        SET enabled=1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE singleton_id=1`,
  result: 'changes',
});

export function referenceCaptureGuard(origin) {
  if (origin !== SYNC_ORIGIN.remote) {
    return Object.freeze({ beforeStatements: [], afterStatements: [] });
  }
  return Object.freeze({
    beforeStatements: [DISABLE_CAPTURE],
    afterStatements: [ENABLE_CAPTURE],
  });
}

export default referenceCaptureGuard;
