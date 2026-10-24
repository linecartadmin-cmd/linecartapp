import React, { useState, useEffect } from 'react';
import { api } from '../api';
import { formatShopId } from '../utils';

export default function OverviewScreen({
  user,
  orders = [],
  shops = [],
  clusters = [],
  onNavigate,
  onOrderForCustomer,
  showToast
}) {
  const [selectedCluster, setSelectedCluster] = useState('all');
  const [loadedClusters, setLoadedClusters] = useState(clusters);

  const [recentFilters, setRecentFilters] = useState({
    shop: '',
    fromDate: '',
    toDate: '',
    itemId: '',
    category: ''
  });

  // Ensure clusters are loaded from backend if not passed down yet
  useEffect(() => {
    if (clusters && clusters.length > 0) {
      setLoadedClusters(clusters);
    } else if (user) {
      api.getClusterInfo(user.id).then((res) => {
        if ((res.status === 200 || res.status === 1) && res.result?.clusterList) {
          setLoadedClusters(res.result.clusterList);
        }
      });
    }
  }, [clusters, user]);

  const clusterOptions = loadedClusters.length > 0 ? loadedClusters : clusters;

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

  // 1. FILTER SHOPS BY CLUSTER
  const displayedShops = selectedCluster === 'all'
    ? shops
    : shops.filter((s) => Number(s.clusterid || s.clusterId) === Number(selectedCluster));

  // 2. FILTER ORDERS BY CLUSTER
  const clusterShopNames = new Set(displayedShops.map((s) => (s.shopName || '').toLowerCase()));
  const clusterShopIds = new Set(displayedShops.map((s) => Number(s.shopid)));

  const displayedOrders = selectedCluster === 'all'
    ? orders
    : orders.filter((o) => {
        if (o.clusterId) return Number(o.clusterId) === Number(selectedCluster);
        if (o.shopid && clusterShopIds.has(Number(o.shopid))) return true;
        return clusterShopNames.has((o.customer || '').toLowerCase());
      });

  // 3. METRICS
  const totalOrders = displayedOrders.length;
  const deliveredOrders = displayedOrders.filter((o) => (o.status || '').toLowerCase() === 'delivered').length;
  const pendingOrders = displayedOrders.filter(
    (o) => (o.status || '').toLowerCase() === 'pending' || (o.status || '').toLowerCase() === 'in progress'
  ).length;
  const totalValue = displayedOrders.reduce((sum, o) => sum + Number(o.total || 0), 0);

  // 4. GROUP SHOPS BY CATEGORY FOR CURRENT CLUSTER
  const categoryCounts = displayedShops.reduce((acc, s) => {
    const cat = s.shopCategory || 'Retail';
    acc[cat] = (acc[cat] || 0) + 1;
    return acc;
  }, {});
  const categoryNames = Object.keys(categoryCounts).sort((a, b) => categoryCounts[b] - categoryCounts[a]);
  const categoryColors = ['blue', 'green', 'yellow', 'purple'];
  const maxCategoryCount = Math.max(...Object.values(categoryCounts), 1);

  // 5. FILTER RECENT ORDERS (Inclusive date range, shop, item, category)
  const filteredOrders = displayedOrders.filter((o) => {
    if (recentFilters.shop && o.customer !== recentFilters.shop) return false;
    if (recentFilters.fromDate && o.date < recentFilters.fromDate) return false;
    if (recentFilters.toDate && o.date > recentFilters.toDate) return false;
    if (recentFilters.category) {
      const matchedShop = displayedShops.find((s) => s.shopName === o.customer);
      if ((matchedShop?.shopCategory || 'Retail') !== recentFilters.category) return false;
    }
    if (recentFilters.itemId && o.itemsList) {
      const matchItem = o.itemsList.some((it) =>
        String(it.itemid || it.itemName).toLowerCase().includes(recentFilters.itemId.toLowerCase())
      );
      if (!matchItem) return false;
    }
    return true;
  });

  const todayStr = new Date().toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  }).toUpperCase();

  const currentClusterObj = clusterOptions.find((c) => String(c.clusterId) === String(selectedCluster));
  const currentClusterName = currentClusterObj ? currentClusterObj.clusterName : 'All clusters';

  const handleClearFilters = () => {
    setRecentFilters({
      shop: '',
      fromDate: '',
      toDate: '',
      itemId: '',
      category: ''
    });
  };

  return (
    <div>
      {/* Page Heading (Introduction Section) */}
      <div className="page-heading">
        <div>
          <p className="eyebrow">{todayStr}</p>
          <h1>Good morning, {user?.name || 'Field Sales Agent'}</h1>
          <p>Here’s what’s happening with your wholesale produce orders today.</p>
        </div>

        <button
          className="primary-button"
          onClick={() => onNavigate('orders')}
        >
          ＋ &nbsp;Create order
        </button>
      </div>

      {/* Full-Width Cluster Filter Row Directly Below Introduction */}
      <div className="cluster-filter-row">
        <label htmlFor="overviewClusterSelect" className="cluster-filter-label">
          <span className="cluster-filter-icon">⚲</span>
          <span>CLUSTER ROUTE</span>
        </label>
        <div className="cluster-select-container">
          <select
            id="overviewClusterSelect"
            className="cluster-fullwidth-select"
            value={selectedCluster}
            onChange={(e) => {
              setSelectedCluster(e.target.value);
              setRecentFilters((prev) => ({ ...prev, shop: '' }));
            }}
            aria-label="Filter overview by cluster"
          >
            <option value="all">All clusters ({shops.length} stores)</option>
            {clusterOptions.map((c) => {
              const count = shops.filter((s) => Number(s.clusterid || s.clusterId) === Number(c.clusterId)).length;
              return (
                <option key={c.clusterId} value={String(c.clusterId)}>
                  {c.clusterName} ({count} stores)
                </option>
              );
            })}
          </select>
          <span className="cluster-select-chevron">▾</span>
        </div>
      </div>

      {/* Stats Grid */}
      <section className="stats-grid">
        <article className="stat-card">
          <div className="stat-top">
            <span>Orders this month</span>
            <span className="stat-icon blue">▤</span>
          </div>
          <div className="stat-value">{totalOrders}</div>
          <div className="stat-foot">
            <span className="up">↑ 12%</span> active route fulfillment
          </div>
        </article>

        <article className="stat-card">
          <div className="stat-top">
            <span>Pending delivery</span>
            <span className="stat-icon yellow">◷</span>
          </div>
          <div className="stat-value">{pendingOrders}</div>
          <div className="stat-foot">
            {selectedCluster === 'all' ? 'Across all assigned cluster routes' : `In ${currentClusterName}`}
          </div>
        </article>

        <article className="stat-card">
          <div className="stat-top">
            <span>Delivered orders</span>
            <span className="stat-icon green">✓</span>
          </div>
          <div className="stat-value">{deliveredOrders}</div>
          <div className="stat-foot">
            <span className="up">↑ 98%</span> delivery success rate
          </div>
        </article>

        <article className="stat-card">
          <div className="stat-top">
            <span>Order value</span>
            <span className="stat-icon purple">₹</span>
          </div>
          <div className="stat-value">{money(totalValue)}</div>
          <div className="stat-foot">Total value of placed orders</div>
        </article>
      </section>

      {/* Overview Grid: Chart + Delivery Summary */}
      <section className="overview-grid">
        {/* Order Activity Trend */}
        <article className="panel">
          <div className="panel-head">
            <div>
              <h2>Order activity</h2>
              <p>Orders placed over the last 7 delivery cycles</p>
            </div>
            <div className="legend">
              <span><i></i>Orders</span>
              <span><i className="legend-two"></i>Delivered</span>
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
            <svg viewBox="0 0 600 145" preserveAspectRatio="none" aria-label="Order activity chart">
              <defs>
                <linearGradient id="area-grad" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0" stopColor="#12aee2" stopOpacity="0.18" />
                  <stop offset="1" stopColor="#12aee2" stopOpacity="0" />
                </linearGradient>
                <linearGradient id="area-grad-delivered" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0" stopColor="#526e7f" stopOpacity="0.08" />
                  <stop offset="1" stopColor="#526e7f" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path
                d="M0 112 C35 103 48 110 86 88 S142 72 172 84 S223 95 258 59 S309 65 344 51 S391 70 430 45 S489 28 514 46 S560 34 600 13 L600 145 L0 145 Z"
                fill="url(#area-grad)"
              />
              <path
                d="M0 128 C48 120 62 125 86 113 S143 100 172 107 S223 118 258 91 S309 100 344 80 S391 92 430 74 S489 63 514 78 S560 61 600 50 L600 145 L0 145 Z"
                fill="url(#area-grad-delivered)"
              />
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
        </article>

        {/* Delivery Summary */}
        <article className="panel">
          <div className="panel-head">
            <div>
              <h2>Delivery summary</h2>
              <p>Current fulfillment status</p>
            </div>
            <button
              className="quiet-button"
              onClick={() => onNavigate('reports')}
            >
              Details ↗
            </button>
          </div>

          <div className="summary-list">
            <div className="summary-item">
              <span className="summary-title">Delivered</span>
              <span className="summary-value">{deliveredOrders} orders</span>
              <div className="progress-track">
                <div
                  className="progress-fill green"
                  style={{ width: `${totalOrders ? (deliveredOrders / totalOrders) * 100 : 65}%` }}
                />
              </div>
              <span className="summary-sub">Successfully fulfilled to stores</span>
            </div>

            <div className="summary-item">
              <span className="summary-title">In progress</span>
              <span className="summary-value">{pendingOrders} orders</span>
              <div className="progress-track">
                <div
                  className="progress-fill yellow"
                  style={{ width: `${totalOrders ? (pendingOrders / totalOrders) * 100 : 35}%` }}
                />
              </div>
              <span className="summary-sub">Loaded & in transit</span>
            </div>

            <div className="summary-item">
              <span className="summary-title">Total registered stores</span>
              <span className="summary-value">{displayedShops.length} stores</span>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: '100%' }} />
              </div>
              <span className="summary-sub">
                {selectedCluster === 'all'
                  ? `Active across all clusters (${clusterOptions.map((c) => c.clusterName).join(', ')})`
                  : `Active in ${currentClusterName}`}
              </span>
            </div>
          </div>
        </article>
      </section>

      {/* Shops by Category Panel */}
      <section className="panel category-panel">
        <div className="panel-head">
          <div>
            <h2>Shops by category</h2>
            <p>
              {displayedShops.length} registered shops {selectedCluster !== 'all' ? `in ${currentClusterName}` : 'across all clusters'} grouped by business category
            </p>
          </div>
          <button
            className="quiet-button"
            onClick={() => onNavigate('customers')}
          >
            View shops ↗
          </button>
        </div>

        <div className="category-grid">
          {categoryNames.map((cat, i) => {
            const count = categoryCounts[cat];
            const pct = Math.max(12, Math.round((count / maxCategoryCount) * 100));
            return (
              <div key={cat} className="category-tile">
                <span className={`stat-icon ${categoryColors[i % categoryColors.length]}`}>
                  {['▣', '⌂', '▤', '✚', '♦'][i % 5]}
                </span>
                <div>
                  <b>{count}</b>
                  <small>{cat}</small>
                </div>
                <div className="category-track">
                  <i style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Recent Orders Table Panel with Filter Row */}
      <section className="table-panel">
        <div className="table-heading">
          <div>
            <h2>Recent orders</h2>
            <span className="recent-count">
              {filteredOrders.length} shown {selectedCluster !== 'all' && `(${currentClusterName})`}
            </span>
          </div>
          <button
            className="view-all"
            onClick={() => onNavigate('reports')}
          >
            View all orders →
          </button>
        </div>

        {/* .recent-filters grid with From Date & To Date */}
        <div className="recent-filters">
          <label>
            <span>Shop</span>
            <select
              className="select recent-filter"
              value={recentFilters.shop}
              onChange={(e) => setRecentFilters({ ...recentFilters, shop: e.target.value })}
            >
              <option value="">All shops ({displayedShops.length})</option>
              {displayedShops.slice(0, 50).map((s) => (
                <option key={s.shopid} value={s.shopName}>
                  [{formatShopId(s.shopid)}] {s.shopName}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>From date</span>
            <input
              className="field recent-filter"
              type="date"
              value={recentFilters.fromDate}
              onChange={(e) => setRecentFilters({ ...recentFilters, fromDate: e.target.value })}
            />
          </label>

          <label>
            <span>To date</span>
            <input
              className="field recent-filter"
              type="date"
              value={recentFilters.toDate}
              onChange={(e) => setRecentFilters({ ...recentFilters, toDate: e.target.value })}
            />
          </label>

          <label>
            <span>Item ID / Name</span>
            <input
              className="field recent-filter"
              placeholder="e.g. Onion, Potato"
              value={recentFilters.itemId}
              onChange={(e) => setRecentFilters({ ...recentFilters, itemId: e.target.value })}
            />
          </label>

          <label>
            <span>Shop category</span>
            <select
              className="select recent-filter"
              value={recentFilters.category}
              onChange={(e) => setRecentFilters({ ...recentFilters, category: e.target.value })}
            >
              <option value="">All categories</option>
              {categoryNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>

          <button
            className="clear-filters"
            disabled={!Object.values(recentFilters).some(Boolean)}
            onClick={handleClearFilters}
          >
            Clear
          </button>
        </div>

        {/* Scrollable table container for smooth mobile horizontal scrolling without page blowout */}
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
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredOrders.length > 0 ? (
                filteredOrders.slice(0, 8).map((order) => {
                  const matchedShop = displayedShops.find((s) => s.shopName === order.customer) ||
                                      shops.find((s) => s.shopName === order.customer);
                  const shortId = order.shopId || (matchedShop ? formatShopId(matchedShop.shopid) : '');

                  return (
                    <tr key={order.id}>
                      <td><strong className="order-id-tag">{order.id}</strong></td>
                      <td>
                        <div className="customer-cell">
                          <span className="customer-dot">{initials(order.customer)}</span>
                          <div className="customer-cell-text">
                            <strong>{order.customer}</strong>
                            {shortId && (
                              <small className="order-shop-badge">
                                {shortId}
                              </small>
                            )}
                          </div>
                        </div>
                      </td>
                      <td>{dateLabel(order.date)}</td>
                      <td>{order.itemsCount || order.items || 1} items</td>
                      <td><strong>{money(order.total)}</strong></td>
                      <td>
                        <span
                          className={`status ${(order.status || 'pending').toLowerCase().replace(/\s/g, '-')}`}
                        >
                          {order.status || 'Pending'}
                        </span>
                      </td>
                      <td>
                        <button
                          className="quiet-button"
                          onClick={() => showToast(`${order.id} · ${order.customer} · ${order.status || 'Pending'}`)}
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan="7">
                    <div className="empty-state">No orders match the selected filters.</div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
