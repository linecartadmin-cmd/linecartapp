const BASE_URL = window.location.port === '3000' ? 'http://localhost:3001' : '';

export const api = {
  // Demo users list for quick testing
  async getDemoUsers() {
    const res = await fetch(`${BASE_URL}/api/demo-users`);
    return res.json();
  },

  // 1. POST /login?phone=...&password=...
  async login(phone, password) {
    const res = await fetch(
      `${BASE_URL}/login?phone=${encodeURIComponent(phone)}&password=${encodeURIComponent(password)}`,
      { method: 'POST' }
    );
    return res.json();
  },

  // 2. GET /clusterinfo?spersonId=...
  async getClusterInfo(spersonId) {
    const res = await fetch(`${BASE_URL}/clusterinfo?spersonId=${encodeURIComponent(spersonId || '')}`);
    return res.json();
  },

  // 3. GET /getitemsorder?spersonId=...
  async getItemsOrder(spersonId) {
    const res = await fetch(`${BASE_URL}/getitemsorder?spersonId=${encodeURIComponent(spersonId || '')}`);
    return res.json();
  },

  // 4. POST /createorder
  async createOrder(orderList) {
    const res = await fetch(`${BASE_URL}/createorder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderList })
    });
    return res.json();
  },

  // 5. GET /gethomereport?spersonId=...
  async getHomeReport(spersonId) {
    const res = await fetch(`${BASE_URL}/gethomereport?spersonId=${encodeURIComponent(spersonId || '')}`);
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
        body: formData
      });
      return res.json();
    }
    const res = await fetch(`${BASE_URL}/addcustomer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(customerData)
    });
    return res.json();
  }
};
