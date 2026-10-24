import React, { useState, useEffect } from 'react';
import { api } from '../api';

export default function LoginScreen({ onLoginSuccess, showToast }) {
  const [username, setUsername] = useState('9876543210');
  const [password, setPassword] = useState('1234');
  const [loading, setLoading] = useState(false);
  const [agentsList, setAgentsList] = useState([]);

  useEffect(() => {
    api.getDemoUsers().then((res) => {
      if (res?.users) setAgentsList(res.users);
    }).catch(() => {});
  }, []);

  const handleLoginSubmit = async (e) => {
    if (e) e.preventDefault();
    const trimmedUser = username.trim();
    const trimmedPwd = password.trim();

    if (trimmedUser.length !== 10) {
      if (showToast) showToast('Please Enter Valid UserId.');
      return;
    }

    if (trimmedPwd.length === 0) {
      if (showToast) showToast('Please Enter Valid Password.');
      return;
    }

    setLoading(true);
    try {
      const response = await api.login(trimmedUser, trimmedPwd);
      if (response && (response.status === 200 || response.status === 1) && response.result?.length > 0) {
        const userRecord = response.result[0];
        localStorage.setItem('LineCartPref_userid', String(userRecord.id));
        localStorage.setItem('LineCartPref_user', JSON.stringify(userRecord));
        if (showToast) showToast(`Welcome back, ${userRecord.name}!`);
        onLoginSuccess(userRecord);
      } else {
        if (showToast) showToast('Invalid UserId/Password.');
      }
    } catch {
      if (showToast) showToast('Invalid UserId/Password.');
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

        <form onSubmit={handleLoginSubmit} className="space-y-4">
          <div className="field-group">
            <label htmlFor="loginPhone" className="text-xs font-semibold text-slate-700">
              Registered Phone / UserId *
            </label>
            <input
              id="loginPhone"
              type="tel"
              inputMode="numeric"
              required
              className="field"
              placeholder="10-digit registered phone"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>

          <div className="field-group">
            <label htmlFor="loginPassword" className="text-xs font-semibold text-slate-700">
              Password *
            </label>
            <input
              id="loginPassword"
              type="password"
              required
              className="field"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
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

        {/* Demo Credentials Box */}
        <div className="mt-6 pt-5 border-t border-[#edf0f2] text-left">
          <span className="text-[11px] text-slate-500 block mb-2 font-semibold">
            Field Sales Agents ({agentsList.length > 0 ? agentsList.length : '11'} active):
          </span>
          <select
            className="select w-full text-xs"
            value={username}
            onChange={(e) => {
              const val = e.target.value;
              if (val) {
                setUsername(val);
                setPassword('password123');
              }
            }}
          >
            <option value="">-- Quick-select Field Sales Agent --</option>
            {agentsList.map((a) => (
              <option key={a.id} value={a.phone}>
                {a.name} ({a.phone})
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
