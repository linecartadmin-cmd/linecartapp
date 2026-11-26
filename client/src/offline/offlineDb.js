/**
 * LineCart Offline-First IndexedDB Storage
 *
 * Manages client-side storage for:
 * - Scoped user profiles & permissions
 * - Permitted shops and catalog items
 * - 7-day past order history per shop
 * - Assigned delivery orders
 * - Independent mutation sync queue with idempotency keys
 *
 * SECURITY NOTICE (Pilot Stage):
 * Data stored in IndexedDB is NOT encrypted at rest. It is protected
 * only by the Android app UID sandbox and biometric UI authentication.
 * Physical access to a rooted or compromised device can expose this cache.
 */

import { PILOT_CLUSTERS, PILOT_CATALOG, PILOT_SHOPS } from './pilotSeedData';

const DB_NAME = 'LineCartOfflineDB';
const DB_VERSION = 3;

let dbInstance = null;

export function openOfflineDB() {
  if (dbInstance) return Promise.resolve(dbInstance);

  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB is not supported in this environment'));
      return;
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // 1. User Profiles
      if (!db.objectStoreNames.contains('profiles')) {
        db.createObjectStore('profiles', { keyPath: 'userId' });
      }

      // 2. Permitted Shops (scoped by userId)
      if (!db.objectStoreNames.contains('shops')) {
        const shopStore = db.createObjectStore('shops', { keyPath: 'id' });
        shopStore.createIndex('userId', 'userId', { unique: false });
        shopStore.createIndex('clusterId', 'clusterId', { unique: false });
        shopStore.createIndex('userId_shopId', ['userId', 'shopId'], { unique: true });
      }

      // 3. Catalog Items
      if (!db.objectStoreNames.contains('catalog')) {
        const catStore = db.createObjectStore('catalog', { keyPath: 'id' });
        catStore.createIndex('userId', 'userId', { unique: false });
      }

      // 4. Clusters
      if (!db.objectStoreNames.contains('clusters')) {
        const clusterStore = db.createObjectStore('clusters', { keyPath: 'id' });
        clusterStore.createIndex('userId', 'userId', { unique: false });
      }

      // 5. 7-Day Order History
      if (!db.objectStoreNames.contains('order_history')) {
        const histStore = db.createObjectStore('order_history', { keyPath: 'id' });
        histStore.createIndex('userId', 'userId', { unique: false });
        histStore.createIndex('userId_shopId', ['userId', 'shopId'], { unique: false });
        histStore.createIndex('date', 'date', { unique: false });
      }

      // 6. Assigned Delivery Orders
      if (!db.objectStoreNames.contains('delivery_orders')) {
        const delStore = db.createObjectStore('delivery_orders', { keyPath: 'id' });
        delStore.createIndex('userId', 'userId', { unique: false });
        delStore.createIndex('clusterId', 'clusterId', { unique: false });
      }

      // 7. Sync Queue (Independent mutations)
      if (!db.objectStoreNames.contains('sync_queue')) {
        const queueStore = db.createObjectStore('sync_queue', { keyPath: 'mutationId' });
        queueStore.createIndex('userId', 'userId', { unique: false });
        queueStore.createIndex('status', 'status', { unique: false });
        queueStore.createIndex('createdAt', 'createdAt', { unique: false });
        queueStore.createIndex('idempotencyKey', 'idempotencyKey', { unique: true });
      }

      // 8. Price History Cache
      if (!db.objectStoreNames.contains('price_history')) {
        const phStore = db.createObjectStore('price_history', { keyPath: 'id' });
        phStore.createIndex('userId', 'userId', { unique: false });
        phStore.createIndex('itemId', 'itemId', { unique: false });
      }

      // 9. Price Requests Cache
      if (!db.objectStoreNames.contains('price_requests')) {
        const prStore = db.createObjectStore('price_requests', { keyPath: 'id' });
        prStore.createIndex('userId', 'userId', { unique: false });
        prStore.createIndex('status', 'status', { unique: false });
        prStore.createIndex('orderId', 'orderId', { unique: false });
      }
    };

    request.onsuccess = (event) => {
      dbInstance = event.target.result;
      resolve(dbInstance);
    };

    request.onerror = (event) => {
      reject(new Error(`Failed to open IndexedDB: ${event.target.error?.message || 'Unknown error'}`));
    };
  });
}

// ---------------------------------------------------------------------------
// Generic Transaction Helpers
// ---------------------------------------------------------------------------

