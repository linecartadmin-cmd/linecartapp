import React, { useState, useEffect, useMemo, useRef } from 'react';
import { api } from '../api';
import { getPaymentSummary } from '../utils';

export default function ManagerOrdersScreen({ user, clusters, shops, showToast, defaultTab = 'orders', onNavigate, isAdmin: propsIsAdmin }) {
  const [loading, setLoading] = useState(true);
  const [assignedAgents, setAssignedAgents] = useState([]);
  const [orders, setOrders] = useState([]);
  const [totals, setTotals] = useState({
    count: 0,
    totalAmount: 0,
    totalUnits: 0,
    averageOrderValue: 0
  });

  // Filters
  const [selectedAgentId, setSelectedAgentId] = useState('all');
  const [selectedCluster, setSelectedCluster] = useState('all');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [selectedShopId, setSelectedShopId] = useState('all');
  const [selectedStatus, setSelectedStatus] = useState('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  // Selected Order for Modal / Export
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [isExporting, setIsExporting] = useState(false);

  // Price Requests Tab & Decision State
  const [activeTab, setActiveTab] = useState(defaultTab || 'orders'); // 'orders' | 'price-requests'
  const [priceRequests, setPriceRequests] = useState([]);
  const [priceRequestsLoading, setPriceRequestsLoading] = useState(false);
  const [priceRequestsError, setPriceRequestsError] = useState(null);
  const [priceStatusFilter, setPriceStatusFilter] = useState('pending');
  const [decisionModal, setDecisionModal] = useState(null);
  const [deciding, setDeciding] = useState(false);

  useEffect(() => {
    if (defaultTab) {
      setActiveTab(defaultTab);
    }
  }, [defaultTab]);

  const fetchPriceRequests = () => {
    if (!user) return;
    setPriceRequestsLoading(true);
    setPriceRequestsError(null);
    api.getPriceRequests(priceStatusFilter, user.id)
      .then((res) => {
        if (res && (res.status === 200 || !res.status) && Array.isArray(res.priceRequests)) {
          setPriceRequests(res.priceRequests);
          setPriceRequestsError(null);
        } else {
          setPriceRequests([]);
          setPriceRequestsError(res?.message || 'Failed to load price requests');
        }
      })
      .catch((err) => {
        setPriceRequests([]);
        setPriceRequestsError(err?.message || 'Network error loading price requests');
      })
      .finally(() => setPriceRequestsLoading(false));
  };

  useEffect(() => {
    fetchPriceRequests();
  }, [user, priceStatusFilter]);

  const handleDecisionSubmit = async () => {
    if (!decisionModal || !decisionModal.request) return;
    const { request, action, comment, applyToCatalog } = decisionModal;
    if (action === 'reject' && (!comment || !comment.trim())) {
      showToast('A reason is required when rejecting a price request.');
      return;
    }
    setDeciding(true);
    try {
      const res = await api.decidePriceRequest(request.id, {
        action,
        comment,
        applyToCatalog
      });
      if (res && res.status === 200) {
        showToast(action === 'approve' ? 'Price request approved!' : 'Price request rejected.');
        setDecisionModal(null);
        fetchPriceRequests();
        fetchOrders();
      } else {
        showToast(res?.message || 'Failed to record decision.');
      }
    } catch (err) {
      showToast('Error recording decision: ' + err.message);
    } finally {
      setDeciding(false);
    }
  };

  const isAdmin = (user?.role || '').toLowerCase() === 'admin';
  const [deliveryAgents, setDeliveryAgents] = useState([]);
  const [catalogProducts, setCatalogProducts] = useState([]);

  // Admin CRUD Modal states
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createFormData, setCreateFormData] = useState({
    shopId: '',
    spersonId: '',
    clusterId: 1,
    orderDate: new Date().toISOString().slice(0, 10),
    orderList: [],
    notes: ''
  });

  const [editModalOrder, setEditModalOrder] = useState(null);
  const [editFormData, setEditFormData] = useState({
    status: 'In progress',
    deliveryAgentId: '',
    orderList: [],
    notes: ''
  });

  const [cancelModalOrder, setCancelModalOrder] = useState(null);
  const [cancelReason, setCancelReason] = useState('');
  const [deleteModalOrder, setDeleteModalOrder] = useState(null);
  const [savingAction, setSavingAction] = useState(false);

  // Load manager's assigned agents OR all agents for Admin
  useEffect(() => {
    if (!user) return;
    if (isAdmin) {
      api.getAdminUsers().then((res) => {
        if (res && res.users) {
          const agents = res.users.filter((u) => (u.role || '').toLowerCase() === 'field sales agent');
          setAssignedAgents(agents);
          const deliv = res.users.filter((u) => (u.role || '').toLowerCase() === 'delivery agent');
          setDeliveryAgents(deliv);
        }
      });
      api.getItems('all').then((res) => {
        if (res && res.items) {
          setCatalogProducts(res.items);
        }
      });
    } else {
      api.getManagerAssignments(user.id).then((res) => {
        if (res && res.assignedAgents) {
          setAssignedAgents(res.assignedAgents);
        }
      });
    }
  }, [user, isAdmin]);

  // Load orders based on filters
  const fetchOrders = () => {
    if (!user) return;
    setLoading(true);
    const params = {
      managerId: isAdmin ? undefined : user.id,
      agentId: selectedAgentId !== 'all' ? selectedAgentId : undefined,
      clusterId: selectedCluster !== 'all' ? selectedCluster : undefined,
      category: selectedCategory !== 'all' ? selectedCategory : undefined,
      shopId: selectedShopId !== 'all' ? selectedShopId : undefined,
      status: selectedStatus !== 'all' ? selectedStatus : undefined,
      fromDate: fromDate || undefined,
      toDate: toDate || undefined
    };

    const fetcher = isAdmin ? api.getAdminOrders(params) : api.getManagerOrders(params);
    fetcher
      .then((res) => {
        if (res && res.orders) {
          setOrders(res.orders);
          setTotals(res.totals || { count: 0, totalAmount: 0, totalUnits: 0, averageOrderValue: 0 });
        } else {
          setOrders([]);
          setTotals({ count: 0, totalAmount: 0, totalUnits: 0, averageOrderValue: 0 });
        }
      })
      .catch((err) => {
        console.error('Failed to load orders', err);
        showToast('Error loading orders');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchOrders();
  }, [user, isAdmin, selectedAgentId, selectedCluster, selectedCategory, selectedShopId, selectedStatus, fromDate, toDate]);

  const handleOpenCreateOrder = () => {
    const defaultShop = shops[0] || {};
    const defaultAgent = assignedAgents[0] || user;
    const defaultItem = catalogProducts[0] || {};
    setCreateFormData({
      shopId: defaultShop.shopid || '',
      spersonId: defaultAgent.id || user.id,
      clusterId: defaultShop.clusterid || 1,
      orderDate: new Date().toISOString().slice(0, 10),
      orderList: defaultItem.itemId ? [{
        itemid: defaultItem.itemId,
        itemName: defaultItem.itemName,
        qty: 1,
        price: defaultItem.price || 0,
        custprice: defaultItem.price || 0
      }] : [{
        itemid: 1,
        itemName: 'Item 1',
        qty: 1,
        price: 50,
        custprice: 50
      }],
      notes: ''
    });
    setCreateModalOpen(true);
  };

  const handleOpenEditOrder = (order) => {
    setEditModalOrder(order);
    const existingList = (order.orderList || []).map((it) => ({
      itemid: it.itemid || it.itemId || it.id,
      itemName: it.itemName || it.item_name || 'Item',
      qty: it.qty ?? 1,
      price: it.custprice ?? it.cust_price ?? it.price ?? 0,
      custprice: it.custprice ?? it.cust_price ?? it.price ?? 0
    }));
    setEditFormData({
      status: order.status || 'In progress',
      deliveryAgentId: order.deliveryAgentId !== null && order.deliveryAgentId !== undefined ? order.deliveryAgentId : '',
      orderList: existingList.length > 0 ? existingList : [{
        itemid: 1,
        itemName: 'Item 1',
        qty: 1,
        price: 50,
        custprice: 50
      }],
      notes: ''
    });
  };

  const handleSubmitCreateOrder = async (e) => {
    e.preventDefault();
    if (!createFormData.shopId) {
      showToast('Please select a shop.');
      return;
    }
    const validLines = createFormData.orderList.filter((l) => (parseFloat(l.qty) || 0) > 0);
    if (validLines.length === 0) {
      showToast('Order must contain at least one item with quantity > 0.');
      return;
    }
    setSavingAction(true);
    try {
      const res = await api.adminCreateOrder({
        shopId: createFormData.shopId,
        spersonId: createFormData.spersonId,
        clusterId: createFormData.clusterId,
        orderDate: createFormData.orderDate,
        orderList: validLines,
        notes: createFormData.notes
      });
      if (res && (res.status === 200 || res.status === 201)) {
        showToast('Order created successfully!');
        setCreateModalOpen(false);
        fetchOrders();
        window.dispatchEvent(new CustomEvent('linecart:orders_updated'));
      } else {
        showToast(res?.message || 'Failed to create order.');
      }
    } catch (err) {
      showToast('Error creating order: ' + err.message);
    } finally {
      setSavingAction(false);
    }
  };

  const handleSubmitEditOrder = async (e) => {
    e.preventDefault();
    if (!editModalOrder) return;
    const validLines = editFormData.orderList.filter((l) => (parseFloat(l.qty) || 0) > 0);
    if (validLines.length === 0) {
      showToast('Order must have at least one line item with quantity > 0.');
      return;
    }
    setSavingAction(true);
    try {
      const res = await api.adminUpdateOrder(editModalOrder.id || editModalOrder.orderId, {
        status: editFormData.status,
        deliveryAgentId: editFormData.deliveryAgentId || null,
        orderList: validLines,
        notes: editFormData.notes
      });
      if (res && res.status === 200) {
        showToast('Order updated successfully!');
        setEditModalOrder(null);
        fetchOrders();
        window.dispatchEvent(new CustomEvent('linecart:orders_updated'));
      } else {
        showToast(res?.message || 'Failed to update order.');
      }
    } catch (err) {
      showToast('Error updating order: ' + err.message);
    } finally {
      setSavingAction(false);
    }
  };

  const handleConfirmCancel = async () => {
    if (!cancelModalOrder) return;
    setSavingAction(true);
    try {
      const res = await api.adminCancelOrder(cancelModalOrder.id || cancelModalOrder.orderId, cancelReason);
      if (res && res.status === 200) {
        showToast('Order cancelled successfully.');
        setCancelModalOrder(null);
        fetchOrders();
        window.dispatchEvent(new CustomEvent('linecart:orders_updated'));
      } else {
        showToast(res?.message || 'Failed to cancel order.');
      }
    } catch (err) {
      showToast('Error cancelling order: ' + err.message);
    } finally {
      setSavingAction(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteModalOrder) return;
    setSavingAction(true);
    try {
      const res = await api.adminDeleteOrder(deleteModalOrder.id || deleteModalOrder.orderId);
      if (res && res.status === 200) {
        showToast('Order deleted permanently.');
        setDeleteModalOrder(null);
        fetchOrders();
        window.dispatchEvent(new CustomEvent('linecart:orders_updated'));
      } else {
        showToast(res?.message || 'Failed to delete order.');
      }
    } catch (err) {
      showToast('Error deleting order: ' + err.message);
    } finally {
      setSavingAction(false);
    }
  };

  // Unique categories for filter dropdown
  const categories = useMemo(() => {
    const set = new Set();
    shops.forEach((s) => {
      if (s.shopCategory) set.add(s.shopCategory);
    });
    return Array.from(set).sort();
  }, [shops]);

  // Filtered shops based on selected cluster
  const availableShops = useMemo(() => {
    return shops.filter((s) => {
      if (selectedCluster !== 'all' && Number(s.clusterid) !== Number(selectedCluster)) return false;
      if (selectedCategory !== 'all' && s.shopCategory !== selectedCategory) return false;
      return true;
    });
  }, [shops, selectedCluster, selectedCategory]);

  // Quick Date Range Presets
  const applyDatePreset = (preset) => {
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    if (preset === 'all') {
      setFromDate('');
      setToDate('');
    } else if (preset === 'today') {
      setFromDate(todayStr);
      setToDate(todayStr);
    } else if (preset === 'yesterday') {
      const yest = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      setFromDate(yest);
      setToDate(yest);
    } else if (preset === 'month') {
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
      setFromDate(firstDay);
      setToDate(todayStr);
    }
  };

  // Helper to format currency
  const formatInr = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

  // Status Badge Class
  const getStatusBadge = (status) => {
    const s = (status || '').toLowerCase();
    if (s.includes('deliver')) return 'badge-delivered';
    if (s.includes('progress')) return 'badge-progress';
    if (s.includes('pending')) return 'badge-pending';
    if (s.includes('cancel')) return 'badge-cancelled';
    return 'badge-neutral';
  };

  // Canvas PNG Export Function
  const exportOrderAsPNG = (order) => {
    if (!order) return;
    setIsExporting(true);

    try {
      // Create high-res canvas (2x for retina sharpness)
      const scale = 2;
      const width = 640;
      const baseHeight = 520;
      const items = order.orderList && order.orderList.length > 0
        ? order.orderList
        : [{ itemName: 'Standard Order Bundle', qty: order.itemsCount || 1, custprice: order.total, actprice: order.total }];

      const extraItemRows = Math.max(0, items.length - 2);
      const height = baseHeight + (extraItemRows * 36);

      const canvas = document.createElement('canvas');
      canvas.width = width * scale;
      canvas.height = height * scale;
      const ctx = canvas.getContext('2d');
      ctx.scale(scale, scale);

      // Background
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);

      // Outer border & soft inner card
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 1;
      ctx.strokeRect(16, 16, width - 32, height - 32);

      // Top brand banner
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(16, 16, width - 32, 70);

      // Brand Title
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 22px "DM Sans", -apple-system, sans-serif';
      ctx.fillText('LineCart Wholesale', 36, 48);

      ctx.font = '12px "DM Sans", -apple-system, sans-serif';
      ctx.fillStyle = '#94a3b8';
      ctx.fillText('OFFICIAL ORDER INVOICE & RECEIPT', 36, 68);

      // Order ID Pill on banner
      ctx.fillStyle = '#22c55e';
      ctx.beginPath();
      ctx.roundRect(width - 165, 36, 130, 30, 6);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 13px "DM Sans", -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(order.id || order.orderId || 'ORDER', width - 100, 56);
      ctx.textAlign = 'left';

      // Meta info block
      let y = 115;
      ctx.fillStyle = '#64748b';
      ctx.font = '12px "DM Sans", -apple-system, sans-serif';
      ctx.fillText('CUSTOMER / SHOP', 36, y);
      ctx.fillText('SALES AGENT', 260, y);
      ctx.fillText('DATE & STATUS', 460, y);

      y += 20;
      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 15px "DM Sans", -apple-system, sans-serif';
      ctx.fillText(order.customer || `Shop #${order.customerId}`, 36, y);
      ctx.fillText(order.agentName || `Agent #${order.spersonid}`, 260, y);
      ctx.fillText(order.date || 'Today', 460, y);

      y += 18;
      ctx.font = '12px "DM Sans", -apple-system, sans-serif';
      ctx.fillStyle = '#64748b';
      ctx.fillText(`Category: ${order.shopCategory || 'Retail'}`, 36, y);
      ctx.fillText(`Agent ID: ${order.spersonid || 'N/A'}`, 260, y);
      ctx.fillText(`Status: ${order.status || 'Active'}`, 460, y);

      // Divider line
      y += 22;
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(36, y);
      ctx.lineTo(width - 36, y);
      ctx.stroke();

      // Items Table Header
      y += 26;
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(36, y - 18, width - 72, 28);
      ctx.fillStyle = '#475569';
      ctx.font = 'bold 12px "DM Sans", -apple-system, sans-serif';
      ctx.fillText('ITEM DESCRIPTION', 48, y);
      ctx.textAlign = 'right';
      ctx.fillText('RATE (₹)', 380, y);
      ctx.fillText('QTY', 470, y);
      ctx.fillText('TOTAL (₹)', width - 48, y);
      ctx.textAlign = 'left';

      // Table Rows
      y += 20;
      items.forEach((item, idx) => {
        const rate = parseFloat(item.custprice || item.price || item.actprice || 50);
        const qty = parseFloat(item.qty) || 1;
        const itemTotal = rate * qty;

        // Row background zebra
        if (idx % 2 === 1) {
          ctx.fillStyle = '#fcfdfe';
          ctx.fillRect(36, y - 14, width - 72, 28);
        }

        ctx.fillStyle = '#1e293b';
        ctx.font = '13px "DM Sans", -apple-system, sans-serif';
        ctx.fillText(item.itemName || `Commodity Item #${item.itemid || idx + 1}`, 48, y + 4);

        ctx.textAlign = 'right';
        ctx.fillText(`₹${rate.toFixed(2)}`, 380, y + 4);
        ctx.fillText(`${qty}`, 470, y + 4);
        ctx.font = 'bold 13px "DM Sans", -apple-system, sans-serif';
        ctx.fillText(`₹${itemTotal.toLocaleString('en-IN')}`, width - 48, y + 4);
        ctx.textAlign = 'left';

        y += 30;
      });

      // Bottom Divider
      y += 10;
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(36, y);
      ctx.lineTo(width - 36, y);
      ctx.stroke();

      // Grand Total Box
      y += 35;
      ctx.fillStyle = '#f1f5f9';
      ctx.beginPath();
      ctx.roundRect(width - 260, y - 22, 224, 46, 8);
      ctx.fill();

      ctx.fillStyle = '#475569';
      ctx.font = '13px "DM Sans", -apple-system, sans-serif';
      ctx.fillText('GRAND TOTAL:', width - 245, y + 6);

      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 20px "DM Sans", -apple-system, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(formatInr(order.total), width - 48, y + 7);
      ctx.textAlign = 'left';

      // Footer note
      y = height - 35;
      ctx.font = '11px "DM Sans", -apple-system, sans-serif';
      ctx.fillStyle = '#94a3b8';
      ctx.fillText(`Exported from LineCart Sales Manager Portal on ${new Date().toLocaleString('en-IN')}`, 36, y);

      // Trigger download
      canvas.toBlob((blob) => {
        if (!blob) {
          showToast('Failed to create image');
          setIsExporting(false);
          return;
        }
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.download = `Order_${order.id || order.orderId || 'receipt'}.png`;
        link.href = url;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        setIsExporting(false);
        showToast(`Order ${order.id} exported as PNG!`);
      }, 'image/png');
    } catch (err) {
      console.error('PNG export failed', err);
      showToast('Error exporting PNG');
      setIsExporting(false);
    }
  };

  return (
    <div className="manager-orders-page">
      {/* Page Header */}
      <div className="page-header-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 className="page-title">{isAdmin ? 'Order Management' : activeTab === 'orders' ? 'Team Orders' : 'Customer Price Requests'}</h1>
          <p className="page-subtitle">
            {isAdmin
              ? 'Audited order administration: create, inspect, edit, cancel, and manage order deliveries'
              : activeTab === 'orders'
              ? 'Filter, inspect, and export orders placed by your assigned sales team'
              : 'Review, approve, or reject customer-specific custom price requests submitted by sales agents'}
          </p>
        </div>
        {isAdmin && (
          <button
            type="button"
            className="btn-primary"
            style={{
              padding: '10px 18px',
              borderRadius: '8px',
              fontWeight: 700,
              fontSize: '13px',
              background: '#0284c7',
              color: '#fff',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
            onClick={handleOpenCreateOrder}
          >
            <span>+ Create Order</span>
          </button>
        )}
      </div>

      {/* Tab Controls */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', borderBottom: '1px solid #e2e8f0', paddingBottom: '12px' }}>
        <button
          type="button"
          onClick={() => setActiveTab('orders')}
          style={{
            padding: '8px 16px',
            borderRadius: '8px',
            fontSize: '13px',
            fontWeight: 700,
            border: 'none',
            cursor: 'pointer',
            background: activeTab === 'orders' ? '#0284c7' : '#f1f5f9',
            color: activeTab === 'orders' ? '#fff' : '#475569'
          }}
        >
          📦 Team Orders ({orders.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('price-requests')}
          style={{
            padding: '8px 16px',
            borderRadius: '8px',
            fontSize: '13px',
            fontWeight: 700,
            border: 'none',
            cursor: 'pointer',
            background: activeTab === 'price-requests' ? '#d97706' : '#f1f5f9',
            color: activeTab === 'price-requests' ? '#fff' : '#475569',
            display: 'flex',
            alignItems: 'center',
            gap: '6px'
          }}
        >
          <span>Customer Price Requests</span>
          {priceRequests.filter((p) => p.status === 'pending').length > 0 && (
            <span style={{
              background: activeTab === 'price-requests' ? '#b45309' : '#d97706',
              color: '#fff',
              fontSize: '11px',
              padding: '1px 6px',
              borderRadius: '9999px',
              fontWeight: 800
            }}>
              {priceRequests.filter((p) => p.status === 'pending').length}
            </span>
          )}
        </button>
      </div>

      {activeTab === 'price-requests' ? (
        <div className="price-requests-view">
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '10px',
            marginBottom: '16px'
          }}>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {['pending', 'approved', 'rejected', 'all'].map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setPriceStatusFilter(st)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '6px',
                    fontSize: '12px',
                    fontWeight: 600,
                    border: '1px solid #cbd5e1',
                    background: priceStatusFilter === st ? '#1e293b' : '#fff',
                    color: priceStatusFilter === st ? '#fff' : '#475569',
                    cursor: 'pointer',
                    textTransform: 'capitalize'
                  }}
                >
                  {st === 'all' ? 'All Requests' : st}
                </button>
              ))}
            </div>
            <div style={{
              fontSize: '12px',
              color: '#0369a1',
              background: '#f0f9ff',
              border: '1px solid #bae6fd',
              padding: '6px 12px',
              borderRadius: '8px',
              fontWeight: 600
            }}>
              ✓ Single-step approval: One decision by either Admin or authorized Sales Manager resolves the request.
            </div>
          </div>

          {priceRequestsError ? (
            <div className="card" style={{ padding: '2.5rem', textAlign: 'center', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '12px' }}>
              <span style={{ fontSize: '2.5rem' }}>⚠️</span>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700, margin: '0.5rem 0', color: '#991b1b' }}>Failed to Load Price Requests</h3>
              <p style={{ color: '#b91c1c', fontSize: '0.85rem', marginBottom: '1.25rem' }}>{priceRequestsError}</p>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={fetchPriceRequests}
                style={{ padding: '8px 20px', fontWeight: 600 }}
              >
                ↻ Retry Loading
              </button>
            </div>
          ) : priceRequestsLoading ? (
            <div className="loading-state card" style={{ padding: '3rem', textAlign: 'center', color: '#64748b' }}>
              <div className="spinner" style={{ margin: '0 auto 12px' }} />
              <div>Loading customer price requests...</div>
            </div>
          ) : priceRequests.length === 0 ? (
            <div className="empty-state card" style={{ padding: '3rem', textAlign: 'center' }}>
              <span className="empty-icon" style={{ fontSize: '2.5rem' }}>✅</span>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700, margin: '0.5rem 0' }}>No Price Requests Found</h3>
              <p style={{ color: '#64748b', fontSize: '0.85rem' }}>There are no price requests matching the current filter.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {priceRequests.map((pr) => {
                const diff = pr.requestedPrice - pr.catalogPrice;
                const isSelf = Number(user?.id) === Number(pr.agentId);
                return (
                  <div key={pr.id} className="card" style={{ padding: '16px 20px', borderRadius: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '10px' }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontWeight: 800, fontSize: '15px', color: '#0f172a' }}>{pr.itemName}</span>
                          <span style={{ fontSize: '11px', background: '#f1f5f9', padding: '2px 8px', borderRadius: '6px', color: '#475569' }}>
                            Order: <b>{pr.orderId}</b>
                          </span>
                        </div>
                        <div style={{ fontSize: '13px', color: '#475569', marginTop: '4px' }}>
                          Store: <b>{pr.shopName}</b> · Cluster: {pr.clusterName || ('#' + pr.clusterId)} · Agent: <b>{pr.agentName}</b>
                        </div>
                      </div>

                      <span style={{
                        padding: '4px 10px',
                        borderRadius: '20px',
                        fontSize: '11px',
                        fontWeight: 700,
                        background: pr.status === 'approved' ? '#dcfce7' : pr.status === 'rejected' ? '#fee2e2' : '#fef3c7',
                        color: pr.status === 'approved' ? '#15803d' : pr.status === 'rejected' ? '#b91c1c' : '#b45309'
                      }}>
                        {pr.status === 'approved'
                          ? '✓ Approved (Resolved)'
                          : pr.status === 'rejected'
                          ? '✕ Rejected (Resolved)'
                          : '⏳ Pending (1 approval resolves)'}
                      </span>
                    </div>

                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                      gap: '12px',
                      background: '#f8fafc',
                      padding: '12px',
                      borderRadius: '8px',
                      margin: '12px 0'
                    }}>
                      <div>
                        <span style={{ fontSize: '10px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>Catalog Rate</span>
                        <div style={{ fontSize: '14px', fontWeight: 700, color: '#334155' }}>₹{pr.catalogPrice.toFixed(2)}</div>
                      </div>
                      <div>
                        <span style={{ fontSize: '10px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>Requested Rate</span>
                        <div style={{ fontSize: '15px', fontWeight: 800, color: '#0284c7' }}>₹{pr.requestedPrice.toFixed(2)}</div>
                      </div>
                      <div>
                        <span style={{ fontSize: '10px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>Variance</span>
                        <div style={{ fontSize: '14px', fontWeight: 700, color: diff < 0 ? '#16a34a' : '#d97706' }}>
                          {diff < 0 ? ('-₹' + Math.abs(diff).toFixed(2)) : ('+₹' + diff.toFixed(2))}
                        </div>
                      </div>
                      <div>
                        <span style={{ fontSize: '10px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>Requested At</span>
                        <div style={{ fontSize: '12px', color: '#64748b' }}>{new Date(pr.createdAt).toLocaleString('en-IN')}</div>
                      </div>
                    </div>

                    {pr.reason && (
                      <div style={{ fontSize: '12px', color: '#475569', marginBottom: '10px' }}>
                        <b>Agent Reason:</b> <i>"{pr.reason}"</i>
                      </div>
                    )}

                    {pr.status === 'pending' ? (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', paddingTop: '8px', borderTop: '1px solid #f1f5f9' }}>
                        <span style={{ fontSize: '11.5px', color: '#64748b' }}>
                          Action by either Admin or authorized Sales Manager resolves this request immediately.
                        </span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          {isSelf ? (
                            <span style={{ fontSize: '11px', color: '#b91c1c', fontWeight: 600 }}>
                              ⚠️ Self-approval forbidden (created by your account)
                            </span>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => setDecisionModal({ request: pr, action: 'reject', comment: '', applyToCatalog: false })}
                                style={{
                                  padding: '6px 14px',
                                  borderRadius: '6px',
                                  border: '1px solid #fca5a5',
                                  background: '#fef2f2',
                                  color: '#b91c1c',
                                  fontSize: '12px',
                                  fontWeight: 700,
                                  cursor: 'pointer'
                                }}
                              >
                                Reject
                              </button>
                              <button
                                type="button"
                                onClick={() => setDecisionModal({ request: pr, action: 'approve', comment: '', applyToCatalog: false })}
                                style={{
                                  padding: '6px 16px',
                                  borderRadius: '6px',
                                  border: 'none',
                                  background: '#16a34a',
                                  color: '#fff',
                                  fontSize: '12px',
                                  fontWeight: 700,
                                  cursor: 'pointer'
                                }}
                              >
                                Approve
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div style={{ fontSize: '11.5px', color: '#475569', borderTop: '1px solid #f1f5f9', paddingTop: '8px' }}>
                        Resolved by <b>{pr.decisionByName || ('User #' + pr.decisionBy)}</b>
                        {pr.decisionByRole ? <span> ({pr.decisionByRole})</span> : null} on {pr.decisionAt ? new Date(pr.decisionAt).toLocaleString('en-IN') : '—'}
                        {pr.decisionComment && <span> · Note: <i>"{pr.decisionComment}"</i></span>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <>
      <div className="page-header-row">
        <div>
          <h1 className="page-title">Team Orders</h1>
          <p className="page-subtitle">Filter, inspect, and export orders placed by your assigned sales team</p>
        </div>
      </div>

      {/* KPI Summary Cards */}
      <div className="orders-kpi-grid">
        <div className="kpi-card">
          <span className="kpi-label">TOTAL ORDERS</span>
          <div className="kpi-value">{totals.count}</div>
          <span className="kpi-sub">Filtered selection</span>
        </div>
        <div className="kpi-card highlight-kpi">
          <span className="kpi-label">TOTAL REVENUE</span>
          <div className="kpi-value">{formatInr(totals.totalAmount)}</div>
          <span className="kpi-sub">Gross sales value</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">TOTAL UNITS</span>
          <div className="kpi-value">{totals.totalUnits} <span className="kpi-unit">units</span></div>
          <span className="kpi-sub">Commodity quantity</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">AVG ORDER VALUE</span>
          <div className="kpi-value">{formatInr(totals.averageOrderValue)}</div>
          <span className="kpi-sub">Per completed transaction</span>
        </div>
      </div>

      {/* 6 Comprehensive Filters */}
      <div className="manager-filter-panel card">
        <div className="filter-header-bar">
          <span className="filter-panel-title">Filter Orders</span>
          <div className="quick-presets">
            <span className="preset-label">Quick:</span>
            <button type="button" className="btn-preset" onClick={() => applyDatePreset('all')}>All Time</button>
            <button type="button" className="btn-preset" onClick={() => applyDatePreset('today')}>Today</button>
            <button type="button" className="btn-preset" onClick={() => applyDatePreset('yesterday')}>Yesterday</button>
            <button type="button" className="btn-preset" onClick={() => applyDatePreset('month')}>This Month</button>
          </div>
        </div>

        <div className="filter-grid-6">
          {/* 1. Date From */}
          <div className="filter-control">
            <label className="filter-label">From Date</label>
            <input
              type="date"
              className="filter-input"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
            />
          </div>

          {/* 2. Date To */}
          <div className="filter-control">
            <label className="filter-label">To Date</label>
            <input
              type="date"
              className="filter-input"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
            />
          </div>

          {/* 3. Assigned Sales Agent */}
          <div className="filter-control">
            <label className="filter-label">Sales Agent</label>
            <select
              className="filter-select"
              value={selectedAgentId}
              onChange={(e) => setSelectedAgentId(e.target.value)}
            >
              <option value="all">All Assigned Agents ({assignedAgents.length})</option>
              {assignedAgents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name} (ID: {agent.id})
                </option>
              ))}
            </select>
          </div>

          {/* 4. Cluster */}
          <div className="filter-control">
            <label className="filter-label">Cluster Route</label>
            <select
              className="filter-select"
              value={selectedCluster}
              onChange={(e) => setSelectedCluster(e.target.value)}
            >
              <option value="all">All Clusters</option>
              {clusters.map((c) => (
                <option key={c.clusterId} value={c.clusterId}>
                  {c.clusterName || `Cluster ${c.clusterId}`}
                </option>
              ))}
            </select>
          </div>

          {/* 5. Shop Category */}
          <div className="filter-control">
            <label className="filter-label">Shop Category</label>
            <select
              className="filter-select"
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
            >
              <option value="all">All Categories</option>
              {categories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>

          {/* 6. Specific Shop & Status */}
          <div className="filter-control">
            <label className="filter-label">Order Status</label>
            <select
              className="filter-select"
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
            >
              <option value="all">All Statuses</option>
              <option value="In progress">In progress</option>
              <option value="Delivered">Delivered</option>
              <option value="Pending">Pending</option>
              <option value="Cancelled">Cancelled</option>
            </select>
          </div>
        </div>

        {/* Additional specific shop select row */}
        <div className="filter-sub-row">
          <div className="filter-control full-span">
            <label className="filter-label">Specific Shop / Customer</label>
            <select
              className="filter-select"
              value={selectedShopId}
              onChange={(e) => setSelectedShopId(e.target.value)}
            >
              <option value="all">All Shops ({availableShops.length})</option>
              {availableShops.map((s) => (
                <option key={s.shopid} value={s.shopid}>
                  {s.shopName} {s.ownerName ? `(${s.ownerName})` : ''} - {s.shopCategory || 'Retail'}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Orders List / Table */}
      <div className="card orders-table-card">
        <div className="table-header-title">
          <span>Orders ({orders.length})</span>
          <small className="muted-text">Click any order to view details and export clean PNG receipt</small>
        </div>

        {loading ? (
          <div className="loading-state">Loading team orders...</div>
        ) : orders.length === 0 ? (
          <div className="empty-state">
            <span className="empty-icon">📂</span>
            <h3>No orders found</h3>
            <p>No orders match the selected filters or assigned agents.</p>
          </div>
        ) : (
          <div className="table-responsive-wrapper">
            <table className="orders-table">
              <thead>
                <tr>
                  <th>Order ID</th>
                  <th>Customer / Shop</th>
                  <th>Sales Agent</th>
                  <th>Date</th>
                  <th>Items & Qty</th>
                  <th>Total (₹)</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.id || order.orderId} className="order-row" onClick={() => setSelectedOrder(order)}>
                    <td className="bold-cell font-mono">{order.id || order.orderId}</td>
                    <td>
                      <div className="shop-title-cell">{order.customer || `Shop #${order.customerId}`}</div>
                      <span className="shop-category-tag">{order.shopCategory || 'Retail'}</span>
                    </td>
                    <td>
                      <span className="agent-badge">{order.agentName || `Agent #${order.spersonid}`}</span>
                    </td>
                    <td className="font-mono">{order.date}</td>
                    <td>
                      {order.orderList && order.orderList.length > 0 ? (
                        <span>{order.orderList.length} items ({order.orderList.reduce((s, i) => s + (parseFloat(i.qty) || 0), 0)} units)</span>
                      ) : (
                        <span>{order.itemsCount || 1} items</span>
                      )}
                    </td>
                    <td className="total-amount-cell">{formatInr(order.total)}</td>
                    <td>
                      {(() => {
                        const pay = getPaymentSummary(order);
                        return (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
                              <span className={`status-pill ${getStatusBadge(order.status)}`}>
                                {order.status || 'Active'}
                              </span>
                              <span style={{
                                fontSize: '10px',
                                fontWeight: 700,
                                padding: '1px 6px',
                                borderRadius: '999px',
                                background: pay.paymentStatus === 'Collected' ? '#dcfce7' : (pay.paymentStatus === 'Partially collected' ? '#fef3c7' : '#f1f5f9'),
                                color: pay.paymentStatus === 'Collected' ? '#15803d' : (pay.paymentStatus === 'Partially collected' ? '#b45309' : '#475569')
                              }}>
                                {pay.paymentStatus}
                              </span>
                            </div>
                            <span style={{ fontSize: '11px', color: '#475569', fontWeight: 600 }}>
                              {pay.summaryText}
                            </span>
                          </div>
                        );
                      })()}
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px' }}>
                        <button
                          type="button"
                          className="btn-action-view"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedOrder(order);
                          }}
                        >
                          View
                        </button>
                        {isAdmin && (
                          <>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenEditOrder(order);
                              }}
                              style={{
                                padding: '4px 10px',
                                fontSize: '12px',
                                fontWeight: 600,
                                borderRadius: '6px',
                                border: '1px solid #cbd5e1',
                                background: '#f8fafc',
                                color: '#0f172a',
                                cursor: 'pointer'
                              }}
                            >
                              Edit
                            </button>
                            {order.status !== 'Cancelled' && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setCancelModalOrder(order);
                                  setCancelReason('');
                                }}
                                style={{
                                  padding: '4px 10px',
                                  fontSize: '12px',
                                  fontWeight: 600,
                                  borderRadius: '6px',
                                  border: '1px solid #fecaca',
                                  background: '#fff1f2',
                                  color: '#e11d48',
                                  cursor: 'pointer'
                                }}
                              >
                                Cancel
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setDeleteModalOrder(order);
                              }}
                              style={{
                                padding: '4px 10px',
                                fontSize: '12px',
                                fontWeight: 600,
                                borderRadius: '6px',
                                border: '1px solid #fca5a5',
                                background: '#fee2e2',
                                color: '#b91c1c',
                                cursor: 'pointer'
                              }}
                            >
                              Delete
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      </>
      )}

      {/* Price Request Decision Modal */}
      {decisionModal && (
        <div className="modal-overlay" onClick={() => setDecisionModal(null)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '480px' }}>
            <div className="modal-header">
              <div>
                <span className="modal-kicker">
                  {decisionModal.action === 'approve' ? 'Approve Custom Rate' : 'Reject Price Request'}
                </span>
                <h2 className="modal-title">{decisionModal.request.itemName}</h2>
              </div>
              <button
                type="button"
                className="modal-close"
                onClick={() => setDecisionModal(null)}
              >
                ✕
              </button>
            </div>

            <div className="modal-body" style={{ padding: '16px' }}>
              <div style={{ background: '#f8fafc', padding: '12px', borderRadius: '8px', marginBottom: '14px', fontSize: '13px' }}>
                <div>Store: <b>{decisionModal.request.shopName}</b></div>
                <div>Sales Agent: <b>{decisionModal.request.agentName}</b></div>
                <div>Order Reference: <b>{decisionModal.request.orderId}</b></div>
                <div style={{ marginTop: '6px', display: 'flex', gap: '16px' }}>
                  <span>Catalog Rate: <b>₹{decisionModal.request.catalogPrice.toFixed(2)}</b></span>
                  <span>Requested Rate: <b style={{ color: '#0284c7' }}>₹{decisionModal.request.requestedPrice.toFixed(2)}</b></span>
                </div>
              </div>

              {decisionModal.request.reason && (
                <div style={{ fontSize: '12px', color: '#475569', marginBottom: '14px' }}>
                  <b>Agent Reason:</b> <i>"{decisionModal.request.reason}"</i>
                </div>
              )}

              <div style={{ marginBottom: '14px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, marginBottom: '6px' }}>
                  {decisionModal.action === 'approve' ? 'Approval Note (Optional):' : 'Rejection Reason (Required):'}
                </label>
                <textarea
                  rows="3"
                  value={decisionModal.comment}
                  onChange={(e) => setDecisionModal({ ...decisionModal, comment: e.target.value })}
                  placeholder={decisionModal.action === 'approve' ? 'Add any delivery or volume conditions...' : 'Explain reason for rejection...'}
                  style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '12px' }}
                />
              </div>

              {decisionModal.action === 'approve' && (
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', cursor: 'pointer', color: '#334155' }}>
                  <input
                    type="checkbox"
                    checked={decisionModal.applyToCatalog}
                    onChange={(e) => setDecisionModal({ ...decisionModal, applyToCatalog: e.target.checked })}
                  />
                  <span>Also update regional cluster rate for this commodity</span>
                </label>
              )}
            </div>

            <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', padding: '12px 16px' }}>
              <button
                type="button"
                className="btn-secondary"
                disabled={deciding}
                onClick={() => setDecisionModal(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deciding}
                onClick={handleDecisionSubmit}
                style={{
                  padding: '8px 18px',
                  borderRadius: '6px',
                  border: 'none',
                  fontWeight: 700,
                  fontSize: '12px',
                  cursor: 'pointer',
                  background: decisionModal.action === 'approve' ? '#16a34a' : '#dc2626',
                  color: '#fff'
                }}
              >
                {deciding ? 'Recording...' : decisionModal.action === 'approve' ? 'Confirm Approval' : 'Confirm Rejection'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Selected Order Modal with PNG Export */}
      {selectedOrder && (
        <div className="modal-overlay" onClick={() => setSelectedOrder(null)}>
          <div className="modal-dialog modal-order-detail" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <span className="modal-kicker">LineCart Order Receipt</span>
                <h2 className="modal-title">{selectedOrder.id || selectedOrder.orderId}</h2>
              </div>
              <button
                type="button"
                className="modal-close"
                onClick={() => setSelectedOrder(null)}
              >
                ✕
              </button>
            </div>

            <div className="modal-body">
              {/* Order Meta Card */}
              <div className="order-detail-meta-grid">
                <div>
                  <span className="meta-label">Customer / Shop</span>
                  <strong>{selectedOrder.customer || `Shop #${selectedOrder.customerId}`}</strong>
                  <div className="muted-text">{selectedOrder.shopCategory || 'Retail'} · Cluster {selectedOrder.clusterId || 1}</div>
                </div>
                <div>
                  <span className="meta-label">Sales Agent</span>
                  <strong>{selectedOrder.agentName || `Agent #${selectedOrder.spersonid}`}</strong>
                  <div className="muted-text">Employee ID: {selectedOrder.spersonid}</div>
                </div>
                <div>
                  <span className="meta-label">Order Date</span>
                  <strong>{selectedOrder.date}</strong>
                  <div className="muted-text">
                    <span className={`status-pill ${getStatusBadge(selectedOrder.status)}`}>
                      {selectedOrder.status || 'Active'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Payment & Delivery Status Card */}
              {(() => {
                const pay = getPaymentSummary(selectedOrder);
                return (
                  <div style={{
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: '10px',
                    padding: '12px 16px',
                    marginTop: '12px',
                    marginBottom: '14px'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px', flexWrap: 'wrap', gap: '8px' }}>
                      <span style={{ fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#64748b' }}>
                        Delivery & Payment Summary
                      </span>
                      <span style={{
                        fontSize: '12px',
                        fontWeight: 700,
                        padding: '2px 10px',
                        borderRadius: '999px',
                        background: pay.paymentStatus === 'Collected' ? '#dcfce7' : (pay.paymentStatus === 'Partially collected' ? '#fef3c7' : '#f1f5f9'),
                        color: pay.paymentStatus === 'Collected' ? '#15803d' : (pay.paymentStatus === 'Partially collected' ? '#b45309' : '#475569')
                      }}>
                        {pay.paymentStatus}
                      </span>
                    </div>
                    <div style={{ fontSize: '13px', fontWeight: 700, color: '#0f172a', marginBottom: '8px' }}>
                      {pay.fullText}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '10px', fontSize: '12px', borderTop: '1px solid #e2e8f0', paddingTop: '8px' }}>
                      <div>
                        <span style={{ color: '#64748b', display: 'block', fontSize: '11px' }}>Delivery Status</span>
                        <b>{pay.deliveryStatus}</b>
                      </div>
                      <div>
                        <span style={{ color: '#64748b', display: 'block', fontSize: '11px' }}>Order Total</span>
                        <b>₹{pay.total.toLocaleString('en-IN')}</b>
                      </div>
                      <div>
                        <span style={{ color: '#64748b', display: 'block', fontSize: '11px' }}>Amount Collected</span>
                        <b style={{ color: '#16a34a' }}>₹{pay.collected.toLocaleString('en-IN')}</b>
                      </div>
                      <div>
                        <span style={{ color: '#64748b', display: 'block', fontSize: '11px' }}>Balance Remaining</span>
                        <b style={{ color: pay.balance > 0 ? '#dc2626' : '#16a34a' }}>₹{pay.balance.toLocaleString('en-IN')}</b>
                      </div>
                      {pay.collectedBy && (
                        <div>
                          <span style={{ color: '#64748b', display: 'block', fontSize: '11px' }}>Collected By</span>
                          <b>{pay.collectedBy}</b>
                        </div>
                      )}
                      {pay.collectedAt && (
                        <div>
                          <span style={{ color: '#64748b', display: 'block', fontSize: '11px' }}>Collected At</span>
                          <b>{new Date(pay.collectedAt).toLocaleDateString('en-IN')}</b>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* Items Breakdown Table */}
              <h4 className="detail-section-title">Purchased Commodities</h4>
              <div className="order-items-detail-table">
                <table>
                  <thead>
                    <tr>
                      <th>Item Description</th>
                      <th style={{ textAlign: 'right' }}>Price</th>
                      <th style={{ textAlign: 'right' }}>Qty</th>
                      <th style={{ textAlign: 'right' }}>Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(selectedOrder.orderList && selectedOrder.orderList.length > 0) ? (
                      selectedOrder.orderList.map((item, idx) => {
                        const rate = parseFloat(item.custprice || item.price || item.actprice || 50);
                        const catRate = parseFloat(item.catalogPrice || item.catPrice || item.actprice || rate);
                        const reqRate = item.requestedPrice !== undefined && item.requestedPrice !== null
                          ? parseFloat(item.requestedPrice)
                          : null;
                        const reqStatus = item.priceRequestStatus || null;
                        const qty = parseFloat(item.qty) || 1;
                        return (
                          <tr key={idx}>
                            <td>
                              <div>{item.itemName || `Commodity #${item.itemid || idx + 1}`}</div>
                              {reqRate !== null && !isNaN(reqRate) && (
                                <div style={{ fontSize: '11px', marginTop: '2px', color: reqStatus === 'approved' ? '#15803d' : reqStatus === 'rejected' ? '#b91c1c' : '#b45309' }}>
                                  Catalog: ₹{catRate.toFixed(2)} · Requested: ₹{reqRate.toFixed(2)} ·{' '}
                                  <b>
                                    {reqStatus === 'approved'
                                      ? '✓ Approved'
                                      : reqStatus === 'rejected'
                                      ? '✕ Rejected (Catalog applied)'
                                      : '⏳ Pending approval'}
                                  </b>
                                </div>
                              )}
                            </td>
                            <td style={{ textAlign: 'right' }}>₹{rate.toFixed(2)}</td>
                            <td style={{ textAlign: 'right' }}>{qty} {item.unit || 'kg'}</td>
                            <td style={{ textAlign: 'right', fontWeight: 'bold' }}>
                              ₹{(rate * qty).toLocaleString('en-IN')}
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td>General Order Items</td>
                        <td style={{ textAlign: 'right' }}>—</td>
                        <td style={{ textAlign: 'right' }}>{selectedOrder.itemsCount || 1}</td>
                        <td style={{ textAlign: 'right', fontWeight: 'bold' }}>{formatInr(selectedOrder.total)}</td>
                      </tr>
                    )}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th colSpan="3" style={{ textAlign: 'right' }}>Grand Total:</th>
                      <th style={{ textAlign: 'right', fontSize: '1.1rem', color: '#16a34a' }}>
                        {formatInr(selectedOrder.total)}
                      </th>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            <div className="modal-footer order-detail-footer">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setSelectedOrder(null)}
              >
                Close
              </button>
              <button
                type="button"
                className="btn-primary btn-export-png"
                disabled={isExporting}
                onClick={() => exportOrderAsPNG(selectedOrder)}
              >
                {isExporting ? 'Generating PNG...' : '📸 Export Order as PNG Image'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Admin Create Order Modal */}
      {createModalOpen && (
        <div className="modal-overlay" onClick={() => setCreateModalOpen(false)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '640px' }}>
            <div className="modal-header">
              <div>
                <span className="modal-kicker">ADMIN ORDER CREATION</span>
                <h2 className="modal-title">Create New Order</h2>
              </div>
              <button type="button" className="modal-close" onClick={() => setCreateModalOpen(false)}>✕</button>
            </div>

            <form onSubmit={handleSubmitCreateOrder}>
              <div className="modal-body" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, marginBottom: '4px' }}>Shop / Customer *</label>
                    <select
                      className="select"
                      value={createFormData.shopId}
                      onChange={(e) => {
                        const sId = e.target.value;
                        const matchedShop = shops.find((s) => String(s.shopid) === String(sId));
                        setCreateFormData({
                          ...createFormData,
                          shopId: sId,
                          clusterId: matchedShop?.clusterid || createFormData.clusterId
                        });
                      }}
                      required
                    >
                      <option value="">Select Shop...</option>
                      {shops.map((s) => (
                        <option key={s.shopid} value={s.shopid}>{s.shopName} ({s.ownerName || s.shopid})</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, marginBottom: '4px' }}>Sales Agent *</label>
                    <select
                      className="select"
                      value={createFormData.spersonId}
                      onChange={(e) => setCreateFormData({ ...createFormData, spersonId: e.target.value })}
                      required
                    >
                      <option value="">Select Agent...</option>
                      {assignedAgents.map((a) => (
                        <option key={a.id} value={a.id}>{a.name} (ID: {a.id})</option>
                      ))}
                      {!assignedAgents.some((a) => a.id === user?.id) && (
                        <option value={user?.id}>{user?.name} (Admin)</option>
                      )}
                    </select>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, marginBottom: '4px' }}>Order Date</label>
                    <input
                      type="date"
                      className="field"
                      value={createFormData.orderDate}
                      onChange={(e) => setCreateFormData({ ...createFormData, orderDate: e.target.value })}
                      required
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, marginBottom: '4px' }}>Cluster Route</label>
                    <select
                      className="select"
                      value={createFormData.clusterId}
                      onChange={(e) => setCreateFormData({ ...createFormData, clusterId: Number(e.target.value) })}
                    >
                      {clusters.map((c) => (
                        <option key={c.clusterId} value={c.clusterId}>{c.clusterName || `Cluster ${c.clusterId}`}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Line Items */}
                <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <span style={{ fontSize: '13px', fontWeight: 700 }}>Order Line Items</span>
                    <button
                      type="button"
                      style={{ padding: '4px 8px', fontSize: '11px', fontWeight: 700, background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: '4px', cursor: 'pointer' }}
                      onClick={() => {
                        const defItem = catalogProducts[0] || {};
                        setCreateFormData({
                          ...createFormData,
                          orderList: [
                            ...createFormData.orderList,
                            { itemid: defItem.itemId || 1, itemName: defItem.itemName || 'Item', qty: 1, price: defItem.price || 50, custprice: defItem.price || 50 }
                          ]
                        });
                      }}
                    >
                      + Add Commodity
                    </button>
                  </div>

                  <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
                    {createFormData.orderList.map((line, idx) => (
                      <div key={idx} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr auto', gap: '8px', alignItems: 'center', marginBottom: '8px' }}>
                        <select
                          className="select"
                          style={{ padding: '4px 6px', fontSize: '12px' }}
                          value={line.itemid}
                          onChange={(e) => {
                            const selectedId = Number(e.target.value);
                            const matched = catalogProducts.find((p) => Number(p.itemId) === selectedId);
                            const updated = [...createFormData.orderList];
                            updated[idx] = {
                              ...updated[idx],
                              itemid: selectedId,
                              itemName: matched?.itemName || `Item ${selectedId}`,
                              price: matched?.price || updated[idx].price,
                              custprice: matched?.price || updated[idx].custprice
                            };
                            setCreateFormData({ ...createFormData, orderList: updated });
                          }}
                        >
                          {catalogProducts.map((p) => (
                            <option key={p.itemId} value={p.itemId}>{p.itemName} (₹{p.price})</option>
                          ))}
                        </select>
                        <input
                          type="number"
                          min="1"
                          step="1"
                          className="field"
                          placeholder="Qty"
                          style={{ padding: '4px 6px', fontSize: '12px' }}
                          value={line.qty}
                          onChange={(e) => {
                            const updated = [...createFormData.orderList];
                            updated[idx].qty = parseFloat(e.target.value) || 0;
                            setCreateFormData({ ...createFormData, orderList: updated });
                          }}
                        />
                        <input
                          type="number"
                          min="0"
                          step="0.1"
                          className="field"
                          placeholder="Rate (₹)"
                          style={{ padding: '4px 6px', fontSize: '12px' }}
                          value={line.custprice}
                          onChange={(e) => {
                            const updated = [...createFormData.orderList];
                            const p = parseFloat(e.target.value) || 0;
                            updated[idx].custprice = p;
                            updated[idx].price = p;
                            setCreateFormData({ ...createFormData, orderList: updated });
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const updated = createFormData.orderList.filter((_, i) => i !== idx);
                            setCreateFormData({ ...createFormData, orderList: updated });
                          }}
                          style={{ color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px', padding: '0 4px' }}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>

                  <div style={{ textAlign: 'right', fontSize: '13px', fontWeight: 700, marginTop: '8px', color: '#0284c7' }}>
                    Order Total: ₹{createFormData.orderList.reduce((sum, l) => sum + ((parseFloat(l.qty) || 0) * (parseFloat(l.custprice) || 0)), 0).toFixed(2)}
                  </div>
                </div>
              </div>

              <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', padding: '12px 16px' }}>
                <button type="button" className="btn-secondary" onClick={() => setCreateModalOpen(false)}>Cancel</button>
                <button
                  type="submit"
                  disabled={savingAction}
                  style={{
                    padding: '8px 18px',
                    borderRadius: '6px',
                    border: 'none',
                    fontWeight: 700,
                    fontSize: '12px',
                    background: '#0284c7',
                    color: '#fff',
                    cursor: 'pointer'
                  }}
                >
                  {savingAction ? 'Creating...' : 'Create Order'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Admin Edit Order Modal */}
      {editModalOrder && (
        <div className="modal-overlay" onClick={() => setEditModalOrder(null)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '640px' }}>
            <div className="modal-header">
              <div>
                <span className="modal-kicker">ADMIN ORDER EDIT</span>
                <h2 className="modal-title">Edit Order: {editModalOrder.id || editModalOrder.orderId}</h2>
              </div>
              <button type="button" className="modal-close" onClick={() => setEditModalOrder(null)}>✕</button>
            </div>

            <form onSubmit={handleSubmitEditOrder}>
              <div className="modal-body" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div style={{ background: '#f8fafc', padding: '10px 14px', borderRadius: '8px', fontSize: '12px', color: '#334155' }}>
                  <div>Store: <b>{editModalOrder.customer}</b></div>
                  <div>Agent: <b>{editModalOrder.agentName || `ID: ${editModalOrder.spersonid}`}</b></div>
                  <div>Order Date: <b>{editModalOrder.date}</b></div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, marginBottom: '4px' }}>Status</label>
                    <select
                      className="select"
                      value={editFormData.status}
                      onChange={(e) => setEditFormData({ ...editFormData, status: e.target.value })}
                      required
                    >
                      <option value="In progress">In progress</option>
                      <option value="Picked up">Picked up</option>
                      <option value="Delivered">Delivered</option>
                      <option value="Could not deliver">Could not deliver</option>
                      <option value="Cancelled">Cancelled</option>
                    </select>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, marginBottom: '4px' }}>Delivery Agent</label>
                    <select
                      className="select"
                      value={editFormData.deliveryAgentId}
                      onChange={(e) => setEditFormData({ ...editFormData, deliveryAgentId: e.target.value })}
                    >
                      <option value="">Unassigned</option>
                      {deliveryAgents.map((da) => (
                        <option key={da.id} value={da.id}>{da.name} (ID: {da.id})</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Line Items Edit */}
                <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <span style={{ fontSize: '13px', fontWeight: 700 }}>Line Items & Pricing</span>
                    <button
                      type="button"
                      style={{ padding: '4px 8px', fontSize: '11px', fontWeight: 700, background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: '4px', cursor: 'pointer' }}
                      onClick={() => {
                        const defItem = catalogProducts[0] || {};
                        setEditFormData({
                          ...editFormData,
                          orderList: [
                            ...editFormData.orderList,
                            { itemid: defItem.itemId || 1, itemName: defItem.itemName || 'Item', qty: 1, price: defItem.price || 50, custprice: defItem.price || 50 }
                          ]
                        });
                      }}
                    >
                      + Add Item
                    </button>
                  </div>

                  <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
                    {editFormData.orderList.map((line, idx) => (
                      <div key={idx} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr auto', gap: '8px', alignItems: 'center', marginBottom: '8px' }}>
                        <div style={{ fontSize: '12px', fontWeight: 600 }}>{line.itemName}</div>
                        <input
                          type="number"
                          min="1"
                          step="1"
                          className="field"
                          placeholder="Qty"
                          style={{ padding: '4px 6px', fontSize: '12px' }}
                          value={line.qty}
                          onChange={(e) => {
                            const updated = [...editFormData.orderList];
                            updated[idx].qty = parseFloat(e.target.value) || 0;
                            setEditFormData({ ...editFormData, orderList: updated });
                          }}
                        />
                        <input
                          type="number"
                          min="0"
                          step="0.1"
                          className="field"
                          placeholder="Rate (₹)"
                          style={{ padding: '4px 6px', fontSize: '12px' }}
                          value={line.custprice}
                          onChange={(e) => {
                            const updated = [...editFormData.orderList];
                            const p = parseFloat(e.target.value) || 0;
                            updated[idx].custprice = p;
                            updated[idx].price = p;
                            setEditFormData({ ...editFormData, orderList: updated });
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const updated = editFormData.orderList.filter((_, i) => i !== idx);
                            setEditFormData({ ...editFormData, orderList: updated });
                          }}
                          style={{ color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px', padding: '0 4px' }}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>

                  <div style={{ textAlign: 'right', fontSize: '13px', fontWeight: 700, marginTop: '8px', color: '#0284c7' }}>
                    Updated Total: ₹{editFormData.orderList.reduce((sum, l) => sum + ((parseFloat(l.qty) || 0) * (parseFloat(l.custprice) || 0)), 0).toFixed(2)}
                  </div>
                </div>
              </div>

              <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', padding: '12px 16px' }}>
                <button type="button" className="btn-secondary" onClick={() => setEditModalOrder(null)}>Cancel</button>
                <button
                  type="submit"
                  disabled={savingAction}
                  style={{
                    padding: '8px 18px',
                    borderRadius: '6px',
                    border: 'none',
                    fontWeight: 700,
                    fontSize: '12px',
                    background: '#0284c7',
                    color: '#fff',
                    cursor: 'pointer'
                  }}
                >
                  {savingAction ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Admin Cancel Order Modal */}
      {cancelModalOrder && (
        <div className="modal-overlay" onClick={() => setCancelModalOrder(null)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '440px' }}>
            <div className="modal-header">
              <div>
                <span className="modal-kicker">CONFIRM CANCELLATION</span>
                <h2 className="modal-title">Cancel Order {cancelModalOrder.id || cancelModalOrder.orderId}?</h2>
              </div>
              <button type="button" className="modal-close" onClick={() => setCancelModalOrder(null)}>✕</button>
            </div>

            <div className="modal-body" style={{ padding: '16px' }}>
              <p style={{ fontSize: '13px', color: '#475569', marginBottom: '12px' }}>
                Are you sure you want to cancel this order placed by <b>{cancelModalOrder.customer}</b>?
              </p>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, marginBottom: '4px' }}>Cancellation Reason:</label>
                <textarea
                  rows="3"
                  className="field"
                  style={{ width: '100%', padding: '8px', fontSize: '12px' }}
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder="e.g. Customer requested cancellation / out of stock..."
                />
              </div>
            </div>

            <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', padding: '12px 16px' }}>
              <button type="button" className="btn-secondary" onClick={() => setCancelModalOrder(null)}>Keep Order</button>
              <button
                type="button"
                disabled={savingAction}
                onClick={handleConfirmCancel}
                style={{
                  padding: '8px 18px',
                  borderRadius: '6px',
                  border: 'none',
                  fontWeight: 700,
                  fontSize: '12px',
                  background: '#e11d48',
                  color: '#fff',
                  cursor: 'pointer'
                }}
              >
                {savingAction ? 'Cancelling...' : 'Confirm Cancellation'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Admin Delete Order Modal */}
      {deleteModalOrder && (
        <div className="modal-overlay" onClick={() => setDeleteModalOrder(null)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '440px' }}>
            <div className="modal-header">
              <div>
                <span className="modal-kicker" style={{ color: '#dc2626' }}>PERMANENT DESTRUCTION</span>
                <h2 className="modal-title">Delete Order Permanently?</h2>
              </div>
              <button type="button" className="modal-close" onClick={() => setDeleteModalOrder(null)}>✕</button>
            </div>

            <div className="modal-body" style={{ padding: '16px' }}>
              <div style={{ background: '#fef2f2', border: '1px solid #fecaca', padding: '12px', borderRadius: '8px', marginBottom: '12px', color: '#991b1b', fontSize: '13px' }}>
                ⚠️ <b>Warning:</b> This will permanently remove order <b>{deleteModalOrder.id || deleteModalOrder.orderId}</b>, its line items, and audit records. This cannot be undone.
              </div>
              <p style={{ fontSize: '13px', color: '#475569' }}>
                Store: <b>{deleteModalOrder.customer}</b><br />
                Total: <b>{formatInr(deleteModalOrder.total)}</b>
              </p>
            </div>

            <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', padding: '12px 16px' }}>
              <button type="button" className="btn-secondary" onClick={() => setDeleteModalOrder(null)}>Cancel</button>
              <button
                type="button"
                disabled={savingAction}
                onClick={handleConfirmDelete}
                style={{
                  padding: '8px 18px',
                  borderRadius: '6px',
                  border: 'none',
                  fontWeight: 700,
                  fontSize: '12px',
                  background: '#dc2626',
                  color: '#fff',
                  cursor: 'pointer'
                }}
              >
                {savingAction ? 'Deleting...' : 'Permanently Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
