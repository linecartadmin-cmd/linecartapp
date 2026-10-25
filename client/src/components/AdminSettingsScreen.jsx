import React, { useState, useEffect } from 'react';
import { api } from '../api';

export default function AdminSettingsScreen({ user, showToast }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState({
    organizationName: 'LineCart Wholesale Logistics',
    currencySymbol: '₹',
    defaultTargetPeriod: new Date().toISOString().slice(0, 7),
    maintenanceMode: false
  });

  const loadSettings = () => {
    setLoading(true);
    api.getAdminSettings()
      .then((res) => {
        if (res && res.settings) {
          setSettings(res.settings);
        } else if (res && res.status === 403) {
          showToast('Access Denied: Administrator role required.');
        }
      })
      .catch((err) => {
        console.error('Failed to load settings', err);
        showToast('Error loading settings');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadSettings();
  }, []);

  const handleSubmit = (e) => {
    e.preventDefault();
    setSaving(true);
    api.updateAdminSettings(settings)
      .then((res) => {
        if (res && res.status === 200) {
          showToast('Application settings saved & audited successfully!');
          loadSettings();
        } else {
          showToast(res?.message || 'Failed to update settings');
        }
      })
      .catch((err) => {
        console.error('Update settings error', err);
        showToast('Error saving settings');
      })
      .finally(() => setSaving(false));
  };

  return (
    <div className="admin-page-container">
      {/* Header */}
      <div className="page-header-row">
        <div>
          <h1 className="page-title">Application &amp; System Settings</h1>
          <p className="page-subtitle">Configure organization branding, default quota cycles, and operational flags</p>
        </div>

        <div className="header-actions">
          <button
            type="submit"
            form="settingsForm"
            className="btn-primary"
            disabled={loading || saving}
          >
            {saving ? 'Saving...' : '💾 Save Settings'}
          </button>
        </div>
      </div>

      <div className="card" style={{ maxWidth: '680px' }}>
        <form id="settingsForm" onSubmit={handleSubmit}>
          <div className="modal-body" style={{ padding: '0.5rem 0' }}>
            <div className="field-group">
              <label className="filter-label">Organization / Trading Entity Name</label>
              <input
                type="text"
                required
                className="filter-input"
                value={settings.organizationName || ''}
                onChange={(e) => setSettings({ ...settings, organizationName: e.target.value })}
              />
              <small className="muted-text">Appears on invoices, receipts, and exported PNG vouchers.</small>
            </div>

            <div className="field-group">
              <label className="filter-label">Currency Symbol</label>
              <input
                type="text"
                required
                className="filter-input"
                style={{ width: '80px' }}
                value={settings.currencySymbol || '₹'}
                onChange={(e) => setSettings({ ...settings, currencySymbol: e.target.value })}
              />
            </div>

            <div className="field-group">
              <label className="filter-label">Default Target Quota Period (YYYY-MM)</label>
              <input
                type="text"
                pattern="\d{4}-\d{2}"
                required
                className="filter-input"
                style={{ width: '160px' }}
                placeholder="2026-10"
                value={settings.defaultTargetPeriod || ''}
                onChange={(e) => setSettings({ ...settings, defaultTargetPeriod: e.target.value })}
              />
              <small className="muted-text">Standard monthly quota tracking cycle.</small>
            </div>

            <div className="field-group" style={{ marginTop: '0.5rem' }}>
              <label className="filter-label" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  className="checkbox-custom"
                  checked={Boolean(settings.maintenanceMode)}
                  onChange={(e) => setSettings({ ...settings, maintenanceMode: e.target.checked })}
                />
                <span>Maintenance / Read-Only Mode</span>
              </label>
              <small className="muted-text">Temporarily prevents sales agents from placing new live wholesale orders.</small>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
