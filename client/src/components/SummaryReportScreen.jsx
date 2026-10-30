import React, { useState, useEffect } from 'react';
import { api } from '../api';

function getIstDateStr(date = new Date()) {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

function addDaysToDateStr(dateStr, days) {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return '';
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (isNaN(d.getTime())) return '';
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
}

const DEFAULT_PERF_SCALE = [
  { band: 'Exceeded', range: '≥ 100%', minPct: 100, maxPct: null, color: 'green', description: 'Target fully achieved or exceeded' },
  { band: 'On Track', range: '80% – 99%', minPct: 80, maxPct: 99.99, color: 'blue', description: 'Strong progress toward target' },
  { band: 'Needs Attention', range: '50% – 79%', minPct: 50, maxPct: 79.99, color: 'amber', description: 'Moderate progress; requires follow-up' },
  { band: 'Critical / Below 50%', range: '< 50%', minPct: 0, maxPct: 49.99, color: 'red', description: 'Significant gap against target' }
];

export default function SummaryReportScreen({
  user,
  showToast
}) {
  const [clustersList, setClustersList] = useState([]);
  const [selectedClusterId, setSelectedClusterId] = useState('all');
  const [selectedClusterLabel, setSelectedClusterLabel] = useState('All clusters');
  const [reportPeriod, setReportPeriod] = useState('30d'); // 'today' | '7d' | '30d' | 'custom'
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [agentsList, setAgentsList] = useState([]);
  const [selectedAgentId, setSelectedAgentId] = useState('all');
  const [loading, setLoading] = useState(false);
  const [rawOrders, setRawOrders] = useState([]);
  const [reportMeta, setReportMeta] = useState(null);
  const [selectedInProgressDrilldown, setSelectedInProgressDrilldown] = useState(null); // { title, subtitle, orders }

  const money = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');
  const todayIST = getIstDateStr();
  const yestIST = addDaysToDateStr(todayIST, -1);

  const formatDateDisplay = (dStr) => {
    if (!dStr) return '—';
    const clean = String(dStr).slice(0, 10);
    const d = new Date(`${clean}T00:00:00`);
    return isNaN(d.getTime())
      ? clean
      : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  const role = (user?.role || '').toLowerCase();
  const isAdmin = role === 'admin';
  const isManager = role === 'sales manager';
  const isAgent = role === 'field sales agent';
  const isAdminOrManager = isAdmin || isManager;

  // Apply period preset dates in Asia/Kolkata local timezone
  const handleSelectPeriod = (periodKey) => {
    setReportPeriod(periodKey);
    const nowStr = getIstDateStr();
    if (periodKey === 'today') {
      setFromDate(nowStr);
      setToDate(nowStr);
    } else if (periodKey === '7d') {
      setFromDate(addDaysToDateStr(nowStr, -6));
      setToDate(nowStr);
    } else if (periodKey === '30d') {
      setFromDate(addDaysToDateStr(nowStr, -29));
      setToDate(nowStr);
    }
  };

  // Initialize default period range on mount
  useEffect(() => {
    handleSelectPeriod('30d');
  }, []);

  useEffect(() => {
    if (!isAdminOrManager) return;
    if (isAdmin) {
      api.getAdminUsers()
        .then((res) => {
          if (res && res.users) {
            const fieldAgents = res.users.filter(
              (u) => (u.role || '').toLowerCase() === 'field sales agent' && Number(u.active) === 1
            );
            setAgentsList(fieldAgents);
          }
        })
        .catch(() => {});
    } else if (isManager && user?.id) {
      api.getManagerAssignedAgents(user.id)
        .then((res) => {
          if (res && res.agents) {
            const fieldAgents = res.agents.filter(
              (u) => (u.role || '').toLowerCase() === 'field sales agent' && Number(u.active ?? 1) === 1
            );
            setAgentsList(fieldAgents);
          }
        })
        .catch(() => {});
    }
  }, [user?.id, isAdmin, isManager, isAdminOrManager]);

  const loadReport = () => {
    setLoading(true);
    const params = {
      spersonId: selectedAgentId !== 'all' ? selectedAgentId : (isAgent ? user?.id : undefined),
      clusterId: selectedClusterId !== 'all' ? selectedClusterId : undefined,
      period: reportPeriod !== 'custom' ? reportPeriod : undefined,
      fromDate: fromDate || undefined,
      toDate: toDate || undefined
    };

    Promise.all([
      api.getHomeReport(params),
      api.getOrders()
    ])
      .then(([reportRes, ordersRes]) => {
        if ((reportRes?.status === 200 || reportRes?.status === 1) && reportRes?.result) {
          const list = reportRes.result.clusterList || [];
          setClustersList(list);
          setReportMeta(reportRes.result);
          // If agent has only 1 assigned cluster, auto-select it
          if (isAgent && list.length === 1 && selectedClusterId === 'all') {
            setSelectedClusterId(String(list[0].clusterId));
            setSelectedClusterLabel(list[0].clusterName || `Cluster ${list[0].clusterId}`);
          }
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
  }, [user?.id, selectedClusterId, selectedAgentId, reportPeriod, fromDate, toDate]);

  const isAllClusters = selectedClusterId === 'all';
  const activeCluster = !isAllClusters
    ? clustersList.find((c) => Number(c.clusterId) === Number(selectedClusterId)) || clustersList[0] || null
    : null;

  const allowedClusterIds = new Set(clustersList.map((c) => Number(c.clusterId)));

  // Filter live orders based on toolbar controls & role scope
  const filteredOrders = rawOrders.filter((o) => {
    if (selectedClusterId !== 'all' && Number(o.clusterId) !== Number(selectedClusterId)) return false;
    if (!isAdmin && allowedClusterIds.size > 0 && !allowedClusterIds.has(Number(o.clusterId))) return false;
    if (selectedAgentId !== 'all' && Number(o.spersonid) !== Number(selectedAgentId)) return false;
    if (isAgent && Number(o.spersonid) !== Number(user?.id)) return false;
    const dStr = (o.date || '').slice(0, 10);
    if (fromDate && dStr < fromDate) return false;
    if (toDate && dStr > toDate) return false;
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
  let totalVisited = 0;
  let totalNotOrdered = 0;
  let deliveryStatusList = [];
  let dailyDeliveryStatusList = [];
  let orderItemStatusList = [];
  let shopsByCategoryMap = new Map();

  if (isAllClusters) {
    clustersList.forEach((c) => {
      const s = c.order_shop_status || c || {};
      totalShops += Number(s.assignedShopsCount ?? s.totalshops ?? c.totalshops ?? 0);
      totalOrdered += Number(s.orderedShopsCount ?? s.totalorderedshops ?? c.totalorderedshops ?? 0);
      totalVisited += Number(s.visitedShopsCount ?? s.totalorderedshops ?? 0);
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
          delivMap.set(item.name, {
            ...item,
            unit: item.unit || 'kg',
            totalcount: 0,
            delivered: 0,
            inprogress: 0,
            inProgressOrders: []
          });
        }
        const entry = delivMap.get(item.name);
        entry.totalcount += Number(item.totalcount || 0);
        entry.delivered += Number(item.delivered || 0);
        entry.inprogress += Number(item.inprogress || 0);
        if (Array.isArray(item.inProgressOrders)) {
          entry.inProgressOrders.push(...item.inProgressOrders);
        }
      });
    });
    deliveryStatusList = Array.from(delivMap.values()).map((it) => ({
      ...it,
      fulfillment: it.totalcount > 0 ? Math.min(100, Math.round((it.delivered / it.totalcount) * 100)) : 0
    }));

    const dayMap = new Map();
    clustersList.forEach((c) => {
      (c.dailyDeliveryStatus || []).forEach((d) => {
        if (!dayMap.has(d.date)) {
          dayMap.set(d.date, {
            date: d.date,
            expectedDeliveryDate: d.expectedDeliveryDate || addDaysToDateStr(d.date, 1),
            totalOrders: 0,
            deliveredCount: 0,
            inProgressCount: 0,
            totalQty: 0,
            deliveredQty: 0,
            inProgressQty: 0,
            inProgressOrders: []
          });
        }
        const cur = dayMap.get(d.date);
        cur.totalOrders += Number(d.totalOrders || 0);
        cur.deliveredCount += Number(d.deliveredCount || 0);
        cur.inProgressCount += Number(d.inProgressCount || 0);
        cur.totalQty = Number((cur.totalQty + Number(d.totalQty || 0)).toFixed(2));
        cur.deliveredQty = Number((cur.deliveredQty + Number(d.deliveredQty || 0)).toFixed(2));
        cur.inProgressQty = Number((cur.inProgressQty + Number(d.inProgressQty || 0)).toFixed(2));
        if (Array.isArray(d.inProgressOrders)) {
          cur.inProgressOrders.push(...d.inProgressOrders);
        }
      });
    });
    dailyDeliveryStatusList = Array.from(dayMap.values()).sort((a, b) => b.date.localeCompare(a.date));

    const orderItemMap = new Map();
    clustersList.forEach((c) => {
      const list = c.order_item_status || [];
      list.forEach((item) => {
        if (!orderItemMap.has(item.name)) {
          orderItemMap.set(item.name, { ...item, unit: item.unit || 'kg', totalcount: 0 });
        }
        orderItemMap.get(item.name).totalcount += Number(item.totalcount || 0);
      });
    });
    orderItemStatusList = Array.from(orderItemMap.values());
  } else {
    const shopStatus = activeCluster?.order_shop_status || activeCluster || {};
    totalShops = shopStatus.assignedShopsCount ?? shopStatus.totalshops ?? activeCluster?.totalshops ?? 0;
    totalOrdered = shopStatus.orderedShopsCount ?? shopStatus.totalorderedshops ?? activeCluster?.totalorderedshops ?? 0;
    totalVisited = shopStatus.visitedShopsCount ?? totalOrdered;
    totalNotOrdered = shopStatus.totalnotorderedshops ?? activeCluster?.totalnotorderedshops ?? Math.max(0, totalShops - totalOrdered);
    deliveryStatusList = activeCluster?.deliverystatus || activeCluster?.delivery_status || [];
    dailyDeliveryStatusList = activeCluster?.dailyDeliveryStatus || [];
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
    const dStr = String(o.date || '').slice(0, 10);
    const expDeliv = o.expectedDeliveryDate || (dStr ? addDaysToDateStr(dStr, 1) : '—');
    const lines = Array.isArray(o.orderList) ? o.orderList : [];
    if (lines.length === 0) {
      detailedOrderLines.push({
        lineKey: `${o.orderId || o.id}-none`,
        orderId: o.orderId || o.id,
        date: dStr || '—',
        expectedDeliveryDate: expDeliv,
        shopName: o.customer || o.shopName || 'Customer Store',
        shopCategory: o.shopCategory || 'Retail',
        itemName: 'General Replenishment',
        qtyKg: 0,
        unit: 'kg',
        unitPrice: 0,
        lineTotal: Number(o.total || 0),
        status: o.status || 'Active'
      });
    } else {
      lines.forEach((it, idx) => {
        const qty = parseFloat(it.qty || 0) || 0;
        if (qty <= 0) return;
        const unitPrice = parseFloat(it.price || it.custprice || it.actprice || 0) || 0;
        const rawUnit = String(it.unitType || it.unit || 'kg');
        const unit = rawUnit.toLowerCase().startsWith('kg') ? 'kg' : rawUnit;
        detailedOrderLines.push({
          lineKey: `${o.orderId || o.id}-${it.itemid || idx}`,
          orderId: o.orderId || o.id,
          date: dStr || '—',
          expectedDeliveryDate: expDeliv,
          shopName: o.customer || o.shopName || 'Customer Store',
          shopCategory: o.shopCategory || 'Retail',
          itemName: it.itemName || it.name || `Item #${it.itemid}`,
          qtyKg: qty,
          unit,
          unitPrice,
          requestedPrice: it.requestedPrice ?? null,
          priceRequestStatus: it.priceRequestStatus || null,
          lineTotal: qty * unitPrice,
          status: o.status || 'Active'
        });
      });
    }
  });

  const fulfillmentRate = totalShops > 0 ? Math.round((totalOrdered / totalShops) * 100) : 0;

  const totalDeliveredUnits = deliveryStatusList.reduce((acc, x) => acc + Number(x.delivered || 0), 0);
  const totalInProgressUnits = deliveryStatusList.reduce((acc, x) => acc + Number(x.inprogress || 0), 0);
  const totalDeliveryUnits = deliveryStatusList.reduce((acc, x) => acc + Number(x.totalcount || 0), 0);

  const totalOrderCommodityUnits = orderItemStatusList.reduce((acc, x) => acc + Number(x.totalcount || 0), 0);

  const tva = reportMeta?.targetVsActual || {
    hasTarget: false,
    targetAmount: 0,
    actualAmount: totalRevenue,
    differenceAmount: totalRevenue,
    achievementPct: 0,
    performanceIndicator: { label: 'No Target Set', code: 'no_target', color: 'neutral' },
    items: []
  };
  const perfScale = reportMeta?.performanceIndicatorScale || DEFAULT_PERF_SCALE;
  const freqCustomers = isAdminOrManager ? reportMeta?.frequentlyOrderedCustomers : null;

  const handleClusterSelect = (e) => {
    const val = e.target.value;
    setSelectedClusterId(val);
    if (val === 'all') {
      setSelectedClusterLabel('All clusters');
    } else {
      const found = clustersList.find((c) => Number(c.clusterId) === Number(val));
      setSelectedClusterLabel(found?.clusterName || 'Selected Cluster');
    }
  };

  return (
    <div className="summary-report-page">
      {/* Page Heading */}
      <div className="page-heading">
        <div>
          <p className="eyebrow">ROUTE OPERATIONS · IST ({todayIST})</p>
          <h1>Summary Report</h1>
          <p>
            Live shop coverage (Assigned, Visited, Ordered), commodity delivery status, expected delivery dates, and Target vs Actual performance for {selectedClusterLabel}.
          </p>
        </div>

        <div className="heading-actions" style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center' }}>
          {/* Period Filter Buttons (Today, Last 7 days, Last 30 days) */}
          <div className="report-period-pills" role="group" aria-label="Report period">
            {[
              { key: 'today', label: 'Today' },
              { key: '7d', label: 'Last 7 days' },
              { key: '30d', label: 'Last 30 days' }
            ].map((p) => (
              <button
                key={p.key}
                type="button"
                className={`report-period-btn ${reportPeriod === p.key ? 'active' : ''}`}
                onClick={() => handleSelectPeriod(p.key)}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Date Range Filter */}
          <div className="cluster-filter-pill" style={{ gap: '6px' }}>
            <span className="cluster-pill-label">From</span>
            <input
              type="date"
              className="cluster-pill-select"
              value={fromDate}
              onChange={(e) => {
                setReportPeriod('custom');
                setFromDate(e.target.value);
              }}
              aria-label="From Date"
            />
            <span className="cluster-pill-label">To</span>
            <input
              type="date"
              className="cluster-pill-select"
              value={toDate}
              onChange={(e) => {
                setReportPeriod('custom');
                setToDate(e.target.value);
              }}
              aria-label="To Date"
            />
            {(fromDate || toDate) && (
              <button
                type="button"
                className="quiet-button"
                style={{ height: '24px', padding: '0 6px', fontSize: '11px' }}
                onClick={() => handleSelectPeriod('30d')}
              >
                Reset
              </button>
            )}
          </div>

          {/* Agent Filter for Admin and Sales Manager */}
          {isAdminOrManager && agentsList.length > 0 && (
            <div className="cluster-filter-pill">
              <span className="cluster-pill-icon">👤</span>
              <label htmlFor="summaryAgentSelect" className="cluster-pill-label">Agent</label>
              <select
                id="summaryAgentSelect"
                className="cluster-pill-select"
                value={selectedAgentId}
                onChange={(e) => setSelectedAgentId(e.target.value)}
              >
                <option value="all">All Field Agents</option>
                {agentsList.map((ag) => (
                  <option key={ag.id} value={String(ag.id)}>
                    {ag.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Hide cluster selector for single-cluster Field Sales Agents; show for multi-cluster or Manager/Admin */}
          {(!isAgent || clustersList.length > 1) ? (
            <div className="cluster-filter-pill">
              <span className="cluster-pill-icon">📍</span>
              <label htmlFor="summaryClusterSelect" className="cluster-pill-label">Cluster</label>
              <select
                id="summaryClusterSelect"
                className="cluster-pill-select"
                value={selectedClusterId}
                onChange={handleClusterSelect}
              >
                <option value="all">All clusters ({clustersList.length})</option>
                {clustersList.map((c) => (
                  <option key={c.clusterId} value={c.clusterId}>
                    {c.clusterName}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            clustersList[0] && (
              <div className="cluster-filter-pill">
                <span className="cluster-pill-icon">📍</span>
                <span className="cluster-pill-label">Assigned Cluster:</span>
                <strong style={{ fontSize: '12.5px', color: '#0f172a' }}>{clustersList[0].clusterName}</strong>
              </div>
            )
          )}

          <button
            className="secondary-button"
            onClick={loadReport}
            disabled={loading}
          >
            {loading ? 'Refreshing...' : '↻ Refresh'}
          </button>
        </div>
      </div>

      {/* Top 4KPI Stat Cards — Explicitly labeled Shop Counts (Assigned, Visited, Ordered) + Active Orders */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-top">
            <span>Assigned Shops (Scope)</span>
            <span className="stat-icon blue">🏪</span>
          </div>
          <div className="stat-value">{totalShops}</div>
          <div className="stat-foot">
            Total shops assigned in {selectedClusterLabel}
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-top">
            <span>Visited Shops</span>
            <span className="stat-icon purple">📍</span>
          </div>
          <div className="stat-value">{totalVisited}</div>
          <div className="stat-foot">
            Assigned shops visited in selected period
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-top">
            <span>Shops with Orders</span>
            <span className="stat-icon green">✓</span>
          </div>
          <div className="stat-value">{totalOrdered}</div>
          <div className="stat-foot">
            <span className="up">{fulfillmentRate}%</span> of assigned shops ({totalNotOrdered} without orders)
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-top">
            <span>Orders (Active / Delivered)</span>
            <span className="stat-icon yellow">📦</span>
          </div>
          <div className="stat-value">{activeOrdersCount} / {deliveredOrdersCount}</div>
          <div className="stat-foot">
            Total value: <b>{money(totalRevenue)}</b> ({filteredOrders.length} orders)
          </div>
        </div>
      </div>

      {/* Tabular Target vs Actual Section */}
      <section className="table-panel" style={{ marginBottom: '20px' }}>
        <div className="table-heading" style={{ flexWrap: 'wrap', gap: '8px' }}>
          <div>
            <h2>Target vs Actual Summary Table</h2>
            <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#64748b' }}>
              Period: {fromDate || '—'} to {toDate || todayIST} (Timezone: Asia/Kolkata)
            </p>
          </div>
          <span className={`perf-indicator-badge ${tva.performanceIndicator?.color || 'neutral'}`}>
            {tva.performanceIndicator?.label || 'No Target Set'}
          </span>
        </div>

        <div className="table-scroll-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Scope / Commodity</th>
                <th>Target</th>
                <th>Actual</th>
                <th>Difference (Actual − Target)</th>
                <th>Achievement %</th>
                <th>Performance Indicator</th>
              </tr>
            </thead>
            <tbody>
              <tr style={{ background: '#f8fafc', fontWeight: 700 }}>
                <td><strong>Overall Sales Total ({selectedClusterLabel})</strong></td>
                <td>{tva.hasTarget ? money(tva.targetAmount) : '₹0 (Not set)'}</td>
                <td><strong>{money(tva.actualAmount ?? totalRevenue)}</strong></td>
                <td style={{ color: (tva.differenceAmount || 0) >= 0 ? '#15803d' : '#b91c1c', fontWeight: 700 }}>
                  {(tva.differenceAmount || 0) >= 0 ? '+' : ''}{money(tva.differenceAmount ?? totalRevenue)}
                </td>
                <td><strong>{tva.hasTarget ? `${tva.achievementPct}%` : '—'}</strong></td>
                <td>
                  <span className={`perf-indicator-badge ${tva.performanceIndicator?.color || 'neutral'}`}>
                    {tva.performanceIndicator?.label || 'No Target Set'}
                  </span>
                </td>
              </tr>
              {(tva.items || []).map((row) => (
                <tr key={row.itemId}>
                  <td><strong>{row.itemName}</strong></td>
                  <td>
                    {row.targetAmount > 0 ? money(row.targetAmount) : '—'}{' '}
                    {row.targetQty > 0 ? `(${row.targetQty} ${row.unit || 'kg'})` : ''}
                  </td>
                  <td>
                    <strong>{money(row.actualAmount)}</strong> ({row.actualQty} {row.unit || 'kg'})
                  </td>
                  <td style={{ color: row.differenceAmount >= 0 ? '#15803d' : '#b91c1c', fontWeight: 600 }}>
                    {row.differenceAmount >= 0 ? '+' : ''}{money(row.differenceAmount)} ({row.differenceQty >= 0 ? '+' : ''}{row.differenceQty} {row.unit || 'kg'})
                  </td>
                  <td><strong>{row.targetAmount > 0 || row.targetQty > 0 ? `${row.achievementPct}%` : '—'}</strong></td>
                  <td>
                    <span className={`perf-indicator-badge ${row.performanceIndicator?.color || 'neutral'}`}>
                      {row.performanceIndicator?.label || 'No Target Set'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Frequently Ordered Customers — STRICTLY for Sales Managers (and Admin) ONLY; never shown to Field Sales Agents */}
      {isAdminOrManager && !isAgent && freqCustomers && (
        <section className="table-panel" style={{ marginBottom: '20px' }}>
          <div className="table-heading" style={{ flexWrap: 'wrap', gap: '8px' }}>
            <div>
              <h2>Frequently Ordered Customers (Sales Manager Insight)</h2>
              <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#64748b' }}>
                Rule: <b>{freqCustomers.rule}</b> · Calculation period: <b>{freqCustomers.calculationPeriod}</b> · Minimum orders required: <b>{freqCustomers.minOrdersRequired}</b>
              </p>
            </div>
            <span className="status delivered">{freqCustomers.count} Qualifying Stores</span>
          </div>

          <div className="table-scroll-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Shop ID</th>
                  <th>Customer Store</th>
                  <th>Shop Category</th>
                  <th>Calculation Period</th>
                  <th>Order Count</th>
                  <th>Order Frequency</th>
                  <th>Total Quantity (kg)</th>
                  <th style={{ textAlign: 'right' }}>Total Order Value</th>
                </tr>
              </thead>
              <tbody>
                {(freqCustomers.customers || []).length > 0 ? (
                  freqCustomers.customers.map((c) => (
                    <tr key={c.shopId}>
                      <td><span className="shop-code-pill">{c.shopShortId}</span></td>
                      <td><strong>{c.shopName}</strong></td>
                      <td><span className="status pending">{c.shopCategory}</span></td>
                      <td>{c.calculationPeriod}</td>
                      <td>
                        <span className="status delivered">{c.orderCount} orders</span>
                      </td>
                      <td><strong>{c.frequencyLabel}</strong></td>
                      <td>{c.totalQtyKg} kg</td>
                      <td style={{ textAlign: 'right' }}><strong>{money(c.totalAmount)}</strong></td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="8">
                      <div className="empty-state" style={{ padding: '24px' }}>
                        No customer stores met the frequency threshold ({freqCustomers.minOrdersRequired}+ orders in {freqCustomers.calculationPeriod}).
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Daily Delivery Status List (Selecting an In Progress count for a previous day opens matching orders & details) */}
      <section className="table-panel" style={{ marginBottom: '20px' }}>
        <div className="table-heading" style={{ flexWrap: 'wrap', gap: '8px' }}>
          <div>
            <h2>Delivery Status by Order Date & Expected Delivery Date</h2>
            <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#64748b' }}>
              Orders placed today have tomorrow as their expected delivery date by default; yesterday’s orders are due today. Select any <b>In Progress</b> count for a previous day or today to inspect the matching orders and item details.
            </p>
          </div>
        </div>

        <div className="table-scroll-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Order Date</th>
                <th>Expected Delivery Date</th>
                <th>Total Orders</th>
                <th>Delivered Orders</th>
                <th>In Progress (Select to view orders)</th>
                <th style={{ textAlign: 'right' }}>Total Qty (kg)</th>
              </tr>
            </thead>
            <tbody>
              {dailyDeliveryStatusList.length > 0 ? (
                dailyDeliveryStatusList.map((day) => {
                  const isToday = day.date === todayIST;
                  const isYesterday = day.date === yestIST;
                  return (
                    <tr key={day.date}>
                      <td>
                        <strong>{formatDateDisplay(day.date)}</strong>
                        {isToday && <span className="shop-code-pill" style={{ marginLeft: '6px' }}>Today</span>}
                        {isYesterday && (
                          <span className="shop-code-pill" style={{ marginLeft: '6px', background: '#fef3c7', color: '#92400e', borderColor: '#fde68a' }}>
                            Yesterday
                          </span>
                        )}
                      </td>
                      <td>
                        <strong style={{ color: '#0369a1' }}>{formatDateDisplay(day.expectedDeliveryDate)}</strong>
                        {day.expectedDeliveryDate === todayIST && (
                          <span style={{ marginLeft: '6px', fontSize: '11px', fontWeight: 700, color: '#0369a1' }}>
                            (Due Today)
                          </span>
                        )}
                      </td>
                      <td>{day.totalOrders}</td>
                      <td>
                        <span className="status delivered">{day.deliveredCount} Delivered ({day.deliveredQty} kg)</span>
                      </td>
                      <td>
                        {day.inProgressCount > 0 ? (
                          <button
                            type="button"
                            className="inprogress-drilldown-btn"
                            onClick={() =>
                              setSelectedInProgressDrilldown({
                                title: `In Progress Orders for Order Date ${formatDateDisplay(day.date)}`,
                                subtitle: `Expected delivery date: ${formatDateDisplay(day.expectedDeliveryDate)} · ${day.inProgressOrders.length} matching order(s)`,
                                orders: day.inProgressOrders || []
                              })
                            }
                          >
                            ⏳ {day.inProgressCount} In Progress ({day.inProgressQty} kg) — Open orders →
                          </button>
                        ) : (
                          <span style={{ color: '#64748b', fontSize: '12px' }}>0 In Progress</span>
                        )}
                      </td>
                      <td style={{ textAlign: 'right' }}><strong>{day.totalQty} kg</strong></td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan="6">
                    <div className="empty-state" style={{ padding: '24px' }}>
                      No daily delivery status records found.
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Drill-down Panel when an In Progress count is selected */}
      {selectedInProgressDrilldown && (
        <section
          className="panel"
          role="region"
          aria-label={selectedInProgressDrilldown.title}
          style={{
            marginBottom: '20px',
            border: '2px solid #f59e0b',
            background: '#fffdf7'
          }}
        >
          <div className="panel-head" style={{ borderBottom: '1px solid #fde68a', paddingBottom: '10px' }}>
            <div>
              <h2 style={{ color: '#92400e' }}>⏳ {selectedInProgressDrilldown.title}</h2>
              <p style={{ color: '#78350f', fontSize: '12px' }}>{selectedInProgressDrilldown.subtitle}</p>
            </div>
            <button
              type="button"
              className="secondary-button"
              onClick={() => setSelectedInProgressDrilldown(null)}
            >
              ✕ Close details
            </button>
          </div>

          <div style={{ display: 'grid', gap: '12px' }}>
            {(selectedInProgressDrilldown.orders || []).map((ord, idx) => (
              <div
                key={ord.orderId || ord.id || idx}
                style={{
                  background: '#ffffff',
                  border: '1px solid #e2e8f0',
                  borderRadius: '10px',
                  padding: '12px 14px'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', marginBottom: '8px' }}>
                  <div>
                    <strong style={{ fontSize: '13.5px', color: '#0f172a' }}>
                      Order #{ord.orderId || ord.id} · {ord.shopName}
                    </strong>
                    {ord.shopId && <span className="shop-code-pill" style={{ marginLeft: '8px' }}>{ord.shopId}</span>}
                    <div style={{ fontSize: '12px', color: '#475569', marginTop: '2px' }}>
                      Order Date: <b>{formatDateDisplay(ord.date)}</b> · Expected Delivery: <b style={{ color: '#0369a1' }}>{formatDateDisplay(ord.expectedDeliveryDate)}</b>
                      {ord.agentName && ` · Agent: ${ord.agentName}`}
                      {ord.locationText && ` · 📍 ${ord.locationText}`}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span className="status in-progress">{ord.status || 'In progress'}</span>
                    <div style={{ fontWeight: 700, fontSize: '14px', color: '#0f172a', marginTop: '4px' }}>
                      {money(ord.total)}
                    </div>
                  </div>
                </div>

                <div className="table-scroll-container">
                  <table className="history-items-table">
                    <thead>
                      <tr>
                        <th>Item Description</th>
                        <th>Ordered Quantity</th>
                        <th>Catalog Price</th>
                        <th style={{ textAlign: 'right' }}>Line Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(ord.orderList || []).map((it, i) => {
                        const unit = it.unit || 'kg';
                        const lineTot = Number(it.qty || 0) * Number(it.price || 0);
                        return (
                          <tr key={i}>
                            <td><b>{it.itemName}</b></td>
                            <td><span className="qty-highlight">{it.qty} {unit}</span></td>
                            <td>
                              {money(it.price)}/{unit}
                              {it.requestedPrice !== null && it.requestedPrice !== undefined && (
                                <span style={{ display: 'block', fontSize: '11px', color: '#92400e' }}>
                                  Requested: {money(it.requestedPrice)}/{unit} ({it.priceRequestStatus || 'pending'})
                                </span>
                              )}
                            </td>
                            <td style={{ textAlign: 'right' }}><b>{money(lineTot)}</b></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Shops & Orders by Shop Type (Category Breakdown) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '20px', marginBottom: '20px' }}>
        <section className="table-panel">
          <div className="table-heading">
            <div>
              <h2>Assigned Shops by Category</h2>
              <small style={{ color: '#7b8a92', fontSize: '12px' }}>
                Store distribution across {selectedClusterLabel}
              </small>
            </div>
            <span className="status delivered">{totalShops} Assigned Shops</span>
          </div>

          <div className="table-scroll-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Shop Category / Type</th>
                  <th style={{ textAlign: 'right' }}>Assigned Shops</th>
                  <th style={{ textAlign: 'right' }}>Share</th>
                </tr>
              </thead>
              <tbody>
                {shopsByCategoryList.length > 0 ? (
                  shopsByCategoryList.map((row) => {
                    const share = totalShops > 0 ? Math.round((row.count / totalShops) * 100) : 0;
                    return (
                      <tr key={row.category}>
                        <td><strong>{row.category}</strong></td>
                        <td style={{ textAlign: 'right' }}><strong>{row.count}</strong></td>
                        <td style={{ textAlign: 'right' }}>
                          <span className="status in-progress">{share}%</span>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan="3">
                      <div className="empty-state" style={{ padding: '24px' }}>
                        No shop categories available.
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="table-panel">
          <div className="table-heading">
            <div>
              <h2>Orders by Shop Category</h2>
              <small style={{ color: '#7b8a92', fontSize: '12px' }}>
                Order volume and total weight (kg) by customer type
              </small>
            </div>
            <span className="status in-progress">{filteredOrders.length} Orders</span>
          </div>

          <div className="table-scroll-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Shop Type</th>
                  <th style={{ textAlign: 'right' }}>Orders</th>
                  <th style={{ textAlign: 'right' }}>Total Qty (kg)</th>
                  <th style={{ textAlign: 'right' }}>Order Value</th>
                </tr>
              </thead>
              <tbody>
                {ordersByCategoryList.length > 0 ? (
                  ordersByCategoryList.map((row) => (
                    <tr key={row.category}>
                      <td><strong>{row.category}</strong></td>
                      <td style={{ textAlign: 'right' }}>{row.orderCount}</td>
                      <td style={{ textAlign: 'right' }}><strong>{row.totalQtyKg} kg</strong></td>
                      <td style={{ textAlign: 'right' }}><strong>{money(row.totalAmount)}</strong></td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="4">
                      <div className="empty-state" style={{ padding: '24px' }}>
                        No orders placed in the selected period.
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {/* Main Two-Column Tables: Delivery Status & Order Status by Commodity */}
      <div className="summary-tables-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: '20px', marginBottom: '20px' }}>
        {/* Delivery Status Table */}
        <section className="table-panel">
          <div className="table-heading">
            <div>
              <h2>Commodity Delivery Status</h2>
              <small style={{ color: '#7b8a92', fontSize: '12px' }}>
                Select any In Progress count to view matching orders
              </small>
            </div>
            <span className="status delivered">{totalDeliveredUnits} / {totalDeliveryUnits} kg</span>
          </div>

          <div className="table-scroll-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Items</th>
                  <th style={{ textAlign: 'right' }}>Total (kg)</th>
                  <th style={{ textAlign: 'right' }}>Delivered (kg)</th>
                  <th style={{ textAlign: 'right' }}>In Progress (kg)</th>
                  <th style={{ textAlign: 'right' }}>Progress</th>
                </tr>
              </thead>
              <tbody>
                {deliveryStatusList.length > 0 ? (
                  deliveryStatusList.map((item, idx) => {
                    const total = Number(item.totalcount || 0);
                    const deliv = Number(item.delivered || 0);
                    const inprog = Number(item.inprogress || 0);
                    const unit = item.unit || 'kg';
                    const pct = total > 0 ? Math.min(100, Math.round((deliv / total) * 100)) : 0;

                    return (
                      <tr key={item.id || idx}>
                        <td>
                          <strong>{item.name}</strong>
                        </td>
                        <td style={{ textAlign: 'right' }}><strong>{total} {unit}</strong></td>
                        <td style={{ textAlign: 'right', color: '#29996d', fontWeight: 600 }}>{deliv} {unit}</td>
                        <td style={{ textAlign: 'right' }}>
                          {inprog > 0 ? (
                            <button
                              type="button"
                              className="inprogress-drilldown-btn"
                              onClick={() =>
                                setSelectedInProgressDrilldown({
                                  title: `In Progress Orders for ${item.name}`,
                                  subtitle: `${inprog} ${unit} in progress across ${(item.inProgressOrders || []).length} order(s)`,
                                  orders: item.inProgressOrders || []
                                })
                              }
                            >
                              ⏳ {inprog} {unit}
                            </button>
                          ) : (
                            <span style={{ color: '#64748b' }}>0 {unit}</span>
                          )}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <span className={`status ${pct >= 75 ? 'delivered' : 'in-progress'}`}>
                            {pct}%
                          </span>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan="5">
                      <div className="empty-state">No commodity delivery status records found.</div>
                    </td>
                  </tr>
                )}
              </tbody>
              {deliveryStatusList.length > 0 && (
                <tfoot>
                  <tr style={{ background: '#f8fafb', fontWeight: 700 }}>
                    <td style={{ padding: '12px 17px' }}>Total Volume</td>
                    <td style={{ padding: '12px 17px', textAlign: 'right' }}>{totalDeliveryUnits} kg</td>
                    <td style={{ padding: '12px 17px', textAlign: 'right', color: '#29996d' }}>{totalDeliveredUnits} kg</td>
                    <td style={{ padding: '12px 17px', textAlign: 'right', color: '#df9c2f' }}>{totalInProgressUnits} kg</td>
                    <td style={{ padding: '12px 17px', textAlign: 'right' }}>
                      {totalDeliveryUnits > 0 ? Math.round((totalDeliveredUnits / totalDeliveryUnits) * 100) : 0}%
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </section>

        {/* Order Status Table */}
        <section className="table-panel">
          <div className="table-heading">
            <div>
              <h2>Order Summary by Item</h2>
              <small style={{ color: '#7b8a92', fontSize: '12px' }}>
                Saved order quantities per commodity (in kg)
              </small>
            </div>
            <span className="status in-progress">{totalOrderCommodityUnits} kg Ordered</span>
          </div>

          <div className="table-scroll-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Item Description</th>
                  <th style={{ textAlign: 'right' }}>Ordered Quantity (kg)</th>
                  <th style={{ textAlign: 'right' }}>Volume Share</th>
                  <th style={{ textAlign: 'right' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {orderItemStatusList.length > 0 ? (
                  orderItemStatusList.map((item, idx) => {
                    const count = Number(item.totalcount || 0);
                    const unit = item.unit || 'kg';
                    const share = totalOrderCommodityUnits > 0
                      ? Math.round((count / totalOrderCommodityUnits) * 100)
                      : 0;
                    const itemSt = String(item.status || 'Active').toLowerCase();
                    const badgeClass = itemSt === 'delivered' ? 'delivered' : itemSt.includes('pending') ? 'pending' : 'in-progress';
                    return (
                      <tr key={item.id || idx}>
                        <td>
                          <strong>{item.name}</strong>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <strong>{count} {unit}</strong>
                        </td>
                        <td style={{ textAlign: 'right' }}>{share}%</td>
                        <td style={{ textAlign: 'right' }}>
                          <span className={`status ${badgeClass}`}>{item.status || 'Active'}</span>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan="4">
                      <div className="empty-state">No order commodity records found.</div>
                    </td>
                  </tr>
                )}
              </tbody>
              {orderItemStatusList.length > 0 && (
                <tfoot>
                  <tr style={{ background: '#f8fafb', fontWeight: 700 }}>
                    <td style={{ padding: '12px 17px' }}>Total Ordered Weight</td>
                    <td style={{ padding: '12px 17px', textAlign: 'right' }}>{totalOrderCommodityUnits} kg</td>
                    <td style={{ padding: '12px 17px', textAlign: 'right' }}>100%</td>
                    <td style={{ padding: '12px 17px', textAlign: 'right' }}>—</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </section>
      </div>

      {/* Detailed Order Breakdown by Shop, Item, Expected Delivery Date & Quantity (kg) */}
      <section className="table-panel" style={{ marginBottom: '20px' }}>
        <div className="table-heading">
          <div>
            <h2>Detailed Saved Order Lines (Shop, Item Description, Quantity in kg & Expected Delivery)</h2>
            <small style={{ color: '#7b8a92', fontSize: '12px' }}>
              Complete line-by-line breakdown of saved customer orders
            </small>
          </div>
          <span className="status delivered">{detailedOrderLines.length} Line Items</span>
        </div>

        <div className="table-scroll-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Order ID</th>
                <th>Order Date</th>
                <th>Expected Delivery</th>
                <th>Shop Name</th>
                <th>Shop Type</th>
                <th>Item Description</th>
                <th style={{ textAlign: 'right' }}>Quantity (kg)</th>
                <th style={{ textAlign: 'right' }}>Catalog Price</th>
                <th style={{ textAlign: 'right' }}>Line Total</th>
                <th style={{ textAlign: 'right' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {detailedOrderLines.length > 0 ? (
                detailedOrderLines.map((line) => {
                  const st = String(line.status || '').toLowerCase();
                  const badgeClass = st === 'delivered' ? 'delivered' : st === 'cancelled' ? 'cancelled' : 'in-progress';
                  return (
                    <tr key={line.lineKey}>
                      <td><strong className="order-id-tag">{line.orderId}</strong></td>
                      <td>{formatDateDisplay(line.date)}</td>
                      <td><strong style={{ color: '#0369a1' }}>{formatDateDisplay(line.expectedDeliveryDate)}</strong></td>
                      <td><strong>{line.shopName}</strong></td>
                      <td>{line.shopCategory}</td>
                      <td><strong>{line.itemName}</strong></td>
                      <td style={{ textAlign: 'right' }}><strong>{line.qtyKg} {line.unit || 'kg'}</strong></td>
                      <td style={{ textAlign: 'right' }}>
                        {money(line.unitPrice)}/{line.unit || 'kg'}
                        {line.requestedPrice !== null && line.requestedPrice !== undefined && (
                          <small style={{ display: 'block', color: '#92400e', fontSize: '10.5px' }}>
                            Req: {money(line.requestedPrice)} ({line.priceRequestStatus || 'pending'})
                          </small>
                        )}
                      </td>
                      <td style={{ textAlign: 'right' }}><strong>{money(line.lineTotal)}</strong></td>
                      <td style={{ textAlign: 'right' }}>
                        <span className={`status ${badgeClass}`}>{line.status}</span>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan="10">
                    <div className="empty-state">No order line items match the selected filter criteria.</div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Bottom Performance Indicator Table (Placed at the bottom of the report page) */}
      <section className="table-panel" style={{ marginTop: '24px' }}>
        <div className="table-heading">
          <div>
            <h2>Performance Indicator Reference Table</h2>
            <small style={{ color: '#7b8a92', fontSize: '12px' }}>
              Achievement percentage thresholds used across LineCart Target vs Actual reports
            </small>
          </div>
        </div>
        <div className="table-scroll-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Performance Indicator</th>
                <th>Achievement % Range</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              {perfScale.map((row) => (
                <tr key={row.band}>
                  <td>
                    <span className={`perf-indicator-badge ${row.color}`}>
                      {row.band}
                    </span>
                  </td>
                  <td><strong>{row.range}</strong></td>
                  <td>{row.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
