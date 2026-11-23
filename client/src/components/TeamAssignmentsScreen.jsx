import React, { useState, useEffect } from 'react';
import { Save } from 'lucide-react';
import { Icon } from '../ui';
import { api } from '../api';

export default function TeamAssignmentsScreen({ user = {}, clusters = [], showToast }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [assignedAgentIds, setAssignedAgentIds] = useState([]);
  const [assignedAgents, setAssignedAgents] = useState([]);
  const [allAgents, setAllAgents] = useState([]);
  const [filterCluster, setFilterCluster] = useState('all');
  const [search, setSearch] = useState('');

  // Admin controls
  const [allManagers, setAllManagers] = useState([]);
  const isUserAdmin = (user?.role || '').toLowerCase() === 'admin';
  const [adminSelectedManagerId, setAdminSelectedManagerId] = useState(null);

  const effectiveManagerId = isUserAdmin
    ? (adminSelectedManagerId || (allManagers[0]?.id ? Number(allManagers[0].id) : null))
    : Number(user?.id);

  // Load assignments
  const loadAssignments = (targetManagerId = effectiveManagerId) => {
    if (!targetManagerId) return;
    setLoading(true);
    api.getManagerAssignments(targetManagerId)
      .then((res) => {
        if (res && res.status === 200) {
          setAssignedAgentIds(res.assignedAgentIds || []);
          setAssignedAgents(res.assignedAgents || []);
          setAllAgents(res.allAgents || []);
        } else if (res && res.status === 403) {
          if (showToast) showToast(res.message || 'Access Denied');
        }
      })
      .catch((err) => {
        console.error('Failed to load team assignments', err);
        if (showToast) showToast('Error loading team assignments');
      })
      .finally(() => setLoading(false));
  };

  // Load managers list if admin
  useEffect(() => {
    if (isUserAdmin) {
      api.getAdminUsers()
        .then((res) => {
          if (res && res.users) {
            const managers = res.users.filter((u) => (u.role || '').toLowerCase() === 'sales manager');
            setAllManagers(managers);
            if (managers.length > 0) {
              setAdminSelectedManagerId((prev) => {
                if (prev && managers.some((m) => Number(m.id) === Number(prev))) return prev;
                return Number(managers[0].id);
              });
            }
          }
        })
        .catch(() => {});
    }
  }, [isUserAdmin]);

  useEffect(() => {
    if (effectiveManagerId) {
      loadAssignments(effectiveManagerId);
    }
  }, [user?.id, effectiveManagerId]);

  // Admin-only toggle agent assignment
  const handleToggleAgent = (agentId) => {
    if (!isUserAdmin) return;
    const id = Number(agentId);
    setAssignedAgentIds((prev) => {
      if (prev.includes(id)) {
        return prev.filter((x) => x !== id);
      } else {
        return [...prev, id];
      }
    });
  };

  // Admin-only save handler
  const handleSaveAssignments = () => {
    if (!isUserAdmin) {
      if (showToast) showToast('Forbidden: Only administrators can modify team assignments.');
      return;
    }
    if (!adminSelectedManagerId) {
      if (showToast) showToast('Please select a manager to configure.');
      return;
    }
    setSaving(true);
    api.updateManagerAssignments(adminSelectedManagerId, assignedAgentIds)
      .then((res) => {
        if (res && res.status === 200) {
          if (showToast) {
            showToast(res.message || `Team assignments saved: ${assignedAgentIds.length} agents mapped.`);
          }
          loadAssignments(adminSelectedManagerId);
        } else {
          if (showToast) showToast(res?.message || 'Failed to save assignments');
        }
      })
      .catch((err) => {
        console.error('Save failed', err);
        if (showToast) showToast('Error saving assignments');
      })
      .finally(() => setSaving(false));
  };

  const getClusterName = (clusterId) => {
    const list = Array.isArray(clusters) ? clusters : [];
    const match = list.find((c) => Number(c.clusterId) === Number(clusterId));
    return match ? (match.clusterName || `Cluster ${match.clusterId}`) : `Cluster ${clusterId || 1}`;
  };

  // Currently configured manager profile
  const currentManager = isUserAdmin
    ? (allManagers.find((m) => Number(m.id) === Number(effectiveManagerId)) || allManagers[0] || { name: 'Regional Manager', role: 'Sales Manager', phone: '—', id: effectiveManagerId })
    : user;

  const assignedSalesAgents = assignedAgents.filter((a) => (a.role || '').toLowerCase() === 'field sales agent');
  const assignedDeliveryAgents = assignedAgents.filter((a) => (a.role || '').toLowerCase() === 'delivery agent');

  // Filtered agents (Admins view allAgents with assignment toggles; Managers view assignedAgents read-only)
  const rosterSource = isUserAdmin ? allAgents : assignedAgents;
  const displayedAgents = rosterSource.filter((agent) => {
    if (filterCluster !== 'all' && Number(agent.clusterid || agent.clusterId) !== Number(filterCluster)) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      const matchName = (agent.name || '').toLowerCase().includes(q);
      const matchPhone = (agent.phone || '').includes(q);
      const matchId = String(agent.id).includes(q);
      const matchRole = (agent.role || '').toLowerCase().includes(q);
      if (!matchName && !matchPhone && !matchId && !matchRole) return false;
    }
    return true;
  });

  return (
    <div className="team-assignments-page" style={{ width: '100%', maxWidth: '100%', boxSizing: 'border-box' }}>
      {/* Header */}
      <div className="page-header-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 className="page-title" style={{ margin: 0, fontSize: '1.4rem', fontWeight: 800 }}>
            {isUserAdmin ? 'System Team Assignment Console' : 'My Sales Team'}
          </h1>
          <p className="page-subtitle" style={{ margin: '4px 0 0 0', color: '#64748b', fontSize: '0.85rem' }}>
            {isUserAdmin
              ? 'Administrator governance: map field sales agents to regional managers'
              : 'Field sales agents assigned to your regional supervision (Read-only)'}
          </p>
        </div>

        {isUserAdmin && (
          <div className="header-actions">
            <button
              type="button"
              className="btn-primary"
              disabled={loading || saving}
              onClick={handleSaveAssignments}
              style={{ padding: '8px 16px', fontWeight: 700 }}
            >
              {saving ? 'Saving...' : <><Icon icon={Save} size={16} /> Save Manager Assignments</>}
            </button>
          </div>
        )}
      </div>

      {/* Security Governance Notice for Managers */}
      {!isUserAdmin && (
        <div className="card" style={{ padding: '0.875rem 1rem', background: '#f8fafc', borderColor: '#cbd5e1', borderRadius: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '1.25rem' }}>🔒</span>
            <div style={{ fontSize: '0.825rem', color: '#475569', lineHeight: 1.4 }}>
              <strong style={{ color: '#0f172a' }}>Centralized Administrator Governance:</strong> Team assignments are configured and governed exclusively by LineCart Administrators. Sales Managers can inspect their active assigned team below and set quotas for these representatives.
            </div>
          </div>
        </div>
      )}

      {/* Admin Manager Selector Bar */}
      {isUserAdmin && (
        <div className="card filter-panel" style={{ padding: '1rem', background: '#fff', borderRadius: '12px', border: '1px solid #edf0f2' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            <label style={{ fontWeight: '700', fontSize: '0.85rem' }}>Configuring Manager:</label>
            <select
              className="filter-select"
              style={{ maxWidth: '300px' }}
              value={adminSelectedManagerId}
              onChange={(e) => setAdminSelectedManagerId(Number(e.target.value))}
            >
              {allManagers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} (ID: #{m.id})
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Manager Summary Card */}
      <div className="card manager-meta-card" style={{ padding: '1rem', background: '#fff', borderRadius: '12px', border: '1px solid #edf0f2', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div className="meta-left" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div className="avatar-large" style={{ width: '44px', height: '44px', borderRadius: '50%', background: '#dbeafe', color: '#1e40af', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: '1.1rem' }}>
            {((currentManager?.name) || 'M').charAt(0).toUpperCase()}
          </div>
          <div className="meta-info">
            <span className="badge-manager" style={{ fontSize: '11px', background: '#e0f2fe', color: '#0369a1', padding: '2px 8px', borderRadius: '6px', fontWeight: 700 }}>
              {currentManager?.role || 'Sales Manager'}
            </span>
            <h2 className="manager-title-name" style={{ margin: '4px 0 2px 0', fontSize: '1.1rem', fontWeight: 700 }}>{currentManager?.name || 'Regional Manager'}</h2>
            <div className="meta-row muted-text" style={{ fontSize: '12px', color: '#64748b' }}>
              <span>📞 {currentManager?.phone || '—'}</span>
              <span style={{ margin: '0 4px' }}>·</span>
              <span>ID: #{currentManager?.id || effectiveManagerId}</span>
            </div>
          </div>
        </div>

        <div className="meta-right-stat" style={{ textAlign: 'right' }}>
          <div className="supervision-count">
            <span className="count-number" style={{ fontSize: '1.4rem', fontWeight: 800, color: '#0f172a' }}>{assignedAgentIds.length}</span>
            <span className="count-label" style={{ fontSize: '12px', color: '#64748b', marginLeft: '6px' }}>Assigned Members</span>
          </div>
          <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end', marginTop: '4px' }}>
            <span style={{ fontSize: '11px', padding: '1px 6px', borderRadius: '4px', background: '#e0f2fe', color: '#0369a1', fontWeight: 600 }}>
              {assignedSalesAgents.length} Sales
            </span>
            {assignedDeliveryAgents.length > 0 && (
              <span style={{ fontSize: '11px', padding: '1px 6px', borderRadius: '4px', background: '#fef3c7', color: '#92400e', fontWeight: 600 }}>
                {assignedDeliveryAgents.length} Delivery
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Empty State Banner if no team members assigned yet */}
      {assignedAgentIds.length === 0 && !loading && (
        <div className="card" style={{ padding: '1.5rem', background: '#eff6ff', borderColor: '#bfdbfe', borderRadius: '12px', textAlign: 'center' }}>
          <span style={{ fontSize: '2.5rem', display: 'block', marginBottom: '0.5rem' }}>📋</span>
          <h3 style={{ margin: '0 0 0.5rem 0', color: '#1e40af', fontSize: '1.1rem' }}>No Team Members Assigned Yet</h3>
          <p style={{ color: '#1e3a8a', maxWidth: '480px', margin: '0 auto', fontSize: '0.875rem', lineHeight: 1.5 }}>
            {isUserAdmin
              ? 'This sales manager currently has no representatives mapped to their regional supervision. Check agents in the roster below and click Save.'
              : 'Your sales manager account does not currently have any representatives mapped to your team. Please contact a LineCart Administrator to assign field sales or delivery representatives to your regional supervision.'}
          </p>
        </div>
      )}

      {/* Sales Team View / Roster Card (Only if Admin OR Manager has assigned agents) */}
      {(isUserAdmin || assignedAgents.length > 0) && (
        <div className="card team-list-card" style={{ padding: '1rem', background: '#fff', borderRadius: '12px', border: '1px solid #edf0f2' }}>
          <div className="team-list-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '14px' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700 }}>
                {isUserAdmin ? 'Assign Team Members' : 'Assigned Regional Team'}
              </h3>
              <p className="muted-text" style={{ margin: '4px 0 0 0', color: '#64748b', fontSize: '0.8rem' }}>
                {isUserAdmin
                  ? 'Check the boxes to map field sales agents and delivery operations to this manager.'
                  : 'Assigned team members reporting to your regional supervision. Quotas and sales performance apply strictly to Field Sales Agents.'}
              </p>
            </div>

            {isUserAdmin && (
              <div className="bulk-selection-actions" style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  className="btn-preset"
                  onClick={() => setAssignedAgentIds(allAgents.map((a) => a.id))}
                  style={{ padding: '4px 10px', fontSize: '11px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#f8fafc', fontWeight: 600 }}
                >
                  Select All ({allAgents.length})
                </button>
                <button
                  type="button"
                  className="btn-preset"
                  onClick={() => setAssignedAgentIds([])}
                  style={{ padding: '4px 10px', fontSize: '11px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#f8fafc', fontWeight: 600 }}
                >
                  Clear All
                </button>
              </div>
            )}
          </div>

          {/* Filter controls */}
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '12px' }}>
            <input
              type="text"
              className="filter-input"
              placeholder="Search member by name, phone, ID, or role..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ flex: 1, minWidth: '180px', height: '34px', fontSize: '12px', padding: '0 10px', border: '1px solid #cbd5e1', borderRadius: '6px' }}
            />
            {Array.isArray(clusters) && clusters.length > 0 && (
              <select
                className="filter-select"
                value={filterCluster}
                onChange={(e) => setFilterCluster(e.target.value)}
                style={{ height: '34px', fontSize: '12px', padding: '0 10px', border: '1px solid #cbd5e1', borderRadius: '6px' }}
              >
                <option value="all">All Clusters</option>
                {clusters.map((c) => (
                  <option key={c.clusterId} value={String(c.clusterId)}>
                    {c.clusterName || `Cluster ${c.clusterId}`}
                  </option>
                ))}
              </select>
            )}
          </div>

          {loading ? (
            <div className="loading-state" style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>Loading team roster...</div>
          ) : displayedAgents.length === 0 ? (
            <div className="empty-state" style={{ padding: '2rem 1rem', textAlign: 'center' }}>
              <span style={{ fontSize: '2rem', display: 'block', marginBottom: '0.5rem' }}>👥</span>
              <h3 style={{ margin: '0 0 0.5rem 0', color: '#0f172a', fontSize: '1rem' }}>No Members Match Filter</h3>
              <p style={{ color: '#64748b', maxWidth: '420px', margin: '0 auto', fontSize: '0.825rem' }}>
                No team representatives match your current search or cluster filter.
              </p>
            </div>
          ) : (
            <div className="table-responsive-wrapper" style={{ overflowX: 'auto' }}>
              <table className="team-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #e2e8f0', textAlign: 'left', color: '#64748b', fontSize: '11px', textTransform: 'uppercase' }}>
                    {isUserAdmin && <th style={{ width: '48px', textAlign: 'center', padding: '8px 4px' }}>Assign</th>}
                    <th style={{ padding: '8px 10px' }}>Member Name</th>
                    <th style={{ padding: '8px 10px' }}>Role</th>
                    <th style={{ padding: '8px 10px' }}>ID</th>
                    <th style={{ padding: '8px 10px' }}>Phone</th>
                    <th style={{ padding: '8px 10px' }}>Cluster Route</th>
                    <th style={{ padding: '8px 10px' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedAgents.map((agent) => {
                    const isAssigned = assignedAgentIds.includes(Number(agent.id));
                    const isDeliv = (agent.role || '').toLowerCase() === 'delivery agent';
                    return (
                      <tr
                        key={agent.id}
                        className={`agent-row ${isAssigned ? 'row-assigned' : ''}`}
                        onClick={() => isUserAdmin && handleToggleAgent(agent.id)}
                        style={{
                          cursor: isUserAdmin ? 'pointer' : 'default',
                          borderBottom: '1px solid #f1f5f9',
                          background: isAssigned ? (isDeliv ? '#fffbeb' : '#f0fdf4') : 'transparent'
                        }}
                      >
                        {isUserAdmin && (
                          <td style={{ textAlign: 'center', padding: '10px 4px' }} onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              className="checkbox-custom"
                              checked={isAssigned}
                              onChange={() => handleToggleAgent(agent.id)}
                              style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                            />
                          </td>
                        )}
                        <td className="bold-cell" style={{ padding: '10px' }}>
                          <div className="agent-name-cell" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span className="agent-avatar-sm" style={{ width: '28px', height: '28px', borderRadius: '50%', background: isDeliv ? '#fef3c7' : '#e2e8f0', color: isDeliv ? '#92400e' : '#1e293b', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: '11px' }}>
                              {(agent.name || 'A').charAt(0)}
                            </span>
                            <div>
                              <div style={{ fontWeight: 600, color: '#0f172a' }}>{agent.name}</div>
                              <small className="muted-text" style={{ color: '#64748b', fontSize: '11px' }}>ID: #{agent.id}</small>
                            </div>
                          </div>
                        </td>
                        <td style={{ padding: '10px' }}>
                          <span
                            style={{
                              padding: '2px 8px',
                              borderRadius: '6px',
                              fontSize: '11px',
                              fontWeight: 600,
                              background: isDeliv ? '#fef3c7' : '#e0f2fe',
                              color: isDeliv ? '#92400e' : '#0369a1'
                            }}
                          >
                            {agent.role || 'Field Sales Agent'}
                          </span>
                        </td>
                        <td className="font-mono" style={{ padding: '10px', color: '#64748b' }}>#{agent.id}</td>
                        <td style={{ padding: '10px', color: '#334155' }}>{agent.phone || '—'}</td>
                        <td style={{ padding: '10px' }}>
                          <span className="cluster-tag" style={{ background: '#f1f5f9', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', color: '#475569' }}>
                            {getClusterName(agent.clusterid || agent.clusterId)}
                          </span>
                        </td>
                        <td style={{ padding: '10px' }}>
                          <span className={`status-pill ${agent.active ? 'badge-delivered' : 'badge-cancelled'}`} style={{ padding: '2px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: 600, background: agent.active ? '#dcfce7' : '#fee2e2', color: agent.active ? '#15803d' : '#b91c1c' }}>
                            {agent.active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {isUserAdmin && (
            <div className="team-footer-save" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginTop: '16px', paddingTop: '12px', borderTop: '1px solid #f1f5f9' }}>
              <span className="save-hint" style={{ fontSize: '12px', color: '#64748b' }}>
                {assignedAgentIds.length} agent(s) currently selected for this manager.
              </span>
              <button
                type="button"
                className="btn-primary"
                disabled={loading || saving}
                onClick={handleSaveAssignments}
                style={{ padding: '8px 16px', fontWeight: 700 }}
              >
                {saving ? 'Saving...' : <><Icon icon={Save} size={16} /> Save Manager Assignments</>}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
