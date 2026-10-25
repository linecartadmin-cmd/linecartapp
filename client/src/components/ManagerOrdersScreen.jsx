import React, { useState, useEffect, useMemo, useRef } from 'react';
import { api } from '../api';

export default function ManagerOrdersScreen({ user, clusters, shops, showToast }) {
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

  // Load manager's assigned agents
  useEffect(() => {
    if (!user) return;
    api.getManagerAssignments(user.id).then((res) => {
      if (res && res.assignedAgents) {
        setAssignedAgents(res.assignedAgents);
      }
    });
  }, [user]);

  // Load orders based on filters
  const fetchOrders = () => {
    if (!user) return;
    setLoading(true);
    const params = {
      managerId: user.id,
      agentId: selectedAgentId,
      clusterId: selectedCluster,
      category: selectedCategory,
      shopId: selectedShopId,
      status: selectedStatus,
      fromDate: fromDate || undefined,
      toDate: toDate || undefined
    };

    api.getManagerOrders(params)
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
  }, [user, selectedAgentId, selectedCluster, selectedCategory, selectedShopId, selectedStatus, fromDate, toDate]);

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
                      <span className={`status-pill ${getStatusBadge(order.status)}`}>
                        {order.status || 'Active'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        type="button"
                        className="btn-action-view"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedOrder(order);
                        }}
                      >
                        View &amp; Export
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

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
                        const qty = parseFloat(item.qty) || 1;
                        return (
                          <tr key={idx}>
                            <td>{item.itemName || `Commodity #${item.itemid || idx + 1}`}</td>
                            <td style={{ textAlign: 'right' }}>₹{rate.toFixed(2)}</td>
                            <td style={{ textAlign: 'right' }}>{qty}</td>
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
    </div>
  );
}
