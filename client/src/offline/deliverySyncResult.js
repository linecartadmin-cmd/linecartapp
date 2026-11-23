// How the offline queue records the server's answer to a replayed delivery status update.
// Pure function (no IndexedDB), so it is unit-tested directly.
//
//  - 200 / legacy 1        -> synced
//  - 409 (conflict/stale)  -> failed, never retried; keeps the server's authoritative status so the
//                             device can show it instead of the rejected local change
//  - any other reply       -> failed with the server's message (unchanged behaviour)
export function classifyDeliverySyncResponse(res) {
  if (res && (res.status === 200 || res.status === 1)) {
    return { outcome: 'synced', idempotentReplay: Boolean(res.idempotentReplay) };
  }
  if (res && res.status === 409) {
    return {
      outcome: 'failed',
      isConflict: true,
      serverStatus: res.currentStatus || null,
      requestedStatus: res.requestedStatus || null,
      code: res.code || 'STATUS_CONFLICT',
      error: res.message || 'The server refused this update because the order changed.'
    };
  }
  return { outcome: 'failed', isConflict: false, serverStatus: null, error: res?.message || 'Server rejected status update.' };
}
