import React, { useState, useEffect, useMemo } from 'react';
import { api } from '../api';

export default function AdminTargetsScreen({ user, clusters = [], onNavigate, showToast }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [targets, setTargets] = useState([]);
  const [availablePeriods, setAvailablePeriods] = useState(['2026-10', '2026-11', '2026-12']);
  const [selectedPeriod, setSelectedPeriod] = useState('2026-10');
  const [selectedCluster, setSelectedCluster] = useState('all');
  const [selectedManager, setSelectedManager] = useState('all');
  const [search, setSearch] = useState('');

  // Reference data for target creation
  const [usersList, setUsersList] = useState([]);
  const [catalogItems, setCatalogItems] = useState([]);

  // Modal State
  const [showModal, setShowModal] = useState(false);
  const [editingTarget, setEditingTarget] = useState(null);
  const [modalForm, setModalForm] = useState({
    agentId: '',
    managerId: '',
    clusterId: '1',
    period: '2026-10',
    targetAmount: 50000,
    itemTargets: []
  });
  const [modalError, setModalError] = useState('');

  const formatInr = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

  // Load targets from backend
  const loadTargets = () => {
    setLoading(true);
    api.getAdminTargets()
      .then((res) => {
        if (res && res.targets) {
          setTargets(res.targets);
          if (res.availablePeriods && res.availablePeriods.length > 0) {
            setAvailablePeriods(res.availablePeriods);
          }
          if (res.defaultPeriod) {
            setSelectedPeriod((prev) => prev || res.defaultPeriod);
          }
        } else if (res && res.status === 403) {
          showToast('Access Denied: Administrator role required.');
        }
      })
      .catch((err) => {
        console.error('Failed to load targets', err);
        showToast('Error loading target quotas');
      })
      .finally(() => setLoading(false));
  };

  // Load users and commodities
  useEffect(() => {
    loadTargets();

    api.getAdminUsers()
      .then((res) => {
        if (res && res.users) {
          setUsersList(res.users);
        }
      })
      .catch(() => {});

    api.getAdminItems()
      .then((res) => {
        if (res && res.items) {
          setCatalogItems(res.items);
        }
      })
      .catch(() => {});
  }, []);

  // Filtered Field Sales Agents for quota assignment
  const fieldAgents = useMemo(() => {
    return usersList.filter((u) => (u.role || '').toLowerCase() === 'field sales agent' && Number(u.active) === 1);
  }, [usersList]);

  // Managers list
  const managers = useMemo(() => {
    return usersList.filter((u) => (u.role || '').toLowerCase() === 'sales manager');
  }, [usersList]);

  // Filtered targets
  const filteredTargets = useMemo(() => {
    return targets.filter((t) => {
      if (selectedPeriod !== 'all' && t.period !== selectedPeriod) return false;
      if (selectedCluster !== 'all' && Number(t.clusterId) !== Number(selectedCluster)) return false;
      if (selectedManager !== 'all' && Number(t.managerId) !== Number(selectedManager)) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const matchAgent = (t.agentName || '').toLowerCase().includes(q);
        const matchPhone = (t.agentPhone || '').includes(q);
        const matchManager = (t.managerName || '').toLowerCase().includes(q);
        const matchId = String(t.agentId || '').includes(q);
        if (!matchAgent && !matchPhone && !matchManager && !matchId) return false;
      }
      return true;
    });
  }, [targets, selectedPeriod, selectedCluster, selectedManager, search]);

  // Summary Metrics
  const summary = useMemo(() => {
    const totalTarget = filteredTargets.reduce((sum, t) => sum + Number(t.targetAmount || 0), 0);
    const totalAchieved = filteredTargets.reduce((sum, t) => sum + Number(t.achievedAmount || 0), 0);
    const fulfillment = totalTarget > 0 ? Math.round((totalAchieved / totalTarget) * 100) : 0;
    const coveredAgents = new Set(filteredTargets.map((t) => t.agentId)).size;
    return { totalTarget, totalAchieved, fulfillment, coveredAgents };
  }, [filteredTargets]);

  // Open Create Modal
  const openCreateModal = () => {
    const defaultAgent = fieldAgents[0];
    const defaultManager = defaultAgent?.assignedManager?.id || managers[0]?.id || 100;
    const defaultCluster = defaultAgent?.clusterid || 1;

    setEditingTarget(null);
    setModalError('');
    setModalForm({
      agentId: defaultAgent ? String(defaultAgent.id) : '',
      managerId: String(defaultManager),
      clusterId: String(defaultCluster),
      period: selectedPeriod !== 'all' ? selectedPeriod : '2026-10',
      targetAmount: 50000,
      itemTargets: catalogItems.length > 0 ? [
        {
          itemId: catalogItems[0].itemid,
          itemName: catalogItems[0].itemName,
          targetQty: 500,
          targetAmount: Math.round(500 * (catalogItems[0].price || 50))
        }
      ] : []
    });
    setShowModal(true);
  };

  // Open Edit Modal
  const openEditModal = (t) => {
    setEditingTarget(t);
    setModalError('');
    setModalForm({
      id: t.id,
      agentId: String(t.agentId),
      managerId: String(t.managerId || 100),
      clusterId: String(t.clusterId || 1),
      period: t.period || '2026-10',
      targetAmount: Number(t.targetAmount || 0),
      itemTargets: Array.isArray(t.itemTargets) ? JSON.parse(JSON.stringify(t.itemTargets)) : []
    });
    setShowModal(true);
  };

  // On Agent Selected in Modal -> Auto-populate manager and cluster
  const handleAgentSelect = (agentId) => {
    const selected = usersList.find((u) => Number(u.id) === Number(agentId));
    setModalForm((prev) => ({
      ...prev,
      agentId,
      clusterId: selected?.clusterid ? String(selected.clusterid) : prev.clusterId,
      managerId: selected?.assignedManager?.id ? String(selected.assignedManager.id) : prev.managerId
    }));
  };

  // Add Item to Quota
  const handleAddItemQuota = () => {
    const usedIds = (modalForm.itemTargets || []).map((it) => Number(it.itemId));
    const nextItem = catalogItems.find((ci) => !usedIds.includes(Number(ci.itemid))) || catalogItems[0];
    if (!nextItem) return;

    const defaultQty = 200;
    const defaultVal = Math.round(defaultQty * (nextItem.price || 50));

    setModalForm((prev) => ({
      ...prev,
      itemTargets: [
        ...(prev.itemTargets || []),
        {
          itemId: nextItem.itemid,
          itemName: nextItem.itemName,
          targetQty: defaultQty,
          targetAmount: defaultVal
        }
      ]
    }));
  };

  // Update Item Quota
  const handleUpdateItemQuota = (index, field, value) => {
    setModalForm((prev) => {
      const updated = [...(prev.itemTargets || [])];
      if (!updated[index]) return prev;

      if (field === 'itemId') {
        const found = catalogItems.find((ci) => Number(ci.itemid) === Number(value));
        updated[index] = {
          ...updated[index],
          itemId: Number(value),
          itemName: found ? found.itemName : `Item ${value}`,
          targetAmount: Math.round((updated[index].targetQty || 0) * (found?.price || 50))
        };
      } else if (field === 'targetQty') {
        const qty = Number(value) || 0;
        const itemObj = catalogItems.find((ci) => Number(ci.itemid) === Number(updated[index].itemId));
        const price = itemObj?.price || 50;
        updated[index] = {
          ...updated[index],
          targetQty: qty,
          targetAmount: Math.round(qty * price)
        };
      } else if (field === 'targetAmount') {
        updated[index] = {
          ...updated[index],
          targetAmount: Number(value) || 0
        };
      }

      return { ...prev, itemTargets: updated };
    });
  };

  // Remove Item Quota
  const handleRemoveItemQuota = (index) => {
    setModalForm((prev) => ({
      ...prev,
      itemTargets: (prev.itemTargets || []).filter((_, i) => i !== index)
    }));
  };

  // Submit Modal
  const handleModalSubmit = (e) => {
    e.preventDefault();
    setModalError('');

    if (!modalForm.agentId) {
      setModalError('Please select a Field Sales Agent.');
      return;
    }

    if (Number(modalForm.targetAmount) < 0) {
      setModalError('Target amount cannot be negative.');
      return;
    }

    setSaving(true);
    api.saveAdminTarget({
      id: editingTarget ? editingTarget.id : undefined,
      agentId: Number(modalForm.agentId),
      managerId: Number(modalForm.managerId || 100),
      clusterId: Number(modalForm.clusterId || 1),
      period: modalForm.period,
      targetAmount: Number(modalForm.targetAmount || 0),
      itemTargets: modalForm.itemTargets
    })
      .then((res) => {
        if (res && res.status === 200) {
          showToast(res.message || 'Target quota saved successfully!');
          setShowModal(false);
          loadTargets();
        } else {
          setModalError(res?.message || 'Failed to save target quota.');
        }
      })
      .catch((err) => {
        console.error('Save target error', err);
        setModalError('An unexpected error occurred while saving.');
      })
      .finally(() => setSaving(false));
  };

  // Delete Target
  const handleDeleteTarget = (t) => {
    const confirmMsg = `Are you sure you want to delete the target quota of ${formatInr(t.targetAmount)} for ${t.agentName} (${t.period})?`;
    if (!window.confirm(confirmMsg)) return;

    api.deleteAdminTarget(t.id)
      .then((res) => {
        if (res && res.status === 200) {
          showToast(res.message || 'Target deleted successfully');
          loadTargets();
        } else {
          showToast(res?.message || 'Failed to delete target');
        }
      })
      .catch((err) => {
        console.error('Delete target error', err);
        showToast('Error deleting target quota');
      });
  };

  const getClusterName = (clusterId) => {
    const list = Array.isArray(clusters) ? clusters : [];
    const match = list.find((c) => Number(c.clusterId) === Number(clusterId));
    return match ? (match.clusterName || `Cluster ${match.clusterId}`) : `Cluster ${clusterId || 1}`;
  };

  return (
    <div className="admin-page-container">
      {/* Header */}
      <div className="page-header-row">
        <div>
          <div className="admin-role-badge">🎯 Performance Governance</div>
          <h1 className="page-title">Targets &amp; Quotas Management</h1>
          <p className="page-subtitle">
            Configure monthly sales revenue quotas and per-commodity kg targets across sales managers and field agents
          </p>
        </div>

        <div className="header-actions">
          <button
            type="button"
            className="btn-preset"
            onClick={loadTargets}
            title="Refresh target quotas from backend"
          >
            ↻ Refresh
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={openCreateModal}
          >
            + Set New Target
          </button>
        </div>
      </div>

      {/* Top Summary KPI Cards */}
      <div className="admin-kpi-grid">
        <div className="kpi-card highlight-kpi">
          <span className="kpi-label">TOTAL QUOTA ASSIGNED</span>
          <div className="kpi-value text-green">{formatInr(summary.totalTarget)}</div>
          <span className="kpi-sub">Target Cycle: {selectedPeriod === 'all' ? 'All Periods' : selectedPeriod}</span>
        </div>

        <div className="kpi-card">
          <span className="kpi-label">ACHIEVED SALES</span>
          <div className="kpi-value">{formatInr(summary.totalAchieved)}</div>
          <span className="kpi-sub">Real order transactions</span>
        </div>

        <div className="kpi-card">
          <span className="kpi-label">OVERALL FULFILLMENT</span>
          <div className="kpi-value">{summary.fulfillment}%</div>
          <span className="kpi-sub">{summary.fulfillment >= 70 ? '🟢 On track' : '🟡 Gap to target'}</span>
        </div>

        <div className="kpi-card">
          <span className="kpi-label">COVERED AGENTS</span>
          <div className="kpi-value">{summary.coveredAgents} / {fieldAgents.length || 0}</div>
          <span className="kpi-sub">{filteredTargets.length} active quotas configured</span>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="card manager-filter-panel">
        <div className="filter-grid-6">
          <div className="filter-control" style={{ flex: 1.5 }}>
            <label className="filter-label">Search Quotas</label>
            <input
              type="text"
              className="filter-input"
              placeholder="Search by agent name, phone, or ID..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="filter-control">
            <label className="filter-label">Target Period</label>
            <select
              className="filter-select"
              value={selectedPeriod}
              onChange={(e) => setSelectedPeriod(e.target.value)}
            >
              <option value="all">All Cycles</option>
              {availablePeriods.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>

          <div className="filter-control">
            <label className="filter-label">Wholesale Cluster</label>
            <select
              className="filter-select"
              value={selectedCluster}
              onChange={(e) => setSelectedCluster(e.target.value)}
            >
              <option value="all">All Clusters ({clusters.length})</option>
              {clusters.map((c) => (
                <option key={c.clusterId} value={c.clusterId}>
                  {c.clusterName || `Cluster ${c.clusterId}`}
                </option>
              ))}
            </select>
          </div>

          <div className="filter-control">
            <label className="filter-label">Supervising Manager</label>
            <select
              className="filter-select"
              value={selectedManager}
              onChange={(e) => setSelectedManager(e.target.value)}
            >
              <option value="all">All Managers ({managers.length})</option>
              {managers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} (#{m.id})
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Targets Table */}
      <div className="card">
        <div className="table-header-title">
          <span>Target Quotas ({filteredTargets.length})</span>
          <small className="muted-text">Saved in persistent server storage</small>
        </div>

        {loading ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: '#64748b' }}>
            <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>⏳</div>
            <p>Loading target quotas from backend...</p>
          </div>
        ) : filteredTargets.length === 0 ? (
          <div style={{ padding: '3.5rem', textAlign: 'center', color: '#64748b' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>🎯</div>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: '#1e293b', marginBottom: '0.25rem' }}>
              No Target Quotas Found
            </h3>
            <p style={{ fontSize: '0.82rem', color: '#64748b', maxWidth: '420px', margin: '0 auto 1.25rem auto' }}>
              {search || selectedPeriod !== 'all' || selectedCluster !== 'all'
                ? 'No targets match the active filters. Try adjusting your search or period.'
                : 'No sales quotas have been configured yet. Set targets to track agent progress and commodity fulfillment.'}
            </p>
            <button
              type="button"
              className="btn-primary"
              onClick={openCreateModal}
            >
              + Set First Target Quota
            </button>
          </div>
        ) : (
          <div className="table-responsive-wrapper">
            <table className="orders-table">
              <thead>
                <tr>
                  <th>Field Sales Agent</th>
                  <th>Manager &amp; Route</th>
                  <th>Period</th>
                  <th>Revenue Quota</th>
                  <th>Fulfillment Progress</th>
                  <th>Commodity Breakdown</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredTargets.map((t) => {
                  const rate = t.fulfillmentRate || 0;
                  const rateBadge = rate >= 70 ? 'badge-delivered' : rate >= 30 ? 'badge-progress' : 'badge-pending';

                  return (
                    <tr key={t.id}>
                      <td className="bold-cell">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '1.25rem' }}>📋</span>
                          <div>
                            <div>{t.agentName}</div>
                            <small className="muted-text font-mono">ID: #{t.agentId} · {t.agentPhone || 'No phone'}</small>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div>
                          <span className="manager-ref-pill">Mgr: {t.managerName}</span>
                        </div>
                        <div style={{ marginTop: '4px' }}>
                          <span className="cluster-tag">{getClusterName(t.clusterId)}</span>
                        </div>
                      </td>
                      <td className="font-mono">
                        <span className="status-pill badge-neutral">{t.period}</span>
                      </td>
                      <td>
                        <div className="bold-cell" style={{ fontSize: '0.95rem' }}>{formatInr(t.targetAmount)}</div>
                        <small className="muted-text">Achieved: {formatInr(t.achievedAmount)}</small>
                      </td>
                      <td>
                        <div style={{ minWidth: '130px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px', fontSize: '0.75rem' }}>
                            <span className={`status-pill ${rateBadge}`}>{rate}%</span>
                            <span className="muted-text">{t.orderCount || 0} orders</span>
                          </div>
                          <div style={{ height: '6px', background: '#e2e8f0', borderRadius: '4px', overflow: 'hidden' }}>
                            <div
                              style={{
                                height: '100%',
                                width: `${Math.min(100, rate)}%`,
                                background: rate >= 70 ? '#10b981' : rate >= 30 ? '#3b82f6' : '#f59e0b',
                                transition: 'width 0.3s ease'
                              }}
                            />
                          </div>
                          {t.gapAmount > 0 && (
                            <small style={{ fontSize: '0.68rem', color: '#94a3b8' }}>Gap: {formatInr(t.gapAmount)}</small>
                          )}
                        </div>
                      </td>
                      <td>
                        {(!t.itemTargets || t.itemTargets.length === 0) ? (
                          <span className="muted-text text-xs">No commodity quotas set</span>
                        ) : (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', maxWidth: '280px' }}>
                            {t.itemTargets.map((it, idx) => (
                              <span
                                key={idx}
                                style={{
                                  background: '#f1f5f9',
                                  border: '1px solid #e2e8f0',
                                  borderRadius: '6px',
                                  padding: '2px 6px',
                                  fontSize: '0.72rem',
                                  color: '#334155'
                                }}
                              >
                                <strong>{it.itemName}</strong>: {it.targetQty} kg ({formatInr(it.targetAmount)})
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div className="user-action-buttons">
                          <button
                            type="button"
                            className="btn-action-view"
                            onClick={() => openEditModal(t)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="btn-action-delete"
                            onClick={() => handleDeleteTarget(t)}
                            title="Delete this target quota"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal: Create / Edit Target */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-dialog" style={{ maxWidth: '640px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <span className="modal-kicker">Target Governance</span>
                <h2 className="modal-title">
                  {editingTarget ? `Edit Target Quota #${editingTarget.id}` : 'Configure New Sales Target'}
                </h2>
              </div>
              <button
                type="button"
                className="modal-close"
                onClick={() => setShowModal(false)}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleModalSubmit}>
              <div className="modal-body" style={{ maxHeight: '72vh', overflowY: 'auto' }}>
                {modalError && (
                  <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '0.65rem 0.85rem', marginBottom: '1rem', fontSize: '0.78rem', color: '#991b1b' }}>
                    {modalError}
                  </div>
                )}

                <div className="field-group">
                  <label className="filter-label">Field Sales Agent *</label>
                  <select
                    className="filter-select"
                    required
                    value={modalForm.agentId}
                    onChange={(e) => handleAgentSelect(e.target.value)}
                  >
                    <option value="">-- Select Field Sales Agent --</option>
                    {fieldAgents.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} (#{a.id}) · {getClusterName(a.clusterid)} {a.assignedManager ? `(Mgr: ${a.assignedManager.name})` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                  <div className="field-group">
                    <label className="filter-label">Supervising Manager *</label>
                    <select
                      className="filter-select"
                      value={modalForm.managerId}
                      onChange={(e) => setModalForm({ ...modalForm, managerId: e.target.value })}
                    >
                      {managers.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name} (#{m.id})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="field-group">
                    <label className="filter-label">Wholesale Cluster *</label>
                    <select
                      className="filter-select"
                      value={modalForm.clusterId}
                      onChange={(e) => setModalForm({ ...modalForm, clusterId: e.target.value })}
                    >
                      {clusters.map((c) => (
                        <option key={c.clusterId} value={c.clusterId}>
                          {c.clusterName || `Cluster ${c.clusterId}`}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                  <div className="field-group">
                    <label className="filter-label">Quota Cycle / Period (YYYY-MM) *</label>
                    <input
                      type="text"
                      required
                      pattern="\d{4}-\d{2}"
                      placeholder="e.g. 2026-10"
                      className="filter-input"
                      value={modalForm.period}
                      onChange={(e) => setModalForm({ ...modalForm, period: e.target.value })}
                    />
                  </div>

                  <div className="field-group">
                    <label className="filter-label">Total Monthly Target Amount (₹) *</label>
                    <input
                      type="number"
                      required
                      min={0}
                      step={500}
                      className="filter-input"
                      value={modalForm.targetAmount}
                      onChange={(e) => setModalForm({ ...modalForm, targetAmount: e.target.value })}
                    />
                  </div>
                </div>

                {/* Per-Commodity Quota Breakdown Section */}
                <div style={{ marginTop: '1rem', borderTop: '1px solid #e2e8f0', paddingTop: '1rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                    <div>
                      <strong style={{ fontSize: '0.85rem', color: '#1e293b' }}>Commodity Quotas Breakdown</strong>
                      <p style={{ fontSize: '0.72rem', color: '#64748b', margin: 0 }}>
                        Allocate specific kilogram quotas and values for catalog commodities
                      </p>
                    </div>
                    <button
                      type="button"
                      className="btn-preset"
                      style={{ fontSize: '0.75rem', padding: '0.3rem 0.65rem' }}
                      onClick={handleAddItemQuota}
                    >
                      + Add Commodity
                    </button>
                  </div>

                  {(!modalForm.itemTargets || modalForm.itemTargets.length === 0) ? (
                    <div style={{ background: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: '8px', padding: '1rem', textAlign: 'center', color: '#64748b', fontSize: '0.78rem' }}>
                      No commodity items added yet. Click &ldquo;+ Add Commodity&rdquo; to set per-item targets.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      {modalForm.itemTargets.map((it, idx) => (
                        <div
                          key={idx}
                          style={{
                            display: 'grid',
                            gridTemplateColumns: '1.8fr 1fr 1fr auto',
                            gap: '0.5rem',
                            alignItems: 'center',
                            background: '#f8fafc',
                            border: '1px solid #e2e8f0',
                            borderRadius: '8px',
                            padding: '0.5rem 0.65rem'
                          }}
                        >
                          <div>
                            <label style={{ fontSize: '0.68rem', color: '#64748b', display: 'block', marginBottom: '2px' }}>Commodity</label>
                            <select
                              className="filter-select"
                              style={{ width: '100%', fontSize: '0.78rem', height: '32px' }}
                              value={it.itemId}
                              onChange={(e) => handleUpdateItemQuota(idx, 'itemId', e.target.value)}
                            >
                              {catalogItems.map((ci) => (
                                <option key={ci.itemid} value={ci.itemid}>
                                  {ci.itemName} (₹{ci.price}/kg)
                                </option>
                              ))}
                            </select>
                          </div>

                          <div>
                            <label style={{ fontSize: '0.68rem', color: '#64748b', display: 'block', marginBottom: '2px' }}>Target (Kg)</label>
                            <input
                              type="number"
                              min={0}
                              className="filter-input"
                              style={{ width: '100%', fontSize: '0.78rem', height: '32px' }}
                              value={it.targetQty}
                              onChange={(e) => handleUpdateItemQuota(idx, 'targetQty', e.target.value)}
                            />
                          </div>

                          <div>
                            <label style={{ fontSize: '0.68rem', color: '#64748b', display: 'block', marginBottom: '2px' }}>Value (₹)</label>
                            <input
                              type="number"
                              min={0}
                              className="filter-input"
                              style={{ width: '100%', fontSize: '0.78rem', height: '32px' }}
                              value={it.targetAmount}
                              onChange={(e) => handleUpdateItemQuota(idx, 'targetAmount', e.target.value)}
                            />
                          </div>

                          <div style={{ paddingTop: '14px' }}>
                            <button
                              type="button"
                              onClick={() => handleRemoveItemQuota(idx)}
                              style={{
                                background: '#fee2e2',
                                color: '#b91c1c',
                                border: 'none',
                                borderRadius: '6px',
                                width: '28px',
                                height: '28px',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontWeight: 'bold'
                              }}
                              title="Remove commodity"
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="modal-footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                {editingTarget ? (
                  <button
                    type="button"
                    className="btn-danger"
                    onClick={() => {
                      setShowModal(false);
                      handleDeleteTarget(editingTarget);
                    }}
                  >
                    Delete Target
                  </button>
                ) : <span />}

                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setShowModal(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn-primary"
                    disabled={saving}
                  >
                    {saving ? 'Saving...' : 'Save Target Quota'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
