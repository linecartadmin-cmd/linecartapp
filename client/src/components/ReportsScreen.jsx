import React, { useState, useEffect } from 'react';
import { api } from '../api';
import { formatShopId, getPaymentSummary } from '../utils';

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

function computePerfIndicator(pct, hasTarget = true) {
  if (!hasTarget) return { label: 'No Target Set', code: 'no_target', color: 'neutral' };
  const n = Number(pct || 0);
  if (n >= 100) return { label: 'Exceeded (≥100%)', code: 'exceeded', color: 'green' };
  if (n >= 80) return { label: 'On Track (80–99%)', code: 'on_track', color: 'blue' };
  if (n >= 50) return { label: 'Needs Attention (50–79%)', code: 'needs_attention', color: 'amber' };
  return { label: 'Critical (<50%)', code: 'critical', color: 'red' };
}

export default function ReportsScreen({
  user,
  clusters = [],
  shops = [],
  orders = [],
  onNavigate,
  showToast
}) {
  const [reportPeriod, setReportPeriod] = useState('7d'); // 'today' | '7d' | '30d'
  const [statusFilter, setStatusFilter] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');

  // Field Sales Agent sees only assigned clusters
  const assignedClusters = clusters.filter((c) =>
    shops.some((s) => Number(s.clusterid || s.clusterId) === Number(c.clusterId))
  );
  const effectiveClusters = assignedClusters.length > 0 ? assignedClusters : clusters;
  const hasSingleCluster = effectiveClusters.length <= 1;
  const defaultClusterFilter = hasSingleCluster && effectiveClusters[0]
    ? String(effectiveClusters[0].clusterId)
    : 'all';

  const [selectedClusterFilter, setSelectedClusterFilter] = useState(defaultClusterFilter);
  const [serverReport, setServerReport] = useState(null);
  const [loadingReport, setLoadingReport] = useState(false);
  const [selectedDayDrilldown, setSelectedDayDrilldown] = useState(null); // { date, expectedDeliveryDate, orders }
  const [selectedOrderDetail, setSelectedOrderDetail] = useState(null);

  useEffect(() => {
    if (hasSingleCluster && effectiveClusters[0] && selectedClusterFilter !== String(effectiveClusters[0].clusterId)) {
      setSelectedClusterFilter(String(effectiveClusters[0].clusterId));
    }
  }, [hasSingleCluster, effectiveClusters, selectedClusterFilter]);

  useEffect(() => {
    let mounted = true;
    const spersonId = user?.id || localStorage.getItem('LineCartPref_userid') || 6;
    setLoadingReport(true);
    api.getHomeReport({
      spersonId,
      clusterId: selectedClusterFilter,
      period: reportPeriod
    })
      .then((res) => {
        if (mounted && res && res.status === 200 && res.result) {
          setServerReport(res.result);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (mounted) setLoadingReport(false);
      });
    return () => {
      mounted = false;
    };
  }, [user?.id, selectedClusterFilter, reportPeriod, orders.length]);

  const money = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');
  const dateLabel = (val) => {
    if (!val) return '—';
    const dStr = String(val).slice(0, 10);
    const d = new Date(`${dStr}T00:00:00`);
    return isNaN(d.getTime())
      ? val
      : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  };
  const initials = (name) =>
    (name || 'Shop')
      .split(/\s+/)
      .slice(0, 2)
      .map((x) => x[0])
      .join('')
      .toUpperCase();

  // Compute local timezone (Asia/Kolkata) date window for Today, Last 7 days, Last 30 days
  const todayIST = getIstDateStr();
  const yestIST = addDaysToDateStr(todayIST, -1);
  const periodDays = reportPeriod === 'today' ? 1 : reportPeriod === '7d' ? 7 : 30;
  const fromDateIST = addDaysToDateStr(todayIST, -(periodDays - 1));
  const periodLabel = reportPeriod === 'today' ? 'Today' : reportPeriod === '7d' ? 'Last 7 days' : 'Last 30 days';

  // Scoped shops for this agent & cluster
  const scopedShops = selectedClusterFilter === 'all'
    ? shops
    : shops.filter((s) => Number(s.clusterid || s.clusterId) === Number(selectedClusterFilter));

  const allowedClusterIds = new Set(effectiveClusters.map((c) => Number(c.clusterId)));

  // Filter orders by assigned cluster scope (all dates first, for previous-day In Progress drilldown)
  const clusterScopedOrdersAllDates = orders.filter((o) => {
    const cid = Number(o.clusterId || o.clusterid || 0);
    if (cid > 0 && allowedClusterIds.size > 0 && !allowedClusterIds.has(cid)) return false;
    if (selectedClusterFilter !== 'all' && cid > 0 && cid !== Number(selectedClusterFilter)) return false;
    return true;
  });

  // Filter orders by selected period (Today, Last 7 days, Last 30 days in Asia/Kolkata)
  const clusterFilteredOrders = clusterScopedOrdersAllDates.filter((o) => {
    const dStr = String(o.date || o.orderDate || '').slice(0, 10);
    if (!dStr) return true;
    return dStr >= fromDateIST && dStr <= todayIST;
  });

  const deliveredCount = clusterFilteredOrders.filter((o) => (o.status || '').toLowerCase() === 'delivered').length;
  const inProgressCount = clusterFilteredOrders.filter((o) => {
    const st = (o.status || '').toLowerCase();
    return st === 'in progress' || st === 'price approval pending' || st === 'pending';
  }).length;
  const pendingApprovalCount = clusterFilteredOrders.filter((o) => (o.status || '').toLowerCase() === 'price approval pending').length;
  const totalValue = clusterFilteredOrders.reduce((sum, o) => sum + Number(o.total || 0), 0);

  // Shop counts with explicit definitions (Assigned Shops, Visited Shops, Shops with Orders)
  const orderedShopIds = new Set(
    clusterFilteredOrders
      .filter((o) => (o.status || '').toLowerCase() !== 'cancelled')
      .map((o) => String(o.shopid || o.customerId || o.shopId || o.customer || ''))
      .filter(Boolean)
  );
  const assignedShopsCount = serverReport?.shopCounts?.assignedShopsCount ?? scopedShops.length;
  const orderedShopsCount = serverReport?.shopCounts?.orderedShopsCount ?? orderedShopIds.size;
  const visitedShopsCount = serverReport?.shopCounts?.visitedShopsCount ?? orderedShopIds.size;

  const shownOrders = clusterFilteredOrders.filter((o) => {
    const st = (o.status || 'In progress').toLowerCase();
    if (statusFilter === 'Delivered' && st !== 'delivered') return false;
    if (statusFilter === 'In progress' && st !== 'in progress' && st !== 'price approval pending') return false;
    if (statusFilter === 'Pending approval' && st !== 'price approval pending') return false;
    if (searchQuery && !(`${o.id} ${o.customer || o.shopName}`).toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  // Daily delivery status list (including previous days) so selecting an In Progress count for a previous day opens matching orders
  const dailyDeliveryStatus = (() => {
    const serverDays = serverReport?.clusterList?.flatMap((c) => c.dailyDeliveryStatus || []) || [];
    if (serverDays.length > 0 && selectedClusterFilter !== 'all') {
      return serverDays;
    }
    const byDate = new Map();
    for (const o of clusterScopedOrdersAllDates) {
      const st = String(o.status || '').toLowerCase();
      if (st === 'cancelled') continue;
      const dStr = String(o.date || o.orderDate || '').slice(0, 10);
      if (!dStr) continue;
      const expDeliv = o.expectedDeliveryDate || addDaysToDateStr(dStr, 1);
      if (!byDate.has(dStr)) {
        byDate.set(dStr, {
          date: dStr,
          expectedDeliveryDate: expDeliv,
          totalOrders: 0,
          deliveredCount: 0,
          inProgressCount: 0,
          inProgressOrders: []
        });
      }
      const entry = byDate.get(dStr);
      entry.totalOrders += 1;
      const lines = Array.isArray(o.orderList || o.itemsList) ? (o.orderList || o.itemsList) : [];
      if (st === 'delivered') {
        entry.deliveredCount += 1;
      } else {
        entry.inProgressCount += 1;
        entry.inProgressOrders.push({
          orderId: o.orderId || o.id,
          id: o.id || o.orderId,
          shopName: o.shopName || o.customer || 'Shop',
          shopId: o.shopId || formatShopId(o.shopid || o.customerId),
          date: dStr,
          expectedDeliveryDate: expDeliv,
          status: o.status || 'In progress',
          total: Number(o.total || 0),
          locationText: o.locationText || null,
          visitPhotoStatus: o.visitPhotoStatus || null,
          orderList: lines.map((l) => ({
            itemName: l.itemName || l.name || `Item #${l.itemid || l.itemId}`,
            qty: Number(l.qty || 0),
            unit: String(l.unitType || l.unit || 'kg').toLowerCase().startsWith('kg') ? 'kg' : String(l.unitType || l.unit || 'kg'),
            price: Number(l.price || l.custprice || 0),
            requestedPrice: l.requestedPrice ?? null,
            priceRequestStatus: l.priceRequestStatus || null
          }))
        });
      }
    }
    return Array.from(byDate.values()).sort((a, b) => b.date.localeCompare(a.date));
  })();

  // Target vs Actual data
  const tva = serverReport?.targetVsActual || {
    hasTarget: false,
    targetAmount: 0,
    actualAmount: totalValue,
    differenceAmount: totalValue,
    achievementPct: 0,
    performanceIndicator: computePerfIndicator(0, false),
    items: []
  };
  const perfScale = serverReport?.performanceIndicatorScale || DEFAULT_PERF_SCALE;

  // Compute real ordered commodities from saved orders (never hardcoded demo items)
  const orderedCommodities = (() => {
    const map = new Map();
    for (const o of clusterFilteredOrders) {
      const lines = Array.isArray(o.orderList || o.itemsList) ? (o.orderList || o.itemsList) : [];
      for (const l of lines) {
        const qty = parseFloat(l.qty) || 0;
        if (qty <= 0) continue;
        const name = l.itemName || l.name || `Item #${l.itemid || l.itemId}`;
        const unit = String(l.unitType || l.unit || 'kg').toLowerCase().startsWith('kg') ? 'kg' : String(l.unitType || l.unit || 'kg');
        const prev = map.get(name) || { name, qty: 0, unit };
        prev.qty += qty;
        map.set(name, prev);
      }
    }
    if (map.size === 0 && serverReport?.clusterList) {
      for (const c of serverReport.clusterList) {
        for (const ds of c.deliverystatus || []) {
          const prev = map.get(ds.name) || { name: ds.name, qty: 0, unit: ds.unit || 'kg' };
          prev.qty += Number(ds.totalcount || 0);
          map.set(ds.name, prev);
        }
      }
    }
    const arr = Array.from(map.values()).sort((a, b) => b.qty - a.qty);
    const maxQ = arr.length > 0 ? Math.max(...arr.map((x) => x.qty), 1) : 1;
    return arr.map((x, idx) => ({
      ...x,
      pct: Math.min(100, Math.max(10, Math.round((x.qty / maxQ) * 100))),
      color: idx % 3 === 1 ? 'green' : idx % 3 === 2 ? 'yellow' : ''
    }));
  })();

  const handleExportCSV = () => {
    const headers = [
      'Order ID',
      'Customer',
      'Order Date',
      'Expected Delivery Date',
      'Items',
      'Total',
      'Delivery Status',
      'Payment Status',
      'Amount Collected',
      'Balance Remaining',
      'Payment Summary'
    ];
    const rows = clusterFilteredOrders.map((o) => {
      const pay = getPaymentSummary(o);
      const dStr = String(o.date || o.orderDate || '').slice(0, 10);
      const expDeliv = o.expectedDeliveryDate || addDaysToDateStr(dStr, 1);
      return [
        o.id,
        o.customer || o.shopName,
        dStr,
        expDeliv,
        o.itemsCount || o.items || 1,
        o.total,
        pay.deliveryStatus,
        pay.paymentStatus,
        pay.collected,
        pay.balance,
        pay.summaryText
      ];
    });
    const csvContent = [headers, ...rows]
      .map((r) => r.map((c) => `"${String(c || '').replace(/"/g, '""')}"`).join(','))
      .join('\r\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `linecart-orders-report-${todayIST}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    showToast('Orders report downloaded successfully.');
  };

  return (
    <div className="reports-page">
      {/* Page Heading */}
      <div className="page-heading reports-heading">
        <div>
          <p className="eyebrow">FIELD SALES INSIGHTS · IST ({todayIST})</p>
          <h1>Reports</h1>
          <p>
            Wholesale order fulfillment, shop coverage, expected delivery dates, and Target vs Actual performance ({periodLabel}: {fromDateIST} to {todayIST}).
          </p>
        </div>
        <button className="secondary-button" onClick={handleExportCSV}>
          ↧ &nbsp;Download report
        </button>
      </div>

      {/* Period Selector (Today, Last 7 days, Last 30 days) + Assigned Cluster Filter */}
      <div className="reports-toolbar" style={{ flexWrap: 'wrap', gap: '12px' }}>
        <div className="reports-filter-group">
          <span className="reports-filter-label">REPORT PERIOD (IST)</span>
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
                onClick={() => setReportPeriod(p.key)}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Show cluster selector only if agent has more than 1 assigned cluster; otherwise show assigned cluster badge */}
        {effectiveClusters.length > 1 ? (
          <div className="reports-filter-group">
            <label htmlFor="reportClusterSelect" className="reports-filter-label">ASSIGNED CLUSTER</label>
            <select
              id="reportClusterSelect"
              className="select reports-cluster-select"
              value={selectedClusterFilter}
              onChange={(e) => setSelectedClusterFilter(e.target.value)}
            >
              <option value="all">All assigned clusters ({effectiveClusters.length})</option>
              {effectiveClusters.map((c) => (
                <option key={c.clusterId} value={String(c.clusterId)}>
                  {c.clusterName}
                </option>
              ))}
            </select>
          </div>
        ) : (
          effectiveClusters[0] && (
            <div className="reports-filter-group">
              <span className="reports-filter-label">ASSIGNED CLUSTER</span>
              <span className="cluster-filter-pill" style={{ height: '38px', fontWeight: 700, fontSize: '12.5px' }}>
                📍 {effectiveClusters[0].clusterName}
              </span>
            </div>
          )
        )}

        <div className="reports-search-wrap">
          <input
            className="search-input reports-search-input"
            placeholder="Search order ID or store..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="reports-tabs-wrap">
          <div className="tabs reports-tabs">
            {['All', 'Delivered', 'In progress', 'Pending approval'].map((st) => (
              <button
                key={st}
                type="button"
                className={`tab ${statusFilter === st ? 'selected' : ''}`}
                onClick={() => setStatusFilter(st)}
              >
                {st}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Explicit Shop Coverage & Order KPIs */}
      <div className="stats-grid" style={{ marginBottom: '20px' }}>
        <div className="stat-card">
          <div className="stat-top">
            <span>Assigned Shops (Route Scope)</span>
            <span className="stat-icon blue">🏪</span>
          </div>
          <div className="stat-value">{assignedShopsCount}</div>
          <div className="stat-foot">Total customer shops assigned to you</div>
        </div>

        <div className="stat-card">
          <div className="stat-top">
            <span>Visited Shops ({periodLabel})</span>
            <span className="stat-icon purple">📍</span>
          </div>
          <div className="stat-value">{visitedShopsCount}</div>
          <div className="stat-foot">Assigned shops visited in {periodLabel.toLowerCase()}</div>
        </div>

        <div className="stat-card">
          <div className="stat-top">
            <span>Shops with Orders ({periodLabel})</span>
            <span className="stat-icon green">✓</span>
          </div>
          <div className="stat-value">{orderedShopsCount}</div>
          <div className="stat-foot">
            {Math.max(0, assignedShopsCount - orderedShopsCount)} assigned shops without orders
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-top">
            <span>Order Value ({periodLabel})</span>
            <span className="stat-icon yellow">₹</span>
          </div>
          <div className="stat-value">{money(totalValue)}</div>
          <div className="stat-foot">
            {clusterFilteredOrders.length} orders · {deliveredCount} delivered · {inProgressCount} in progress
          </div>
        </div>
      </div>

      {/* Tabular Target vs Actual Section */}
      <section className="table-panel" style={{ marginBottom: '20px' }}>
        <div className="table-heading" style={{ flexWrap: 'wrap', gap: '8px' }}>
          <div>
            <h2>Target vs Actual ({periodLabel})</h2>
            <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#64748b' }}>
              Tabular comparison of sales target, actual achieved sales, difference, achievement %, and performance indicator.
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
                <td>
                  <strong>Overall Route Sales ({periodLabel})</strong>
                </td>
                <td>{tva.hasTarget ? money(tva.targetAmount) : '₹0 (Not set)'}</td>
                <td><strong>{money(tva.actualAmount ?? totalValue)}</strong></td>
                <td style={{ color: (tva.differenceAmount || 0) >= 0 ? '#15803d' : '#b91c1c', fontWeight: 700 }}>
                  {(tva.differenceAmount || 0) >= 0 ? '+' : ''}
                  {money(tva.differenceAmount ?? totalValue)}
                </td>
                <td>
                  <strong>{tva.hasTarget ? `${tva.achievementPct}%` : '—'}</strong>
                </td>
                <td>
                  <span className={`perf-indicator-badge ${tva.performanceIndicator?.color || 'neutral'}`}>
                    {tva.performanceIndicator?.label || 'No Target Set'}
                  </span>
                </td>
              </tr>

              {(tva.items || []).map((row) => (
                <tr key={row.itemId}>
                  <td>
                    <strong>{row.itemName}</strong>
                  </td>
                  <td>
                    {row.targetAmount > 0 ? money(row.targetAmount) : '—'}{' '}
                    {row.targetQty > 0 ? `(${row.targetQty} ${row.unit || 'kg'})` : ''}
                  </td>
                  <td>
                    <strong>{money(row.actualAmount)}</strong> ({row.actualQty} {row.unit || 'kg'})
                  </td>
                  <td style={{ color: row.differenceAmount >= 0 ? '#15803d' : '#b91c1c', fontWeight: 600 }}>
                    {row.differenceAmount >= 0 ? '+' : ''}
                    {money(row.differenceAmount)} ({row.differenceQty >= 0 ? '+' : ''}{row.differenceQty} {row.unit || 'kg'})
                  </td>
                  <td>
                    <strong>{row.targetAmount > 0 || row.targetQty > 0 ? `${row.achievementPct}%` : '—'}</strong>
                  </td>
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

      {/* Delivery Status by Day (Selecting an In Progress count for a previous day opens matching orders & details) */}
      <section className="table-panel" style={{ marginBottom: '20px' }}>
        <div className="table-heading" style={{ flexWrap: 'wrap', gap: '8px' }}>
          <div>
            <h2>Delivery Status by Order Date & Expected Delivery Date</h2>
            <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#64748b' }}>
              Orders placed today default to tomorrow as their expected delivery date; yesterday’s orders are due today. Select any <b>In Progress</b> count (including previous days) to view the matching orders and item details.
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
                <th>Delivered</th>
                <th>In Progress (Click to inspect)</th>
              </tr>
            </thead>
            <tbody>
              {dailyDeliveryStatus.length > 0 ? (
                dailyDeliveryStatus.map((day) => {
                  const isYesterday = day.date === yestIST;
                  const isToday = day.date === todayIST;
                  return (
                    <tr key={day.date}>
                      <td>
                        <strong>{dateLabel(day.date)}</strong>
                        {isToday && (
                          <span className="shop-code-pill" style={{ marginLeft: '6px' }}>Today</span>
                        )}
                        {isYesterday && (
                          <span className="shop-code-pill" style={{ marginLeft: '6px', background: '#fef3c7', color: '#92400e', borderColor: '#fde68a' }}>
                            Yesterday
                          </span>
                        )}
                      </td>
                      <td>
                        <strong style={{ color: '#0369a1' }}>{dateLabel(day.expectedDeliveryDate)}</strong>
                        {day.expectedDeliveryDate === todayIST && (
                          <span style={{ marginLeft: '6px', fontSize: '11px', fontWeight: 700, color: '#0369a1' }}>
                            (Due Today)
                          </span>
                        )}
                      </td>
                      <td>{day.totalOrders}</td>
                      <td>
                        <span className="status delivered">{day.deliveredCount} Delivered</span>
                      </td>
                      <td>
                        {day.inProgressCount > 0 ? (
                          <button
                            type="button"
                            className="inprogress-drilldown-btn"
                            onClick={() =>
                              setSelectedDayDrilldown({
                                date: day.date,
                                expectedDeliveryDate: day.expectedDeliveryDate,
                                orders: day.inProgressOrders || []
                              })
                            }
                            title={`View ${day.inProgressCount} In Progress orders for ${day.date}`}
                          >
                            ⏳ {day.inProgressCount} In Progress — View orders →
                          </button>
                        ) : (
                          <span style={{ color: '#64748b', fontSize: '12px' }}>0 In Progress</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan="5">
                    <div className="empty-state">No delivery records found for your assigned cluster scope.</div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Drill-down Modal/Panel for Previous-Day (or Selected-Day) In Progress Orders */}
      {selectedDayDrilldown && (
        <section
          className="panel"
          role="region"
          aria-label={`In Progress orders for ${selectedDayDrilldown.date}`}
          style={{
            marginBottom: '20px',
            border: '2px solid #f59e0b',
            background: '#fffdf7'
          }}
        >
          <div className="panel-head" style={{ borderBottom: '1px solid #fde68a', paddingBottom: '10px' }}>
            <div>
              <h2 style={{ color: '#92400e' }}>
                ⏳ In Progress Orders for {dateLabel(selectedDayDrilldown.date)} ({selectedDayDrilldown.orders.length})
              </h2>
              <p style={{ color: '#78350f', fontSize: '12px' }}>
                Expected delivery date: <b>{dateLabel(selectedDayDrilldown.expectedDeliveryDate)}</b> · Showing full order & line-item details.
              </p>
            </div>
            <button
              type="button"
              className="secondary-button"
              onClick={() => setSelectedDayDrilldown(null)}
            >
              ✕ Close details
            </button>
          </div>

          <div style={{ display: 'grid', gap: '12px' }}>
            {selectedDayDrilldown.orders.map((ord) => (
              <div
                key={ord.orderId || ord.id}
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
                      Order Date: <b>{dateLabel(ord.date)}</b> · Expected Delivery: <b style={{ color: '#0369a1' }}>{dateLabel(ord.expectedDeliveryDate)}</b>
                      {ord.locationText && ` · 📍 ${ord.locationText}`}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span className="status in-progress">{ord.status}</span>
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
                      {(ord.orderList || []).map((it, idx) => {
                        const unit = it.unit || 'kg';
                        const lineTot = Number(it.qty || 0) * Number(it.price || 0);
                        return (
                          <tr key={idx}>
                            <td><b>{it.itemName}</b></td>
                            <td>
                              <span className="qty-highlight">
                                {it.qty} {unit}
                              </span>
                            </td>
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

      {/* Main Reports Layout */}
      <div className="report-layout" style={{ marginBottom: '20px' }}>
        <div className="report-main-col">
          {/* Order Status Summary Table Panel */}
          <section className="table-panel">
            <div className="table-heading">
              <h2>Order status log <span className="muted-count">({shownOrders.length})</span></h2>
              <button className="view-all" onClick={() => onNavigate('orders')}>
                ＋ New order →
              </button>
            </div>

            <div className="table-scroll-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Order ID</th>
                    <th>Customer</th>
                    <th>Order date</th>
                    <th>Expected delivery</th>
                    <th>Items</th>
                    <th>Total</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {shownOrders.length > 0 ? (
                    shownOrders.map((o) => {
                      const dStr = String(o.date || o.orderDate || '').slice(0, 10);
                      const expDeliv = o.expectedDeliveryDate || addDaysToDateStr(dStr, 1);
                      return (
                        <tr
                          key={o.id}
                          onClick={() => setSelectedOrderDetail(selectedOrderDetail?.id === o.id ? null : o)}
                          style={{ cursor: 'pointer' }}
                          title="Click to view ordered item details"
                        >
                          <td>
                            <strong className="order-id-tag">{o.id}</strong>
                            {(o.syncState === 'waiting' || (typeof o.id === 'string' && o.id.startsWith('TEMP-'))) && (
                              <span style={{ display: 'block', fontSize: '11px', color: '#ed6c02', fontWeight: 600 }}>
                                ⏳ Waiting to sync
                              </span>
                            )}
                          </td>
                          <td>
                            <div className="customer-cell">
                              <span className="customer-dot">{initials(o.customer || o.shopName)}</span>
                              <div>
                                <strong>{o.customer || o.shopName}</strong>
                                {o.shopId && <small className="order-shop-badge">{o.shopId}</small>}
                              </div>
                            </div>
                          </td>
                          <td>{dateLabel(dStr)}</td>
                          <td>
                            <strong style={{ color: '#0369a1' }}>{dateLabel(expDeliv)}</strong>
                          </td>
                          <td>{o.itemsCount || o.items || (o.orderList || []).length || 1} items</td>
                          <td><strong>{money(o.total)}</strong></td>
                          <td>
                            {(() => {
                              const pay = getPaymentSummary(o);
                              return (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
                                    <span className={`status ${(o.status || 'pending').toLowerCase().replace(/\s/g, '-')}`}>
                                      {o.status || 'In progress'}
                                    </span>
                                    <span style={{
                                      fontSize: '11px',
                                      fontWeight: 700,
                                      padding: '1px 6px',
                                      borderRadius: '999px',
                                      background: pay.paymentStatus === 'Collected' ? '#dcfce7' : (pay.paymentStatus === 'Partially collected' ? '#fef3c7' : '#f1f5f9'),
                                      color: pay.paymentStatus === 'Collected' ? '#15803d' : (pay.paymentStatus === 'Partially collected' ? '#b45309' : '#475569')
                                    }}>
                                      {pay.paymentStatus}
                                    </span>
                                  </div>
                                  <span style={{ fontSize: '11.5px', color: '#64748b', fontWeight: 600 }}>
                                    {pay.summaryText}
                                  </span>
                                </div>
                              );
                            })()}
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan="7">
                        <div className="empty-state">No orders match this period and filter.</div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {selectedOrderDetail && (
            <section className="panel" style={{ marginTop: '14px', border: '1px solid #bae6fd', background: '#f0f9ff' }}>
              <div className="panel-head">
                <div>
                  <h2>Order Summary · #{selectedOrderDetail.id} ({selectedOrderDetail.customer || selectedOrderDetail.shopName})</h2>
                  <p>
                    Order Date: {dateLabel(selectedOrderDetail.date)} · Expected Delivery: {dateLabel(selectedOrderDetail.expectedDeliveryDate || addDaysToDateStr(String(selectedOrderDetail.date || '').slice(0, 10), 1))}
                  </p>
                </div>
                <button type="button" className="quiet-button" onClick={() => setSelectedOrderDetail(null)}>
                  ✕ Close
                </button>
              </div>
              <div className="table-scroll-container">
                <table className="history-items-table" style={{ background: '#fff' }}>
                  <thead>
                    <tr>
                      <th>Item Description</th>
                      <th>Ordered Quantity</th>
                      <th>Catalog Price</th>
                      <th style={{ textAlign: 'right' }}>Line Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {((selectedOrderDetail.orderList || selectedOrderDetail.itemsList) || []).map((it, idx) => {
                      const unit = String(it.unitType || it.unit || 'kg').toLowerCase().startsWith('kg') ? 'kg' : String(it.unitType || it.unit || 'kg');
                      const p = Number(it.price || it.custprice || 0);
                      const q = Number(it.qty || 0);
                      return (
                        <tr key={idx}>
                          <td><b>{it.itemName || it.name || `Item #${it.itemid}`}</b></td>
                          <td><span className="qty-highlight">{q} {unit}</span></td>
                          <td>{money(p)}/{unit}</td>
                          <td style={{ textAlign: 'right' }}><b>{money(q * p)}</b></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>

        {/* Right Aside Column */}
        <aside className="report-side-col">
          {/* Delivery Status Summary */}
          <section className="panel" style={{ marginBottom: '16px' }}>
            <div className="panel-head">
              <div>
                <h2>Delivery status ({periodLabel})</h2>
                <p>Status breakdown in selected period</p>
              </div>
            </div>

            <div className="summary-list">
              <div className="summary-item">
                <span className="summary-title">Delivered</span>
                <span className="summary-value">{deliveredCount}</span>
                <div className="progress-track">
                  <div
                    className="progress-fill green"
                    style={{ width: `${clusterFilteredOrders.length ? (deliveredCount / clusterFilteredOrders.length) * 100 : 0}%` }}
                  />
                </div>
              </div>

              <div className="summary-item">
                <span className="summary-title">In progress</span>
                <span className="summary-value">{inProgressCount}</span>
                <div className="progress-track">
                  <div
                    className="progress-fill yellow"
                    style={{ width: `${clusterFilteredOrders.length ? (inProgressCount / clusterFilteredOrders.length) * 100 : 0}%` }}
                  />
                </div>
              </div>

              <div className="summary-item">
                <span className="summary-title">Price approval pending</span>
                <span className="summary-value">{pendingApprovalCount}</span>
                <div className="progress-track">
                  <div
                    className="progress-fill"
                    style={{ width: `${clusterFilteredOrders.length ? (pendingApprovalCount / clusterFilteredOrders.length) * 100 : 0}%` }}
                  />
                </div>
              </div>
            </div>
          </section>

          {/* Ordered Commodities (From Saved Order Data Only) */}
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>Ordered commodities ({periodLabel})</h2>
                <p>Actual quantities from saved orders (in kg)</p>
              </div>
            </div>

            {orderedCommodities.length === 0 ? (
              <div style={{ fontSize: '12.5px', color: '#64748b', padding: '12px 0' }}>
                No commodities ordered in the selected period.
              </div>
            ) : (
              <div className="summary-list">
                {orderedCommodities.map((x, i) => (
                  <div key={x.name} className="summary-item">
                    <span className="summary-title">{i + 1}. {x.name}</span>
                    <span className="summary-value">{x.qty} {x.unit}</span>
                    <div className="progress-track">
                      <div
                        className={`progress-fill ${x.color}`}
                        style={{ width: `${x.pct}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </aside>
      </div>

      {/* Bottom Performance Indicator Reference Table (Placed at the bottom of the report page) */}
      <section className="table-panel" style={{ marginTop: '24px' }}>
        <div className="table-heading">
          <div>
            <h2>Performance Indicator Reference Table</h2>
            <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#64748b' }}>
              Standard achievement bands used to evaluate Target vs Actual sales performance across periods.
            </p>
          </div>
        </div>
        <div className="table-scroll-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Performance Indicator</th>
                <th>Achievement % Range</th>
                <th>Interpretation & Action</th>
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
