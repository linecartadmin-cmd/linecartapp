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

    api
      .getHomeReport(params)
      .then((res) => {
        if ((res?.status === 200 || res?.status === 1) && res?.result?.clusterList) {
          const list = res.result.clusterList;
          setClustersList(list);
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
  }, [user?.id, selectedClusterId, selectedAgentId, fromDate, toDate]);

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
                  <th>Total Order Count</th>
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
                            {item.totalcount} units
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
