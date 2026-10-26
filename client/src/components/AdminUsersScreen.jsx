import React, { useState, useEffect, useMemo } from 'react';
import { api, INDIAN_MOBILE_REGEX } from '../api';

export default function AdminUsersScreen({ user, clusters, onNavigate, showToast }) {
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  // Create User Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState({
    name: '',
    phone: '',
    password: '',
    role: 'Field Sales Agent',
    clusterid: '1'
  });
  const [creating, setCreating] = useState(false);

  // Edit User Modal State
  const [editingUser, setEditingUser] = useState(null);
  const [editForm, setEditForm] = useState({
    name: '',
    phone: '',
    password: '',
    role: 'Field Sales Agent',
    clusterid: '1',
    active: 1
  });
  const [updating, setUpdating] = useState(false);

  const loadUsers = () => {
    setLoading(true);
    api.getAdminUsers()
      .then((res) => {
        if (res && res.users) {
          setUsers(res.users);
        } else if (res && res.status === 403) {
          showToast('Access Denied: Administrator role required.');
        }
      })
      .catch((err) => {
        console.error('Failed to load users', err);
        showToast('Error loading users');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadUsers();
  }, []);

  // Filtered users
  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      if (roleFilter !== 'all' && (u.role || '').toLowerCase() !== roleFilter.toLowerCase()) return false;
      if (statusFilter !== 'all') {
        const isActive = Number(u.active) === 1;
        if (statusFilter === 'active' && !isActive) return false;
        if (statusFilter === 'inactive' && isActive) return false;
      }
      if (search.trim()) {
        const q = search.toLowerCase();
        const matchName = (u.name || '').toLowerCase().includes(q);
        const matchPhone = (u.phone || '').includes(q);
        const matchId = String(u.id).includes(q);
        if (!matchName && !matchPhone && !matchId) return false;
      }
      return true;
    });
  }, [users, roleFilter, statusFilter, search]);

  // Handle Create User
  const handleCreateSubmit = (e) => {
    e.preventDefault();
    if (!createForm.name.trim() || !createForm.phone) {
      showToast('Name and a 10-digit Indian mobile number are required.');
      return;
    }
    if (!INDIAN_MOBILE_REGEX.test(createForm.phone)) {
      showToast('Invalid mobile number: must be exactly 10 digits starting with 6, 7, 8, or 9 (no spaces or country codes).');
      return;
    }
    setCreating(true);
    api.createAdminUser(createForm)
      .then((res) => {
        if (res && (res.status === 201 || res.status === 200)) {
          showToast(`User '${res.user?.name}' created successfully!`);
          setShowCreateModal(false);
          setCreateForm({
            name: '',
            phone: '',
            password: '',
            role: 'Field Sales Agent',
            clusterid: '1'
          });
          loadUsers();
        } else {
          showToast(res?.message || 'Failed to create user');
        }
      })
      .catch((err) => {
        console.error('Create user error', err);
        showToast('Error creating user');
      })
      .finally(() => setCreating(false));
  };

  // Open Edit Modal
  const openEditModal = (u) => {
    setEditingUser(u);
    setEditForm({
      name: u.name || '',
      phone: u.phone || '',
      password: '',
      role: u.role || 'Field Sales Agent',
      clusterid: String(u.clusterid || 1),
      active: u.active !== undefined ? u.active : 1
    });
  };

  // Handle Edit User Submit
  const handleEditSubmit = (e) => {
    e.preventDefault();
    if (!editingUser) return;
    if (!INDIAN_MOBILE_REGEX.test(editForm.phone || '')) {
      showToast('Invalid mobile number: must be exactly 10 digits starting with 6, 7, 8, or 9 (no spaces or country codes).');
      return;
    }
    setUpdating(true);
    api.updateAdminUser(editingUser.id, editForm)
      .then((res) => {
        if (res && res.status === 200) {
          showToast(`User '${editingUser.name}' updated successfully!`);
          setEditingUser(null);
          loadUsers();
        } else {
          showToast(res?.message || 'Failed to update user');
        }
      })
      .catch((err) => {
        console.error('Update user error', err);
        showToast('Error updating user');
      })
      .finally(() => setUpdating(false));
  };

  const activeAdminsCount = useMemo(() => {
    return users.filter((u) => (u.role || '').toLowerCase() === 'admin' && Number(u.active) === 1).length;
  }, [users]);

  // Handle Toggle Active Status
  const handleToggleStatus = (u) => {
    const nextStatus = Number(u.active) === 1 ? 0 : 1;
    const isTargetActiveAdmin = (u.role || '').toLowerCase() === 'admin' && Number(u.active) === 1;
    if (isTargetActiveAdmin && activeAdminsCount <= 1 && nextStatus === 0) {
      showToast('Security Protection: Cannot deactivate the last active Administrator.');
      return;
    }

    const confirmMsg = nextStatus === 0
      ? `Are you sure you want to deactivate ${u.name}? They will be blocked from logging in.`
      : `Reactivate account for ${u.name}?`;

    if (!window.confirm(confirmMsg)) return;

    api.toggleUserStatus(u.id, nextStatus)
      .then((res) => {
        if (res && res.status === 200) {
          showToast(`Account status updated for ${u.name}`);
          loadUsers();
        } else {
          showToast(res?.message || 'Failed to change status');
        }
      })
      .catch((err) => {
        console.error('Toggle status error', err);
        showToast('Error updating status');
      });
  };

  // Handle Delete User Permanently
  const handleDeleteUser = (u) => {
    if (!u) return;
    if (Number(u.id) === Number(user?.id)) {
      showToast('Security Alert: You cannot delete your own currently logged-in account.');
      return;
    }
    const isTargetActiveAdmin = (u.role || '').toLowerCase() === 'admin' && Number(u.active) === 1;
    if (isTargetActiveAdmin && activeAdminsCount <= 1) {
      showToast('Security Alert: Cannot delete the last active Administrator.');
      return;
    }

    const confirmMsg = `Are you sure you want to permanently delete user "${u.name}" (#${u.id})?\n\nThis will remove their account, team assignments, and target quotas. This action cannot be undone.`;
    if (!window.confirm(confirmMsg)) return;

    api.deleteAdminUser(u.id)
      .then((res) => {
        if (res && res.status === 200) {
          showToast(res.message || `User '${u.name}' was permanently deleted.`);
          if (editingUser && editingUser.id === u.id) {
            setEditingUser(null);
          }
          loadUsers();
        } else {
          showToast(res?.message || 'Failed to delete user');
        }
      })
      .catch((err) => {
        console.error('Delete user error', err);
        showToast('Error deleting user');
      });
  };

  const getClusterName = (clusterId) => {
    const match = clusters.find((c) => Number(c.clusterId) === Number(clusterId));
    return match ? (match.clusterName || `Cluster ${match.clusterId}`) : `Cluster ${clusterId || 1}`;
  };

  return (
    <div className="admin-page-container">
      {/* Header */}
      <div className="page-header-row">
        <div>
          <h1 className="page-title">User Accounts &amp; Roles</h1>
          <p className="page-subtitle">Provision, configure, and govern access for Administrators, Managers, and Sales Agents</p>
        </div>

        <div className="header-actions">
          <button
            type="button"
            className="btn-primary"
            onClick={() => setShowCreateModal(true)}
          >
            + Add New User
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="card manager-filter-panel">
        <div className="filter-grid-6">
          <div className="filter-control" style={{ flex: 2 }}>
            <label className="filter-label">Search Users</label>
            <input
              type="text"
              className="filter-input"
              placeholder="Search by name, phone, or ID..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="filter-control">
            <label className="filter-label">System Role</label>
            <select
              className="filter-select"
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
            >
              <option value="all">All Roles</option>
              <option value="Admin">Administrator</option>
              <option value="Sales Manager">Sales Manager</option>
              <option value="Field Sales Agent">Field Sales Agent</option>
              <option value="Delivery Agent">Delivery Agent</option>
            </select>
          </div>

          <div className="filter-control">
            <label className="filter-label">Account Status</label>
            <select
              className="filter-select"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="all">All Statuses</option>
              <option value="active">Active Only</option>
              <option value="inactive">Inactive Only</option>
            </select>
          </div>
        </div>
      </div>

      {/* Users Table */}
      <div className="card">
        <div className="table-header-title">
          <span>Registered Users ({filteredUsers.length})</span>
          <small className="muted-text">Managed accounts across LineCart suite</small>
        </div>

        {loading ? (
          <div className="loading-state">Loading users...</div>
        ) : filteredUsers.length === 0 ? (
          <div className="empty-state">
            <span className="empty-icon">👥</span>
            <h3>No users match your filter</h3>
            <p>Try adjusting your search query or role filter.</p>
          </div>
        ) : (
          <div className="table-responsive-wrapper">
            <table className="team-table">
              <thead>
                <tr>
                  <th>User / Name</th>
                  <th>ID</th>
                  <th>System Role</th>
                  <th>Contact Phone</th>
                  <th>Cluster Route</th>
                  <th>Team Scope</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((u) => {
                  const isActive = Number(u.active) === 1;
                  const roleLower = (u.role || '').toLowerCase();
                  return (
                    <tr key={u.id} className={!isActive ? 'row-inactive' : ''}>
                      <td className="bold-cell">
                        <div className="agent-name-cell">
                          <span className={`agent-avatar-sm ${roleLower === 'admin' ? 'avatar-admin' : roleLower === 'sales manager' ? 'avatar-manager' : ''}`}>
                            {(u.name || 'U').charAt(0)}
                          </span>
                          <div>
                            <div>{u.name}</div>
                            <small className="muted-text font-mono">{u.createdon ? `Added ${u.createdon.slice(0, 10)}` : ''}</small>
                          </div>
                        </div>
                      </td>
                      <td className="font-mono">#{u.id}</td>
                      <td>
                        <span className={`badge-role-tag role-${roleLower.replace(/\s+/g, '-')}`}>
                          {u.role || 'Field Sales Agent'}
                        </span>
                      </td>
                      <td className="font-mono">{u.phone}</td>
                      <td>
                        <span className="cluster-tag">
                          {getClusterName(u.clusterid)}
                        </span>
                      </td>
                      <td>
                        {roleLower === 'sales manager' ? (
                          <span className="team-scope-pill" onClick={() => onNavigate('admin-assignments')}>
                            {u.assignedAgentsCount} supervised agents ↗
                          </span>
                        ) : roleLower === 'field sales agent' ? (
                          u.assignedManager ? (
                            <span className="manager-ref-pill">Reports to: {u.assignedManager.name}</span>
                          ) : (
                            <span className="muted-text">Unassigned</span>
                          )
                        ) : roleLower === 'delivery agent' ? (
                          <span className="cluster-tag" style={{ background: '#e0f2fe', color: '#0369a1' }}>🚚 Delivery Fleet</span>
                        ) : (
                          <span className="admin-all-scope">Org-Wide</span>
                        )}
                      </td>
                      <td>
                        <span className={`status-pill ${isActive ? 'badge-delivered' : 'badge-cancelled'}`}>
                          {isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div className="user-action-buttons">
                          <button
                            type="button"
                            className="btn-action-view"
                            onClick={() => openEditModal(u)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className={`btn-action-status ${isActive ? 'btn-deactivate' : 'btn-activate'}`}
                            onClick={() => handleToggleStatus(u)}
                            title={isActive ? 'Deactivate user' : 'Reactivate user'}
                            disabled={isActive && (u.role || '').toLowerCase() === 'admin' && activeAdminsCount <= 1}
                          >
                            {isActive ? 'Deactivate' : 'Activate'}
                          </button>
                          <button
                            type="button"
                            className="btn-action-delete"
                            onClick={() => handleDeleteUser(u)}
                            disabled={Number(u.id) === Number(user?.id) || ((u.role || '').toLowerCase() === 'admin' && activeAdminsCount <= 1)}
                            title={
                              Number(u.id) === Number(user?.id)
                                ? 'Cannot delete your own account'
                                : (u.role || '').toLowerCase() === 'admin' && activeAdminsCount <= 1
                                ? 'Cannot delete last active Administrator'
                                : 'Permanently delete user'
                            }
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

      {/* Modal: Create User */}
      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <span className="modal-kicker">Administrative Provisioning</span>
                <h2 className="modal-title">Create New User Account</h2>
              </div>
              <button
                type="button"
                className="modal-close"
                onClick={() => setShowCreateModal(false)}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateSubmit}>
              <div className="modal-body">
                <div className="field-group">
                  <label className="filter-label">Full Name *</label>
                  <input
                    type="text"
                    required
                    className="filter-input"
                    placeholder="e.g. Ramesh Kumar"
                    value={createForm.name}
                    onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                  />
                </div>

                <div className="field-group">
                  <label className="filter-label">Registered Phone Number * (10 Digits)</label>
                  <input
                    type="tel"
                    required
                    className="filter-input"
                    placeholder="e.g. 9870000002"
                    value={createForm.phone}
                    onChange={(e) => setCreateForm({ ...createForm, phone: e.target.value })}
                  />
                </div>

                <div className="field-group">
                  <label className="filter-label">Password *</label>
                  <input
                    type="password"
                    required
                    className="filter-input"
                    placeholder="Account password"
                    value={createForm.password}
                    onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
                  />
                </div>

                <div className="field-group">
                  <label className="filter-label">System Role *</label>
                  <select
                    className="filter-select"
                    value={createForm.role}
                    onChange={(e) => setCreateForm({ ...createForm, role: e.target.value })}
                  >
                    <option value="Field Sales Agent">Field Sales Agent</option>
                    <option value="Delivery Agent">Delivery Agent</option>
                    <option value="Sales Manager">Sales Manager</option>
                    <option value="Admin">Administrator (Full Access)</option>
                  </select>
                </div>

                <div className="field-group">
                  <label className="filter-label">Assigned Cluster Route *</label>
                  <select
                    className="filter-select"
                    value={createForm.clusterid}
                    onChange={(e) => setCreateForm({ ...createForm, clusterid: e.target.value })}
                  >
                    {clusters.map((c) => (
                      <option key={c.clusterId} value={c.clusterId}>
                        {c.clusterName || `Cluster ${c.clusterId}`}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowCreateModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={creating}
                >
                  {creating ? 'Creating User...' : 'Create Account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Edit User */}
      {editingUser && (
        <div className="modal-overlay" onClick={() => setEditingUser(null)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <span className="modal-kicker">Edit Account</span>
                <h2 className="modal-title">Edit {editingUser.name}</h2>
              </div>
              <button
                type="button"
                className="modal-close"
                onClick={() => setEditingUser(null)}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleEditSubmit}>
              <div className="modal-body">
                {(editingUser && (editingUser.role || '').toLowerCase() === 'admin' && Number(editingUser.active) === 1 && activeAdminsCount <= 1) && (
                  <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '0.65rem 0.85rem', marginBottom: '1rem', fontSize: '0.78rem', color: '#991b1b', lineHeight: '1.4' }}>
                    <strong>🛡 Protected Account:</strong> This is the last active Administrator account. System safeguards prevent deactivation or demoting this role to ensure permanent administrative governance.
                  </div>
                )}

                <div className="field-group">
                  <label className="filter-label">Full Name *</label>
                  <input
                    type="text"
                    required
                    className="filter-input"
                    value={editForm.name}
                    onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  />
                </div>

                <div className="field-group">
                  <label className="filter-label">Registered Phone Number *</label>
                  <input
                    type="tel"
                    required
                    className="filter-input"
                    value={editForm.phone}
                    onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                  />
                </div>

                <div className="field-group">
                  <label className="filter-label">Reset Password (Leave blank to keep unchanged)</label>
                  <input
                    type="password"
                    className="filter-input"
                    placeholder="Enter new password (min. 8 characters)"
                    value={editForm.password}
                    onChange={(e) => setEditForm({ ...editForm, password: e.target.value })}
                  />
                </div>

                <div className="field-group">
                  <label className="filter-label">System Role *</label>
                  <select
                    className="filter-select"
                    value={editForm.role}
                    onChange={(e) => setEditForm({ ...editForm, role: e.target.value })}
                    disabled={editingUser && (editingUser.role || '').toLowerCase() === 'admin' && Number(editingUser.active) === 1 && activeAdminsCount <= 1}
                  >
                    <option value="Field Sales Agent">Field Sales Agent</option>
                    <option value="Delivery Agent">Delivery Agent</option>
                    <option value="Sales Manager">Sales Manager</option>
                    <option value="Admin">Administrator (Full Access)</option>
                  </select>
                </div>

                <div className="field-group">
                  <label className="filter-label">Cluster Route *</label>
                  <select
                    className="filter-select"
                    value={editForm.clusterid}
                    onChange={(e) => setEditForm({ ...editForm, clusterid: e.target.value })}
                  >
                    {clusters.map((c) => (
                      <option key={c.clusterId} value={c.clusterId}>
                        {c.clusterName || `Cluster ${c.clusterId}`}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="field-group">
                  <label className="filter-label">Account Status</label>
                  <select
                    className="filter-select"
                    value={editForm.active}
                    onChange={(e) => setEditForm({ ...editForm, active: Number(e.target.value) })}
                    disabled={editingUser && (editingUser.role || '').toLowerCase() === 'admin' && Number(editingUser.active) === 1 && activeAdminsCount <= 1}
                  >
                    <option value="1">Active</option>
                    <option value="0">Inactive / Suspended</option>
                  </select>
                </div>
              </div>

              <div className="modal-footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <button
                  type="button"
                  className="btn-danger"
                  onClick={() => handleDeleteUser(editingUser)}
                  disabled={
                    Number(editingUser?.id) === Number(user?.id) ||
                    ((editingUser?.role || '').toLowerCase() === 'admin' && activeAdminsCount <= 1)
                  }
                  title={
                    Number(editingUser?.id) === Number(user?.id)
                      ? 'Cannot delete your own account'
                      : (editingUser?.role || '').toLowerCase() === 'admin' && activeAdminsCount <= 1
                      ? 'Cannot delete last active Administrator'
                      : 'Permanently delete this user'
                  }
                >
                  Delete User
                </button>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setEditingUser(null)}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn-primary"
                    disabled={updating}
                  >
                    {updating ? 'Saving Changes...' : 'Save Changes'}
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
