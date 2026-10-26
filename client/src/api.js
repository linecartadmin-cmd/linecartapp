const ENV_API_URL = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_BASE_URL)
  ? String(import.meta.env.VITE_API_BASE_URL).replace(/\/+$/, '')
  : '';
const BASE_URL = ENV_API_URL || (typeof window !== 'undefined' && window.location.port === '3000' ? 'http://localhost:3001' : '');

export const INDIAN_MOBILE_REGEX = /^[6-9]\d{9}$/;

export function isValidIndianMobile(phone) {
  return typeof phone === 'string' && INDIAN_MOBILE_REGEX.test(phone);
}

const getAuthHeaders = () => {
  try {
    const headers = {};
    const token = localStorage.getItem('LineCartPref_token');
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
  async setupInitialAdmin({ name, phone, password }) {
    const res = await fetch(`${BASE_URL}/api/system/setup-admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
    const res = await fetch(`${BASE_URL}/clusterinfo?spersonId=${encodeURIComponent(spersonId || '')}`, {
      headers: { ...getAuthHeaders() }
    });
    return res.json();
  },

  // 3. GET /getitemsorder?spersonId=...
  async getItemsOrder(spersonId) {
    const res = await fetch(`${BASE_URL}/getitemsorder?spersonId=${encodeURIComponent(spersonId || '')}`, {
      headers: { ...getAuthHeaders() }
    });
    return res.json();
  },

  // 4. POST /createorder
  async createOrder(orderList, idempotencyKey = null) {
    const key = idempotencyKey || `ord-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const res = await fetch(`${BASE_URL}/createorder`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Idempotency-Key': key,
        ...getAuthHeaders()
      },
      body: JSON.stringify({ orderList, idempotencyKey: key })
    });
    return res.json();
  },

  // 4a. GET /api/shops/:shopId/order-history (Previous 7-day past orders for selected shop)
  async getShopOrderHistory(shopId, days = 7) {
    try {
      const res = await fetch(`${BASE_URL}/api/shops/${encodeURIComponent(shopId)}/order-history?days=${encodeURIComponent(days)}`, {
        headers: { ...getAuthHeaders() }
      });
      return await res.json();
    } catch (err) {
      return { status: 500, message: err.message, orders: [] };
    }
  },

  // 5. GET /gethomereport?spersonId=...
  async getHomeReport(spersonId) {
    const res = await fetch(`${BASE_URL}/gethomereport?spersonId=${encodeURIComponent(spersonId || '')}`, {
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
    const res = await fetch(`${BASE_URL}/api/manager/assignments?managerId=${encodeURIComponent(managerId || 100)}`, {
      headers: { ...getAuthHeaders() }
    });
    return res.json();
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
  async getDeliveryOrders(clusterId) {
    const q = clusterId && clusterId !== 'all' ? `?clusterId=${encodeURIComponent(clusterId)}` : '';
    const res = await fetch(`${BASE_URL}/api/delivery/orders${q}`, {
      headers: { ...getAuthHeaders() }
    });
    return res.json();
  },

  async updateDeliveryStatus(orderId, status, reason = null, note = null) {
    const res = await fetch(`${BASE_URL}/api/delivery/orders/${encodeURIComponent(orderId)}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({ status, reason, note })
    });
    return res.json();
  }
};
