import React, { useState, useEffect } from 'react';
import { api } from '../api';

export default function AdminDashboardScreen({ user, onNavigate, showToast }) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const loadDashboard = () => {
    setLoading(true);
    setError(null);
    api.getAdminDashboard()
      .then((res) => {
        if (res && res.status === 200) {
          setData(res);
        } else if (res && res.status === 403) {
          setError('Access Denied: Administrator role required.');
          if (showToast) showToast('Access Denied: Administrator role required.');
        } else {
          setError(res?.message || 'Failed to load organization metrics.');
        }
      })
      .catch((err) => {
        console.error('Failed to load admin dashboard', err);
        setError('Error connecting to LineCart server.');
        if (showToast) showToast('Error loading admin dashboard');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadDashboard();
  }, []);

  const formatInr = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

  if (loading) {
    return (
      <div className="admin-page-container">
        <div className="card" style={{ padding: '3.5rem', textAlign: 'center', color: '#64748b' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>⏳</div>
          <div style={{ fontSize: '1rem', fontWeight: 600, color: '#1e293b' }}>Loading Executive Command Center...</div>
          <p style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.25rem' }}>Aggregating organization metrics, routes, and performance</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="admin-page-container">
        <div className="card" style={{ padding: '2.5rem', textAlign: 'center', maxWidth: '520px', margin: '2rem auto' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>⚠️</div>
          <h2 style={{ fontSize: '1.125rem', fontWeight: 'bold', color: '#1e293b', marginBottom: '0.5rem' }}>
            {error || 'Unable to Load Executive Dashboard'}
          </h2>
          <p style={{ fontSize: '0.8125rem', color: '#64748b', marginBottom: '1.25rem', lineHeight: '1.5' }}>
            Could not retrieve organization metrics from the backend. Ensure your account has Administrator privileges.
          </p>
          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
            <button
              type="button"
              className="btn-primary"
              onClick={loadDashboard}
              style={{ padding: '0.5rem 1.25rem', fontSize: '0.8125rem' }}
            >
              Retry Loading
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                localStorage.removeItem('LineCartPref_token');
                localStorage.removeItem('LineCartPref_user');
                localStorage.removeItem('LineCartPref_userid');
                window.location.reload();
              }}
              style={{ padding: '0.5rem 1.25rem', fontSize: '0.8125rem' }}
            >
              Sign In Again
            </button>
          </div>
        </div>
      </div>
    );
  }

  const metrics = data?.metrics || {
    totalUsers: 0,
    activeUsers: 0,
    managerCount: 0,
    agentCount: 0,
    adminCount: 0,
    totalShops: 0,
    totalClusters: 0,
    totalOrders: 0,
    totalRevenue: 0,
    totalUnits: 0,
    averageOrderValue: 0
  };

  const clusterStats = data?.clusterStatsBreakdown || [];
  const managerStats = data?.managerBreakdown || [];
  const recentAudits = data?.recentAudits || [];

  return (
    <div className="admin-page-container">
      {/* Header */}
      <div className="page-header-row">
        <div>
          <div className="admin-role-badge">🛡 LineCart Executive Administration</div>
          <h1 className="page-title">Executive Command Center</h1>
          <p className="page-subtitle">Full system governance, organization metrics, and access control</p>
        </div>

        <div className="header-actions">
          <button
            type="button"
            className="btn-primary"
            onClick={() => onNavigate('admin-users')}
          >
            + Create New User
          </button>
        </div>
      </div>

      {/* Top Organization KPI Grid */}
      <div className="admin-kpi-grid">
        <div className="kpi-card highlight-kpi">
          <span className="kpi-label">GROSS REVENUE</span>
          <div className="kpi-value text-green">{formatInr(metrics.totalRevenue)}</div>
          <span className="kpi-sub">Across all delivery routes</span>
        </div>

        <div className="kpi-card">
          <span className="kpi-label">TOTAL ORDERS</span>
          <div className="kpi-value">{metrics.totalOrders}</div>
          <span className="kpi-sub">Avg Order: {formatInr(metrics.averageOrderValue)}</span>
        </div>

        <div className="kpi-card">
          <span className="kpi-label">TOTAL USERS</span>
          <div className="kpi-value">{metrics.totalUsers}</div>
          <span className="kpi-sub">{metrics.managerCount} Managers · {metrics.agentCount} Agents · {metrics.adminCount} Admins</span>
        </div>

        <div className="kpi-card">
          <span className="kpi-label">STORES &amp; ROUTES</span>
          <div className="kpi-value">{metrics.totalShops}</div>
          <span className="kpi-sub">{metrics.totalClusters} Wholesale Clusters</span>
        </div>
      </div>

      {/* Quick Access Tiles to All Management Screens */}
      <div className="admin-quick-nav-grid">
        <div className="nav-tile" onClick={() => onNavigate('admin-users')}>
          <div className="tile-icon">👥</div>
          <div className="tile-info">
            <strong>User Management</strong>
            <span>Create, edit, and deactivate user accounts and assign roles</span>
          </div>
          <span className="tile-arrow">→</span>
        </div>

        <div className="nav-tile" onClick={() => onNavigate('admin-roles')}>
          <div className="tile-icon">🛡</div>
          <div className="tile-info">
            <strong>Roles &amp; Permissions</strong>
            <span>Configure accessible pages and actions for non-admin roles</span>
          </div>
          <span className="tile-arrow">→</span>
        </div>

        <div className="nav-tile" onClick={() => onNavigate('admin-assignments')}>
          <div className="tile-icon">🔗</div>
          <div className="tile-info">
            <strong>Team Assignments</strong>
            <span>Map sales agents to regional managers with persistent storage</span>
          </div>
          <span className="tile-arrow">→</span>
        </div>

        <div className="nav-tile" onClick={() => onNavigate('admin-targets')}>
          <div className="tile-icon">🎯</div>
          <div className="tile-info">
            <strong>Targets &amp; Quotas</strong>
            <span>Set and manage revenue and commodity quotas org-wide</span>
          </div>
          <span className="tile-arrow">→</span>
        </div>

        <div className="nav-tile" onClick={() => onNavigate('admin-orders')}>
          <div className="tile-icon">📦</div>
          <div className="tile-info">
            <strong>All Company Orders</strong>
            <span>Inspect unscoped orders across all teams, shops, and clusters</span>
          </div>
          <span className="tile-arrow">→</span>
        </div>

        <div className="nav-tile" onClick={() => onNavigate('admin-reports')}>
          <div className="tile-icon">📈</div>
          <div className="tile-info">
            <strong>Executive Reports</strong>
            <span>Org-wide target vs achieved performance analysis</span>
          </div>
          <span className="tile-arrow">→</span>
        </div>

        <div className="nav-tile" onClick={() => onNavigate('admin-audit')}>
          <div className="tile-icon">📜</div>
          <div className="tile-info">
            <strong>Security Audit Trail</strong>
            <span>Review timestamps, administrators, and changes made</span>
          </div>
          <span className="tile-arrow">→</span>
        </div>

        <div className="nav-tile" onClick={() => onNavigate('admin-settings')}>
          <div className="tile-icon">⚙️</div>
          <div className="tile-info">
            <strong>System Settings</strong>
            <span>Organization branding, default periods, and system mode</span>
          </div>
          <span className="tile-arrow">→</span>
        </div>
      </div>

      {/* Cluster Performance Breakdown */}
      <div className="card">
        <div className="table-header-title">
          <span>Cluster Route Performance</span>
          <small className="muted-text">Real-time revenue and shop coverage across clusters</small>
        </div>

        <div className="table-responsive-wrapper">
          <table className="orders-table">
            <thead>
              <tr>
                <th>Cluster Route</th>
                <th>Cluster ID</th>
                <th>Registered Shops</th>
                <th>Orders Placed</th>
                <th>Total Revenue (₹)</th>
              </tr>
            </thead>
            <tbody>
              {clusterStats.map((c) => (
                <tr key={c.clusterId}>
                  <td className="bold-cell">{c.clusterName}</td>
                  <td className="font-mono">#{c.clusterId}</td>
                  <td>{c.shopCount} stores</td>
                  <td>{c.orderCount} orders</td>
                  <td className="bold-cell">{formatInr(c.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Sales Manager Team Summary */}
      <div className="card">
        <div className="table-header-title">
          <span>Regional Sales Managers Overview</span>
          <button
            type="button"
            className="btn-preset"
            onClick={() => onNavigate('admin-assignments')}
          >
            Manage Mappings →
          </button>
        </div>

        <div className="table-responsive-wrapper">
          <table className="orders-table">
            <thead>
              <tr>
                <th>Sales Manager</th>
                <th>Assigned Agents</th>
                <th>Team Orders</th>
                <th>Team Revenue</th>
                <th>Assigned Quota</th>
                <th>Fulfillment</th>
              </tr>
            </thead>
            <tbody>
              {managerStats.length === 0 ? (
                <tr>
                  <td colSpan="6" style={{ textAlign: 'center', padding: '1.5rem', color: '#64748b' }}>
                    No Sales Managers registered in the system yet.
                  </td>
                </tr>
              ) : (
                managerStats.map((m) => (
                  <tr key={m.id}>
                    <td className="bold-cell">
                      <div>{m.name}</div>
                      <small className="muted-text font-mono">ID: #{m.id}</small>
                    </td>
                    <td>
                      <span className="cluster-tag">{m.assignedAgentsCount} agents assigned</span>
                    </td>
                    <td>{m.orderCount}</td>
                    <td className="bold-cell">{formatInr(m.revenue)}</td>
                    <td>{m.targetAmount > 0 ? formatInr(m.targetAmount) : <span className="muted-text">Not configured</span>}</td>
                    <td>
                      {m.targetAmount > 0 ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span className={`status-pill ${m.achievementRate >= 70 ? 'badge-delivered' : 'badge-pending'}`}>
                            {m.achievementRate}%
                          </span>
                        </div>
                      ) : (
                        <span className="muted-text">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recent Audit Activity Snippet */}
      <div className="card">
        <div className="table-header-title">
          <span>Recent Administrative Audit Logs</span>
          <button
            type="button"
            className="btn-preset"
            onClick={() => onNavigate('admin-audit')}
          >
            View Full Audit Trail ({recentAudits.length || 0}) →
          </button>
        </div>

        <div className="audit-snippet-list">
          {recentAudits.length === 0 ? (
            <p className="muted-text" style={{ padding: '1rem', margin: 0 }}>
              No administrative changes logged yet. Any modifications to users, permissions, assignments, or targets will appear here.
            </p>
          ) : (
            recentAudits.map((log) => (
              <div key={log.id} className="audit-item-row">
                <div className="audit-meta">
                  <span className={`audit-badge badge-${(log.action || '').toLowerCase()}`}>
                    {log.action}
                  </span>
                  <span className="audit-time font-mono">{log.timestamp.slice(0, 19).replace('T', ' ')}</span>
                  <span className="audit-admin">by {log.adminName}</span>
                </div>
                <div className="audit-details-text">
                  {log.details}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
