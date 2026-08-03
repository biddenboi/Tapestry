const RECOVERY_OPEN_OPTIONS = Object.freeze({
  mode: 'persistent',
  migrate: false,
  runUncleanIntegrityCheck: false,
  writerLeaseWaitMs: 8_000,
  writerLeasePollMs: 120,
});

export async function prepareRestoreRuntime({ ready, adapter } = {}) {
  try {
    await ready;
    return { recoveredStartup: false, startupError: null };
  } catch (startupError) {
    if (!adapter?.open) throw startupError;
    const openResult = await adapter.open(RECOVERY_OPEN_OPTIONS);
    if (!openResult?.initialization?.initialized) {
      throw new Error(
        'Tapestry storage is open in another tab. Close the other tab, then restore again.',
        { cause: startupError },
      );
    }
    return { recoveredStartup: true, startupError };
  }
}

export default prepareRestoreRuntime;
