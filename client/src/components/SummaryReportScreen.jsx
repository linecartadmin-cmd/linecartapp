import React, { useState, useEffect } from 'react';
import { api } from '../api';

export default function SummaryReportScreen({
  user,
  showToast
}) {
  const [clustersList, setClustersList] = useState([]);
  const [selectedClusterId, setSelectedClusterId] = useState(1);
  const [selectedClusterLabel, setSelectedClusterLabel] = useState('');
  const [loading, setLoading] = useState(false);

  const todayStr = new Date().toLocaleDateString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).replace(/\//g, '-');

  const loadReport = () => {
    setLoading(true);
    api
      .getHomeReport(user?.id || 1)
      .then((res) => {
        if ((res?.status === 200 || res?.status === 1) && res?.result?.clusterList) {
          const list = res.result.clusterList;
          setClustersList(list);
          if (list.length > 0 && !selectedClusterLabel) {
            setSelectedClusterId(list[0].clusterId);
            setSelectedClusterLabel(list[0].clusterName);
          }
        } else {
          showToast('Failed to load cluster reports');
        }
      })
      .catch(() => {
        showToast('Failed to connect to reports service');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadReport();
  }, [user?.id]);

  const isAllClusters = selectedClusterId === 'all';

  const activeCluster = !isAllClusters
    ? clustersList.find((c) => Number(c.clusterId) === Number(selectedClusterId)) || clustersList[0] || null
    : null;

  // Compute stats for all clusters or single selected cluster
  let totalShops = 0;
  let totalOrdered = 0;
  let totalNotOrdered = 0;
  let deliveryStatusList = [];
  let orderItemStatusList = [];

  if (isAllClusters) {
    clustersList.forEach((c) => {
      const s = c.order_shop_status || c || {};
      totalShops += Number(s.totalshops ?? c.totalshops ?? 0);
      totalOrdered += Number(s.totalorderedshops ?? c.totalorderedshops ?? 0);
      totalNotOrdered += Number(s.totalnotorderedshops ?? c.totalnotorderedshops ?? 0);
    });

    const delivMap = new Map();
    clustersList.forEach((c) => {
      const list = c.deliverystatus || c.delivery_status || [];
      list.forEach((item) => {
        if (!delivMap.has(item.name)) {
          delivMap.set(item.name, { ...item, totalcount: 0 });
        }
        delivMap.get(item.name).totalcount += Number(item.totalcount || 0);
      });
    });
    deliveryStatusList = Array.from(delivMap.values());

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
  }

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

      {/* Cluster & Date Toolbar */}
      <div className="summary-toolbar">
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

        <div className="summary-date-group">
          <span className="summary-date-label">Report Date:</span>
          <span className="summary-date-badge">
            📅 {todayStr}
          </span>
        </div>
      </div>

      {/* 4 Shop Status KPI Cards (Reading from order_shop_status) */}
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
            <span>Number Of Ordered Shops</span>
            <span className="stat-icon green">✓</span>
          </div>
          <div className="stat-value">{totalOrdered}</div>
          <div className="stat-foot">
            <span className="up">Active</span> replenishment orders placed
          </div>
        </article>

        <article className="stat-card">
          <div className="stat-top">
            <span>Number Of Not Ordered Shops</span>
            <span className="stat-icon yellow">◷</span>
          </div>
          <div className="stat-value">{totalNotOrdered}</div>
          <div className="stat-foot">Visited / pending store order</div>
        </article>

        <article className="stat-card">
          <div className="stat-top">
            <span>Number Of Sops Not Connected</span>
            <span className="stat-icon purple">♙</span>
          </div>
          <div className="stat-value">{totalNotOrdered}</div>
          <div className="stat-foot">Requires sales officer follow-up</div>
        </article>
      </section>

      {/* Two Data Panels */}
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
                  <th>Total Units</th>
                  <th>Delivered</th>
                  <th>Inprogress</th>
                  <th>Fulfillment</th>
                </tr>
              </thead>
              <tbody>
                {deliveryStatusList.length > 0 ? (
                  deliveryStatusList.map((row, idx) => {
                    const delivered = 11; // Bytecode adapter constant
                    const inprogress = 22;
                    const total = row.totalcount || 0;
                    const pct = total > 0 ? Math.min(100, Math.round((delivered / total) * 100)) : 100;
                    return (
                      <tr key={`${row.id || idx}-${row.name}`}>
                        <td>
                          <strong>{row.name}</strong>
                        </td>
                        <td><b>{total}</b></td>
                        <td>
                          <span className="status delivered">{delivered}</span>
                        </td>
                        <td>
                          <span className="status in-progress">{inprogress}</span>
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
                      <div className="empty-state">No delivery status records for this cluster.</div>
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
                  <th>Total Order Count</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {orderItemStatusList.length > 0 ? (
                  orderItemStatusList.map((item, idx) => (
                    <tr key={`${item.id || idx}-${item.name}`}>
                      <td>
                        <div className="flex items-center gap-2">
                          <span className="stat-icon blue text-xs">▤</span>
                          <strong>{item.name}</strong>
                        </div>
                      </td>
                      <td>
                        <span className="text-sm font-bold text-slate-800">
                          {item.totalcount} units
                        </span>
                      </td>
                      <td>
                        <span className="status delivered">Active</span>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="3">
                      <div className="empty-state">No item orders for this cluster route.</div>
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
