import React, { useState } from 'react';
import { api } from '../api';

export default function ChangePasswordModal({ user, onSuccess, onClose, showToast }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg('');

    if (!currentPassword) {
      setErrorMsg('Please enter your current password.');
      return;
    }

    if (newPassword.length < 8) {
      setErrorMsg('New password must be at least 8 characters long.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setErrorMsg('New password and confirmation do not match.');
      return;
    }

    if (newPassword === currentPassword) {
      setErrorMsg('New password cannot match your current temporary password.');
      return;
    }

    setLoading(true);
    try {
      const res = await api.changePassword(user.id, currentPassword, newPassword);
      if (res && res.status === 200) {
        if (showToast) showToast('Password updated successfully! Welcome to LineCart.');
        onSuccess();
      } else {
        setErrorMsg(res?.message || 'Failed to update password. Please check your current password.');
      }
    } catch {
      setErrorMsg('An unexpected error occurred while updating your password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[9999] bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-4"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 9999,
        backgroundColor: 'rgba(15, 23, 42, 0.75)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px'
      }}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 border border-slate-200 relative animate-in fade-in zoom-in duration-150"
        style={{
          background: '#ffffff',
          borderRadius: '16px',
          maxWidth: '448px',
          width: '100%',
          padding: '24px',
          border: '1px solid #e2e8f0',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
          position: 'relative'
        }}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-800">
                Password Change Required
              </h3>
              <p className="text-xs text-slate-500">
                Account: {user.name} ({user.role})
              </p>
            </div>
          </div>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg p-1.5 transition-colors"
              title="Close and continue to dashboard"
            >
              ✕
            </button>
          )}
        </div>

        <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 mb-4 text-xs text-amber-800 leading-relaxed">
          <strong>Mandatory First-Login Security:</strong> This account was initialized with a temporary or bootstrap password. Please set a private password before proceeding.
        </div>

        {errorMsg && (
          <div className="p-2.5 bg-red-50 text-red-700 rounded-lg border border-red-200 text-xs mb-3 font-medium">
            {errorMsg}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-xs font-semibold text-slate-700 block mb-1">
              Current / Initial Password *
            </label>
            <input
              type="password"
              required
              className="field w-full text-xs"
              placeholder="Enter current password (e.g. admin123 in dev)"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-700 block mb-1">
              New Password * (min. 8 characters)
            </label>
            <input
              type="password"
              required
              minLength={8}
              className="field w-full text-xs"
              placeholder="At least 8 characters"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-700 block mb-1">
              Confirm New Password *
            </label>
            <input
              type="password"
              required
              minLength={8}
              className="field w-full text-xs"
              placeholder="Re-enter new password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>

          <div className="flex items-center gap-2 pt-2">
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="secondary-button flex-1"
                style={{ height: '40px', fontSize: '13px' }}
              >
                Skip / Later
              </button>
            )}
            <button
              type="submit"
              disabled={loading}
              className="primary-button flex-1"
              style={{ height: '40px', fontSize: '13px' }}
            >
              {loading ? 'Updating Password...' : 'Save New Password'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
