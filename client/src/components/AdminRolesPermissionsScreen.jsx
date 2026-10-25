import React, { useState, useEffect } from 'react';
import { api } from '../api';

const AVAILABLE_PAGES = [
  { id: 'reports', label: 'Performance Reports', desc: 'Target vs achieved sales report & charts' },
  { id: 'orders', label: 'Orders & Transactions', desc: 'Order tracking and entry' },
  { id: 'map', label: 'Cluster Shop Map', desc: 'Interactive Leaflet geolocation view' },
  { id: 'team', label: 'Sales Team Roster', desc: 'View assigned team members' },
  { id: 'customers', label: 'Customer Directory', desc: 'Shop directory, addresses and contacts' },
  { id: 'overview', label: 'Agent Overview Home', desc: 'Agent route summary and catalog quick order' },
  { id: 'summary', label: 'Summary Report', desc: 'Item summary and delivery status' },
  { id: 'delivery', label: 'Delivery Route Portal', desc: 'Mobile-first road routing and stop fulfillment' }
];

const AVAILABLE_ACTIONS = [
  { id: 'view_all_reports', label: 'View Organization Reports', desc: 'View company-wide reports across all agents' },
  { id: 'view_team_reports', label: 'View Team Reports', desc: 'View reports scoped to assigned team agents' },
  { id: 'view_agent_reports', label: 'View Personal Agent Reports', desc: 'View individual sales quota reports' },
  { id: 'create_order', label: 'Create Wholesale Orders', desc: 'Submit new wholesale commodity orders' },
  { id: 'view_orders', label: 'View Order List', desc: 'Inspect order history and statuses' },
  { id: 'view_team_orders', label: 'View Team Orders', desc: 'View orders placed by supervised sales agents' },
  { id: 'view_assigned_deliveries', label: 'View Assigned Deliveries', desc: 'View orders assigned to delivery agent' },
  { id: 'update_delivery_status', label: 'Update Delivery Status', desc: 'Advance order delivery status and record failure reasons' },
  { id: 'export_reports', label: 'Export Reports', desc: 'Export report tables and summaries' },
  { id: 'export_png', label: 'Export PNG Order Receipts', desc: 'Generate and download high-DPI image receipts' },
  { id: 'view_cluster_shops', label: 'View Cluster Map Pins', desc: 'Access map view of stores with coordinates' },
  { id: 'add_customer', label: 'Register New Customer Stores', desc: 'Add new retail/horeca shops to route' },
  { id: 'manage_users', label: 'User Administration', desc: 'Provision and deactivate user accounts' },
  { id: 'manage_roles', label: 'Role Permissions Governance', desc: 'Configure system role permissions' },
  { id: 'manage_assignments', label: 'Team Mapping Governance', desc: 'Assign sales agents to managers' },
  { id: 'manage_targets', label: 'Target Quota Configuration', desc: 'Configure revenue and kg commodity targets' }
];

