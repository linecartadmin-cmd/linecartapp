import React, { useState } from 'react';
import { formatShopId, getPaymentSummary } from '../utils';

export default function ReportsScreen({
  user,
  clusters = [],
  shops = [],
  orders = [],
  onNavigate,
  showToast
}) {
  const [reportRange, setReportRange] = useState('This week');
  const [statusFilter, setStatusFilter] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedClusterFilter, setSelectedClusterFilter] = useState('all');

  const money = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');
  const dateLabel = (val) => {
    if (!val) return 'Today';
    const d = new Date(val);
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

  // Filter orders by cluster if selected
  const clusterShopNames = selectedClusterFilter === 'all'
    ? null
    : new Set(
        shops
          .filter((s) => Number(s.clusterid || s.clusterId) === Number(selectedClusterFilter))
          .map((s) => (s.shopName || '').toLowerCase())
      );

  const clusterFilteredOrders = selectedClusterFilter === 'all'
    ? orders
    : orders.filter((o) => {
        if (o.clusterId) return Number(o.clusterId) === Number(selectedClusterFilter);
        return clusterShopNames ? clusterShopNames.has((o.customer || '').toLowerCase()) : true;
      });

  const deliveredCount = clusterFilteredOrders.filter((o) => (o.status || '').toLowerCase() === 'delivered').length;
  const inProgressCount = clusterFilteredOrders.filter((o) => (o.status || '').toLowerCase() === 'in progress').length;
  const pendingCount = clusterFilteredOrders.filter((o) => (o.status || '').toLowerCase() === 'pending').length;
  const totalValue = clusterFilteredOrders.reduce((sum, o) => sum + Number(o.total || 0), 0);

  const shownOrders = clusterFilteredOrders.filter((o) => {
    if (statusFilter !== 'All' && (o.status || 'Pending').toLowerCase() !== statusFilter.toLowerCase()) return false;
    if (searchQuery && !(`${o.id} ${o.customer}`).toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  // Target vs Achieved Sales calculation for Today vs Yesterday
  const now = new Date();
  const todayISO = now.toISOString().slice(0, 10);
  const yestDate = new Date(now);
  yestDate.setDate(yestDate.getDate() - 1);
  const yestISO = yestDate.toISOString().slice(0, 10);

  const todayLabelStr = now.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  const yestLabelStr = yestDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

  // Real achieved sales from backend orders
  const todayOrders = clusterFilteredOrders.filter((o) => o.date === todayISO);
  const yestOrders = clusterFilteredOrders.filter((o) => o.date === yestISO);

  const todayAchieved = todayOrders.reduce((sum, o) => sum + Number(o.total || 0), 0);
  const yestAchieved = yestOrders.reduce((sum, o) => sum + Number(o.total || 0), 0);

  // Check backend for target data (not configured in existing schema)
  const targetConfigured = user?.dailyTarget || user?.target || null;
  const maxSales = Math.max(todayAchieved, yestAchieved, 1000);

  const handleExportCSV = () => {
    const headers = ['Order ID', 'Customer', 'Date', 'Items', 'Total', 'Delivery Status', 'Payment Status', 'Amount Collected', 'Balance Remaining', 'Payment Summary'];
    const rows = clusterFilteredOrders.map((o) => {
      const pay = getPaymentSummary(o);
      return [
        o.id,
        o.customer,
        o.date,
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
    link.download = `linecart-orders-report-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    showToast('Orders report downloaded successfully.');
  };

  const topItems = [
    { name: 'Onio Medium', qty: '450 kgs', pct: 95, color: '' },
    { name: 'Onion Big', qty: '100 kgs', pct: 72, color: 'green' },
    { name: 'Agra Potato', qty: '85 kgs', pct: 54, color: 'yellow' },
    { name: 'Tomato Hybrid', qty: '65 kgs', pct: 40, color: '' }
  ];

  return (
    <div className="reports-page">
      {/* Page Heading */}
      <div className="page-heading reports-heading">
        <div>
          <p className="eyebrow">INSIGHTS</p>
          <h1>Reports</h1>
          <p>A clear view of wholesale order fulfillment and route performance.</p>
        </div>
        <button
          className="secondary-button"
          onClick={handleExportCSV}
        >
          ↧ &nbsp;Download report
        </button>
      </div>

      {/* Responsive Filter Toolbar */}
      <div className="reports-toolbar">
        <div className="reports-filter-group">
          <label htmlFor="reportPeriodSelect" className="reports-filter-label">PERIOD</label>
          <select
            id="reportPeriodSelect"
            className="select reports-period-select"
            value={reportRange}
            onChange={(e) => {
              setReportRange(e.target.value);
              showToast(`Showing ${e.target.value.toLowerCase()} report`);
            }}
          >
            <option value="This week">This week</option>
            <option value="This month">This month</option>
            <option value="All time">All time</option>
          </select>
        </div>

        {clusters.length > 0 && (
          <div className="reports-filter-group">
            <label htmlFor="reportClusterSelect" className="reports-filter-label">CLUSTER</label>
            <select
              id="reportClusterSelect"
              className="select reports-cluster-select"
              value={selectedClusterFilter}
              onChange={(e) => setSelectedClusterFilter(e.target.value)}
            >
              <option value="all">All clusters</option>
              {clusters.map((c) => (
                <option key={c.clusterId} value={String(c.clusterId)}>
                  {c.clusterName}
                </option>
              ))}
            </select>
          </div>
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
            {['All', 'Delivered', 'In progress', 'Pending'].map((st) => (
              <button
                key={st}
                className={`tab ${statusFilter === st ? 'selected' : ''}`}
                onClick={() => setStatusFilter(st)}
              >
                {st}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Target vs Achieved Sales Section */}
      <section className="panel target-achieved-panel" style={{ marginBottom: '20px' }}>
        <div className="panel-head">
          <div>
            <h2>Target vs Achieved Sales</h2>
            <p>Comparing wholesale sales performance: Today ({todayLabelStr}) vs Yesterday ({yestLabelStr})</p>
          </div>
          <div className="legend">
            <span><i style={{ background: '#12aee2' }}></i>Achieved sales (₹)</span>
            <span><i style={{ background: '#64748b' }}></i>Target (₹)</span>
          </div>
        </div>

        {/* Comparison Cards Grid */}
        <div className="target-cards-grid">
          {/* Today Card */}
          <div className="target-day-card">
            <div className="target-day-head">
              <div>
                <span className="target-day-badge today">TODAY</span>
                <h3>{todayLabelStr}</h3>
              </div>
              <span className="target-count-pill">{todayOrders.length} {todayOrders.length === 1 ? 'order' : 'orders'}</span>
            </div>

            <div className="target-values-row">
              <div className="target-val-block">
                <small>Achieved sales</small>
                <b className="achieved-text">{money(todayAchieved)}</b>
              </div>

              <div className="target-val-block">
                <small>Target sales</small>
                {targetConfigured ? (
                  <b className="target-text">{money(targetConfigured)}</b>
                ) : (
                  <span className="target-unconfigured-pill" title="Target not configured in backend database">
                    Target not configured
                  </span>
                )}
              </div>
            </div>

            {/* Visual Bar Comparison */}
            <div className="target-bar-container">
              <div className="target-bar-track">
                <div
                  className="target-bar-fill today-fill"
                  style={{ width: `${maxSales ? Math.min(100, Math.max(10, Math.round((todayAchieved / maxSales) * 100))) : 0}%` }}
                />
              </div>
              <div className="target-bar-meta">
                <span>Achieved: <b>{money(todayAchieved)}</b></span>
                <span className="target-meta-right">
                  {targetConfigured ? `Target: ${money(targetConfigured)}` : 'Target: —'}
                </span>
              </div>
            </div>
          </div>

          {/* Yesterday Card */}
          <div className="target-day-card">
            <div className="target-day-head">
              <div>
                <span className="target-day-badge yesterday">YESTERDAY</span>
                <h3>{yestLabelStr}</h3>
              </div>
              <span className="target-count-pill">{yestOrders.length} {yestOrders.length === 1 ? 'order' : 'orders'}</span>
            </div>

            <div className="target-values-row">
              <div className="target-val-block">
                <small>Achieved sales</small>
                <b className="achieved-text">{money(yestAchieved)}</b>
              </div>

              <div className="target-val-block">
                <small>Target sales</small>
                {targetConfigured ? (
                  <b className="target-text">{money(targetConfigured)}</b>
                ) : (
                  <span className="target-unconfigured-pill" title="Target not configured in backend database">
                    Target not configured
                  </span>
                )}
              </div>
            </div>

            {/* Visual Bar Comparison */}
            <div className="target-bar-container">
              <div className="target-bar-track">
                <div
                  className="target-bar-fill yest-fill"
                  style={{ width: `${maxSales ? Math.min(100, Math.max(10, Math.round((yestAchieved / maxSales) * 100))) : 0}%` }}
                />
              </div>
              <div className="target-bar-meta">
                <span>Achieved: <b>{money(yestAchieved)}</b></span>
                <span className="target-meta-right">
                  {targetConfigured ? `Target: ${money(targetConfigured)}` : 'Target: —'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Clear Notice when Target Data is Unconfigured */}
        {!targetConfigured && (
          <div className="target-info-notice">
            <span className="target-notice-icon">ℹ</span>
            <div className="target-notice-text">
              <strong>Target data not configured:</strong> Sales targets are not currently set in the database schema. To display real target comparisons, add a <code>daily_target</code> field to the salesperson or cluster route records. Achieved sales above reflect real order values.
            </div>
          </div>
        )}
      </section>

      {/* Main Reports Layout: Multi-column on wide, stacked on mobile */}
      <div className="report-layout">
        {/* Left Column */}
        <div className="report-main-col">
          {/* Order Performance Panel */}
          <section className="panel" style={{ marginBottom: '16px' }}>
            <div className="panel-head">
              <div>
                <h2>Order performance</h2>
                <p>Volume and fulfillment at a glance across routes</p>
              </div>
            </div>

            <div className="report-kpis">
              <div className="report-kpi">
                <span>Total orders</span>
                <b>{clusterFilteredOrders.length}</b>
              </div>
              <div className="report-kpi">
                <span>Delivered</span>
                <b>{deliveredCount}</b>
              </div>
              <div className="report-kpi">
                <span>Order value</span>
                <b>{money(totalValue)}</b>
              </div>
            </div>

            <div className="chart">
              <div className="chart-grid">
                <div className="grid-row"><span>20</span></div>
                <div className="grid-row"><span>15</span></div>
                <div className="grid-row"><span>10</span></div>
                <div className="grid-row"><span>5</span></div>
                <div className="grid-row"><span>0</span></div>
              </div>
              <svg viewBox="0 0 600 145" preserveAspectRatio="none" aria-label="Order trend chart">
                <path
                  d="M0 112 C35 103 48 110 86 88 S142 72 172 84 S223 95 258 59 S309 65 344 51 S391 70 430 45 S489 28 514 46 S560 34 600 13"
                  fill="none"
                  stroke="#16acd5"
                  strokeWidth="3"
                  vectorEffect="non-scaling-stroke"
                  strokeLinecap="round"
                />
                <path
                  d="M0 128 C48 120 62 125 86 113 S143 100 172 107 S223 118 258 91 S309 100 344 80 S391 92 430 74 S489 63 514 78 S560 61 600 50"
                  fill="none"
                  stroke="#526e7f"
                  strokeWidth="2.5"
                  vectorEffect="non-scaling-stroke"
                  strokeLinecap="round"
                />
              </svg>
            </div>
            <div className="chart-labels">
              <span>18 Oct</span>
              <span>19 Oct</span>
              <span>20 Oct</span>
              <span>21 Oct</span>
              <span>22 Oct</span>
              <span>23 Oct</span>
              <span>24 Oct</span>
            </div>
          </section>

          {/* Order Status Summary Table Panel */}
          <section className="table-panel">
            <div className="table-heading">
              <h2>Order status log <span className="muted-count">({shownOrders.length})</span></h2>
              <button
                className="view-all"
                onClick={() => onNavigate('orders')}
              >
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
                    <th>Items</th>
                    <th>Total</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {shownOrders.length > 0 ? (
                    shownOrders.map((o) => (
                      <tr key={o.id}>
                        <td>
                          <strong className="order-id-tag">{o.id}</strong>
                          {(o.syncState === 'waiting' || (typeof o.id === 'string' && o.id.startsWith('TEMP-'))) && (
                            <span style={{ display: 'block', fontSize: '10px', color: '#ed6c02', fontWeight: 600 }}>
                              ⏳ Waiting to sync
                            </span>
                          )}
                        </td>
                        <td>
                          <div className="customer-cell">
                            <span className="customer-dot">{initials(o.customer)}</span>
                            <div>
                              <strong>{o.customer}</strong>
                              {o.shopId && <small className="order-shop-badge">{o.shopId}</small>}
                            </div>
                          </div>
                        </td>
                        <td>{dateLabel(o.date)}</td>
                        <td>{o.itemsCount || o.items || 1} items</td>
                        <td><strong>{money(o.total)}</strong></td>
                        <td>
                          {(() => {
                            const pay = getPaymentSummary(o);
                            return (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
                                  <span
                                    className={`status ${(o.status || 'pending').toLowerCase().replace(/\s/g, '-')}`}
                                  >
                                    {o.status || 'Pending'}
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
                                  {(o.syncState === 'waiting' || (typeof o.id === 'string' && o.id.startsWith('TEMP-'))) && (
                                    <span style={{
                                      fontSize: '10px',
                                      color: '#ed6c02',
                                      background: '#fff7ed',
                                      border: '1px solid #fed7aa',
                                      padding: '1px 5px',
                                      borderRadius: '8px',
                                      fontWeight: 600
                                    }}>
                                      Offline
                                    </span>
                                  )}
                                </div>
                                <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>
                                  {pay.summaryText}
                                </span>
                              </div>
                            );
                          })()}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="6">
                        <div className="empty-state">No orders match this view.</div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        {/* Right Aside Column */}
        <aside className="report-side-col">
          {/* Delivery Status Summary */}
          <section className="panel" style={{ marginBottom: '16px' }}>
            <div className="panel-head">
              <div>
                <h2>Delivery status</h2>
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
                    style={{ width: `${clusterFilteredOrders.length ? (deliveredCount / clusterFilteredOrders.length) * 100 : 70}%` }}
                  />
                </div>
              </div>

              <div className="summary-item">
                <span className="summary-title">In progress</span>
                <span className="summary-value">{inProgressCount}</span>
                <div className="progress-track">
                  <div
                    className="progress-fill yellow"
                    style={{ width: `${clusterFilteredOrders.length ? (inProgressCount / clusterFilteredOrders.length) * 100 : 25}%` }}
                  />
                </div>
              </div>

              <div className="summary-item">
                <span className="summary-title">Pending</span>
                <span className="summary-value">{pendingCount}</span>
                <div className="progress-track">
                  <div
                    className="progress-fill"
                    style={{ width: `${clusterFilteredOrders.length ? (pendingCount / clusterFilteredOrders.length) * 100 : 15}%` }}
                  />
                </div>
              </div>
            </div>
          </section>

          {/* Most Ordered Items */}
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>Most ordered produce</h2>
                <p>By total volume delivered this week</p>
              </div>
            </div>

            <div className="summary-list">
              {topItems.map((x, i) => (
                <div key={x.name} className="summary-item">
                  <span className="summary-title">{i + 1}. {x.name}</span>
                  <span className="summary-value">{x.qty}</span>
                  <div className="progress-track">
                    <div
                      className={`progress-fill ${x.color}`}
                      style={{ width: `${x.pct}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
