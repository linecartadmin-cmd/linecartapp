/**
 * LineCart Independent Sync Engine
 *
 * Manages background and on-demand synchronization of offline mutations.
 * Key properties:
 * 1. Independent item execution: A business-logic failure (e.g. invalid status or price)
 *    marks THAT item as "Needs attention" and DOES NOT block subsequent queued items.
 * 2. Idempotency: Every mutation has a client-generated UUID sent in headers and payload.
 * 3. Device event timestamping: Device time is passed as an audit hint.
 * 4. Network awareness: Automatically detects reconnects and app foreground resume.
 */

import { api } from '../api';
import { classifyDeliverySyncResponse } from './deliverySyncResult';
import {
  enqueueMutation,
  getSyncQueue,
  getPendingMutations,
  updateMutation,
  deleteMutation,
  getUnsyncedCount,
  applyServerDeliveryStatus
} from './offlineDb';

let isSyncing = false;
const listeners = new Set();

// Reactive network state
let isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;

export function getNetworkState() {
  return isOnline;
}

export function subscribeSyncState(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function notifyListeners(state) {
  listeners.forEach((cb) => {
    try {
      cb(state);
    } catch {}
  });
}

/**
 * Initialize event listeners for online/offline events and window focus/resume
 */
export function initSyncEngine(getUserId) {
  if (typeof window === 'undefined') return;

  const handleOnline = () => {
    isOnline = true;
    notifyListeners({ isOnline: true, isSyncing });
    const uid = getUserId ? getUserId() : null;
    if (uid) triggerSync(uid);
  };

  const handleOffline = () => {
    isOnline = false;
    notifyListeners({ isOnline: false, isSyncing });
  };

  const handleVisibility = () => {
    if (document.visibilityState === 'visible' && navigator.onLine) {
      isOnline = true;
      const uid = getUserId ? getUserId() : null;
      if (uid) triggerSync(uid);
    }
  };

  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);
  document.addEventListener('visibilitychange', handleVisibility);

  return () => {
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);
    document.removeEventListener('visibilitychange', handleVisibility);
  };
}

// Order creation is online-only. Orders are never queued on the device. Entries of type
// CREATE_ORDER can only exist if an older app version saved them; they are never sent automatically.
export const LEGACY_OFFLINE_ORDER_NOTICE =
  'Not sent. An older version of the app saved this order offline. Orders now need an internet connection: ' +
  'place it again from the Orders screen, then discard this entry.';

/**
 * Remove a queue entry (used to discard legacy offline orders after the agent has re-entered them).
 */
export async function discardQueueEntry(mutationId, userId) {
  await deleteMutation(mutationId);
  if (userId) {
    const counts = await getUnsyncedCount(userId);
    const queue = await getSyncQueue(userId);
    notifyListeners({ isOnline, isSyncing, pendingCount: counts.waiting, failedCount: counts.failed, queue });
  }
}

/**
 * Enqueue a delivery status update mutation
 */
