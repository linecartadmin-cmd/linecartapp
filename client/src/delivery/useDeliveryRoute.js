import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { planRoadDeliveryRoute } from '../routing';
import { queueDeliveryStatusUpdate, subscribeSyncState, getNetworkState } from '../offline/syncEngine';
import { updateLocalDeliveryOrderStatus, getDeliveryOrders, saveDeliveryOrders, getSyncQueue, applyServerDeliveryStatus } from '../offline/offlineDb';
import { STATUS, deliveryCounts, nextStopIndex, paymentOutcome, syncStateByOrder } from './deliveryModel';

/**
 * Delivery Agent data and actions. The load order, offline queue calls and API calls are the same
 * as the previous DeliveryRouteScreen; what changed is that every action now reports its outcome:
 *   'synced'   the server accepted it (only then is it shown as done)
 *   'queued'   saved on the phone, waiting to sync (shown as pending, never as done)
 *   'rejected' the server refused it (nothing changed locally)
 *   'error'    it could not be saved at all
 * A synchronous in-flight guard stops double taps from sending the same update twice.
 */
export function useDeliveryRoute({ user, showToast, t }) {
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState([]);
  const [clusters, setClusters] = useState([]);
  const [selectedClusterId, setSelectedClusterId] = useState('all');
  const [routeInfo, setRouteInfo] = useState(null);
  const [optimizing, setOptimizing] = useState(false);
  const [updatingId, setUpdatingId] = useState(null);
  const [queue, setQueue] = useState([]);
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : getNetworkState()));
  const inFlight = useRef(false);
  const userId = user?.id;

  // showToast and the strings change identity on every parent render; keep them in refs so data is
  // reloaded only when the user or the selected area changes.
  const showToastRef = useRef(showToast);
  showToastRef.current = showToast;
  const tRef = useRef(t);
  tRef.current = t;
  const toast = useCallback((msg, variant) => showToastRef.current && showToastRef.current(msg, variant), []);

  // Load assigned orders: device cache first, then the server (same calls as before)
  const loadAssignedOrders = useCallback(async () => {
    if (userId) {
      try {
        const cached = await getDeliveryOrders(userId, selectedClusterId === 'all' ? null : selectedClusterId);
        if (cached && cached.length > 0) {
          setOrders(cached);
          setLoading(false);
        }
      } catch {}
    }
    try {
      const res = await api.getDeliveryOrders(selectedClusterId === 'all' ? undefined : selectedClusterId, userId);
      if (res && res.status === 200) {
        setOrders(res.orders || []);
        if (userId && Array.isArray(res.orders)) saveDeliveryOrders(userId, res.orders).catch(() => {});
        if (res.clusters && res.clusters.length > 0) {
          setClusters(res.clusters);
          if (res.clusters.length === 1 && selectedClusterId === 'all') setSelectedClusterId(String(res.clusters[0].clusterId));
        }
      } else {
        toast(res?.message || 'Error loading deliveries', 'error');
      }
    } catch (err) {
      console.warn('[DeliveryRoute] Backend offline, using cached stops:', err?.message);
      toast('Working offline: loaded cached delivery stops', 'warning');
    } finally {
      setLoading(false);
    }
  }, [userId, selectedClusterId, toast]);

  useEffect(() => {
    loadAssignedOrders();
  }, [loadAssignedOrders]);

  // Offline queue state for this user: initial read plus every update the sync engine publishes.
  // When pending updates finish syncing, reload from the server so the list shows confirmed values.
  const pendingRef = useRef(0);
  useEffect(() => {
    if (!userId) return undefined;
    let active = true;
    getSyncQueue(userId)
      .then((q) => {
        if (!active) return;
        setQueue(q || []);
        pendingRef.current = (q || []).filter((m) => m.type === 'UPDATE_DELIVERY_STATUS' && (m.status === 'waiting' || m.status === 'syncing')).length;
      })
      .catch(() => {});
    const unsubscribe = subscribeSyncState((state) => {
      if (typeof state?.isOnline === 'boolean') setOnline(state.isOnline);
      if (Array.isArray(state?.queue)) {
        setQueue(state.queue);
        const pendingNow = state.queue.filter((m) => m.type === 'UPDATE_DELIVERY_STATUS' && (m.status === 'waiting' || m.status === 'syncing')).length;
        if (pendingRef.current > 0 && pendingNow < pendingRef.current && state.isOnline !== false) loadAssignedOrders();
        pendingRef.current = pendingNow;
      }
    });
    const onConflict = (e) => {
      const d = e?.detail;
      if (d?.orderId && d.serverStatus) applyLocal(d.orderId, { status: d.serverStatus, syncState: 'rejected' });
    };
    window.addEventListener('linecart:delivery_conflict', onConflict);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      active = false;
      unsubscribe();
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
      window.removeEventListener('linecart:delivery_conflict', onConflict);
    };
  }, [userId, loadAssignedOrders]);

  const refreshQueue = useCallback(async () => {
    if (!userId) return;
    try {
      const q = await getSyncQueue(userId);
      setQueue(q || []);
      pendingRef.current = (q || []).filter((m) => m.type === 'UPDATE_DELIVERY_STATUS' && (m.status === 'waiting' || m.status === 'syncing')).length;
    } catch {}
  }, [userId]);

  const syncMap = useMemo(() => syncStateByOrder(queue), [queue]);

  const currentStops = useMemo(() => {
    if (selectedClusterId === 'all') return orders;
    return orders.filter((o) => String(o.clusterId) === String(selectedClusterId));
  }, [orders, selectedClusterId]);

  // Route order from the planner when started, otherwise the server order (as before)
  const activeStops = useMemo(() => {
    if (routeInfo?.orderedStops?.length) {
      return routeInfo.orderedStops.map((rs) => orders.find((o) => String(o.id) === String(rs.id)) || rs);
    }
    return currentStops;
  }, [routeInfo, currentStops, orders]);

  const counts = useMemo(() => deliveryCounts(currentStops), [currentStops]);
  const nextIndex = useMemo(() => nextStopIndex(activeStops), [activeStops]);

  const startRoute = useCallback(async () => {
    setOptimizing(true);
    try {
      const planned = await planRoadDeliveryRoute(currentStops);
      setRouteInfo(planned);
      return planned;
    } catch (err) {
      console.error('Route optimization error:', err);
      return null;
    } finally {
      setOptimizing(false);
    }
  }, [currentStops]);

  const applyLocal = (orderId, patch) =>
    setOrders((prev) => prev.map((o) => (String(o.id) === String(orderId) ? { ...o, ...patch } : o)));

  // Status update with payment. Offline and network-drop paths queue exactly as before.
  const updateStatus = useCallback(
    async (orderId, newStatus, { reason = null, note = null, paymentAmountCollected = null, paymentNotes = null } = {}) => {
      if (inFlight.current) return { outcome: 'busy' };
      const target = orders.find((o) => String(o.id) === String(orderId));
      if (target && target.status === STATUS.PRICE_PENDING) {
        toast('Cannot update delivery: Order has price approval pending.', 'error');
        return { outcome: 'rejected' };
      }
      inFlight.current = true;
      setUpdatingId(String(orderId));
      // The status the agent is acting on; the server refuses the update if the order changed since
      const expectedStatus = target?.status || null;

      const col = paymentAmountCollected !== null && paymentAmountCollected !== undefined
        ? Number(paymentAmountCollected)
        : Number(target?.paymentAmountCollected || 0);
      const pay = paymentOutcome(target?.total, col);
      const localPatch = {
        status: newStatus,
        deliveryReason: reason,
        deliveryNote: note,
        deliveryUpdatedAt: new Date().toISOString(),
        paymentStatus: newStatus === STATUS.DELIVERED ? pay.status : target?.paymentStatus || 'Not collected',
        paymentAmountCollected: col,
        paymentBalanceDue: pay.balance
      };

      const queueIt = async (message) => {
        await queueDeliveryStatusUpdate(userId, orderId, newStatus, reason, note, paymentAmountCollected, paymentNotes, expectedStatus);
        await updateLocalDeliveryOrderStatus(userId, orderId, newStatus, reason, note, paymentAmountCollected, paymentNotes);
        applyLocal(orderId, { ...localPatch, syncState: 'waiting' });
        await refreshQueue();
        toast(message, 'warning');
        return { outcome: 'queued', payment: pay };
      };

      try {
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
          try {
            return await queueIt(tRef.current.queuedToast);
          } catch (err) {
            toast(`Failed to update offline status: ${err.message}`, 'error');
            return { outcome: 'error' };
          }
        }
        try {
          const res = await api.updateDeliveryStatus(orderId, newStatus, reason, note, null, null, paymentAmountCollected, paymentNotes, expectedStatus);
          if (res && (res.status === 200 || res.status === 1)) {
            const confirmedPay = {
              ...pay,
              status: res.order?.paymentStatus || pay.status,
              collected: res.order?.paymentAmountCollected !== undefined ? Number(res.order.paymentAmountCollected) : pay.collected,
              balance: res.order?.paymentBalanceDue !== undefined ? Number(res.order.paymentBalanceDue) : pay.balance
            };
            applyLocal(orderId, {
              ...localPatch,
              paymentStatus: newStatus === STATUS.DELIVERED ? confirmedPay.status : localPatch.paymentStatus,
              paymentAmountCollected: confirmedPay.collected,
              paymentBalanceDue: confirmedPay.balance,
              syncState: 'synced'
            });
            toast(tRef.current.updateSuccess, 'success');
            return { outcome: 'synced', payment: confirmedPay };
          }
          if (res && res.status === 409 && res.currentStatus) {
            // The order changed on the server (for example cancelled by the office): show its real status
            applyLocal(orderId, { status: res.currentStatus, syncState: 'rejected' });
            applyServerDeliveryStatus(userId, orderId, res.currentStatus).catch(() => {});
          }
          toast(res?.message || tRef.current.updateFailed, 'error');
          return { outcome: 'rejected', message: res?.message, serverStatus: res?.currentStatus || null };
        } catch {
          // Network dropped mid-request: keep the update on the phone (same as before)
          try {
            return await queueIt(tRef.current.queuedToast);
          } catch {
            toast(tRef.current.updateFailed, 'error');
            return { outcome: 'error' };
          }
        }
      } finally {
        inFlight.current = false;
        setUpdatingId(null);
      }
    },
    [orders, userId, toast, refreshQueue]
  );

  return {
    loading,
    orders,
    clusters,
    selectedClusterId,
    setSelectedClusterId,
    currentStops,
    activeStops,
    counts,
    nextIndex,
    routeInfo,
    optimizing,
    startRoute,
    updateStatus,
    updatingId,
    syncMap,
    queue,
    online,
    reload: loadAssignedOrders
  };
}