async function getStore(storeName, mode = 'readonly') {
  const db = await openOfflineDB();
  const tx = db.transaction(storeName, mode);
  return tx.objectStore(storeName);
}

function promisifyRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Remove a user's cached private data from this device (used on sign-out).
 * The sync_queue is intentionally kept: unsent delivery/price updates are sent the next time
 * that user signs in, so signing out never loses work.
 */
export async function clearUserCachedData(userId) {
  if (!userId) return;
  const uid = Number(userId);
  const db = await openOfflineDB();
  const scopedStores = ['shops', 'catalog', 'clusters', 'order_history', 'delivery_orders', 'price_history', 'price_requests'];
  for (const name of scopedStores) {
    if (!db.objectStoreNames.contains(name)) continue;
    const store = db.transaction(name, 'readwrite').objectStore(name);
    const keys = await promisifyRequest(store.index('userId').getAllKeys(uid));
    for (const key of keys) {
      await promisifyRequest(db.transaction(name, 'readwrite').objectStore(name).delete(key));
    }
  }
  if (db.objectStoreNames.contains('profiles')) {
    await promisifyRequest(db.transaction('profiles', 'readwrite').objectStore('profiles').delete(uid));
  }
}

// ---------------------------------------------------------------------------
// 1. User Profile Scoping & Caching
// ---------------------------------------------------------------------------

export async function saveUserProfile(user) {
  const uid = Number(user?.id ?? user?.userId);
  if (!user || !Number.isInteger(uid) || uid <= 0) return;
  const store = await getStore('profiles', 'readwrite');
  const record = {
    id: uid,
    userId: uid,
    name: user.name,
    phone: user.phone,
    role: user.role,
    clusterId: user.clusterId ?? user.clusterid ?? 1,
    mustChangePassword: Boolean(user.mustChangePassword),
    cachedAt: new Date().toISOString()
  };
  return promisifyRequest(store.put(record));
}

export async function getUserProfile(userId) {
  if (!userId) return null;
  const store = await getStore('profiles', 'readonly');
  const row = await promisifyRequest(store.get(Number(userId)));
  if (!row) return null;
  const normalizedId = Number(row.id ?? row.userId ?? userId);
  return {
    ...row,
    id: normalizedId,
    userId: normalizedId,
    clusterid: row.clusterid ?? row.clusterId ?? 1
  };
}

// ---------------------------------------------------------------------------
// 2. Permitted Shops & Clusters
// ---------------------------------------------------------------------------