export default function AdminRolesPermissionsScreen({ user, onNavigate, showToast }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedRole, setSelectedRole] = useState('Sales Manager');
  const [permissions, setPermissions] = useState({});

  const loadPermissions = () => {
    setLoading(true);
    api.getAdminPermissions()
      .then((res) => {
        if (res && res.permissions) {
          setPermissions(res.permissions);
        } else if (res && res.status === 403) {
          showToast('Access Denied: Administrator role required.');
        }
      })
      .catch((err) => {
        console.error('Failed to load permissions', err);
        showToast('Error loading permissions');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadPermissions();
  }, []);

  const currentRolePerms = permissions[selectedRole] || { pages: [], actions: [] };
  const isAdminRole = selectedRole === 'Admin';

  const handleTogglePage = (pageId) => {
    if (isAdminRole) return;
    const currentPages = currentRolePerms.pages || [];
    const updated = currentPages.includes(pageId)
      ? currentPages.filter((p) => p !== pageId)
      : [...currentPages, pageId];

    setPermissions({
      ...permissions,
      [selectedRole]: {
        ...currentRolePerms,
        pages: updated
      }
    });
  };

  const handleToggleAction = (actionId) => {
    if (isAdminRole) return;
    const currentActions = currentRolePerms.actions || [];
    const updated = currentActions.includes(actionId)
      ? currentActions.filter((a) => a !== actionId)
      : [...currentActions, actionId];

    setPermissions({
      ...permissions,
      [selectedRole]: {
        ...currentRolePerms,
        actions: updated
      }
    });
  };

  const handleSave = () => {
    if (isAdminRole) {
      showToast('Administrator permissions are protected and immutable.');
      return;
    }
    setSaving(true);
    api.updateAdminPermissions(selectedRole, currentRolePerms.pages, currentRolePerms.actions)
      .then((res) => {
        if (res && res.status === 200) {
          showToast(`Permissions updated and persisted for ${selectedRole}`);
          loadPermissions();
        } else {
          showToast(res?.message || 'Failed to save permissions');
        }
      })
      .catch((err) => {
        console.error('Save permissions error', err);
        showToast('Error saving permissions');
      })
      .finally(() => setSaving(false));
  };

  return (
    <div className="admin-page-container">
      {/* Header */}
      <div className="page-header-row">
        <div>
          <h1 className="page-title">Roles &amp; Access Permissions</h1>
          <p className="page-subtitle">Granularly control page visibility and action permissions for LineCart roles</p>
        </div>

        <div className="header-actions">
          {!isAdminRole && (
            <button
              type="button"
              className="btn-primary"
              disabled={loading || saving}
              onClick={handleSave}
            >
              {saving ? 'Saving...' : `💾 Save ${selectedRole} Permissions`}
            </button>
          )}
        </div>
      </div>

      {/* Role Selection Tabs */}
      <div className="role-selector-bar card">
        <button
          type="button"
          className={`role-tab-btn ${selectedRole === 'Sales Manager' ? 'active' : ''}`}
          onClick={() => setSelectedRole('Sales Manager')}
        >
          👔 Sales Manager
        </button>
        <button
          type="button"
          className={`role-tab-btn ${selectedRole === 'Field Sales Agent' ? 'active' : ''}`}
          onClick={() => setSelectedRole('Field Sales Agent')}
        >
          📋 Field Sales Agent
        </button>
        <button
          type="button"
          className={`role-tab-btn ${selectedRole === 'Delivery Agent' ? 'active' : ''}`}
          onClick={() => setSelectedRole('Delivery Agent')}
        >
          🚚 Delivery Agent
        </button>
        <button
          type="button"
          className={`role-tab-btn ${selectedRole === 'Admin' ? 'active' : ''}`}
          onClick={() => setSelectedRole('Admin')}
        >
          🛡 Administrator (Protected)
        </button>
      </div>

      {/* Lockout Protection Banner for Admin Role */}
      {isAdminRole && (
        <div className="unmapped-warning-banner card" style={{ background: '#f0fdf4', borderColor: '#bbf7d0' }}>
          <div className="unmapped-banner-content">
            <span style={{ fontSize: '1.25rem' }}>🛡</span>
            <div>
              <strong style={{ color: '#166534' }}>Immutable System Lockout Protection</strong>
              <p style={{ color: '#15803d' }}>
                The Administrator role retains full, permanent access to all screens, actions, and governance controls. This prevents accidental lockouts and ensures the organization can always be administered.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Configurable Permissions Matrix */}
      <div className="permissions-matrix-grid">
        {/* Page Access Column */}
        <div className="card">
          <div className="table-header-title">
            <span>Allowed Screens &amp; Pages</span>
            <small className="muted-text">Controls navigation menu &amp; route access</small>
          </div>

          <div className="perms-checklist">
            {AVAILABLE_PAGES.map((page) => {
              const isChecked = isAdminRole || (currentRolePerms.pages || []).includes(page.id);
              return (
                <div
                  key={page.id}
                  className={`perm-check-item ${isChecked ? 'perm-active' : ''} ${isAdminRole ? 'perm-locked' : ''}`}
                  onClick={() => !isAdminRole && handleTogglePage(page.id)}
                >
                  <input
                    type="checkbox"
                    className="checkbox-custom"
                    disabled={isAdminRole}
                    checked={isChecked}
                    onChange={() => handleTogglePage(page.id)}
                  />
                  <div className="perm-copy">
                    <strong>{page.label}</strong>
                    <span className="muted-text">{page.desc}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Action Capabilities Column */}
        <div className="card">
          <div className="table-header-title">
            <span>Action &amp; Operation Capabilities</span>
            <small className="muted-text">Enforced by backend API &amp; UI controls</small>
          </div>

          <div className="perms-checklist">
            {AVAILABLE_ACTIONS.map((action) => {
              const isChecked = isAdminRole || (currentRolePerms.actions || []).includes(action.id);
              return (
                <div
                  key={action.id}
                  className={`perm-check-item ${isChecked ? 'perm-active' : ''} ${isAdminRole ? 'perm-locked' : ''}`}
                  onClick={() => !isAdminRole && handleToggleAction(action.id)}
                >
                  <input
                    type="checkbox"
                    className="checkbox-custom"
                    disabled={isAdminRole}
                    checked={isChecked}
                    onChange={() => handleToggleAction(action.id)}
                  />
                  <div className="perm-copy">
                    <strong>{action.label}</strong>
                    <span className="muted-text">{action.desc}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {!isAdminRole && (
        <div className="team-footer-save card" style={{ padding: '1rem 1.25rem' }}>
          <span className="save-hint">
            Changes take effect immediately across all active sessions and persist across server restarts.
          </span>
          <button
            type="button"
            className="btn-primary"
            disabled={loading || saving}
            onClick={handleSave}
          >
            {saving ? 'Saving...' : `Save ${selectedRole} Permissions`}
          </button>
        </div>
      )}
    </div>
  );
}
