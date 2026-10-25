import React, { useState, useEffect, useMemo } from 'react';
import { api } from '../api';

export default function AdminAuditScreen({ user, showToast }) {
  const [loading, setLoading] = useState(true);
  const [logs, setLogs] = useState([]);
  const [actionFilter, setActionFilter] = useState('all');
  const [search, setSearch] = useState('');

  const loadAudit = () => {
    setLoading(true);
    api.getAdminAudit()
      .then((res) => {
        if (res && res.logs) {
          setLogs(res.logs);
        } else if (res && res.status === 403) {
          showToast('Access Denied: Administrator role required.');
        }
      })
      .catch((err) => {
        console.error('Failed to load audit trail', err);
        showToast('Error loading audit trail');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadAudit();
  }, []);

  const uniqueActions = useMemo(() => {
    const set = new Set();
    logs.forEach((l) => {
      if (l.action) set.add(l.action);
    });
    return Array.from(set).sort();
  }, [logs]);

  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      if (actionFilter !== 'all' && log.action !== actionFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const matchAdmin = (log.adminName || '').toLowerCase().includes(q);
        const matchAction = (log.action || '').toLowerCase().includes(q);
        const matchTarget = (log.targetType || '').toLowerCase().includes(q) || (log.targetId || '').includes(q);
        const matchDetails = (log.details || '').toLowerCase().includes(q);
        if (!matchAdmin && !matchAction && !matchTarget && !matchDetails) return false;
      }
      return true;
    });
  }, [logs, actionFilter, search]);

  const getBadgeClass = (action) => {
    const a = (action || '').toUpperCase();
    if (a.includes('CREATE') || a.includes('ACTIVATE')) return 'badge-delivered';
    if (a.includes('UPDATE') || a.includes('SET')) return 'badge-progress';
    if (a.includes('DEACTIVATE')) return 'badge-cancelled';
    return 'badge-neutral';
  };

  return (
    <div className="admin-page-container">
      {/* Header */}
      <div className="page-header-row">
        <div>
          <h1 className="page-title">Security &amp; Governance Audit Trail</h1>
          <p className="page-subtitle">Immutable chronological log of all administrative modifications, target settings, and user actions</p>
        </div>

        <div className="header-actions">
          <button
            type="button"
            className="btn-preset"
            onClick={loadAudit}
          >
            ↻ Refresh Logs
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="card manager-filter-panel">
        <div className="filter-grid-6">
          <div className="filter-control" style={{ flex: 2 }}>
            <label className="filter-label">Search Audit Trail</label>
            <input
              type="text"
              className="filter-input"
              placeholder="Search by action, administrator, target ID, or description..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="filter-control">
            <label className="filter-label">Filter by Action</label>
            <select
              className="filter-select"
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
            >
              <option value="all">All Action Types ({uniqueActions.length})</option>
              {uniqueActions.map((act) => (
                <option key={act} value={act}>
                  {act}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Audit Logs Table */}
      <div className="card">
        <div className="table-header-title">
          <span>Audit Records ({filteredLogs.length})</span>
          <small className="muted-text">Preserved in persistent server storage</small>
        </div>

        {loading ? (
          <div className="loading-state">Loading audit records...</div>
        ) : filteredLogs.length === 0 ? (
          <div className="empty-state">
            <span className="empty-icon">📜</span>
            <h3>No audit records found</h3>
            <p>Administrative modifications will be automatically recorded here.</p>
          </div>
        ) : (
          <div className="table-responsive-wrapper">
            <table className="orders-table">
              <thead>
                <tr>
                  <th>Timestamp (IST)</th>
                  <th>Action Type</th>
                  <th>Administrator</th>
                  <th>Target Type</th>
                  <th>Target ID</th>
                  <th>Event Description / Diff</th>
                </tr>
              </thead>
              <tbody>
                {filteredLogs.map((log) => (
                  <tr key={log.id}>
                    <td className="font-mono text-sm" style={{ whiteSpace: 'nowrap' }}>
                      {log.timestamp ? log.timestamp.slice(0, 19).replace('T', ' ') : '—'}
                    </td>
                    <td>
                      <span className={`status-pill ${getBadgeClass(log.action)}`}>
                        {log.action}
                      </span>
                    </td>
                    <td className="bold-cell">
                      <div>{log.adminName}</div>
                      <small className="muted-text font-mono">ID: #{log.adminId}</small>
                    </td>
                    <td>
                      <span className="cluster-tag">{log.targetType || 'System'}</span>
                    </td>
                    <td className="font-mono">{log.targetId || '—'}</td>
                    <td className="audit-detail-cell">
                      {log.details}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
