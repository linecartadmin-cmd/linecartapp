import React, { useState, useEffect } from 'react';
import { api } from '../api';

export default function TeamAssignmentsScreen({ user, clusters, showToast }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [assignedAgentIds, setAssignedAgentIds] = useState([]);
  const [assignedAgents, setAssignedAgents] = useState([]);
  const [allAgents, setAllAgents] = useState([]);
  const [isAdmin, setIsAdmin] = useState(false);

  // Admin controls
  const [allManagers, setAllManagers] = useState([]);
  const [adminSelectedManagerId, setAdminSelectedManagerId] = useState(user?.id || 100);

  const isUserAdmin = (user?.role || '').toLowerCase() === 'admin';

  // Load assignments
  const loadAssignments = (targetManagerId = user?.id) => {
    if (!user) return;
    setLoading(true);
    api.getManagerAssignments(targetManagerId)
      .then((res) => {
        if (res && res.status === 200) {
          setAssignedAgentIds(res.assignedAgentIds || []);
          setAssignedAgents(res.assignedAgents || []);
          setAllAgents(res.allAgents || []);
          setIsAdmin(res.isAdmin || isUserAdmin);
        } else if (res && res.status === 403) {
          showToast(res.message || 'Access Denied');
        }
      })
      .catch((err) => {
        console.error('Failed to load team assignments', err);
        showToast('Error loading team assignments');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadAssignments(isUserAdmin ? adminSelectedManagerId : user?.id);
  }, [user, adminSelectedManagerId]);

  // Load managers list if admin
  useEffect(() => {
    if (isUserAdmin) {
      api.getAdminUsers()
        .then((res) => {
          if (res && res.users) {
            const managers = res.users.filter((u) => (u.role || '').toLowerCase() === 'sales manager');
            setAllManagers(managers);
          }
        })
        .catch(() => {});
    }
  }, [isUserAdmin]);

  // Admin-only toggle agent handler
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
      showToast('Forbidden: Only administrators can modify assignments.');
      return;
    }
    setSaving(true);
    api.updateManagerAssignments(adminSelectedManagerId, assignedAgentIds)
      .then((res) => {
        if (res && res.status === 200) {
          showToast(`Assignments updated: ${assignedAgentIds.length} agents mapped to manager.`);
          loadAssignments(adminSelectedManagerId);
        } else {
          showToast(res?.message || 'Failed to save assignments');
        }
      })
      .catch((err) => {
        console.error('Save failed', err);
        showToast('Error saving assignments');
      })
      .finally(() => setSaving(false));
  };

  const getClusterName = (clusterId) => {
    const match = clusters.find((c) => Number(c.clusterId) === Number(clusterId));
    return match ? (match.clusterName || `Cluster ${match.clusterId}`) : `Cluster ${clusterId || 1}`;
  };

  return (
    <div className="team-assignments-page">
      {/* Header */}
      <div className="page-header-row">
        <div>
          <h1 className="page-title">{isUserAdmin ? 'System Team Assignment Console' : 'My Sales Team'}</h1>
          <p className="page-subtitle">
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
            >
              {saving ? 'Saving...' : '💾 Save Manager Assignments'}
            </button>
          </div>
        )}
      </div>

      {/* Security Governance Notice for Managers */}
      {!isUserAdmin && (
        <div className="unmapped-warning-banner card" style={{ background: '#f8fafc', borderColor: '#cbd5e1' }}>
          <div className="unmapped-banner-content">
            <span style={{ fontSize: '1.25rem' }}>🔒</span>
            <div>
              <strong style={{ color: '#0f172a' }}>Centralized Administrator Governance</strong>
              <p style={{ color: '#475569' }}>
                Manager-to-agent assignments are governed by System Administrators. Sales Managers can inspect their team but cannot assign agents to themselves or alter scoping. To request team adjustments, contact your LineCart administrator.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Admin Manager Selector Bar */}
      {isUserAdmin && (
        <div className="card filter-panel" style={{ padding: '1rem' }}>
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
      <div className="card manager-meta-card">
        <div className="meta-left">
          <div className="avatar-large">
            {(user.name || 'M').charAt(0).toUpperCase()}
          </div>
          <div className="meta-info">
            <span className="badge-manager">{user.role || 'Sales Manager'}</span>
            <h2 className="manager-title-name">{user.name}</h2>
            <div className="meta-row muted-text">
              <span>📞 {user.phone}</span>
              <span>·</span>
              <span>ID: #{user.id}</span>
            </div>
          </div>
        </div>

        <div className="meta-right-stat">
          <div className="supervision-count">
            <span className="count-number">{assignedAgentIds.length}</span>
            <span className="count-label">Assigned Agents</span>
          </div>
          <small className="muted-text">
            {assignedAgentIds.length === 0 ? 'No agents currently mapped' : 'Active team members'}
          </small>
        </div>
      </div>

      {/* Sales Team View / Roster Card */}
      <div className="card team-list-card">
        <div className="team-list-header">
          <div>
            <h3>{isUserAdmin ? 'Assign Agents to Manager' : 'Assigned Sales Agents'}</h3>
            <p className="muted-text">
              {isUserAdmin
                ? 'Check the boxes to link sales agents to this manager. Changes persist across server restarts.'
                : 'Reports, order pipelines, and target progress are scoped strictly to these assigned representatives.'}
            </p>
          </div>

          {isUserAdmin && (
            <div className="bulk-selection-actions">
              <button
                type="button"
                className="btn-preset"
                onClick={() => setAssignedAgentIds(allAgents.map((a) => a.id))}
              >
                Select All
              </button>
              <button
                type="button"
                className="btn-preset"
                onClick={() => setAssignedAgentIds([])}
              >
                Deselect All
              </button>
            </div>
          )}
        </div>

        {loading ? (
          <div className="loading-state">Loading team roster...</div>
        ) : (!isUserAdmin && assignedAgents.length === 0) ? (
          <div className="empty-state" style={{ padding: '2.5rem 1rem', textAlign: 'center' }}>
            <span style={{ fontSize: '2.5rem', display: 'block', marginBottom: '0.5rem' }}>📋</span>
            <h3 style={{ margin: '0 0 0.5rem 0', color: '#0f172a' }}>No Sales Agents Assigned Yet</h3>
            <p style={{ color: '#64748b', maxWidth: '420px', margin: '0 auto 1rem auto' }}>
              Your manager account does not currently have any field sales agents mapped to it. Contact a LineCart administrator to assign sales agents to your team.
            </p>
          </div>
        ) : (
          <div className="table-responsive-wrapper">
            <table className="team-table">
              <thead>
                <tr>
                  {isUserAdmin && <th style={{ width: '48px', textAlign: 'center' }}>Assign</th>}
                  <th>Agent Name</th>
                  <th>Employee ID</th>
                  <th>Contact Phone</th>
                  <th>Cluster Route</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {(isUserAdmin ? allAgents : assignedAgents).map((agent) => {
                  const isAssigned = assignedAgentIds.includes(Number(agent.id));
                  return (
                    <tr
                      key={agent.id}
                      className={`agent-row ${isAssigned ? 'row-assigned' : ''}`}
                      onClick={() => isUserAdmin && handleToggleAgent(agent.id)}
                      style={{ cursor: isUserAdmin ? 'pointer' : 'default' }}
                    >
                      {isUserAdmin && (
                        <td style={{ textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            className="checkbox-custom"
                            checked={isAssigned}
                            onChange={() => handleToggleAgent(agent.id)}
                          />
                        </td>
                      )}
                      <td className="bold-cell">
                        <div className="agent-name-cell">
                          <span className="agent-avatar-sm">{(agent.name || 'A').charAt(0)}</span>
                          <div>
                            <div>{agent.name}</div>
                            <small className="muted-text">{agent.role || 'Field Sales Agent'}</small>
                          </div>
                        </div>
                      </td>
                      <td className="font-mono">#{agent.id}</td>
                      <td>{agent.phone || '—'}</td>
                      <td>
                        <span className="cluster-tag">
                          {getClusterName(agent.clusterid)}
                        </span>
                      </td>
                      <td>
                        <span className={`status-pill ${agent.active ? 'badge-delivered' : 'badge-cancelled'}`}>
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
          <div className="team-footer-save">
            <span className="save-hint">
              Changes take effect immediately across all Reports, Orders, and Map filters.
            </span>
            <button
              type="button"
              className="btn-primary"
              disabled={loading || saving}
              onClick={handleSaveAssignments}
            >
              {saving ? 'Saving...' : 'Save Manager Assignments'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
