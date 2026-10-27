import React, { useState, useEffect } from 'react';
import { api } from '../api';

export default function ManagerReportsScreen({
  user,
  clusters = [],
  onNavigate,
  showToast
}) {
  const [assignedAgents, setAssignedAgents] = useState([]);
  const [selectedAgentId, setSelectedAgentId] = useState('all');
  const [selectedClusterId, setSelectedClusterId] = useState('all');

  const todayStr = new Date().toISOString().slice(0, 10);
  const weekAgoStr = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

  const [fromDate, setFromDate] = useState(weekAgoStr);
  const [toDate, setToDate] = useState(todayStr);

  const [loading, setLoading] = useState(false);
  const [reportData, setReportData] = useState({
    hasTarget: false,
    targetAmount: 0,
    achievedAmount: 0,
    targetGap: 0,
    achievementRate: 0,
    itemBreakdown: [],
    dailyComparison: [],
    ordersCount: 0
  });

  // Target Configuration Modal State
  const [showTargetModal, setShowTargetModal] = useState(false);
  const [targetFormAgentId, setTargetFormAgentId] = useState('');
  const [targetFormAmount, setTargetFormAmount] = useState('50000');
  const [targetFormItem1Qty, setTargetFormItem1Qty] = useState('500');
  const [targetFormItem2Qty, setTargetFormItem2Qty] = useState('400');
  const [savingTarget, setSavingTarget] = useState(false);

  const money = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');

  // Load assigned agents for this manager
  const loadAssignments = async () => {
    try {
      const res = await api.getManagerAssignments(user?.id || 100);
      if (res?.status === 200) {
        setAssignedAgents(res.assignedAgents || []);
        if (res.assignedAgents?.length > 0 && !targetFormAgentId) {
          setTargetFormAgentId(String(res.assignedAgents[0].id));
        }
      }
    } catch {
      if (showToast) showToast('Failed to load assigned sales agents');
    }
  };

  // Load report data from backend with strict manager scoping
  const loadReport = async () => {
    setLoading(true);
    try {
      const res = await api.getManagerReports({
        managerId: user?.id || 100,
        agentId: selectedAgentId,
        clusterId: selectedClusterId,
        fromDate,
        toDate
      });

      if (res?.status === 200 && res.report) {
        setReportData(res.report);
      } else if (res?.status === 403) {
        if (showToast) showToast('Access restricted: Agent not assigned to you.');
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
  }, [user?.id, selectedAgentId, selectedClusterId, fromDate, toDate]);

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

  return (
    <div className="manager-reports-page">
      {/* Header */}
      <div className="page-heading">
        <div>
          <p className="eyebrow">SALES MANAGER PORTAL • PERFORMANCE & TARGETS</p>
          <h1>Team Reports & Target Tracking</h1>
          <p>
            Monitor real-time sales progress, targets, and commodity gaps across your assigned Field Sales Agents.
          </p>
        </div>

        <div className="heading-actions">
          <button
            className="secondary-button"
            onClick={() => onNavigate && onNavigate('team-assignments')}
            title="Manage which field sales agents report to you"
          >
            👥 Manage Team ({assignedAgents.length} assigned)
          </button>
          <button
            className="primary-button"
            onClick={() => setShowTargetModal(true)}
          >
            🎯 Configure Target
          </button>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="reports-toolbar mb-5">
        {/* Cluster Filter */}
        <div className="reports-filter-group">
          <label htmlFor="mgrCluster" className="reports-filter-label">CLUSTER</label>
          <select
            id="mgrCluster"
            className="select reports-cluster-select"
            value={selectedClusterId}
            onChange={(e) => setSelectedClusterId(e.target.value)}
          >
            <option value="all">All clusters</option>
            {clusters.map((c) => (
              <option key={c.clusterId} value={String(c.clusterId)}>
                {c.clusterName}
              </option>
            ))}
          </select>
        </div>

        {/* Assigned Agent Filter (Strictly limited to assigned agents) */}
        <div className="reports-filter-group">
          <label htmlFor="mgrAgent" className="reports-filter-label">ASSIGNED AGENT</label>
          <select
            id="mgrAgent"
            className="select reports-cluster-select"
            value={selectedAgentId}
            onChange={(e) => setSelectedAgentId(e.target.value)}
          >
            <option value="all">
              All assigned agents ({assignedAgents.length})
            </option>
            {assignedAgents.map((a) => (
              <option key={a.id} value={String(a.id)}>
                {a.name} ({a.phone})
              </option>
            ))}
          </select>
        </div>

        {/* Date Range Filters */}
        <div className="reports-filter-group">
          <label htmlFor="mgrFromDate" className="reports-filter-label">FROM DATE</label>
          <input
            id="mgrFromDate"
            type="date"
            className="field"
            style={{ height: '38px', fontSize: '11px', width: '135px' }}
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
          />
        </div>

        <div className="reports-filter-group">
          <label htmlFor="mgrToDate" className="reports-filter-label">TO DATE</label>
          <input
            id="mgrToDate"
            type="date"
            className="field"
            style={{ height: '38px', fontSize: '11px', width: '135px' }}
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
          />
        </div>

        <button
          className="secondary-button"
          style={{ height: '38px', alignSelf: 'flex-end', marginLeft: 'auto' }}
          onClick={loadReport}
          disabled={loading}
        >
          ↻ {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {/* Warning Notice if Manager has no agents assigned */}
      {assignedAgents.length === 0 && (
        <div className="target-info-notice mb-5" style={{ background: '#fffbeb', borderColor: '#fde68a' }}>
          <span className="target-notice-icon">⚠️</span>
          <div>
            <strong>No Sales Agents Assigned:</strong> You do not currently have any Field Sales Agents assigned to your manager view.
            Backend access is strictly scoped to assigned team members.
            <button
              className="text-blue-600 font-bold ml-2 underline cursor-pointer"
              onClick={() => onNavigate && onNavigate('team-assignments')}
            >
              Click here to assign agents now →
            </button>
          </div>
        </div>
      )}

      {/* Target Unconfigured Notice if no targets stored */}
      {assignedAgents.length > 0 && !reportData.hasTarget && (
        <div className="target-info-notice mb-5">
          <span className="target-notice-icon">ℹ️</span>
          <div>
            <strong>Target Not Configured:</strong> No sales targets have been set for the selected period/agent in the database.
            Achieved sales ({money(reportData.achievedAmount)}) reflect real order transactions.
            <button
              className="text-blue-600 font-bold ml-2 underline cursor-pointer"
              onClick={() => setShowTargetModal(true)}
            >
              Configure target figures now →
            </button>
          </div>
        </div>
      )}

      {/* KPI Cards: Target, Achieved, Gap, Achievement % */}
      <section className="stats-grid mb-5">
        <article className="stat-card">
          <div className="stat-top">
            <span>Overall Sales Target</span>
            <span className="stat-icon blue">🎯</span>
          </div>
          <div className="stat-value">
            {reportData.hasTarget ? money(reportData.targetAmount) : 'Not configured'}
          </div>
          <div className="stat-foot">
            {selectedAgentId === 'all'
              ? `Aggregated across ${assignedAgents.length} assigned agents`
              : `Target for ${selectedAgentObj?.name || 'Agent'}`}
          </div>
        </article>

        <article className="stat-card">
          <div className="stat-top">
            <span>Achieved Sales</span>
            <span className="stat-icon green">₹</span>
          </div>
          <div className="stat-value text-[#0284c7]">
            {money(reportData.achievedAmount)}
          </div>
          <div className="stat-foot">
            <span className="up font-bold">✓</span> {reportData.ordersCount} verified wholesale orders
          </div>
        </article>

        <article className="stat-card">
          <div className="stat-top">
            <span>Remaining Target Gap</span>
            <span className="stat-icon yellow">◷</span>
          </div>
          <div className="stat-value" style={{ color: reportData.targetGap > 0 ? '#df9c2f' : '#29996d' }}>
            {reportData.hasTarget
              ? (reportData.targetGap > 0 ? money(reportData.targetGap) : 'Target Reached! 🎉')
              : 'Target not set'}
          </div>
          <div className="stat-foot">
            {reportData.targetGap > 0
              ? 'Required sales to reach quota'
              : 'Quota fully achieved for period'}
          </div>
        </article>

        <article className="stat-card">
          <div className="stat-top">
            <span>Achievement Progress</span>
            <span className="stat-icon purple">📊</span>
          </div>
          <div className="stat-value">
            {reportData.hasTarget ? `${reportData.achievementRate}%` : '—'}
          </div>
          <div className="stat-foot">
            <div className="w-full h-1.5 bg-slate-100 rounded-full mt-1 overflow-hidden">
              <div
                className="h-full bg-[#12aee2] rounded-full transition-all"
                style={{ width: `${Math.min(100, reportData.achievementRate || 0)}%` }}
              />
            </div>
          </div>
        </article>
      </section>

      {/* Target vs Achieved Graph Panel */}
      <section className="panel target-achieved-panel mb-5">
        <div className="panel-head flex justify-between items-center mb-4">
          <div>
            <h2 className="text-base font-bold text-slate-800">Target vs. Achieved Sales Graph</h2>
            <p className="text-xs text-slate-500">
              Visual sales volume vs target quota comparison for the selected reporting period.
            </p>
          </div>
          <div className="legend flex gap-4 text-xs font-semibold">
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-gradient-to-r from-[#12aee2] to-[#0284c7] inline-block" />
              Achieved Sales
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-slate-300 inline-block" />
              Target Quota
            </span>
          </div>
        </div>

        <div className="target-cards-grid grid grid-cols-1 md:grid-cols-2 gap-4">
          {(reportData.dailyComparison || []).map((day) => {
            const achPct = maxBarValue > 0 ? Math.min(100, Math.round((day.achieved / maxBarValue) * 100)) : 0;
            const tgtPct = maxBarValue > 0 ? Math.min(100, Math.round((day.target / maxBarValue) * 100)) : 0;
            return (
              <div key={day.label} className="target-day-card p-4 border border-slate-100 rounded-xl bg-slate-50">
                <div className="flex justify-between items-center mb-2">
                  <h3 className="font-bold text-sm text-slate-800">{day.label}</h3>
                  <small className="text-[10px] text-slate-400 font-mono">{day.date}</small>
                </div>

                <div className="target-values-row my-2 py-2 border-y border-slate-200 grid grid-cols-2 gap-4">
                  <div>
                    <small className="text-[10px] text-slate-500 uppercase block font-semibold">Achieved</small>
                    <span className="achieved-text text-lg font-bold text-[#0284c7]">{money(day.achieved)}</span>
                  </div>
                  <div>
                    <small className="text-[10px] text-slate-500 uppercase block font-semibold">Target</small>
                    <span className="target-text text-lg font-bold text-slate-600">
                      {day.target > 0 ? money(day.target) : <span className="target-unconfigured-pill">Not set</span>}
                    </span>
                  </div>
                </div>

                {/* Bars */}
                <div className="space-y-2 mt-3">
                  <div>
                    <div className="flex justify-between text-[10px] text-slate-500 mb-1">
                      <span>Achieved</span>
                      <b>{money(day.achieved)}</b>
                    </div>
                    <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-[#12aee2] to-[#0284c7] rounded-full transition-all"
                        style={{ width: `${achPct}%` }}
                      />
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between text-[10px] text-slate-500 mb-1">
                      <span>Target</span>
                      <b>{day.target > 0 ? money(day.target) : '—'}</b>
                    </div>
                    <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-slate-400 rounded-full transition-all"
                        style={{ width: `${tgtPct}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Per-Item Target vs Achieved Breakdown Table with Target Gap */}
      <section className="table-panel summary-table-card mb-5">
        <div className="table-heading flex justify-between items-center">
          <div>
            <h2>Per-Item Target & Achieved Commodity Gap</h2>
            <span className="recent-count">
              Quantity and monetary gap analysis broken down by agricultural commodity.
            </span>
          </div>
          <button
            className="secondary-button text-xs py-1 px-3"
            onClick={() => setShowTargetModal(true)}
          >
            ✏️ Edit Targets
          </button>
        </div>

        <div className="summary-table-scroll">
          <table className="data-table" style={{ minWidth: '750px' }}>
            <thead>
              <tr>
                <th>Commodity Name</th>
                <th>Target Qty</th>
                <th>Achieved Qty</th>
                <th>Quantity Gap</th>
                <th>Target Value</th>
                <th>Achieved Value</th>
                <th>Value Gap</th>
                <th>Fulfillment</th>
              </tr>
            </thead>
            <tbody>
              {reportData.itemBreakdown?.length > 0 ? (
                reportData.itemBreakdown.map((item) => {
                  const pct = item.targetValue > 0
                    ? Math.min(100, Math.round((item.achievedValue / item.targetValue) * 100))
                    : (item.achievedQty > 0 ? 100 : 0);
                  return (
                    <tr key={item.itemId}>
                      <td>
                        <div className="flex items-center gap-2">
                          <span className="stat-icon blue text-xs">🥬</span>
                          <strong>{item.itemName}</strong>
                        </div>
                      </td>
                      <td>
                        <b>{item.targetQty > 0 ? `${item.targetQty} Kgs` : <span className="text-slate-400">—</span>}</b>
                      </td>
                      <td>
                        <b className="text-blue-600">{item.achievedQty} Kgs</b>
                      </td>
                      <td>
                        {item.qtyGap > 0 ? (
                          <span className="status pending text-xs font-bold text-amber-700 bg-amber-50">
                            {item.qtyGap} Kgs needed
                          </span>
                        ) : (
                          <span className="status delivered text-xs">✓ Met</span>
                        )}
                      </td>
                      <td>
                        <b>{item.targetValue > 0 ? money(item.targetValue) : <span className="text-slate-400">—</span>}</b>
                      </td>
                      <td>
                        <b className="text-emerald-700">{money(item.achievedValue)}</b>
                      </td>
                      <td>
                        {item.valueGap > 0 ? (
                          <span className="text-xs font-bold text-amber-700">
                            {money(item.valueGap)}
                          </span>
                        ) : (
                          <span className="text-xs font-bold text-emerald-600">✓ Quota Met</span>
                        )}
                      </td>
                      <td>
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-[#12aee2] rounded-full transition-all"
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
                  <td colSpan="8">
                    <div className="empty-state">No commodity records for this selection.</div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Target Configuration Modal */}
      {showTargetModal && (
        <div className="fixed inset-0 bg-slate-900/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-base font-bold text-slate-800">🎯 Configure Sales Quota / Target</h2>
              <button
                className="text-slate-400 hover:text-slate-600 text-lg font-bold"
                onClick={() => setShowTargetModal(false)}
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-500 mb-4">
              Set actual sales targets in rupees and per-item quantities for an assigned Field Sales Agent.
            </p>

            <form onSubmit={handleSaveTarget} className="space-y-4">
              {assignedAgents.length === 0 ? (
                <div style={{ padding: '12px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', marginBottom: '14px' }}>
                  <div style={{ fontWeight: 700, color: '#92400e', fontSize: '12px', marginBottom: '4px' }}>
                    ⚠️ No Field Sales Agents Assigned
                  </div>
                  <p style={{ margin: '0 0 10px 0', fontSize: '11px', color: '#78350f', lineHeight: 1.4 }}>
                    Your manager account currently has no Field Sales Agents assigned to your team. Please assign agents to your team first before configuring quotas.
                  </p>
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => {
                      setShowTargetModal(false);
                      if (onNavigate) onNavigate('team');
                    }}
                    style={{ fontSize: '11px', height: '32px' }}
                  >
                    👥 Open Manage Team
                  </button>
                </div>
              ) : (
                <div className="field-group">
                  <label className="text-xs font-semibold text-slate-700">Assigned Field Sales Agent *</label>
                  <select
                    className="select w-full"
                    value={targetFormAgentId}
                    onChange={(e) => setTargetFormAgentId(e.target.value)}
                    required
                  >
                    {assignedAgents.map((a) => (
                      <option key={a.id} value={String(a.id)}>
                        {a.name} ({a.phone})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="field-group">
                <label className="text-xs font-semibold text-slate-700">Monthly Sales Target Amount (₹) *</label>
                <input
                  type="number"
                  className="field w-full"
                  required
                  disabled={assignedAgents.length === 0}
                  value={targetFormAmount}
                  onChange={(e) => setTargetFormAmount(e.target.value)}
                  placeholder="e.g. 50000"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="field-group">
                  <label className="text-xs font-semibold text-slate-700">Onio Medium Target (Kgs)</label>
                  <input
                    type="number"
                    className="field w-full"
                    disabled={assignedAgents.length === 0}
                    value={targetFormItem1Qty}
                    onChange={(e) => setTargetFormItem1Qty(e.target.value)}
                    placeholder="e.g. 500"
                  />
                </div>
                <div className="field-group">
                  <label className="text-xs font-semibold text-slate-700">Onion Big Target (Kgs)</label>
                  <input
                    type="number"
                    className="field w-full"
                    disabled={assignedAgents.length === 0}
                    value={targetFormItem2Qty}
                    onChange={(e) => setTargetFormItem2Qty(e.target.value)}
                    placeholder="e.g. 400"
                  />
                </div>
              </div>

              <div className="flex gap-2 justify-end pt-3 border-t border-slate-100">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setShowTargetModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingTarget || assignedAgents.length === 0}
                  className="primary-button"
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
