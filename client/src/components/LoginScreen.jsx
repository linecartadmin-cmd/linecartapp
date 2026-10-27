import React, { useState, useEffect, Suspense } from 'react';
import { Capacitor } from '@capacitor/core';
import { api, INDIAN_MOBILE_REGEX } from '../api';
import {
  registerBiometricSession,
  unlockOfflineSession,
  checkBiometricHardware,
  checkPreviousUserUnsynced,
  getSavedAccounts,
  hasBiometricCredential,
  removeSavedAccount
} from '../offline/biometricAuth';

const ENABLE_DEMO = Boolean(
  (import.meta.env && import.meta.env.DEV) ||
  (import.meta.env && import.meta.env.VITE_ENABLE_DEMO_LOGIN === 'true')
);

const DemoRoleLoginSection = ENABLE_DEMO
  ? React.lazy(() => import('./DemoRoleLoginSection'))
  : null;

export default function LoginScreen({ onLoginSuccess, showToast }) {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showSetupPassword, setShowSetupPassword] = useState(false);
  const [formError, setFormError] = useState('');
  const [loading, setLoading] = useState(false);
  const [agentsList, setAgentsList] = useState([]);
  const [demoRoles, setDemoRoles] = useState([]);
  const [systemMode, setSystemMode] = useState({
    production: true,
    demoMode: false,
    hasActiveAdmin: true,
    requiresAdminSetup: false
  });

  // Offline accounts & biometric status
  const [savedAccounts, setSavedAccounts] = useState([]);
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [selectedHasBio, setSelectedHasBio] = useState(false);
  const [showAccountSwitcher, setShowAccountSwitcher] = useState(false);
  const [hardwareInfo, setHardwareInfo] = useState(null);

  // One-Time First Admin Setup state
  const [setupName, setSetupName] = useState('LineCart Administrator');
  const [setupPhone, setSetupPhone] = useState('');
  const [setupPassword, setSetupPassword] = useState('');

  // Initial load
  useEffect(() => {
    const accounts = getSavedAccounts();
    setSavedAccounts(accounts);

    let activeMeta = null;
    try {
      const raw = localStorage.getItem('LineCartPref_active_user_meta');
      if (raw) activeMeta = JSON.parse(raw);
    } catch {}

    const defaultAcc = (activeMeta && accounts.find((a) => Number(a.id) === Number(activeMeta.userId))) || accounts[0] || null;
    if (defaultAcc) {
      setSelectedAccount(defaultAcc);
      setPhone(defaultAcc.phone || '');
    }

    checkBiometricHardware().then((hw) => {
      setHardwareInfo(hw);
    }).catch(() => {});

    api.getSystemMode().then((res) => {
      if (res) {
        setSystemMode(res);
        if (ENABLE_DEMO && res.demoMode && !res.production) {
          api.getDemoUsers().then((uRes) => {
            if (uRes?.users) setAgentsList(uRes.users);
            if (uRes?.demoRoles) setDemoRoles(uRes.demoRoles);
          }).catch(() => {});
        }
      }
    }).catch(() => {});
  }, []);

  // Update biometric credential existence whenever selected account changes
  useEffect(() => {
    if (selectedAccount?.id) {
      hasBiometricCredential(selectedAccount.id).then((hasCred) => {
        setSelectedHasBio(hasCred);
      }).catch(() => setSelectedHasBio(false));
    } else {
      setSelectedHasBio(false);
    }
  }, [selectedAccount]);

  const handleSelectAccount = (acc) => {
    setSelectedAccount(acc);
    setPhone(acc.phone || '');
    setShowAccountSwitcher(false);
    setFormError('');
  };

  const handleRemoveAccount = async (e, accId) => {
    e.stopPropagation();
    await removeSavedAccount(accId);
    const updated = getSavedAccounts();
    setSavedAccounts(updated);
    if (selectedAccount && Number(selectedAccount.id) === Number(accId)) {
      const next = updated[0] || null;
      setSelectedAccount(next);
      setPhone(next ? next.phone : '');
    }
  };

  const handleBiometricUnlock = async () => {
    if (!selectedAccount?.id) return;
    setLoading(true);
    setFormError('');
    try {
      const { user: unlockedUser } = await unlockOfflineSession(selectedAccount.id);
      if (showToast) showToast(`Welcome back (Offline), ${unlockedUser.name}!`);
      onLoginSuccess(unlockedUser);
    } catch (err) {
      const msg = err.message || 'Biometric authentication failed.';
      setFormError(msg);
      if (showToast) showToast(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleLoginSubmit = async (e) => {
    if (e) e.preventDefault();
    setFormError('');

    if (!phone) {
      const msg = 'Please enter your 10-digit Indian mobile number.';
      setFormError(msg);
      if (showToast) showToast(msg);
      return;
    }

    if (!INDIAN_MOBILE_REGEX.test(phone)) {
      const msg = 'Enter a valid 10-digit Indian mobile number starting with 6, 7, 8, or 9 (no spaces, country codes, or usernames).';
      setFormError(msg);
      if (showToast) showToast(msg);
      return;
    }

    if (!password) {
      const msg = 'Please enter your password.';
      setFormError(msg);
      if (showToast) showToast(msg);
      return;
    }

    setLoading(true);
    try {
      const response = await api.login(phone, password);
      if (response && (response.status === 200 || response.status === 1) && response.result?.length > 0) {
        const userRecord = response.result[0];

        // Account-switching check: verify if previous user has pending unsynced changes
        try {
          const conflict = await checkPreviousUserUnsynced(userRecord.id);
          if (conflict.hasConflict) {
            if (showToast) {
              showToast(`Notice: Previous account (${conflict.previousUserName}) has unsynced offline changes. They remain safely preserved on this device.`);
            }
          }
        } catch {}

        if (!Capacitor.isNativePlatform()) {
          if (response.token) {
            localStorage.setItem('LineCartPref_token', response.token);
          }
        } else {
          // On Android native, NEVER persist the session token in localStorage
          localStorage.removeItem('LineCartPref_token');
        }

        // Register session with native Keystore AccessControl
        if (response.token) {
          try {
            await registerBiometricSession(userRecord, response.token);
          } catch (bioErr) {
            console.warn('[BiometricAuth] Could not register biometric session:', bioErr);
          }
        }

        localStorage.setItem('LineCartPref_userid', String(userRecord.id));
        localStorage.setItem('LineCartPref_user', JSON.stringify(userRecord));
        if (showToast) showToast(`Welcome back, ${userRecord.name}!`);
        onLoginSuccess(userRecord);
      } else {
        const errMsg = response?.message || 'Invalid mobile number or password.';
        setFormError(errMsg);
        if (showToast) showToast(errMsg);
      }
    } catch {
      const errMsg = 'Invalid mobile number or password.';
      setFormError(errMsg);
      if (showToast) showToast(errMsg);
    } finally {
      setLoading(false);
    }
  };

  const handleFirstAdminSetup = async (e) => {
    if (e) e.preventDefault();
    setFormError('');

    if (!INDIAN_MOBILE_REGEX.test(setupPhone)) {
      const msg = 'Admin mobile number must be exactly 10 digits starting with 6, 7, 8, or 9.';
      setFormError(msg);
      if (showToast) showToast(msg);
      return;
    }
    if (!setupPassword || setupPassword.length < 8) {
      const msg = 'Admin password must be at least 8 characters long.';
      setFormError(msg);
      if (showToast) showToast(msg);
      return;
    }

    setLoading(true);
    try {
      const res = await api.setupInitialAdmin({
        name: setupName.trim() || 'LineCart Administrator',
        phone: setupPhone,
        password: setupPassword
      });
      if (res && (res.status === 201 || res.status === 200)) {
        if (showToast) showToast(res.message || 'Initial Administrator configured.');
        setSystemMode((prev) => ({ ...prev, hasActiveAdmin: true, requiresAdminSetup: false }));
        setPhone(setupPhone);
        setPassword('');
      } else {
        const errMsg = res?.message || 'Failed to configure initial Administrator.';
        setFormError(errMsg);
        if (showToast) showToast(errMsg);
      }
    } catch {
      setFormError('Failed to configure initial Administrator.');
    } finally {
      setLoading(false);
    }
  };

  // Only offer biometric unlock if account actually has hardware credentials AND device has strong biometrics
  const canUnlockBiometric = Boolean(
    selectedAccount &&
    selectedHasBio &&
    hardwareInfo?.strongBiometryIsAvailable
  );

  return (
    <div
      className="w-full min-h-screen bg-[#f6f8fa] flex flex-col items-center p-4 overflow-y-auto"
      style={{ width: '100%', minWidth: '100%', minHeight: '100dvh', boxSizing: 'border-box', backgroundColor: '#f6f8fa' }}
    >
      <div
        className="w-full max-w-[420px] my-auto bg-white rounded-2xl border border-[#edf0f2] shadow-[0_8px_28px_rgba(28,54,67,0.06)] p-6 sm:p-8"
        style={{ width: '100%', maxWidth: '420px', marginTop: 'auto', marginBottom: 'auto', boxSizing: 'border-box' }}
      >
        {/* Brand */}
        <div className="text-center mb-8">
          <a className="inline-flex items-center gap-2.5 text-2xl font-extrabold text-[#17232c] tracking-tight no-underline font-['Manrope'] mb-2" href="#overview">
            <img src="/lincart_flashicon.png" alt="Linecart" className="w-9 h-9 rounded-xl object-contain" />
            <span>linecart<span className="text-[#12aee2]">.</span></span>
          </a>
          <p className="text-xs text-slate-400 font-medium">
            Wholesale agricultural route-to-market portal
          </p>
        </div>

        {formError && (
          <div role="alert" className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 font-medium">
            {formError}
          </div>
        )}

        {systemMode.requiresAdminSetup ? (
          <form onSubmit={handleFirstAdminSetup} className="space-y-4">
            <div className="p-3 rounded-xl bg-sky-50 border border-sky-200 text-xs text-sky-800">
              <strong>First-Time Setup:</strong> Configure the initial Administrator account with a 10-digit Indian mobile number and strong password.
            </div>
            <div className="field-group">
              <label htmlFor="setupAdminName" className="text-xs font-semibold text-slate-700">
                Administrator Name *
              </label>
              <input
                id="setupAdminName"
                type="text"
                required
                className="field"
                value={setupName}
                onChange={(e) => setSetupName(e.target.value)}
              />
            </div>
            <div className="field-group">
              <label htmlFor="setupAdminPhone" className="text-xs font-semibold text-slate-700">
                10-Digit Indian Mobile Number *
              </label>
              <input
                id="setupAdminPhone"
                type="tel"
                inputMode="numeric"
                required
                className="field"
                placeholder="e.g. 9870000001"
                value={setupPhone}
                onChange={(e) => setSetupPhone(e.target.value)}
              />
            </div>
            <div className="field-group">
              <label htmlFor="setupAdminPassword" className="text-xs font-semibold text-slate-700">
                Strong Password (min 8 chars) *
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  id="setupAdminPassword"
                  type={showSetupPassword ? 'text' : 'password'}
                  required
                  className="field"
                  placeholder="Enter strong non-default password"
                  value={setupPassword}
                  onChange={(e) => setSetupPassword(e.target.value)}
                  style={{ paddingRight: '42px' }}
                />
                <button
                  type="button"
                  onClick={() => setShowSetupPassword(!showSetupPassword)}
                  aria-label={showSetupPassword ? 'Hide password' : 'Show password'}
                  style={{
                    position: 'absolute',
                    right: '10px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    padding: '4px',
                    fontSize: '15px',
                    cursor: 'pointer',
                    color: '#64748b'
                  }}
                >
                  {showSetupPassword ? '🙈' : '👁️'}
                </button>
              </div>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="primary-button w-full mt-2"
              style={{ height: '42px', fontSize: '13px' }}
            >
              {loading ? 'Configuring Admin...' : 'Initialize Administrator Account'}
            </button>
          </form>
        ) : (
          <>
            {/* Account Switcher Bar (if saved accounts exist) */}
            {savedAccounts.length > 0 && (
              <div style={{
                marginBottom: '14px',
                padding: '10px 12px',
                borderRadius: '10px',
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontSize: '12px'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                  <span style={{ fontSize: '16px' }}>👤</span>
                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <strong style={{ color: '#0f172a' }}>{selectedAccount ? selectedAccount.name : 'Choose Account'}</strong>
                    <span style={{ color: '#64748b', marginLeft: '6px', fontSize: '11px' }}>
                      ({selectedAccount ? selectedAccount.role : ''})
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowAccountSwitcher(!showAccountSwitcher)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#0284c7',
                    fontWeight: 700,
                    cursor: 'pointer',
                    fontSize: '11px',
                    padding: '2px 6px'
                  }}
                >
                  {showAccountSwitcher ? 'Close' : 'Switch'}
                </button>
              </div>
            )}

            {/* Account Switcher Dropdown / List */}
            {showAccountSwitcher && (
              <div style={{
                marginBottom: '14px',
                padding: '8px',
                borderRadius: '10px',
                background: '#ffffff',
                border: '1px solid #cbd5e1',
                boxShadow: '0 4px 12px rgba(0,0,0,0.06)'
              }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#475569', padding: '4px 8px', marginBottom: '4px' }}>
                  Saved Accounts on Device
                </div>
                {savedAccounts.map((acc) => {
                  const isSelected = selectedAccount && Number(selectedAccount.id) === Number(acc.id);
                  return (
                    <div
                      key={acc.id}
                      onClick={() => handleSelectAccount(acc)}
                      style={{
                        padding: '8px 10px',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        background: isSelected ? '#f0f9ff' : 'transparent',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        marginBottom: '2px'
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '12px', color: '#0f172a' }}>{acc.name}</div>
                        <div style={{ fontSize: '11px', color: '#64748b' }}>{acc.phone} · {acc.role}</div>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => handleRemoveAccount(e, acc.id)}
                        title="Remove saved account"
                        style={{
                          background: 'none',
                          border: 'none',
                          color: '#94a3b8',
                          cursor: 'pointer',
                          fontSize: '14px',
                          padding: '2px 6px'
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  );
                })}
                <button
                  type="button"
                  onClick={() => {
                    setSelectedAccount(null);
                    setPhone('');
                    setPassword('');
                    setShowAccountSwitcher(false);
                  }}
                  style={{
                    width: '100%',
                    padding: '8px',
                    textAlign: 'center',
                    background: '#f8fafc',
                    border: '1px dashed #cbd5e1',
                    borderRadius: '6px',
                    fontSize: '11px',
                    color: '#0284c7',
                    fontWeight: 600,
                    cursor: 'pointer',
                    marginTop: '4px'
                  }}
                >
                  + Sign in with a different account
                </button>
              </div>
            )}

            {/* Offline Biometric Unlock Card (ONLY rendered if account has verified Keystore credentials) */}
            {canUnlockBiometric && (
              <div style={{
                marginBottom: '18px',
                padding: '14px',
                borderRadius: '12px',
                background: '#f0fdf4',
                border: '1px solid #bbf7d0',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '13px', fontWeight: 700, color: '#166534' }}>
                    🔐 Offline Mode Available
                  </span>
                  <span style={{ fontSize: '11px', color: '#15803d', fontWeight: 700, background: '#dcfce7', padding: '2px 8px', borderRadius: '10px' }}>
                    {selectedAccount?.name || 'Verified Account'}
                  </span>
                </div>
                <p style={{ margin: 0, fontSize: '12px', color: '#166534', lineHeight: 1.4 }}>
                  Work offline with local shops, catalog, and orders. Unlock securely with your enrolled device biometric.
                </p>

                <button
                  type="button"
                  disabled={loading}
                  onClick={handleBiometricUnlock}
                  className="primary-button"
                  style={{
                    height: '40px',
                    fontSize: '13px',
                    background: '#15803d',
                    borderColor: '#166534',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    marginTop: '4px'
                  }}
                >
                  <span>👆</span> {loading ? 'Verifying biometric...' : 'Unlock with Fingerprint'}
                </button>
              </div>
            )}

            <form onSubmit={handleLoginSubmit} className="space-y-4" noValidate>
            <div className="field-group">
              <label htmlFor="loginPhone" className="text-xs font-semibold text-slate-700">
                Registered 10-Digit Mobile Number *
              </label>
              <input
                id="loginPhone"
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                required
                className="field"
                placeholder="10-digit mobile (starts with 6-9)"
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value);
                  if (formError) setFormError('');
                }}
              />
              <span className="text-[11px] text-slate-400 mt-1 block">
                10 digits starting with 6, 7, 8, or 9 (no +91 or spaces)
              </span>
            </div>

            <div className="field-group">
              <label htmlFor="loginPassword" className="text-xs font-semibold text-slate-700">
                Password *
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  id="loginPassword"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  className="field"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (formError) setFormError('');
                  }}
                  style={{ paddingRight: '42px' }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  style={{
                    position: 'absolute',
                    right: '10px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    padding: '4px',
                    fontSize: '15px',
                    cursor: 'pointer',
                    color: '#64748b'
                  }}
                >
                  {showPassword ? '🙈' : '👁️'}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="primary-button w-full mt-2"
              style={{ height: '42px', fontSize: '13px' }}
            >
              {loading ? 'Signing in...' : 'Sign In to Linecart'}
            </button>
          </form>

          {/* Pilot Security Notice */}
          <div style={{
            marginTop: '16px',
            padding: '10px 12px',
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '8px',
            fontSize: '11px',
            color: '#64748b',
            lineHeight: 1.4,
            textAlign: 'center'
          }}>
            🛡️ <strong>Pilot Storage Notice:</strong> Offline shop and order data is cached on this device in the app sandbox and protected by biometric unlock. It is not encrypted at rest and can be exposed if the device is rooted or compromised.
          </div>
        </>
      )}

        {/* Clearly labeled Demo role login section: STRICTLY ISOLATED TO DEV/DEMO BUILD + DEV/DEMO MODE */}
        {ENABLE_DEMO && DemoRoleLoginSection && systemMode.demoMode && !systemMode.production ? (
          <Suspense fallback={null}>
            <DemoRoleLoginSection
              demoRoles={demoRoles}
              agentsList={agentsList}
              currentPhone={phone}
              onSelectAgent={(agent) => {
                setPhone(agent.phone);
                setPassword('agent123');
              }}
            />
          </Suspense>
        ) : null}
      </div>
    </div>
  );
}
