import { getMemorySessionToken } from './offline/biometricAuth';
import {
  saveClusters,
  getClusters,
  saveShops,
  getShops,
  saveCatalog,
  getCatalog,
  saveOrderHistory,
  getShopOrderHistory as getCachedOrderHistory,
  saveDeliveryOrders,
  getDeliveryOrders as getCachedDeliveryOrders,
  saveCachedPriceHistory,
  getCachedPriceHistory,
  savePriceRequests,
  getPriceRequests as getCachedPriceRequests
} from './offline/offlineDb';

const ENV_API_URL = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_BASE_URL)
  ? String(import.meta.env.VITE_API_BASE_URL).replace(/\/+$/, '')
  : '';
const isCapacitorNative = typeof window !== 'undefined' && (
  (window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform()) ||
  window.location.protocol === 'capacitor:' ||
  (window.location.hostname === 'localhost' && window.location.port === '')
);
const BASE_URL = ENV_API_URL || (isCapacitorNative ? 'https://linecart-staging.onrender.com' : (typeof window !== 'undefined' && window.location.port === '3000' ? 'http://localhost:3001' : ''));

// Client capability level sent with orders. Level 2 = online-only ordering (no offline order queue).
// The server can require a minimum level via MIN_ORDER_CLIENT_LEVEL to stop older app versions.
export const ORDER_CLIENT_LEVEL = '2';

export const INDIAN_MOBILE_REGEX = /^[6-9]\d{9}$/;

export function isValidIndianMobile(phone) {
  return typeof phone === 'string' && INDIAN_MOBILE_REGEX.test(phone);
}

const getAuthHeaders = () => {
  try {
    const headers = {};
    const token = getMemorySessionToken() || (typeof localStorage !== 'undefined' ? localStorage.getItem('LineCartPref_token') : null);
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
      headers['X-Session-Token'] = token;
    }
    return headers;
  } catch {
    return {};
  }
};

