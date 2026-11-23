import React, { useState, useEffect, useMemo } from 'react';
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

export default function ManagerReportsScreen({
  user,
  clusters = [],
  onNavigate,
  showToast
}) {
  const [assignedAgents, setAssignedAgents] = useState([]);
  const [selectedAgentId, setSelectedAgentId] = useState('all');
  const [selectedClusterId, setSelectedClusterId] = useState('all');

  const todayIST = getIstDateStr();
  const yestIST = addDaysToDateStr(todayIST, -1);

  const [reportPeriod, setReportPeriod] = useState('7d'); // 'today' | '7d' | '30d' | 'custom'
  const [fromDate, setFromDate] = useState(() => addDaysToDateStr(todayIST, -6));
  const [toDate, setToDate] = useState(() => todayIST);

  const [loading, setLoading] = useState(false);
  const [reportData, setReportData] = useState({
    hasTarget: false,
    targetAmount: 0,
    achievedAmount: 0,
    differenceAmount: 0,
    targetGap: 0,
    achievementRate: 0,
    achievementPct: 0,
    performanceIndicator: { label: 'No Target Set', code: 'no_target', color: 'neutral' },
    performanceIndicatorScale: DEFAULT_PERF_SCALE,
    shopCounts: { assignedShopsCount: 0, visitedShopsCount: 0, orderedShopsCount: 0, notOrderedShopsCount: 0 },
    frequentlyOrderedCustomers: null,
    itemBreakdown: [],
    agentBreakdown: [],
    dailyComparison: [],
    dailyDeliveryStatus: [],
    authorizedClusters: [],
    ordersCount: 0
  });

  const [selectedDayDrilldown, setSelectedDayDrilldown] = useState(null);

  // Target Configuration Modal State
  const [showTargetModal, setShowTargetModal] = useState(false);
  const [targetFormAgentId, setTargetFormAgentId] = useState('');
  const [targetFormAmount, setTargetFormAmount] = useState('50000');
  const [targetFormItem1Qty, setTargetFormItem1Qty] = useState('500');
  const [targetFormItem2Qty, setTargetFormItem2Qty] = useState('400');
  const [savingTarget, setSavingTarget] = useState(false);
  const [pendingPriceCount, setPendingPriceCount] = useState(0);

  const formatDateDisplay = (dStr) => {
    if (!dStr) return '—';
    const clean = String(dStr).slice(0, 10);
    const d = new Date(`${clean}T00:00:00`);
    return isNaN(d.getTime())
      ? clean
      : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  };

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

  useEffect(() => {
    if (!user) return;
    api.getPriceRequests('pending', user.id).then((res) => {
      if (res && res.status === 200 && Array.isArray(res.priceRequests)) {
        setPendingPriceCount(res.priceRequests.filter((p) => p.status === 'pending').length);
      }
    }).catch(() => {});
  }, [user]);

  const money = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');

  const assignedSalesAgents = useMemo(() => {
    return (assignedAgents || []).filter(
      (a) => (a.role || '').toLowerCase() === 'field sales agent' && Number(a.active ?? 1) === 1
    );
  }, [assignedAgents]);

  const assignedDeliveryAgents = useMemo(() => {
    return (assignedAgents || []).filter(
      (a) => (a.role || '').toLowerCase() === 'delivery agent'
    );
  }, [assignedAgents]);

  // Scoped clusters: Sales Manager sees only clusters within their assigned scope; Admin sees all
  const scopedClusters = useMemo(() => {
    if ((user?.role || '').toLowerCase() === 'admin') return clusters;
    if (Array.isArray(reportData.authorizedClusters) && reportData.authorizedClusters.length > 0) {
      return reportData.authorizedClusters;
    }
    return clusters;
  }, [user?.role, clusters, reportData.authorizedClusters]);

  // Load assigned agents for this manager
  const loadAssignments = async () => {
    try {
      const res = await api.getManagerAssignments(user?.id);
      if (res?.status === 200) {
        setAssignedAgents(res.assignedAgents || []);
      }
    } catch {
      if (showToast) showToast('Failed to load assigned sales agents');
    }
  };

  useEffect(() => {
    if (assignedSalesAgents.length > 0) {
      if (!targetFormAgentId || !assignedSalesAgents.some((a) => String(a.id) === String(targetFormAgentId))) {
        setTargetFormAgentId(String(assignedSalesAgents[0].id));
      }
    } else {
      setTargetFormAgentId('');
    }
  }, [assignedSalesAgents, targetFormAgentId]);

  // Load report data from backend with strict manager scoping
  const loadReport = async () => {
    setLoading(true);
    try {
      const res = await api.getManagerReports({
        managerId: user?.id || 100,
        agentId: selectedAgentId,
        clusterId: selectedClusterId,
        period: reportPeriod !== 'custom' ? reportPeriod : undefined,
        fromDate,
        toDate
      });

      if (res?.status === 200 && res.report) {
        setReportData(res.report);
      } else if (res?.status === 403) {
        if (showToast) showToast(res.message || 'Access restricted: Outside your assigned scope.');
      }
    } catch {
      if (showToast) showToast('Failed to connect to report service.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAssignments();
  }, [user?.id]);

  useEffect(() => {
    loadReport();
  }, [user?.id, selectedAgentId, selectedClusterId, reportPeriod, fromDate, toDate]);

  // Handle saving real targets
  const handleSaveTarget = async (e) => {
    if (e) e.preventDefault();
    if (!targetFormAgentId) {
      if (showToast) showToast('Please select an agent to set target for.');
      return;
    }

    setSavingTarget(true);
    try {
      const item1 = { itemId: 1, itemName: 'Onio Medium', targetQty: Number(targetFormItem1Qty || 0), price: 53.0, targetAmount: Number(targetFormItem1Qty || 0) * 53 };
      const item2 = { itemId: 2, itemName: 'Onion Big', targetQty: Number(targetFormItem2Qty || 0), price: 55.5, targetAmount: Number(targetFormItem2Qty || 0) * 55.5 };

      const res = await api.saveManagerTarget({
        managerId: user?.id || 100,
        agentId: Number(targetFormAgentId),
        clusterId: selectedClusterId !== 'all' ? Number(selectedClusterId) : 1,
        period: toDate.slice(0, 7),
        targetAmount: Number(targetFormAmount || 0),
        itemTargets: [item1, item2]
      });

      if (res?.status === 200) {
        if (showToast) showToast('Sales target saved successfully!');
        setShowTargetModal(false);
        loadReport();
      }
    } catch {
      if (showToast) showToast('Failed to save target.');
    } finally {
      setSavingTarget(false);
    }
  };

  const selectedAgentObj = assignedAgents.find((a) => String(a.id) === String(selectedAgentId));
  const maxBarValue = Math.max(
    reportData.targetAmount || 0,
    reportData.achievedAmount || 0,
    ...(reportData.dailyComparison || []).map((d) => Math.max(d.target || 0, d.achieved || 0)),
    1000
  );

  const shopCounts = reportData.shopCounts || {
    assignedShopsCount: 0,
    visitedShopsCount: 0,
    orderedShopsCount: 0,
    notOrderedShopsCount: 0
  };
  const freqCustomers = reportData.frequentlyOrderedCustomers;
  const perfScale = reportData.performanceIndicatorScale || DEFAULT_PERF_SCALE;
  const dailyDeliveryStatus = reportData.dailyDeliveryStatus || [];

  return (
    <div className="manager-reports-page">
      {/* Header */}
      <div className="page-heading">
        <div>
          <p className="eyebrow">SALES MANAGER PORTAL • PERFORMANCE & TARGETS · IST ({todayIST})</p>
          <h1>Team Reports & Target Tracking</h1>
          <p>
            Monitor real-time sales progress, shop coverage, Target vs Actual, frequently ordered customers, and delivery status across your assigned Field Sales Agents.
          </p>
        </div>

        <div className="heading-actions">
          <button
            className="secondary-button"
            onClick={() => onNavigate && onNavigate('team')}
            title="Inspect assigned team members"
          >
            👥 Manage Team ({assignedAgents.length} assigned)
          </button>
          <button
            className="secondary-button"
            onClick={() => onNavigate && onNavigate('price-requests')}
            title="Review price approval requests"
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <span>Price Approvals</span>
            {pendingPriceCount > 0 && (
              <span style={{
                background: '#d97706',
                color: '#fff',
                fontSize: '11px',
                fontWeight: 800,
                padding: '1px 6px',
                borderRadius: '999px'
              }}>
                {pendingPriceCount}
              </span>
            )}
          </button>
          <button
            className="primary-button"
            onClick={() => setShowTargetModal(true)}
            disabled={assignedSalesAgents.length === 0}
          >
            Configure Sales Target
          </button>
        </div>
      </div>

      {/* Filter Bar with Report Periods (Today, Last 7 days, Last 30 days) */}
      <div className="panel" style={{ marginBottom: '20px', padding: '14px 18px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px', alignItems: 'flex-end' }}>
          {/* Report Period Buttons */}
          <div style={{ display: 'grid', gap: '5px' }}>
            <span style={{ fontSize: '11.5px', fontWeight: 700, color: '#475569' }}>REPORT PERIOD (IST)</span>
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
          </div>

          {/* Agent Filter */}
          <label style={{ display: 'grid', gap: '5px', flex: '1 1 200px' }}>
            <span style={{ fontSize: '11.5px', fontWeight: 700, color: '#475569' }}>ASSIGNED FIELD SALES AGENT</span>
            <select
              className="select"
              value={selectedAgentId}
              onChange={(e) => setSelectedAgentId(e.target.value)}
            >
              <option value="all">All Assigned Field Sales Agents ({assignedSalesAgents.length})</option>
              {assignedSalesAgents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} (#{a.id}) — Field Sales Agent
                </option>
              ))}
            </select>
          </label>

          {/* Cluster Filter (Scoped to Manager's Authorized Clusters) */}
          <label style={{ display: 'grid', gap: '5px', flex: '1 1 180px' }}>
            <span style={{ fontSize: '11.5px', fontWeight: 700, color: '#475569' }}>ASSIGNED CLUSTER ROUTE</span>
            <select
              className="select"
              value={selectedClusterId}
              onChange={(e) => setSelectedClusterId(e.target.value)}
            >
              <option value="all">All Scoped Clusters ({scopedClusters.length})</option>
              {scopedClusters.map((c) => (
                <option key={c.clusterId} value={c.clusterId}>
                  {c.clusterName}
                </option>
              ))}
            </select>
          </label>

          {/* From Date */}
          <label style={{ display: 'grid', gap: '5px', flex: '0 1 150px' }}>
            <span style={{ fontSize: '11.5px', fontWeight: 700, color: '#475569' }}>FROM DATE</span>
            <input
              type="date"
              className="field"
              value={fromDate}
              onChange={(e) => {
                setReportPeriod('custom');
                setFromDate(e.target.value);
              }}
            />
          </label>

          {/* To Date */}
          <label style={{ display: 'grid', gap: '5px', flex: '0 1 150px' }}>
            <span style={{ fontSize: '11.5px', fontWeight: 700, color: '#475569' }}>TO DATE</span>
            <input
              type="date"
              className="field"
              value={toDate}
              onChange={(e) => {
                setReportPeriod('custom');
                setToDate(e.target.value);
              }}
            />
          </label>

          <button
            className="secondary-button"
            onClick={loadReport}
            disabled={loading}
          >
            {loading ? 'Loading...' : '↻ Refresh'}
          </button>
        </div>
      </div>

      {/* Unassigned Empty State */}
      {assignedAgents.length === 0 ? (
        <section className="panel" style={{ textAlign: 'center', padding: '45px 20px' }}>
          <div style={{ fontSize: '36px', marginBottom: '10px' }}>👥</div>
          <h2 style={{ fontSize: '18px', marginBottom: '6px' }}>No Team Members Assigned</h2>
          <p style={{ color: '#78858d', fontSize: '13px', maxWidth: '460px', margin: '0 auto 18px' }}>
            There are currently no active team members assigned to your Sales Manager account by an Administrator.
          </p>
          <button className="primary-button" onClick={() => onNavigate && onNavigate('team')}>
            View Team Assignments →
          </button>
        </section>
      ) : assignedSalesAgents.length === 0 ? (
        <section className="panel" style={{ textAlign: 'center', padding: '45px 20px' }}>
          <div style={{ fontSize: '36px', marginBottom: '10px' }}>🚚</div>
          <h2 style={{ fontSize: '18px', marginBottom: '6px' }}>No Eligible Field Sales Agents Assigned</h2>
          <p style={{ color: '#78858d', fontSize: '13px', maxWidth: '500px', margin: '0 auto 18px' }}>
            You have {assignedDeliveryAgents.length} Delivery Agent(s) assigned ({assignedDeliveryAgents.map((d) => `${d.name} [Delivery Agent]`).join(', ')}), but no active Field Sales Agents. Sales targets and sales performance metrics apply exclusively to Field Sales Agents.
          </p>
          <button className="secondary-button" onClick={() => onNavigate && onNavigate('team')}>
            Inspect Team Members →
          </button>
        </section>
      ) : (
        <>
          {assignedDeliveryAgents.length > 0 && (
            <div style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '10px',
              padding: '10px 16px',
              marginBottom: '16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '8px',
              fontSize: '12.5px',
              color: '#475569'
            }}>
              <div>
                <strong>Assigned Delivery Staff (Excluded from Sales Targets):</strong>{' '}
                {assignedDeliveryAgents.map((d) => `${d.name} (#${d.id} · ${d.role})`).join(', ')}
              </div>
              <span className="status pending">Delivery Role</span>
            </div>
          )}

          {/* Explicit Shop Coverage & Order KPIs */}
          <div className="stats-grid" style={{ marginBottom: '18px' }}>
            <div className="stat-card">
              <div className="stat-top">
                <span>Assigned Shops (Team Scope)</span>
                <span className="stat-icon blue">🏪</span>
              </div>
              <div className="stat-value">{shopCounts.assignedShopsCount}</div>
              <div className="stat-foot">
                Total customer shops assigned to selected scope
              </div>
            </div>

            <div className="stat-card">
              <div className="stat-top">
                <span>Visited Shops (Period)</span>
                <span className="stat-icon purple">📍</span>
              </div>
              <div className="stat-value">{shopCounts.visitedShopsCount}</div>
              <div className="stat-foot">
                Shops visited between {fromDate} & {toDate}
              </div>
            </div>

            <div className="stat-card">
              <div className="stat-top">
                <span>Shops with Orders (Period)</span>
                <span className="stat-icon green">✓</span>
              </div>
              <div className="stat-value">{shopCounts.orderedShopsCount}</div>
              <div className="stat-foot">
                {shopCounts.notOrderedShopsCount} assigned shops without orders
              </div>
            </div>

            <div className="stat-card">
              <div className="stat-top">
                <span>Actual Sales ({reportData.ordersCount || 0} Orders)</span>
                <span className="stat-icon yellow">₹</span>
              </div>
              <div className="stat-value">{money(reportData.achievedAmount)}</div>
              <div className="stat-foot">
                Target: <b>{reportData.hasTarget ? money(reportData.targetAmount) : 'Not set'}</b> ({reportData.achievementPct ?? reportData.achievementRate ?? 0}%)
              </div>
            </div>
          </div>

          {/* Clear Tabular Target vs Actual Section (Team, Agent, and Commodity Breakdown) */}
          <section className="table-panel" style={{ marginBottom: '20px' }}>
            <div className="table-heading" style={{ flexWrap: 'wrap', gap: '8px' }}>
              <div>
                <h2>Tabular Target vs Actual ({fromDate} to {toDate})</h2>
                <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#64748b' }}>
                  Target, actual sales, difference (Actual − Target), achievement percentage, and performance indicator across Field Sales Agents and commodities.
                </p>
              </div>
              <span className={`perf-indicator-badge ${reportData.performanceIndicator?.color || 'neutral'}`}>
                {reportData.performanceIndicator?.label || 'No Target Set'}
              </span>
            </div>

            <div className="table-scroll-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Scope / Field Sales Agent / Commodity</th>
                    <th>Target</th>
                    <th>Actual</th>
                    <th>Difference (Actual − Target)</th>
                    <th>Achievement %</th>
                    <th>Performance Indicator</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Overall Team Row */}
                  <tr style={{ background: '#f0f9ff', fontWeight: 700 }}>
                    <td>
                      <strong>
                        Overall Team Total ({selectedAgentObj ? selectedAgentObj.name : `${assignedSalesAgents.length} Field Sales Agents`})
                      </strong>
                    </td>
                    <td>{reportData.hasTarget ? money(reportData.targetAmount) : '₹0 (Not set)'}</td>
                    <td><strong>{money(reportData.achievedAmount)}</strong></td>
                    <td style={{ color: (reportData.differenceAmount || 0) >= 0 ? '#15803d' : '#b91c1c', fontWeight: 700 }}>
                      {(reportData.differenceAmount || 0) >= 0 ? '+' : ''}
                      {money(reportData.differenceAmount ?? (reportData.achievedAmount - reportData.targetAmount))}
                    </td>
                    <td>
                      <strong>{reportData.hasTarget ? `${reportData.achievementPct ?? reportData.achievementRate}%` : '—'}</strong>
                    </td>
                    <td>
                      <span className={`perf-indicator-badge ${reportData.performanceIndicator?.color || 'neutral'}`}>
                        {reportData.performanceIndicator?.label || 'No Target Set'}
                      </span>
                    </td>
                  </tr>

                  {/* Per-Agent Target vs Actual Rows */}
                  {(reportData.agentBreakdown || []).map((ag) => (
                    <tr key={`agent-${ag.agentId}`}>
                      <td>
                        <strong>👤 {ag.agentName}</strong>{' '}
                        <small style={{ color: '#64748b' }}>
                          ({ag.orderedShopsCount}/{ag.assignedShopsCount} shops ordered · {ag.ordersCount} orders)
                        </small>
                      </td>
                      <td>{ag.targetAmount > 0 ? money(ag.targetAmount) : '₹0 (Not set)'}</td>
                      <td><strong>{money(ag.actualAmount)}</strong></td>
                      <td style={{ color: ag.differenceAmount >= 0 ? '#15803d' : '#b91c1c', fontWeight: 600 }}>
                        {ag.differenceAmount >= 0 ? '+' : ''}{money(ag.differenceAmount)}
                      </td>
                      <td><strong>{ag.targetAmount > 0 ? `${ag.achievementPct}%` : '—'}</strong></td>
                      <td>
                        <span className={`perf-indicator-badge ${ag.performanceIndicator?.color || 'neutral'}`}>
                          {ag.performanceIndicator?.label || 'No Target Set'}
                        </span>
                      </td>
                    </tr>
                  ))}

                  {/* Per-Commodity Target vs Actual Rows */}
                  {(reportData.itemBreakdown || []).map((it) => {
                    const diffVal = it.differenceValue !== undefined ? it.differenceValue : (it.achievedValue - it.targetValue);
                    const diffQty = it.differenceQty !== undefined ? it.differenceQty : (it.achievedQty - it.targetQty);
                    const achPct = it.achievementPct !== undefined
                      ? it.achievementPct
                      : (it.targetQty > 0 ? Math.round((it.achievedQty / it.targetQty) * 100) : 0);
                    return (
                      <tr key={`item-${it.itemId}`}>
                        <td>
                          <strong>📦 {it.itemName}</strong>{' '}
                          <small style={{ color: '#64748b' }}>(Catalog ₹{it.price}/{it.unit || 'kg'})</small>
                        </td>
                        <td>
                          {it.hasTarget ? `${money(it.targetValue)} (${it.targetQty} ${it.unit || 'kg'})` : '—'}
                        </td>
                        <td>
                          <strong>{money(it.achievedValue)}</strong> ({it.achievedQty} {it.unit || 'kg'})
                        </td>
                        <td style={{ color: diffVal >= 0 ? '#15803d' : '#b91c1c', fontWeight: 600 }}>
                          {it.hasTarget
                            ? `${diffVal >= 0 ? '+' : ''}${money(diffVal)} (${diffQty >= 0 ? '+' : ''}${diffQty} ${it.unit || 'kg'})`
                            : `${money(it.achievedValue)} (+${it.achievedQty} ${it.unit || 'kg'})`}
                        </td>
                        <td>
                          <strong>{it.hasTarget ? `${achPct}%` : '—'}</strong>
                        </td>
                        <td>
                          <span className={`perf-indicator-badge ${it.performanceIndicator?.color || 'neutral'}`}>
                            {it.performanceIndicator?.label || (it.hasTarget ? `${achPct}%` : 'No Target Set')}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {/* Frequently Ordered Customers Section (Sales Manager / Admin Exclusive) */}
          <section className="table-panel" style={{ marginBottom: '20px' }}>
            <div className="table-heading" style={{ flexWrap: 'wrap', gap: '8px' }}>
              <div>
                <h2>Frequently Ordered Customers</h2>
                <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#64748b' }}>
                  Rule: <b>{freqCustomers?.rule || 'At least 1 order every 2 days within the selected period'}</b> · Calculation period: <b>{freqCustomers?.calculationPeriod || `${fromDate} to ${toDate}`}</b>
                  {freqCustomers?.minOrdersRequired ? ` · Minimum orders required: ${freqCustomers.minOrdersRequired}` : ''}
                </p>
              </div>
              <span className="status delivered">
                {freqCustomers?.count || 0} {(freqCustomers?.count || 0) === 1 ? 'Customer' : 'Customers'}
              </span>
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
                    <th>Frequency</th>
                    <th>Total Volume (kg)</th>
                    <th style={{ textAlign: 'right' }}>Total Order Value</th>
                  </tr>
                </thead>
                <tbody>
                  {(freqCustomers?.customers || []).length > 0 ? (
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
                          No customers ordered at least once every two days ({freqCustomers?.minOrdersRequired || 1}+ orders) during {freqCustomers?.calculationPeriod || `${fromDate} to ${toDate}`}.
                        </div>
                      </td>
                    </tr>
                  )}
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
                  Orders placed today have tomorrow as their expected delivery date by default; yesterday’s orders are therefore due today. Select any <b>In Progress</b> count for a previous day or today to inspect the matching orders and line items.
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
                    <th>In Progress (Click to open orders)</th>
                    <th style={{ textAlign: 'right' }}>Total Qty (kg)</th>
                  </tr>
                </thead>
                <tbody>
                  {dailyDeliveryStatus.length > 0 ? (
                    dailyDeliveryStatus.map((day) => {
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
                                  setSelectedDayDrilldown({
                                    date: day.date,
                                    expectedDeliveryDate: day.expectedDeliveryDate,
                                    orders: day.inProgressOrders || []
                                  })
                                }
                              >
                                ⏳ {day.inProgressCount} In Progress ({day.inProgressQty} kg) — View orders →
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
                          No delivery status records found for this scope.
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Drill-down Panel when an In Progress count for a previous day is selected */}
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
                    ⏳ In Progress Orders for {formatDateDisplay(selectedDayDrilldown.date)} ({selectedDayDrilldown.orders.length})
                  </h2>
                  <p style={{ color: '#78350f', fontSize: '12px' }}>
                    Expected delivery date: <b>{formatDateDisplay(selectedDayDrilldown.expectedDeliveryDate)}</b> · Showing matching orders and line-item details.
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
                          Agent: <b>{ord.agentName || `#${ord.spersonid}`}</b> · Order Date: <b>{formatDateDisplay(ord.date)}</b> · Expected Delivery: <b style={{ color: '#0369a1' }}>{formatDateDisplay(ord.expectedDeliveryDate)}</b>
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

          {/* Visual Bar Comparison: Today vs Yesterday */}
          <section className="panel" style={{ marginBottom: '20px' }}>
            <div className="panel-head">
              <div>
                <h2>Visual Target vs Achieved Comparison</h2>
                <p>
                  {selectedAgentObj
                    ? `Agent: ${selectedAgentObj.name} (#${selectedAgentObj.id})`
                    : `Aggregated across ${assignedSalesAgents.length} assigned Field Sales Agents`}
                </p>
              </div>
              <div className="legend">
                <span><i style={{ background: '#12aee2' }}></i>Achieved (₹)</span>
                <span><i style={{ background: '#64748b' }}></i>Target Quota (₹)</span>
              </div>
            </div>

            {!reportData.hasTarget && (
              <div className="target-info-notice" style={{ marginBottom: '16px' }}>
                <span className="target-notice-icon">ℹ</span>
                <div className="target-notice-text">
                  <strong>No Target Configured for this Selection:</strong> Click <b>Configure Sales Target</b> in the top right to set a monthly or route quota for your assigned agents.
                </div>
              </div>
            )}

            <div className="target-cards-grid">
              {(reportData.dailyComparison || []).map((day) => {
                const achPct = Math.min(100, Math.max(6, Math.round(((day.achieved || 0) / maxBarValue) * 100)));
                const tgtPct = day.target > 0 ? Math.min(100, Math.max(6, Math.round((day.target / maxBarValue) * 100))) : 0;

                return (
                  <div key={day.label} className="target-day-card">
                    <div className="target-day-head">
                      <div>
                        <span className={`target-day-badge ${day.label === 'Today' ? 'today' : 'yesterday'}`}>
                          {day.label.toUpperCase()}
                        </span>
                        <h3>{day.date}</h3>
                      </div>
                    </div>

                    <div className="target-values-row">
                      <div className="target-val-block">
                        <small>Achieved sales</small>
                        <b className="achieved-text">{money(day.achieved)}</b>
                      </div>
                      <div className="target-val-block">
                        <small>Daily benchmark</small>
                        {day.target > 0 ? (
                          <b className="target-text">{money(day.target)}</b>
                        ) : (
                          <span className="target-unconfigured-pill">Not configured</span>
                        )}
                      </div>
                    </div>

                    <div className="target-bar-container">
                      <div className="target-bar-track" style={{ marginBottom: '6px' }}>
                        <div
                          className="target-bar-fill today-fill"
                          style={{ width: `${achPct}%` }}
                          title={`Achieved: ${money(day.achieved)}`}
                        />
                      </div>
                      {day.target > 0 && (
                        <div className="target-bar-track" style={{ height: '6px', background: '#e2e8f0' }}>
                          <div
                            style={{
                              width: `${tgtPct}%`,
                              height: '100%',
                              background: '#64748b',
                              borderRadius: '6px'
                            }}
                            title={`Target: ${money(day.target)}`}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Bottom Performance Indicator Reference Table (Placed at the bottom of the report page) */}
          <section className="table-panel" style={{ marginTop: '24px' }}>
            <div className="table-heading">
              <div>
                <h2>Performance Indicator Reference Table</h2>
                <small style={{ color: '#7b8a92', fontSize: '12px' }}>
                  Standard achievement bands used to classify Field Sales Agent and route performance
                </small>
              </div>
            </div>
            <div className="table-scroll-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Performance Indicator</th>
                    <th>Achievement % Range</th>
                    <th>Management Interpretation</th>
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
        </>
      )}

      {/* Target Configuration Modal */}
      {showTargetModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.55)',
            zIndex: 100,
            display: 'grid',
            placeItems: 'center',
            padding: '16px'
          }}
        >
          <div className="panel" style={{ width: '100%', maxWidth: '460px', padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <h2 style={{ margin: 0, fontSize: '17px' }}>Configure Agent Sales Target</h2>
              <button
                className="quiet-button"
                onClick={() => setShowTargetModal(false)}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveTarget} style={{ display: 'grid', gap: '14px' }}>
              <label style={{ display: 'grid', gap: '6px' }}>
                <span style={{ fontSize: '12px', fontWeight: 700, color: '#475569' }}>SELECT ASSIGNED FIELD SALES AGENT</span>
                <select
                  className="select"
                  value={targetFormAgentId}
                  onChange={(e) => setTargetFormAgentId(e.target.value)}
                  required
                >
                  {assignedSalesAgents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} (#{a.id}) — Field Sales Agent
                    </option>
                  ))}
                </select>
              </label>

              <label style={{ display: 'grid', gap: '6px' }}>
                <span style={{ fontSize: '12px', fontWeight: 700, color: '#475569' }}>OVERALL TARGET AMOUNT (₹)</span>
                <input
                  type="number"
                  className="field"
                  min="1000"
                  step="500"
                  value={targetFormAmount}
                  onChange={(e) => setTargetFormAmount(e.target.value)}
                  required
                />
              </label>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <label style={{ display: 'grid', gap: '6px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 700, color: '#475569' }}>ONIO MEDIUM TARGET (KGS)</span>
                  <input
                    type="number"
                    className="field"
                    min="0"
                    value={targetFormItem1Qty}
                    onChange={(e) => setTargetFormItem1Qty(e.target.value)}
                  />
                </label>

                <label style={{ display: 'grid', gap: '6px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 700, color: '#475569' }}>ONION BIG TARGET (KGS)</span>
                  <input
                    type="number"
                    className="field"
                    min="0"
                    value={targetFormItem2Qty}
                    onChange={(e) => setTargetFormItem2Qty(e.target.value)}
                  />
                </label>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '8px' }}>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setShowTargetModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="primary-button"
                  disabled={savingTarget}
                >
                  {savingTarget ? 'Saving...' : 'Save Target'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