// expectedStatus (optional, new): the order status the agent saw when acting, so the server can
// refuse the update if the order changed meanwhile (for example cancelled by the office).
export async function queueDeliveryStatusUpdate(userId, orderId, status, reason = null, note = null, paymentAmountCollected = null, paymentNotes = null, expectedStatus = null) {
  const deviceEventTime = new Date().toISOString();
  const idempotencyKey = `del-${orderId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const mutation = await enqueueMutation({
    userId,
    type: 'UPDATE_DELIVERY_STATUS',
    idempotencyKey,
    deviceEventTime,
    payload: {
      orderId: String(orderId),
      status,
      reason,
      note,
      paymentAmountCollected,
      paymentNotes,
      ...(expectedStatus ? { expectedStatus } : {})
    }
  });

  // Attempt sync immediately if online
  if (navigator.onLine) {
    triggerSync(userId).catch(() => {});
  }

  return { mutation, idempotencyKey };
}

/**
 * Enqueue a daily price change mutation for local-first storage and sync
 */
export async function queuePriceUpdate(userId, {
  itemId,
  clusterId = 0,
  newPrice,
  effectiveDate,
  basePrice,
  baseUpdatedAt,
  forceOverwrite = false,
  itemName = 'Commodity',
  clusterName = 'Global'
}) {
  const deviceEventTime = new Date().toISOString();
  const idempotencyKey = `price-${itemId}-${clusterId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const mutation = await enqueueMutation({
    userId,
    type: 'UPDATE_ITEM_PRICE',
    idempotencyKey,
    deviceEventTime,
    payload: {
      itemId: Number(itemId),
      clusterId: Number(clusterId || 0),
      newPrice: Number(newPrice),
      effectiveDate: effectiveDate || deviceEventTime.slice(0, 10),
      basePrice: Number(basePrice || 0),
      baseUpdatedAt,
      forceOverwrite,
      itemName,
      clusterName
    }
  });

  if (typeof navigator !== 'undefined' && navigator.onLine) {
    triggerSync(userId).catch(() => {});
  }

  return { mutation, idempotencyKey };
}

/**
 * Resolve price conflict by discarding offline change and accepting server value
 */
export async function resolvePriceConflictKeepServer(mutationId, serverPrice, userId) {
  await updateMutation(mutationId, {
    status: 'synced',
    syncError: null,
    isConflict: false,
    resolvedWith: 'server',
    syncedAt: new Date().toISOString()
  });
  window.dispatchEvent(new CustomEvent('linecart:prices_updated'));
}

/**
 * Resolve price conflict by overwriting server price with local user price
 */
export async function resolvePriceConflictOverwrite(mutationId, userId) {
  const store = await updateMutation(mutationId, {
    status: 'waiting',
    isConflict: false,
    syncError: null,
    payloadUpdates: { forceOverwrite: true }
  });
  if (typeof navigator !== 'undefined' && navigator.onLine) {
    triggerSync(userId).catch(() => {});
  }
}

/**
 * Execute synchronization of pending mutations for the specified user
 */
export async function triggerSync(userId) {
  if (!userId || isSyncing) return;
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    isOnline = false;
    notifyListeners({ isOnline: false, isSyncing: false });
    return;
  }

  isSyncing = true;
  notifyListeners({ isOnline: true, isSyncing: true });

  try {
    const pendingList = await getPendingMutations(userId);

    for (const item of pendingList) {
      // Mark current item as in-progress
      await updateMutation(item.mutationId, {
        status: 'syncing',
        attempts: (item.attempts || 0) + 1,
        lastAttemptAt: new Date().toISOString()
      });

      try {
        if (item.type === 'CREATE_ORDER') {
          // Legacy entry from an older app version: never sent automatically (orders are online-only).
          await updateMutation(item.mutationId, {
            status: 'failed',
            legacyOfflineOrder: true,
            syncError: LEGACY_OFFLINE_ORDER_NOTICE
          });
          continue;
        } else if (item.type === 'UPDATE_DELIVERY_STATUS') {
          const { orderId, status, reason, note, paymentAmountCollected, paymentNotes, expectedStatus } = item.payload;
          const res = await api.updateDeliveryStatus(
            orderId,
            status,
            reason,
            note,
            item.idempotencyKey,
            item.deviceEventTime,
            paymentAmountCollected,
            paymentNotes,
            expectedStatus || null
          );
          const result = classifyDeliverySyncResponse(res);
          if (result.outcome === 'synced') {
            await updateMutation(item.mutationId, {
              status: 'synced',
              syncError: null,
              syncedAt: new Date().toISOString(),
              syncedResult: {
                idempotentReplay: result.idempotentReplay
              }
            });
          } else {
            // Business rejection (illegal transition, not assigned, order changed, etc.): never retried
            await updateMutation(item.mutationId, {
              status: 'failed',
              syncError: result.error,
              ...(result.isConflict ? { isConflict: true, conflictData: { serverStatus: result.serverStatus, requestedStatus: result.requestedStatus, code: result.code } } : {})
            });
            if (result.isConflict && result.serverStatus) {
              // Replace the rejected local change with the server's status on this device
              await applyServerDeliveryStatus(userId, orderId, result.serverStatus).catch(() => {});
              window.dispatchEvent(new CustomEvent('linecart:delivery_conflict', { detail: { orderId: String(orderId), serverStatus: result.serverStatus } }));
            }
          }
        } else if (item.type === 'UPDATE_ITEM_PRICE') {
          const payload = {
            ...item.payload,
            ...(item.payloadUpdates || {})
          };
          const res = await api.updateDailyPrice(payload, item.idempotencyKey, item.deviceEventTime);
          if (res && (res.status === 200 || res.status === 1)) {
            await updateMutation(item.mutationId, {
              status: 'synced',
              syncError: null,
              isConflict: false,
              syncedAt: new Date().toISOString(),
              syncedResult: {
                idempotentReplay: Boolean(res.idempotentReplay),
                price: res.newPrice,
                effectiveDate: res.effectiveDate
              }
            });
            window.dispatchEvent(new CustomEvent('linecart:prices_updated', { detail: res }));
          } else if (res && res.status === 409) {
            // Concurrent Edit Conflict
            await updateMutation(item.mutationId, {
              status: 'failed',
              isConflict: true,
              conflictData: {
                serverPrice: res.serverPrice,
                serverUpdatedAt: res.serverUpdatedAt,
                serverUpdatedByName: res.serverUpdatedByName,
                clientPrice: res.clientPrice,
                clientEffectiveDate: res.clientEffectiveDate,
                message: res.message
              },
              syncError: res.message || 'Concurrent edit conflict detected.'
            });
            window.dispatchEvent(new CustomEvent('linecart:price_conflict', { detail: { mutation: item, res } }));
          } else {
            const errMsg = res?.message || 'Server rejected price update.';
            await updateMutation(item.mutationId, {
              status: 'failed',
              syncError: errMsg
            });
          }
        }
      } catch (networkOrTransientErr) {
        // Network connection dropped or server unreachable
        const isOfflineErr =
          !navigator.onLine ||
          networkOrTransientErr.name === 'TypeError' ||
          (networkOrTransientErr.message && networkOrTransientErr.message.includes('Failed to fetch'));

        if (isOfflineErr) {
          // Revert to 'waiting' and pause queue until network returns
          await updateMutation(item.mutationId, {
            status: 'waiting',
            syncError: 'Network unavailable. Will retry automatically when reconnected.'
          });
          isOnline = false;
          break; // Stop further requests until connection recovers
        } else {
          // Unhandled error for this item: mark as failed and continue
          await updateMutation(item.mutationId, {
            status: 'failed',
            syncError: networkOrTransientErr.message || 'Unexpected sync error.'
          });
        }
      }
    }
  } finally {
    isSyncing = false;
    const counts = await getUnsyncedCount(userId);
    const queue = await getSyncQueue(userId);
    notifyListeners({
      isOnline,
      isSyncing: false,
      pendingCount: counts.waiting,
      failedCount: counts.failed,
      queue
    });
  }
}