export const api = {
  // Verify active session with backend and get authoritative user & role
  async getAuthMe() {
    try {
      const res = await fetch(`${BASE_URL}/api/auth/me`, {
        headers: { ...getAuthHeaders() }
      });
      return await res.json();
    } catch (err) {
      return { status: 500, authenticated: false, message: err.message };
    }
  },

  // Terminate active session
  async logout() {
    try {
      await fetch(`${BASE_URL}/api/auth/logout`, {
        method: 'POST',
        headers: { ...getAuthHeaders() }
      });
    } catch {}
  },

  // System mode and environment check
  async getSystemMode() {
    const res = await fetch(`${BASE_URL}/api/system/mode`);
    return res.json();
  },

  // One-time Initial Admin Setup when no active Admin has a configured password
  async setupInitialAdmin({ name, phone, password, setupToken }) {
    const headers = { 'Content-Type': 'application/json' };
    if (setupToken) headers['Authorization'] = `Setup ${setupToken}`;
    const res = await fetch(`${BASE_URL}/api/system/setup-admin`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name, phone, password })
    });
    return res.json();
  },

  // Demo users list for quick testing (development only)
  async getDemoUsers() {
    const res = await fetch(`${BASE_URL}/api/demo-users`);
    return res.json();
  },

  // 1. POST /login (Credentials sent strictly in POST request body)
  async login(phone, password) {
    const res = await fetch(`${BASE_URL}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, password })
    });
    return res.json();
  },

  // Change password endpoint
  async changePassword(userId, currentPassword, newPassword) {
    const res = await fetch(`${BASE_URL}/api/auth/change-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({ userId, currentPassword, newPassword })
    });
    return res.json();
  },

  // 2. GET /clusterinfo?spersonId=...
  async getClusterInfo(spersonId) {
    try {
      const res = await fetch(`${BASE_URL}/clusterinfo?spersonId=${encodeURIComponent(spersonId || '')}`, {
        headers: { ...getAuthHeaders() }
      });
      const data = await res.json();
      if ((data.status === 200 || data.status === 1) && data.result?.clusterList) {
        saveClusters(spersonId, data.result.clusterList).catch(() => {});
      }
      return data;
    } catch (err) {
      if (spersonId) {
        const cached = await getClusters(spersonId);
        if (cached && cached.length > 0) {
          return { status: 200, result: { clusterList: cached }, cached: true };
        }
      }
      return { status: 500, message: err.message, result: { clusterList: [] } };
    }
  },

  // 3. GET /getitemsorder?spersonId=...
  async getItemsOrder(spersonId) {
    try {
      const res = await fetch(`${BASE_URL}/getitemsorder?spersonId=${encodeURIComponent(spersonId || '')}`, {
        headers: { ...getAuthHeaders() }
      });
      const data = await res.json();
      if ((data.status === 200 || data.status === 1) && data.result?.clusterList) {
        const allShops = [];
        let catalog = [];
        data.result.clusterList.forEach((c) => {
          if (c.shopsList) {
            c.shopsList.forEach((s) => allShops.push({ ...s, clusterid: c.clusterId }));
            if (!catalog.length && c.shopsList[0]?.itemsList) {
              catalog = c.shopsList[0].itemsList;
            }
          }
        });
        if (allShops.length && spersonId) saveShops(spersonId, allShops).catch(() => {});
        if (catalog.length && spersonId) saveCatalog(spersonId, catalog).catch(() => {});
      }
      return data;
    } catch (err) {
      if (spersonId) {
        const cachedShops = await getShops(spersonId);
        const cachedCatalog = await getCatalog(spersonId);
        if (cachedShops && cachedShops.length > 0) {
          const clusterMap = {};
          cachedShops.forEach((s) => {
            const cid = s.clusterid || 1;
            if (!clusterMap[cid]) {
              clusterMap[cid] = { clusterId: cid, shopsList: [] };
            }
            clusterMap[cid].shopsList.push({
              ...s,
              itemsList: cachedCatalog
            });
          });
          return {
            status: 200,
            result: { clusterList: Object.values(clusterMap) },
            cached: true
          };
        }
      }
      return { status: 500, message: err.message, result: { clusterList: [] } };
    }
  },

  // Lightweight reachability check (no database work on the server)
  async ping(timeoutMs = 6000) {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
    try {
      const res = await fetch(`${BASE_URL}/api/ping`, { cache: 'no-store', signal: ctrl?.signal });
      return res.ok;
    } catch {
      return false;
    } finally {
      if (timer) clearTimeout(timer);
    }
  },

  // 4. POST /createorder (online only)
  // Resolves with the server's JSON for any definite answer (2xx/4xx).
  // Throws an Error with `uncertain = true` when we cannot tell whether the server created the order
  // (network failure, timeout, gateway error, non-JSON body). Callers retry with the SAME idempotency
  // key, and the server returns the existing order instead of creating a duplicate.
  async createOrder(orderList, idempotencyKey = null, deviceEventTime = null, extraMeta = {}, timeoutMs = 30000) {
    const key = idempotencyKey || `ord-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const eventTime = deviceEventTime || new Date().toISOString();
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
    const uncertain = (message) => {
      const err = new Error(message);
      err.uncertain = true;
      return err;
    };
    let res;
    try {
      res = await fetch(`${BASE_URL}/createorder`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Idempotency-Key': key,
          'X-Device-Event-Time': eventTime,
          'X-LineCart-Client': ORDER_CLIENT_LEVEL,
          ...getAuthHeaders()
        },
        body: JSON.stringify({
          orderList,
          idempotencyKey: key,
          deviceEventTime: eventTime,
          ...(extraMeta || {})
        }),
        signal: ctrl?.signal
      });
    } catch (err) {
      throw uncertain(err?.name === 'AbortError' ? 'The server did not answer in time.' : 'The connection was interrupted.');
    } finally {
      if (timer) clearTimeout(timer);
    }
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    if (!body || [502, 503, 504].includes(res.status)) {
      throw uncertain(`The server is temporarily unavailable (HTTP ${res.status}).`);
    }
    return body;
  },

  // 4b. GET /api/orders (Authoritative orders scoped by caller role)
  async getOrders(params = {}) {
    try {
      const q = new URLSearchParams();
      if (params.status) q.set('status', params.status);
      if (params.limit) q.set('limit', String(params.limit));
      const res = await fetch(`${BASE_URL}/api/orders${q.toString() ? '?' + q.toString() : ''}`, {
        headers: { ...getAuthHeaders() }
      });
      return await res.json();
    } catch (err) {
      return { status: 500, orders: [], message: err.message };
    }
  },

  // 4a. GET /api/shops/:shopId/order-history (Previous 7-day past orders for selected shop)
  async getShopOrderHistory(shopId, days = 7, userId = null) {
    try {
      const res = await fetch(`${BASE_URL}/api/shops/${encodeURIComponent(shopId)}/order-history?days=${encodeURIComponent(days)}`, {
        headers: { ...getAuthHeaders() }
      });
      const data = await res.json();
      if (data && data.status === 200 && Array.isArray(data.orders)) {
        if (userId) {
          saveOrderHistory(userId, shopId, data.orders).catch(() => {});
        }
      }
      return data;
    } catch (err) {
      if (userId) {
        const cached = await getCachedOrderHistory(userId, shopId, days);
        if (cached && cached.length > 0) {
          return { status: 200, orders: cached, cached: true };
        }
      }
      return { status: 500, message: err.message, orders: [] };
    }
  },

  // 4b. GET /api/shops (Scoped shop list with assigned agents)
  async getShops() {
    try {
      const res = await fetch(`${BASE_URL}/api/shops`, {
        headers: { ...getAuthHeaders() }
      });
      return await res.json();
    } catch (err) {
      return { status: 500, shops: [], message: err.message };
    }
  },

  // 4c. PUT /api/shops/:shopId/assign (Assign shop to Field Sales Agent - Admin & Sales Manager)
  async assignShopAgent(shopId, agentId) {
    try {
      const res = await fetch(`${BASE_URL}/api/shops/${encodeURIComponent(shopId)}/assign`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders()
        },
        body: JSON.stringify({ agentId })
      });
      return await res.json();
    } catch (err) {
      return { status: 500, message: err.message };
    }
  },

  // 5. GET /gethomereport?spersonId=...
  async getHomeReport(spersonId) {
    let url = `${BASE_URL}/gethomereport`;
    if (typeof spersonId === 'object' && spersonId !== null) {
      const params = new URLSearchParams();
      if (spersonId.spersonId !== undefined && spersonId.spersonId !== null && spersonId.spersonId !== '') {
        params.set('spersonId', spersonId.spersonId);
      }
      if (spersonId.clusterId !== undefined && spersonId.clusterId !== null && spersonId.clusterId !== '') {
        params.set('clusterId', spersonId.clusterId);
      }
      if (spersonId.period) {
        params.set('period', spersonId.period);
      }
      if (spersonId.fromDate) {
        params.set('fromDate', spersonId.fromDate);
      }
      if (spersonId.toDate) {
        params.set('toDate', spersonId.toDate);
      }
      const qs = params.toString();
      if (qs) url += `?${qs}`;
    } else {
      url += `?spersonId=${encodeURIComponent(spersonId || '')}`;
    }
    const res = await fetch(url, {
      headers: { ...getAuthHeaders() }
    });
    return res.json();
  },

  // 6. POST /addcustomer (supports Multipart FormData with image + customer JSON, matching APK ApiService)
  async addCustomer(customerData, imageFile = null) {
    if (imageFile) {
      const formData = new FormData();
      formData.append('image', imageFile);
      formData.append('customer', JSON.stringify(customerData));
      const res = await fetch(`${BASE_URL}/addcustomer`, {
        method: 'POST',
        headers: { ...getAuthHeaders() },
        body: formData
      });
      return res.json();
    }
    const res = await fetch(`${BASE_URL}/addcustomer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify(customerData)
    });
    return res.json();
  },

  // 7. Sales Manager APIs (Scoped to assigned agents)
  async getManagerAssignments(managerId) {
    const q = (managerId !== undefined && managerId !== null && managerId !== '')
      ? `?managerId=${encodeURIComponent(managerId)}`
      : '';
    const res = await fetch(`${BASE_URL}/api/manager/assignments${q}`, {
      headers: { ...getAuthHeaders() }
    });
    return res.json();
  },

  async getManagerAssignedAgents(managerId) {
    const res = await this.getManagerAssignments(managerId);
    return {
      status: res?.status || 200,
      agents: res?.assignedAgents || [],
      assignedAgents: res?.assignedAgents || []
    };
  },

  async updateManagerAssignments(managerId, agentIds) {
    const res = await fetch(`${BASE_URL}/api/manager/assignments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({ managerId, agentIds })
    });
    return res.json();
  },

  async getManagerOrders(params = {}) {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') query.append(k, v);
    });
    const res = await fetch(`${BASE_URL}/api/manager/orders?${query.toString()}`, {
      headers: { ...getAuthHeaders() }
    });
    return res.json();
  },

  async getManagerReports(params = {}) {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') query.append(k, v);
    });
    const res = await fetch(`${BASE_URL}/api/manager/reports?${query.toString()}`, {
      headers: { ...getAuthHeaders() }
    });
    return res.json();
  },

  async getManagerTargets(managerId) {
    const res = await fetch(`${BASE_URL}/api/manager/targets?managerId=${encodeURIComponent(managerId || 100)}`, {
      headers: { ...getAuthHeaders() }
    });
    return res.json();
  },

  async saveManagerTarget(targetData) {
    const res = await fetch(`${BASE_URL}/api/manager/targets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify(targetData)
    });
    return res.json();
  },

  async getManagerShops(params = {}) {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') query.append(k, v);
    });
    const res = await fetch(`${BASE_URL}/api/manager/shops?${query.toString()}`, {
      headers: { ...getAuthHeaders() }
    });
    return res.json();
  },

  // 8. General Role Permissions (Dynamic Frontend Capability Guard)
  async getRolePermissions() {
    const res = await fetch(`${BASE_URL}/api/role-permissions`, {
      headers: { ...getAuthHeaders() }
    });
    return res.json();
  },

  // 9. Administrator APIs (Full Organization Governance)
  async getAdminDashboard() {
    const res = await fetch(`${BASE_URL}/api/admin/dashboard`, {
      headers: { ...getAuthHeaders() }
    });
    return res.json();
  },

  async getAdminUsers() {
    const res = await fetch(`${BASE_URL}/api/admin/users`, {
      headers: { ...getAuthHeaders() }
    });
    return res.json();
  },

  async createAdminUser(userData) {
    const res = await fetch(`${BASE_URL}/api/admin/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify(userData)
    });
    return res.json();
  },

  async updateAdminUser(id, userData) {
    const res = await fetch(`${BASE_URL}/api/admin/users/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify(userData)
    });
    return res.json();
  },

  async toggleUserStatus(id, active) {
    const res = await fetch(`${BASE_URL}/api/admin/users/${id}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({ active })
    });
    return res.json();
  },

  async deleteAdminUser(id) {
    const res = await fetch(`${BASE_URL}/api/admin/users/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { ...getAuthHeaders() }
    });
    return res.json();
  },

  async getAdminPermissions() {
    const res = await fetch(`${BASE_URL}/api/admin/permissions`, {
      headers: { ...getAuthHeaders() }
    });
    return res.json();
  },

  async updateAdminPermissions(role, pages, actions) {
    const res = await fetch(`${BASE_URL}/api/admin/permissions`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({ role, pages, actions })
    });
    return res.json();
  },

  async getAdminOrders(params = {}) {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') query.append(k, v);
    });
    const res = await fetch(`${BASE_URL}/api/admin/orders?${query.toString()}`, {
      headers: { ...getAuthHeaders() }
    });
    return res.json();
  },

  async adminCreateOrder(orderData) {
    const res = await fetch(`${BASE_URL}/api/admin/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify(orderData)
    });
    return res.json();
  },

  async adminUpdateOrder(orderId, orderData) {
    const res = await fetch(`${BASE_URL}/api/admin/orders/${encodeURIComponent(orderId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify(orderData)
    });
    return res.json();
  },

  async adminCancelOrder(orderId, reason = '') {
    const res = await fetch(`${BASE_URL}/api/admin/orders/${encodeURIComponent(orderId)}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({ reason })
    });
    return res.json();
  },

  async adminDeleteOrder(orderId) {
    const res = await fetch(`${BASE_URL}/api/admin/orders/${encodeURIComponent(orderId)}`, {
      method: 'DELETE',
      headers: { ...getAuthHeaders() }
    });
    return res.json();
  },

  async getAdminReports(params = {}) {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') query.append(k, v);
    });
    const res = await fetch(`${BASE_URL}/api/admin/reports?${query.toString()}`, {
      headers: { ...getAuthHeaders() }
    });
    return res.json();
  },

  async getAdminTargets(params = {}) {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') query.append(k, v);
    });
    const res = await fetch(`${BASE_URL}/api/admin/targets?${query.toString()}`, {
      headers: { ...getAuthHeaders() }
    });
    return res.json();
  },

  async saveAdminTarget(targetData) {
    const res = await fetch(`${BASE_URL}/api/admin/targets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify(targetData)
    });
    return res.json();
  },

  async deleteAdminTarget(id) {
    const res = await fetch(`${BASE_URL}/api/admin/targets/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { ...getAuthHeaders() }
    });
    return res.json();
  },

  async getAdminItems() {
    const res = await fetch(`${BASE_URL}/api/admin/items`, {
      headers: { ...getAuthHeaders() }
    });
    return res.json();
  },

  // 16b. Items & Daily Pricing APIs
  async getItems(clusterId = 'all', userId = null) {
    try {
      const res = await fetch(`${BASE_URL}/api/items?clusterId=${encodeURIComponent(clusterId || 'all')}`, {
        headers: { ...getAuthHeaders() }
      });
      const data = await res.json();
      if ((data.status === 200 || data.status === 1) && Array.isArray(data.items)) {
        if (userId) {
          saveCatalog(userId, data.items).catch(() => {});
        }
      }
      return data;
    } catch (err) {
      if (userId) {
        const cached = await getCatalog(userId);
        if (cached && cached.length > 0) {
          return {
            status: 200,
            items: cached,
            clusters: [],
            authorizedClusterIds: [],
            canManageCatalog: false,
            canUpdatePrices: true,
            isOfflineCached: true
          };
        }
      }
      throw err;
    }
  },

  async createItem(itemData) {
    const res = await fetch(`${BASE_URL}/api/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify(itemData)
    });
    return res.json();
  },

  async updateItem(id, itemData) {
    const res = await fetch(`${BASE_URL}/api/items/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify(itemData)
    });
    return res.json();
  },

  async archiveItem(id, active) {
    const res = await fetch(`${BASE_URL}/api/items/${encodeURIComponent(id)}/archive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({ active })
    });
    return res.json();
  },

  async deleteItem(id) {
    const res = await fetch(`${BASE_URL}/api/items/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { ...getAuthHeaders() }
    });
    return res.json();
  },

  async updateDailyPrice(payload, idempotencyKey = null, deviceEventTime = null) {
    const headers = { 'Content-Type': 'application/json', ...getAuthHeaders() };
    if (idempotencyKey) headers['X-Idempotency-Key'] = idempotencyKey;
    if (deviceEventTime) headers['X-Device-Event-Time'] = deviceEventTime;

    const res = await fetch(`${BASE_URL}/api/items/price`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        ...payload,
        idempotencyKey: idempotencyKey || payload.idempotencyKey
      })
    });
    return res.json();
  },

  async getItemPriceHistory(itemId, userId = null) {
    try {
      const res = await fetch(`${BASE_URL}/api/items/${encodeURIComponent(itemId)}/history`, {
        headers: { ...getAuthHeaders() }
      });
      const data = await res.json();
      if ((data.status === 200 || data.status === 1) && Array.isArray(data.history) && userId) {
        saveCachedPriceHistory(userId, itemId, data.history).catch(() => {});
      }
      return data;
    } catch (err) {
      if (userId) {
        const cached = await getCachedPriceHistory(userId, itemId);
        if (cached && cached.length > 0) {
          return { status: 200, itemId, history: cached, isOfflineCached: true };
        }
      }
      throw err;
    }
  },

  async getAdminAudit(params = {}) {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') query.append(k, v);
    });
    const res = await fetch(`${BASE_URL}/api/admin/audit?${query.toString()}`, {
      headers: { ...getAuthHeaders() }
    });
    return res.json();
  },

  async getAdminSettings() {
    const res = await fetch(`${BASE_URL}/api/admin/settings`, {
      headers: { ...getAuthHeaders() }
    });
    return res.json();
  },

  async updateAdminSettings(settings) {
    const res = await fetch(`${BASE_URL}/api/admin/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify(settings)
    });
    return res.json();
  },

  // 17. Delivery Agent APIs
  async getDeliveryOrders(clusterId, userId = null) {
    try {
      const q = clusterId && clusterId !== 'all' ? `?clusterId=${encodeURIComponent(clusterId)}` : '';
      const res = await fetch(`${BASE_URL}/api/delivery/orders${q}`, {
        headers: { ...getAuthHeaders() }
      });
      const data = await res.json();
      if (data && data.status === 200 && Array.isArray(data.orders)) {
        if (userId) {
          saveDeliveryOrders(userId, data.orders).catch(() => {});
        }
      }
      return data;
    } catch (err) {
      if (userId) {
        const cached = await getCachedDeliveryOrders(userId, clusterId);
        if (cached && cached.length > 0) {
          return { status: 200, orders: cached, clusters: [], cached: true };
        }
      }
      return { status: 500, message: err.message, orders: [], clusters: [] };
    }
  },

  async updateDeliveryStatus(orderId, status, reason = null, note = null, idempotencyKey = null, deviceEventTime = null, paymentAmountCollected = null, paymentNotes = null) {
    const key = idempotencyKey || `del-${orderId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const eventTime = deviceEventTime || new Date().toISOString();
    const payload = {
      status,
      reason,
      note,
      idempotencyKey: key,
      deviceEventTime: eventTime
    };
    if (paymentAmountCollected !== null && paymentAmountCollected !== undefined) {
      payload.paymentAmountCollected = paymentAmountCollected;
    }
    if (paymentNotes !== null && paymentNotes !== undefined) {
      payload.paymentNotes = paymentNotes;
    }
    const res = await fetch(`${BASE_URL}/api/delivery/orders/${encodeURIComponent(orderId)}/status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Idempotency-Key': key,
        'X-Device-Event-Time': eventTime,
        ...getAuthHeaders()
      },
      body: JSON.stringify(payload)
    });
    return res.json();
  },

  // 17b. GPS-verified shop visits (online only)
  async getVisitShops(filter = 'all') {
    const res = await fetch(`${BASE_URL}/api/visits/my-shops?filter=${encodeURIComponent(filter)}`, {
      headers: { ...getAuthHeaders() }
    });
    return res.json();
  },

  // Resolves with the server answer (2xx/4xx). Throws `uncertain` when the outcome is unknown so the
  // caller can resend with the SAME idempotency key (the server returns the recorded visit, never a duplicate).
  async verifyVisit(payload, idempotencyKey, timeoutMs = 20000) {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
    let res;
    try {
      res = await fetch(`${BASE_URL}/api/visits/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': idempotencyKey, ...getAuthHeaders() },
        body: JSON.stringify({ ...payload, idempotencyKey, clientTime: new Date().toISOString() }),
        signal: ctrl?.signal
      });
    } catch (err) {
      const e = new Error(err?.name === 'AbortError' ? 'The server did not answer in time.' : 'The connection was interrupted.');
      e.uncertain = true;
      throw e;
    } finally {
      if (timer) clearTimeout(timer);
    }
    let body = null;
    try { body = await res.json(); } catch {}
    if (!body || [502, 503, 504].includes(res.status)) {
      const e = new Error(`The server is temporarily unavailable (HTTP ${res.status}).`);
      e.uncertain = true;
      throw e;
    }
    return body;
  },

  async getVisits(params = {}) {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') q.set(k, v); });
    const res = await fetch(`${BASE_URL}/api/visits?${q.toString()}`, { headers: { ...getAuthHeaders() } });
    return res.json();
  },

  async getVisitSummary(date) {
    const q = date ? `?date=${encodeURIComponent(date)}` : '';
    const res = await fetch(`${BASE_URL}/api/visits/summary${q}`, { headers: { ...getAuthHeaders() } });
    return res.json();
  },

  async reviewVisit(visitId, decision, comment = '') {
    const res = await fetch(`${BASE_URL}/api/visits/${encodeURIComponent(visitId)}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({ decision, comment })
    });
    return res.json();
  },

  async getVisitSettings() {
    const res = await fetch(`${BASE_URL}/api/visits/settings`, { headers: { ...getAuthHeaders() } });
    return res.json();
  },

  async getShopLocations(filter = 'missing') {
    const res = await fetch(`${BASE_URL}/api/visits/shop-locations?filter=${encodeURIComponent(filter)}`, {
      headers: { ...getAuthHeaders() }
    });
    return res.json();
  },

  async updateShopLocation(shopId, { latitude, longitude, reason, source = 'manual' }) {
    const res = await fetch(`${BASE_URL}/api/shops/${encodeURIComponent(shopId)}/location`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({ latitude, longitude, reason, source })
    });
    return res.json();
  },

  async getShopLocationHistory(shopId) {
    const res = await fetch(`${BASE_URL}/api/shops/${encodeURIComponent(shopId)}/location-history`, {
      headers: { ...getAuthHeaders() }
    });
    return res.json();
  },

  // 18. Customer Price Requests APIs
  async getPriceRequests(status = null, userId = null) {
    try {
      const q = status && status !== 'all' ? `?status=${encodeURIComponent(status)}` : '';
      const res = await fetch(`${BASE_URL}/api/price-requests${q}`, {
        headers: { ...getAuthHeaders() }
      });
      const data = await res.json();
      if (data && data.status === 200 && Array.isArray(data.priceRequests) && userId) {
        savePriceRequests(userId, data.priceRequests).catch(() => {});
      }
      return data;
    } catch (err) {
      if (userId) {
        const cached = await getCachedPriceRequests(userId, status);
        if (cached && cached.length > 0) {
          return { status: 200, priceRequests: cached, pendingCount: cached.filter(p => p.status === 'pending').length, cached: true };
        }
      }
      return { status: 500, message: err.message, priceRequests: [], pendingCount: 0 };
    }
  },

  async decidePriceRequest(requestId, { action, comment = '', applyToCatalog = false }) {
    const res = await fetch(`${BASE_URL}/api/price-requests/${encodeURIComponent(requestId)}/decision`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders()
      },
      body: JSON.stringify({ action, comment, applyToCatalog })
    });
    return res.json();
  }
};
