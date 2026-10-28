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
import {
  enqueueMutation,
  getSyncQueue,
  getPendingMutations,
  updateMutation,
  getUnsyncedCount
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

/**
 * Enqueue an order creation mutation for local-first storage and eventual cloud sync
 */
export async function queueOrderCreation(userId, orderList, currentShop, activeItems) {
  const deviceEventTime = new Date().toISOString();
  const idempotencyKey = `ord-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const tempRef = `TEMP-${Date.now().toString().slice(-6)}`;

  const mutation = await enqueueMutation({
    userId,
    type: 'CREATE_ORDER',
    idempotencyKey,
    deviceEventTime,
    payload: {
      orderList,
      tempRef,
      shopName: currentShop?.shopName || 'Customer Store',
      shopId: currentShop?.shopid,
      total: activeItems.reduce(
        (sum, item) => sum + (Number(item.qty) || 0) * (Number(item.custprice || item.price) || 0),
        0
      ),
      itemsCount: activeItems.length
    }
  });

  // Attempt sync immediately if online
  if (navigator.onLine) {
    triggerSync(userId).catch(() => {});
  }

  return { mutation, tempRef, idempotencyKey };
}

/**
 * Enqueue a delivery status update mutation
 */
export async function queueDeliveryStatusUpdate(userId, orderId, status, reason = null, note = null, paymentAmountCollected = null, paymentNotes = null) {
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
      paymentNotes
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
          const res = await api.createOrder(
            item.payload.orderList,
            item.idempotencyKey,
            item.deviceEventTime
          );

          if (res && (res.status === 200 || res.status === 1)) {
            await updateMutation(item.mutationId, {
              status: 'synced',
              syncError: null,
              syncedAt: new Date().toISOString(),
              syncedResult: {
                orderId: res.orderId,
                serialNo: res.id,
                idempotentReplay: Boolean(res.idempotentReplay)
              }
            });

            // Update local orders list in-place so TEMP-XXXXXX becomes real orderId without duplicating
            try {
              const raw = localStorage.getItem('linecart_orders');
              if (raw) {
                const list = JSON.parse(raw);
                if (Array.isArray(list)) {
                  let changed = false;
                  const updatedList = list.map((ord) => {
                    if (ord.id === item.payload?.tempRef || ord.orderId === item.payload?.tempRef || ord.idempotencyKey === item.idempotencyKey) {
                      changed = true;
                      return {
                        ...ord,
                        id: res.orderId || ord.id,
                        orderId: res.orderId || ord.orderId,
                        syncStatus: 'synced'
                      };
                    }
                    return ord;
                  });
                  if (changed) {
                    localStorage.setItem('linecart_orders', JSON.stringify(updatedList));
                    window.dispatchEvent(new CustomEvent('linecart:orders_updated'));
                  }
                }
              }
            } catch {}
          } else {
            // Server returned business rejection (e.g. 400, 403, validation)
            // Mark as 'failed' (Needs attention) and CONTINUE to next item
            const errMsg = res?.message || 'Server rejected order creation.';
            await updateMutation(item.mutationId, {
              status: 'failed',
              syncError: errMsg
            });
          }
        } else if (item.type === 'UPDATE_DELIVERY_STATUS') {
          const { orderId, status, reason, note, paymentAmountCollected, paymentNotes } = item.payload;
          const res = await api.updateDeliveryStatus(
            orderId,
            status,
            reason,
            note,
            item.idempotencyKey,
            item.deviceEventTime,
            paymentAmountCollected,
            paymentNotes
          );

          if (res && (res.status === 200 || res.status === 1)) {
            await updateMutation(item.mutationId, {
              status: 'synced',
              syncError: null,
              syncedAt: new Date().toISOString(),
              syncedResult: {
                idempotentReplay: Boolean(res.idempotentReplay)
              }
            });
          } else {
            // Business rejection (illegal transition, not assigned, etc.)
            const errMsg = res?.message || 'Server rejected status update.';
            await updateMutation(item.mutationId, {
              status: 'failed',
              syncError: errMsg
            });
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
