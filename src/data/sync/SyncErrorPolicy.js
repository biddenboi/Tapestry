const RETIRED_WORKING_SET_ERROR_PATTERNS = Object.freeze([
  'mobile working-set publish session',
  'working-set publish session is no longer active',
]);

export function isRetiredWorkingSetSyncError(error) {
  if (!error) return false;
  const code = String(error.code || '').trim().toLowerCase();
  if (code === 'mobile-publish-session-inactive'
      || code === 'working-set-publish-session-inactive') {
    return true;
  }
  const message = String(error.message || error || '').trim().toLowerCase();
  return RETIRED_WORKING_SET_ERROR_PATTERNS.some((pattern) => message.includes(pattern));
}

export function visibleSyncError(error) {
  return isRetiredWorkingSetSyncError(error) ? null : error || null;
}

export default visibleSyncError;