export async function saveShops(userId, shops = []) {
  if (!userId || !Array.isArray(shops)) return;
  const db = await openOfflineDB();
  const tx = db.transaction('shops', 'readwrite');
  const store = tx.objectStore('shops');
  const now = new Date().toISOString();

  for (const shop of shops) {
    const shopId = shop.shopid ?? shop.shopId;
    if (shopId === undefined || shopId === null) continue;
    const record = {
      id: `${userId}_${shopId}`,
      userId: Number(userId),
      shopId: Number(shopId),
      clusterId: Number(shop.clusterid ?? shop.clusterId ?? 1),
      shopName: shop.shopName || '',
      shopCategory: shop.shopCategory || 'Retail',
      ownerName: shop.ownerName || '',
      contact1: shop.contact1 || '',
      address: shop.address || '',
      pincode: shop.pincode || '',
      photo: shop.photo || 'no_image.jpg',
      raw: shop,
      cachedAt: now
    };
    store.put(record);
  }

  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getShops(userId, clusterId = null, searchQuery = '') {
  if (!userId) return [];
  const store = await getStore('shops', 'readonly');
  const index = store.index('userId');
  const rawList = await promisifyRequest(index.getAll(Number(userId)));

  let filtered = rawList.map((r) => r.raw || r);

  if (clusterId && clusterId !== 'all') {
    filtered = filtered.filter((s) => Number(s.clusterid ?? s.clusterId) === Number(clusterId));
  }

  if (searchQuery && typeof searchQuery === 'string' && searchQuery.trim()) {
    const q = searchQuery.toLowerCase().trim();
    filtered = filtered.filter(
      (s) =>
        (s.shopName && s.shopName.toLowerCase().includes(q)) ||
        (s.ownerName && s.ownerName.toLowerCase().includes(q)) ||
        (s.contact1 && s.contact1.includes(q)) ||
        (s.address && s.address.toLowerCase().includes(q))
    );
  }

  return filtered;
}

export async function saveClusters(userId, clusters = []) {
  if (!userId || !Array.isArray(clusters)) return;
  const db = await openOfflineDB();
  const tx = db.transaction('clusters', 'readwrite');
  const store = tx.objectStore('clusters');
  const now = new Date().toISOString();

  for (const c of clusters) {
    const cId = c.clusterId ?? c.clusterid;
    if (cId === undefined || cId === null) continue;
    store.put({
      id: `${userId}_${cId}`,
      userId: Number(userId),
      clusterId: Number(cId),
      clusterName: c.clusterName || `Cluster ${cId}`,
      raw: c,
      cachedAt: now
    });
  }

  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getClusters(userId) {
  if (!userId) return [];
  const store = await getStore('clusters', 'readonly');
  const index = store.index('userId');
  const rawList = await promisifyRequest(index.getAll(Number(userId)));
  return rawList.map((r) => r.raw || r);
}

// ---------------------------------------------------------------------------
// 3. Catalog Items
// ---------------------------------------------------------------------------

export async function saveCatalog(userId, items = []) {
  if (!userId || !Array.isArray(items)) return;
  const db = await openOfflineDB();
  const tx = db.transaction('catalog', 'readwrite');
  const store = tx.objectStore('catalog');
  const now = new Date().toISOString();

  for (const item of items) {
    const itemId = item.itemid ?? item.itemId;
    if (itemId === undefined || itemId === null) continue;
    store.put({
      id: `${userId}_${itemId}`,
      userId: Number(userId),
      itemId: Number(itemId),
      itemName: item.itemName || '',
      price: Number(item.price) || 0,
      cprice: Number(item.cprice) || 0,
      unitType: item.unitType || 'Kgs',
      raw: item,
      cachedAt: now
    });
  }

  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getCatalog(userId) {
  if (!userId) return [];
  const store = await getStore('catalog', 'readonly');
  const index = store.index('userId');
  const rawList = await promisifyRequest(index.getAll(Number(userId)));
  return rawList.map((r) => r.raw || r);
}

// ---------------------------------------------------------------------------
// 4. Seven-Day Past Order History per Shop
// ---------------------------------------------------------------------------

export async function saveOrderHistory(userId, shopId, orders = []) {
  if (!userId || !shopId || !Array.isArray(orders)) return;
  const db = await openOfflineDB();
  const tx = db.transaction('order_history', 'readwrite');
  const store = tx.objectStore('order_history');
  const now = new Date().toISOString();

  for (const o of orders) {
    const oId = o.orderId || o.id;
    if (!oId) continue;
    store.put({
      id: `${userId}_${oId}`,
      userId: Number(userId),
      shopId: Number(shopId),
      orderId: String(oId),
      date: o.date || now.slice(0, 10),
      raw: o,
      cachedAt: now
    });
  }

  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getShopOrderHistory(userId, shopId, days = 7) {
  if (!userId || !shopId) return [];
  const store = await getStore('order_history', 'readonly');
  const index = store.index('userId_shopId');
  const list = await promisifyRequest(index.getAll([Number(userId), Number(shopId)]));

  // Sort descending by date
  const sorted = list
    .map((r) => r.raw || r)
    .sort((a, b) => new Date(b.date || b.created_at || 0) - new Date(a.date || a.created_at || 0));

  if (!days) return sorted;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - Number(days));
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  return sorted.filter((o) => (o.date || o.order_date || '').slice(0, 10) >= cutoffStr);
}

// ---------------------------------------------------------------------------
// 5. Assigned Delivery Orders
// ---------------------------------------------------------------------------

export async function saveDeliveryOrders(userId, orders = []) {
  if (!userId || !Array.isArray(orders)) return;
  const db = await openOfflineDB();
  const tx = db.transaction('delivery_orders', 'readwrite');
  const store = tx.objectStore('delivery_orders');
  const now = new Date().toISOString();

  for (const o of orders) {
    const oId = o.orderId || o.id;
    if (!oId) continue;
    store.put({
      id: `${userId}_${oId}`,
      userId: Number(userId),
      orderId: String(oId),
      clusterId: Number(o.clusterId ?? o.clusterid ?? 1),
      status: o.status || 'In progress',
      raw: o,
      cachedAt: now
    });
  }

  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getDeliveryOrders(userId, clusterId = null) {
  if (!userId) return [];
  const store = await getStore('delivery_orders', 'readonly');
  const index = store.index('userId');
  const rawList = await promisifyRequest(index.getAll(Number(userId)));
  let list = rawList.map((r) => r.raw || r);

  if (clusterId && clusterId !== 'all') {
    list = list.filter((o) => Number(o.clusterId ?? o.clusterid) === Number(clusterId));
  }

  return list;
}

/**
 * After the server refuses a queued delivery update (409), put the server's status back into this
 * device's cached copy of the order. Only the status changes; payment fields are left as they are
 * (the next server load replaces the whole cached order).
 */
export async function applyServerDeliveryStatus(userId, orderId, serverStatus) {
  if (!userId || !orderId || !serverStatus) return;
  const store = await getStore('delivery_orders', 'readwrite');
  const key = `${userId}_${orderId}`;
  const existing = await promisifyRequest(store.get(key));
  if (!existing) return;
  existing.status = serverStatus;
  existing.raw = { ...(existing.raw || {}), status: serverStatus, syncState: 'rejected' };
  existing.cachedAt = new Date().toISOString();
  await promisifyRequest(store.put(existing));
}

export async function updateLocalDeliveryOrderStatus(userId, orderId, newStatus, reason = null, note = null, paymentAmountCollected = null, paymentNotes = null) {
  if (!userId || !orderId) return;
  const store = await getStore('delivery_orders', 'readwrite');
  const key = `${userId}_${orderId}`;
  const existing = await promisifyRequest(store.get(key));

  if (existing) {
    const total = Number(existing.raw?.total || 0);
    let paymentStatus = existing.raw?.paymentStatus || 'Not collected';
    let amountCollected = Number(existing.raw?.paymentAmountCollected || 0);
    let balanceDue = existing.raw?.paymentBalanceDue !== undefined && existing.raw?.paymentBalanceDue !== null
      ? Number(existing.raw.paymentBalanceDue)
      : Math.max(0, total - amountCollected);

    if (newStatus === 'Delivered') {
      amountCollected = paymentAmountCollected !== null && paymentAmountCollected !== undefined ? Number(paymentAmountCollected) : 0;
      balanceDue = Math.max(0, total - amountCollected);
      if (amountCollected >= total && total > 0) {
        paymentStatus = 'Collected';
      } else if (amountCollected > 0) {
        paymentStatus = 'Partially collected';
      } else {
        paymentStatus = 'Not collected';
      }
    }

    const updatedRaw = {
      ...existing.raw,
      status: newStatus,
      deliveryReason: reason !== null ? reason : existing.raw?.deliveryReason,
      deliveryNote: note !== null ? note : existing.raw?.deliveryNote,
      deliveryUpdatedAt: new Date().toISOString(),
      paymentStatus,
      paymentAmountCollected: amountCollected,
      paymentBalanceDue: balanceDue,
      syncState: 'waiting' // Mark as waiting for cloud sync
    };

    existing.status = newStatus;
    existing.raw = updatedRaw;
    existing.cachedAt = new Date().toISOString();
    await promisifyRequest(store.put(existing));

    // Also sync localStorage linecart_orders if available
    try {
      const rawStored = localStorage.getItem('linecart_orders');
      if (rawStored) {
        const parsed = JSON.parse(rawStored);
        if (Array.isArray(parsed)) {
          const idx = parsed.findIndex((o) => String(o.id) === String(orderId) || String(o.orderId) === String(orderId));
          if (idx >= 0) {
            parsed[idx] = {
              ...parsed[idx],
              status: newStatus,
              deliveryReason: reason !== null ? reason : parsed[idx].deliveryReason,
              deliveryNote: note !== null ? note : parsed[idx].deliveryNote,
              deliveryUpdatedAt: new Date().toISOString(),
              paymentStatus,
              paymentAmountCollected: amountCollected,
              paymentBalanceDue: balanceDue,
              syncState: 'waiting'
            };
            localStorage.setItem('linecart_orders', JSON.stringify(parsed));
            window.dispatchEvent(new CustomEvent('linecart:orders_updated'));
          }
        }
      }
    } catch {}
  }
}

// ---------------------------------------------------------------------------
// 6. Independent Sync Queue & Idempotency
// ---------------------------------------------------------------------------

export async function enqueueMutation({ userId, type, idempotencyKey, payload, deviceEventTime }) {
  if (!userId || !type || !idempotencyKey) {
    throw new Error('Invalid mutation parameters');
  }
  if (type === 'CREATE_ORDER') {
    // Orders are online-only and must never be stored for later synchronisation
    throw new Error('Orders cannot be queued offline. An internet connection is required to place an order.');
  }

  const store = await getStore('sync_queue', 'readwrite');
  const mutation = {
    mutationId: `mut-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    userId: Number(userId),
    type, // 'UPDATE_DELIVERY_STATUS' | 'UPDATE_ITEM_PRICE'
    idempotencyKey: String(idempotencyKey),
    payload,
    deviceEventTime: deviceEventTime || new Date().toISOString(),
    status: 'waiting', // 'waiting' | 'syncing' | 'synced' | 'failed'
    syncError: null,
    attempts: 0,
    createdAt: new Date().toISOString(),
    syncedAt: null,
    syncedResult: null
  };

  await promisifyRequest(store.put(mutation));
  return mutation;
}

export async function getSyncQueue(userId) {
  if (!userId) return [];
  const store = await getStore('sync_queue', 'readonly');
  const index = store.index('userId');
  const list = await promisifyRequest(index.getAll(Number(userId)));
  return list.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

export async function getPendingMutations(userId) {
  const queue = await getSyncQueue(userId);
  return queue.filter((m) => m.status === 'waiting' || m.status === 'syncing');
}

export async function updateMutation(mutationId, updates) {
  if (!mutationId) return;
  const store = await getStore('sync_queue', 'readwrite');
  const existing = await promisifyRequest(store.get(mutationId));
  if (!existing) return;

  const merged = { ...existing, ...updates };
  return promisifyRequest(store.put(merged));
}

export async function deleteMutation(mutationId) {
  if (!mutationId) return;
  const store = await getStore('sync_queue', 'readwrite');
  await promisifyRequest(store.delete(mutationId));
}

export async function getUnsyncedCount(userId) {
  if (!userId) return { waiting: 0, failed: 0, total: 0 };
  const queue = await getSyncQueue(userId);
  const waiting = queue.filter((m) => m.status === 'waiting' || m.status === 'syncing').length;
  const failed = queue.filter((m) => m.status === 'failed').length;
  return { waiting, failed, total: waiting + failed };
}

export async function hasUnsyncedMutations(userId) {
  const counts = await getUnsyncedCount(userId);
  return counts.total > 0;
}

// ---------------------------------------------------------------------------
// 8. Price History Cache
// ---------------------------------------------------------------------------

export async function saveCachedPriceHistory(userId, itemId, history = []) {
  if (!userId || !itemId) return;
  const db = await openOfflineDB();
  const tx = db.transaction('price_history', 'readwrite');
  const store = tx.objectStore('price_history');
  store.put({
    id: `${userId}_${itemId}`,
    userId: Number(userId),
    itemId: Number(itemId),
    history,
    cachedAt: new Date().toISOString()
  });
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getCachedPriceHistory(userId, itemId) {
  if (!userId || !itemId) return [];
  try {
    const store = await getStore('price_history', 'readonly');
    const res = await promisifyRequest(store.get(`${userId}_${itemId}`));
    return res?.history || [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// 9. Customer Price Requests Offline Cache
// ---------------------------------------------------------------------------

export async function savePriceRequests(userId, requests = []) {
  if (!userId || !Array.isArray(requests)) return;
  const db = await openOfflineDB();
  const tx = db.transaction('price_requests', 'readwrite');
  const store = tx.objectStore('price_requests');
  for (const pr of requests) {
    if (!pr.id) continue;
    store.put({
      ...pr,
      userId: Number(userId),
      cachedAt: new Date().toISOString()
    });
  }
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getPriceRequests(userId, status = null) {
  if (!userId) return [];
  try {
    const store = await getStore('price_requests', 'readonly');
    const index = store.index('userId');
    const list = await promisifyRequest(index.getAll(Number(userId)));
    if (!status || status === 'all') return list;
    return list.filter((pr) => pr.status === status);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// 10. Offline Pilot Seeding
// ---------------------------------------------------------------------------

export async function seedPilotDataIfEmpty(userId = 1) {
  const effectiveUid = Number(userId || 1);
  const existingClusters = await getClusters(effectiveUid);
  const existingCatalog = await getCatalog(effectiveUid);
  const existingShops = await getShops(effectiveUid);

  if (existingClusters.length === 0) {
    await saveClusters(effectiveUid, PILOT_CLUSTERS);
  }
  if (existingCatalog.length === 0) {
    await saveCatalog(effectiveUid, PILOT_CATALOG);
  }
  if (existingShops.length === 0) {
    await saveShops(effectiveUid, PILOT_SHOPS);
  }

  const clusters = existingClusters.length ? existingClusters : PILOT_CLUSTERS;
  const catalog = existingCatalog.length ? existingCatalog : PILOT_CATALOG;
  const shops = existingShops.length ? existingShops : PILOT_SHOPS;

  return { clusters, catalog, shops };
}

