import React, { useState, useEffect } from 'react';
import { api } from '../api';

export default function SummaryReportScreen({
  user,
  showToast
}) {
  const [clustersList, setClustersList] = useState([]);
  const [selectedClusterId, setSelectedClusterId] = useState('all');
  const [selectedClusterLabel, setSelectedClusterLabel] = useState('All clusters');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [agentsList, setAgentsList] = useState([]);
  const [selectedAgentId, setSelectedAgentId] = useState('all');
  const [loading, setLoading] = useState(false);
  const [rawOrders, setRawOrders] = useState([]);

  const money = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');

  const todayStr = new Date().toLocaleDateString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).replace(/\//g, '-');

  const role = (user?.role || '').toLowerCase();
  const isAdminOrManager = role === 'admin' || role === 'sales manager';

  useEffect(() => {
    if (!isAdminOrManager) return;
    if (role === 'admin') {
      api.getAdminUsers()
        .then((res) => {
          if (res && res.users) {
            const fieldAgents = res.users.filter(
              (u) => (u.role || '').toLowerCase() === 'field sales agent'
            );
            setAgentsList(fieldAgents);
          }
        })
        .catch(() => {});
    } else if (role === 'sales manager' && user?.id) {
      api.getManagerAssignedAgents(user.id)
        .then((res) => {
          if (res && res.agents) {
            setAgentsList(res.agents);
          }
        })
        .catch(() => {});
    }
  }, [user?.id, role, isAdminOrManager]);

  const loadReport = () => {
    setLoading(true);
    const params = {
      spersonId: selectedAgentId !== 'all' ? selectedAgentId : (role === 'field sales agent' ? user?.id : undefined),
      clusterId: selectedClusterId !== 'all' ? selectedClusterId : undefined,
      fromDate: fromDate || undefined,
      toDate: toDate || undefined
    };

    Promise.all([
      api.getHomeReport(params),
      api.getOrders()
    ])
      .then(([reportRes, ordersRes]) => {
        if ((reportRes?.status === 200 || reportRes?.status === 1) && reportRes?.result?.clusterList) {
          setClustersList(reportRes.result.clusterList);
        } else {
          showToast('Failed to load cluster reports');
        }

        if (ordersRes && ordersRes.status === 200 && Array.isArray(ordersRes.orders)) {
          setRawOrders(ordersRes.orders);
        }
      })
      .catch(() => {
        showToast('Failed to connect to reports service');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadReport();
  }, [user?.id, selectedClusterId, selectedAgentId, fromDate, toDate]);

  const isAllClusters = selectedClusterId === 'all';

  const activeCluster = !isAllClusters
    ? clustersList.find((c) => Number(c.clusterId) === Number(selectedClusterId)) || clustersList[0] || null
    : null;

  // Filter live orders based on toolbar controls
  const filteredOrders = rawOrders.filter((o) => {
    if (selectedClusterId !== 'all' && Number(o.clusterId) !== Number(selectedClusterId)) return false;
    if (selectedAgentId !== 'all' && Number(o.spersonid) !== Number(selectedAgentId)) return false;
    if (role === 'field sales agent' && Number(o.spersonid) !== Number(user?.id)) return false;
    if (fromDate && (o.date || '').slice(0, 10) < fromDate) return false;
    if (toDate && (o.date || '').slice(0, 10) > toDate) return false;
    return true;
  });

  // Calculate live order metrics
  const activeOrders = filteredOrders.filter((o) => {
    const st = String(o.status || '').toLowerCase();
    return st !== 'delivered' && st !== 'cancelled';
  });
  const activeOrdersCount = activeOrders.length;
  const deliveredOrdersCount = filteredOrders.filter((o) => String(o.status || '').toLowerCase() === 'delivered').length;
  const totalRevenue = filteredOrders.reduce((sum, o) => sum + Number(o.total || 0), 0);

  // Compute stats for all clusters or single selected cluster
  let totalShops = 0;
  let totalOrdered = 0;
  let totalNotOrdered = 0;
  let deliveryStatusList = [];
  let orderItemStatusList = [];
  let shopsByCategoryMap = new Map();

  if (isAllClusters) {
    clustersList.forEach((c) => {
      const s = c.order_shop_status || c || {};
      totalShops += Number(s.totalshops ?? c.totalshops ?? 0);
      totalOrdered += Number(s.totalorderedshops ?? c.totalorderedshops ?? 0);
      totalNotOrdered += Number(s.totalnotorderedshops ?? c.totalnotorderedshops ?? 0);

      const cats = c.shopsByCategory || [];
      cats.forEach((catObj) => {
        const current = shopsByCategoryMap.get(catObj.category) || 0;
        shopsByCategoryMap.set(catObj.category, current + Number(catObj.count || 0));
      });
    });

    const delivMap = new Map();
    clustersList.forEach((c) => {
      const list = c.deliverystatus || c.delivery_status || [];
      list.forEach((item) => {
        if (!delivMap.has(item.name)) {
          delivMap.set(item.name, { ...item, totalcount: 0, delivered: 0, inprogress: 0 });
        }
        delivMap.get(item.name).totalcount += Number(item.totalcount || 0);
        delivMap.get(item.name).delivered += Number(item.delivered || 0);
        delivMap.get(item.name).inprogress += Number(item.inprogress || 0);
      });
    });
    deliveryStatusList = Array.from(delivMap.values()).map((it) => ({
      ...it,
      fulfillment: it.totalcount > 0 ? Math.min(100, Math.round((it.delivered / it.totalcount) * 100)) : 0
    }));

    const orderItemMap = new Map();
    clustersList.forEach((c) => {
      const list = c.order_item_status || [];
      list.forEach((item) => {
        if (!orderItemMap.has(item.name)) {
          orderItemMap.set(item.name, { ...item, totalcount: 0 });
        }
        orderItemMap.get(item.name).totalcount += Number(item.totalcount || 0);
      });
    });
    orderItemStatusList = Array.from(orderItemMap.values());
  } else {
    const shopStatus = activeCluster?.order_shop_status || activeCluster || {};
    totalShops = shopStatus.totalshops ?? activeCluster?.totalshops ?? 0;
    totalOrdered = shopStatus.totalorderedshops ?? activeCluster?.totalorderedshops ?? 0;
    totalNotOrdered = shopStatus.totalnotorderedshops ?? activeCluster?.totalnotorderedshops ?? 0;
    deliveryStatusList = activeCluster?.deliverystatus || activeCluster?.delivery_status || [];
    orderItemStatusList = activeCluster?.order_item_status || [];

    const cats = activeCluster?.shopsByCategory || [];
    cats.forEach((catObj) => {
      shopsByCategoryMap.set(catObj.category, Number(catObj.count || 0));
    });
  }

  const shopsByCategoryList = Array.from(shopsByCategoryMap.entries()).map(([category, count]) => ({
    category,
    count
  }));

  // Group live orders by shop category/type
  const ordersByCategoryMap = new Map();
  filteredOrders.forEach((o) => {
    const cat = o.shopCategory || 'Retail';
    if (!ordersByCategoryMap.has(cat)) {
      ordersByCategoryMap.set(cat, {
        category: cat,
        orderCount: 0,
        totalQtyKg: 0,
        totalAmount: 0
      });
    }
    const entry = ordersByCategoryMap.get(cat);
    entry.orderCount += 1;
    entry.totalAmount += Number(o.total || 0);
    const lines = Array.isArray(o.orderList) ? o.orderList : [];
    lines.forEach((it) => {
      entry.totalQtyKg += parseFloat(it.qty || 0) || 0;
    });
  });
  const ordersByCategoryList = Array.from(ordersByCategoryMap.values());

  // Detailed orders by shop, item, and quantity in kilograms
  const detailedOrderLines = [];
  filteredOrders.forEach((o) => {
    const lines = Array.isArray(o.orderList) ? o.orderList : [];
    if (lines.length === 0) {
      detailedOrderLines.push({
        lineKey: `${o.orderId || o.id}-none`,
        orderId: o.orderId || o.id,
        date: o.date || '—',
        shopName: o.customer || o.shopName || 'Customer Store',
        shopCategory: o.shopCategory || 'Retail',
        itemName: 'General Replenishment',
        qtyKg: 0,
        unitPrice: 0,
        lineTotal: Number(o.total || 0),
        status: o.status || 'Active'
      });
    } else {
      lines.forEach((it, idx) => {
        const qty = parseFloat(it.qty || 0) || 0;
        const price = parseFloat(it.price || 0) || 0;
        detailedOrderLines.push({
          lineKey: `${o.orderId || o.id}-${it.itemid || idx}`,
          orderId: o.orderId || o.id,
          date: o.date || '—',
          shopName: o.customer || o.shopName || 'Customer Store',
          shopCategory: o.shopCategory || 'Retail',
          itemName: it.itemName || it.name || `Item ${it.itemid}`,
          qtyKg: qty,
          unitPrice: price,
          lineTotal: qty * price || Number(o.total || 0),
          status: o.status || 'Active'
        });
      });
    }
  });

  return (
    <div className="summary-report-page">
      {/* Page Heading */}
      <div className="page-heading">
        <div>
          <p className="eyebrow">EXECUTIVE SUMMARY</p>
          <h1>Summary Report</h1>
          <p>Real-time cluster delivery progress, shop connectivity, and commodity status.</p>
        </div>
        <button
          className="secondary-button"
          onClick={loadReport}
        >
          ↻ {loading ? 'Refreshing...' : 'Refresh stats'}
        </button>
      </div>

      {/* Cluster, Agent & Date Toolbar */}
      <div className="summary-toolbar" style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', alignItems: 'center' }}>
        <div className="summary-cluster-group">
          <label htmlFor="summary-cluster-select" className="summary-cluster-label">
            CLUSTER ROUTE
          </label>
          <select
            id="summary-cluster-select"
            className="select summary-cluster-select"
            value={selectedClusterId}
            onChange={(e) => {
              const val = e.target.value;
              setSelectedClusterId(val === 'all' ? 'all' : Number(val));
              const found = clustersList.find((c) => Number(c.clusterId) === Number(val));
              setSelectedClusterLabel(val === 'all' ? 'All clusters' : (found?.clusterName || ''));
            }}
          >
            <option value="all">All clusters</option>
            {clustersList.map((c) => (
              <option key={c.clusterId} value={c.clusterId}>
                {c.clusterName}
              </option>
            ))}
          </select>
        </div>

        {isAdminOrManager && (
          <div className="summary-cluster-group">
            <label htmlFor="summary-agent-select" className="summary-cluster-label">
              FIELD SALES AGENT
            </label>
            <select
              id="summary-agent-select"
              className="select summary-cluster-select"
              value={selectedAgentId}
              onChange={(e) => setSelectedAgentId(e.target.value === 'all' ? 'all' : Number(e.target.value))}
            >
              <option value="all">All agents</option>
              {agentsList.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name || a.username} ({a.employeeId || `ID: ${a.id}`})
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="summary-date-group" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <label htmlFor="summary-from-date" style={{ fontSize: '11px', fontWeight: 700, color: '#64748b' }}>
            FROM:
          </label>
          <input
            id="summary-from-date"
            type="date"
            className="field"
            style={{ padding: '4px 8px', fontSize: '12px' }}
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
          />
        </div>

        <div className="summary-date-group" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <label htmlFor="summary-to-date" style={{ fontSize: '11px', fontWeight: 700, color: '#64748b' }}>
            TO:
          </label>
          <input
            id="summary-to-date"
            type="date"
            className="field"
            style={{ padding: '4px 8px', fontSize: '12px' }}
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
          />
        </div>

        <div className="summary-date-group" style={{ marginLeft: 'auto' }}>
          <span className="summary-date-label">Report Date:</span>
          <span className="summary-date-badge">
            📅 {todayStr}
          </span>
        </div>
      </div>

      {/* 4 Shop & Order Status KPI Cards (Derived strictly from live persisted data) */}
      <section className="stats-grid">
        <article className="stat-card">
          <div className="stat-top">
            <span>Total Number Of Shops</span>
            <span className="stat-icon blue">▣</span>
          </div>
          <div className="stat-value">{totalShops}</div>
          <div className="stat-foot">Registered stores on this route</div>
        </article>

        <article className="stat-card">
          <div className="stat-top">
            <span>Active / Running Orders</span>
            <span className="stat-icon green">⚡</span>
          </div>
          <div className="stat-value">{activeOrdersCount}</div>
          <div className="stat-foot">
            <span className="up">In-flight</span> active route orders
          </div>
        </article>

        <article className="stat-card">
          <div className="stat-top">
            <span>Delivered Orders</span>
            <span className="stat-icon green">✓</span>
          </div>
          <div className="stat-value">{deliveredOrdersCount}</div>
          <div className="stat-foot">Successfully fulfilled orders</div>
        </article>

        <article className="stat-card">
          <div className="stat-top">
            <span>Live Order Value</span>
            <span className="stat-icon purple">₹</span>
          </div>
          <div className="stat-value">{money(totalRevenue)}</div>
          <div className="stat-foot">Filtered active order total</div>
        </article>
      </section>

      {/* "Shops by Category" Breakdown Section */}
      <section className="mb-6 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-base font-bold text-slate-800">Shops by category</h2>
            <p className="text-xs text-slate-500">Distribution of registered customer stores across commercial retail formats</p>
          </div>
          <span className="text-xs font-semibold px-2.5 py-1 bg-slate-100 text-slate-700 rounded-full">
            {totalShops} Total Stores
          </span>
        </div>

        {shopsByCategoryList.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
            {shopsByCategoryList.map((catItem) => (
              <div
                key={catItem.category}
                className="p-3 bg-slate-50 border border-slate-100 rounded-xl flex flex-col items-start justify-between"
              >
                <span className="text-xs font-medium text-slate-600 mb-1">{catItem.category}</span>
                <div className="flex items-baseline gap-1">
                  <strong className="text-xl font-extrabold text-[#17232c]">{catItem.count}</strong>
                  <span className="text-[11px] text-slate-400">
                    ({totalShops > 0 ? Math.round((catItem.count / totalShops) * 100) : 0}%)
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state text-xs text-slate-400 p-4 text-center">
            No shop category breakdown available for the selected route.
          </div>
        )}
      </section>

      {/* "Orders by Shop Category / Type" Table */}
      <section className="table-panel summary-table-card mb-6">
        <div className="table-heading">
          <div>
            <h2>Orders by shop category/type</h2>
            <span className="recent-count">Aggregated replenishment volume grouped by customer format</span>
          </div>
        </div>

        <div className="summary-table-scroll">
          <table className="data-table summary-orders-table">
            <thead>
              <tr>
                <th>Shop Category / Format</th>
                <th>Orders Count</th>
                <th>Total Quantity (Kg)</th>
                <th>Total Value (₹)</th>
              </tr>
            </thead>
            <tbody>
              {ordersByCategoryList.length > 0 ? (
                ordersByCategoryList.map((row) => (
                  <tr key={row.category}>
                    <td>
                      <div className="flex items-center gap-2">
                        <span className="stat-icon blue text-xs">🏪</span>
                        <strong>{row.category}</strong>
                      </div>
                    </td>
                    <td>
                      <span className="text-sm font-bold text-slate-800">
                        {row.orderCount} {row.orderCount === 1 ? 'order' : 'orders'}
                      </span>
                    </td>
                    <td>
                      <span className="text-sm font-semibold text-slate-700">
                        {row.totalQtyKg.toLocaleString('en-IN')} kg
                      </span>
                    </td>
                    <td>
                      <span className="text-sm font-bold text-[#12aee2]">
                        {money(row.totalAmount)}
                      </span>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="4">
                    <div className="empty-state">No orders found for the selected route and period.</div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Orders by Shop, Item, and Quantity in Kilograms Table */}
      <section className="table-panel summary-table-card mb-6">
        <div className="table-heading">
          <div>
            <h2>Orders by shop, item, and quantity in kilograms</h2>
            <span className="recent-count">Live itemized line items from persisted order records</span>
          </div>
        </div>

        <div className="summary-table-scroll">
          <table className="data-table summary-delivery-table">
            <thead>
              <tr>
                <th>Order Ref</th>
                <th>Date</th>
                <th>Customer / Shop</th>
                <th>Category</th>
                <th>Commodity Item</th>
                <th>Quantity (Kg)</th>
                <th>Rate / Total</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {detailedOrderLines.length > 0 ? (
                detailedOrderLines.map((line) => {
                  const statusClass = (line.status || 'active').toLowerCase().replace(/\s+/g, '-');
                  return (
                    <tr key={line.lineKey}>
                      <td>
                        <strong className="text-xs text-slate-800">{line.orderId}</strong>
                      </td>
                      <td className="text-xs text-slate-500 whitespace-nowrap">{line.date}</td>
                      <td>
                        <strong>{line.shopName}</strong>
                      </td>
                      <td>
                        <span className="text-xs px-2 py-0.5 bg-slate-100 rounded text-slate-600 font-medium">
                          {line.shopCategory}
                        </span>
                      </td>
                      <td>
                        <div className="flex items-center gap-2">
                          <span className="stat-icon green text-xs">🥬</span>
                          <span className="font-semibold text-slate-800">{line.itemName}</span>
                        </div>
                      </td>
                      <td>
                        <span className="text-sm font-bold text-slate-900">
                          {line.qtyKg} kg
                        </span>
                      </td>
                      <td>
                        <div className="flex flex-col">
                          <strong className="text-xs text-slate-900">{money(line.lineTotal)}</strong>
                          {line.unitPrice > 0 && (
                            <small className="text-[10px] text-slate-400">@ {money(line.unitPrice)}/kg</small>
                          )}
                        </div>
                      </td>
                      <td>
                        <span className={`status ${statusClass}`}>
                          {line.status}
                        </span>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan="8">
                    <div className="empty-state">No order line items match the selected filters.</div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Two Auxiliary Commodity Summary Panels (Fulfillment Progress & Aggregated Commodity Orders) */}
      <div className="summary-tables-grid">
        {/* Panel 1: Delivery Status Summary */}
        <section className="table-panel summary-table-card">
          <div className="table-heading">
            <div>
              <h2>Delivery Status Summary</h2>
              <span className="recent-count">Commodity fulfillment progress</span>
            </div>
          </div>

          <div className="summary-table-scroll">
            <table className="data-table summary-delivery-table">
              <thead>
                <tr>
                  <th>Item Name</th>
                  <th>Total Units (Kg)</th>
                  <th>Delivered</th>
                  <th>Inprogress</th>
                  <th>Fulfillment</th>
                </tr>
              </thead>
              <tbody>
                {deliveryStatusList.length > 0 ? (
                  deliveryStatusList.map((row, idx) => {
                    const delivered = Number(row.delivered || 0);
                    const inprogress = Number(row.inprogress || 0);
                    const total = Number(row.totalcount || 0);
                    const pct = row.fulfillment !== undefined
                      ? row.fulfillment
                      : (total > 0 ? Math.min(100, Math.round((delivered / total) * 100)) : 0);
                    return (
                      <tr key={`${row.id || idx}-${row.name}`}>
                        <td>
                          <strong>{row.name}</strong>
                        </td>
                        <td><b>{total} kg</b></td>
                        <td>
                          <span className="status delivered">{delivered} kg</span>
                        </td>
                        <td>
                          <span className="status in-progress">{inprogress} kg</span>
                        </td>
                        <td>
                          <div className="flex items-center gap-2">
                            <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-[#12aee2] rounded-full"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <small className="text-[10px] text-slate-500 font-bold">{pct}%</small>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan="5">
                      <div className="empty-state">No delivery status records for this selection.</div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Panel 2: Item Orders Status Summary */}
        <section className="table-panel summary-table-card">
          <div className="table-heading">
            <div>
              <h2>Item Orders Status Summary</h2>
              <span className="recent-count">Aggregated quantities ordered across route</span>
            </div>
          </div>

          <div className="summary-table-scroll">
            <table className="data-table summary-orders-table">
              <thead>
                <tr>
                  <th>Commodity Name</th>
                  <th>Total Quantity</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {orderItemStatusList.length > 0 ? (
                  orderItemStatusList.map((item, idx) => {
                    const statusStr = item.status || 'Active';
                    const statusClass = statusStr.toLowerCase().replace(/\s+/g, '-');
                    return (
                      <tr key={`${item.id || idx}-${item.name}`}>
                        <td>
                          <div className="flex items-center gap-2">
                            <span className="stat-icon blue text-xs">▤</span>
                            <strong>{item.name}</strong>
                          </div>
                        </td>
                        <td>
                          <span className="text-sm font-bold text-slate-800">
                            {item.totalcount} kg
                          </span>
                        </td>
                        <td>
                          <span className={`status ${statusClass}`}>
                            {statusStr}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan="3">
                      <div className="empty-state">No item orders for this selection.</div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
