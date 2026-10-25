import React, { useState, useEffect } from 'react';
import { api, INDIAN_MOBILE_REGEX } from '../api';

const IS_DEV_BUILD = Boolean(import.meta.env && import.meta.env.DEV);

export default function LoginScreen({ onLoginSuccess, showToast }) {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState('');
  const [loading, setLoading] = useState(false);
  const [agentsList, setAgentsList] = useState([]);
  const [systemMode, setSystemMode] = useState({
    production: true,
    demoMode: false,
    hasActiveAdmin: true,
    requiresAdminSetup: false
  });

  // One-Time First Admin Setup state
  const [setupName, setSetupName] = useState('LineCart Administrator');
  const [setupPhone, setSetupPhone] = useState('');
  const [setupPassword, setSetupPassword] = useState('');

  useEffect(() => {
    api.getSystemMode().then((res) => {
      if (res) {
        setSystemMode(res);
        if (IS_DEV_BUILD && res.demoMode && !res.production) {
          api.getDemoUsers().then((uRes) => {
            if (uRes?.users) setAgentsList(uRes.users);
          }).catch(() => {});
        }
      }
    }).catch(() => {});
  }, []);

  const handleLoginSubmit = async (e) => {
    if (e) e.preventDefault();
    setFormError('');

    if (!phone) {
      const msg = 'Please enter your 10-digit Indian mobile number.';
      setFormError(msg);
      if (showToast) showToast(msg);
      return;
    }

    // Strict client-side enforcement: exactly 10 digits starting with 6, 7, 8, or 9 (no spaces, country codes, or letters)
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
        if (response.token) {
          localStorage.setItem('LineCartPref_token', response.token);
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

  return (
    <div className="min-h-screen bg-[#f6f8fa] flex flex-col justify-center items-center p-4">
      <div className="w-full max-w-[420px] bg-white rounded-2xl border border-[#edf0f2] shadow-[0_8px_28px_rgba(28,54,67,0.06)] p-8">
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
              <input
                id="setupAdminPassword"
                type="password"
                required
                className="field"
                placeholder="Enter strong non-default password"
                value={setupPassword}
                onChange={(e) => setSetupPassword(e.target.value)}
              />
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
              <input
                id="loginPassword"
                type="password"
                autoComplete="current-password"
                required
                className="field"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (formError) setFormError('');
                }}
              />
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
        )}

        {/* Demo Credentials Box: STRICTLY ISOLATED TO DEV BUILD + DEMO MODE */}
        {IS_DEV_BUILD && systemMode.demoMode && !systemMode.production && (
          <div className="mt-6 pt-5 border-t border-[#edf0f2] text-left">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] text-amber-600 block font-semibold">
                Development / Demo Shortcuts:
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 font-medium border border-amber-200">
                DEV ONLY
              </span>
            </div>

            <select
              className="select w-full text-xs mb-3"
              value={phone}
              onChange={(e) => {
                const val = e.target.value;
                if (val) {
                  setPhone(val);
                  const matched = agentsList.find((u) => u.phone === val);
                  const isDeliv = (matched?.role || '').toLowerCase() === 'delivery agent';
                  setPassword(isDeliv ? '1234' : 'password123');
                  setFormError('');
                }
              }}
            >
              <option value="">-- Quick-select Test Account --</option>
              {agentsList.filter((u) => (u.role || '').toLowerCase() === 'delivery agent').length > 0 && (
                <optgroup label="Delivery Agents">
                  {agentsList
                    .filter((u) => (u.role || '').toLowerCase() === 'delivery agent')
                    .map((d) => (
                      <option key={d.id} value={d.phone}>
                        🚚 {d.name} ({d.phone})
                      </option>
                    ))}
                </optgroup>
              )}
              {agentsList.filter((u) => (u.role || '').toLowerCase() === 'sales manager').length > 0 && (
                <optgroup label="Sales Managers">
                  {agentsList
                    .filter((u) => (u.role || '').toLowerCase() === 'sales manager')
                    .map((m) => (
                      <option key={m.id} value={m.phone}>
                        👔 {m.name} ({m.phone})
                      </option>
                    ))}
                </optgroup>
              )}
              <optgroup label="Field Sales Agents">
                {agentsList
                  .filter((u) => (u.role || '').toLowerCase() !== 'sales manager' && (u.role || '').toLowerCase() !== 'admin' && (u.role || '').toLowerCase() !== 'delivery agent')
                  .map((a) => (
                    <option key={a.id} value={a.phone}>
                      📋 {a.name} ({a.phone})
                    </option>
                  ))}
              </optgroup>
            </select>

            <div className="flex gap-1.5 flex-wrap">
              <button
                type="button"
                className="secondary-button text-[10px] py-1 px-2 flex-1"
                onClick={() => {
                  setPhone('9876500050');
                  setPassword('1234');
                  setFormError('');
                }}
              >
                🚚 Delivery Agent
              </button>
              <button
                type="button"
                className="secondary-button text-[10px] py-1 px-2 flex-1"
                onClick={() => {
                  setPhone('9876500001');
                  setPassword('password123');
                  setFormError('');
                }}
              >
                👔 Manager
              </button>
              <button
                type="button"
                className="secondary-button text-[10px] py-1 px-2 flex-1"
                onClick={() => {
                  setPhone('9876543210');
                  setPassword('password123');
                  setFormError('');
                }}
              >
                📋 Field Agent
              </button>
            </div>
            <p className="text-[10px] text-slate-400 mt-2 leading-relaxed">
              Admin accounts require environment-configured credentials and are never exposed in demo shortcuts.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
