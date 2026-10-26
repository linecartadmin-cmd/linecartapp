import React from 'react';

const CANONICAL_FALLBACK_ROLES = [
  {
    role: 'Admin',
    name: 'Demo Admin',
    phone: '9876500099',
    defaultPassword: 'password123',
    description: 'System administration, user roles & command center'
  },
  {
    role: 'Sales Manager',
    name: 'Demo Sales Manager',
    phone: '9876500001',
    defaultPassword: 'password123',
    description: 'Team performance, orders, maps & quotas'
  },
  {
    role: 'Field Sales Agent',
    name: 'Demo Field Agent',
    phone: '9876543210',
    defaultPassword: 'password123',
    description: 'Shop orders, customer registration & catalogs'
  },
  {
    role: 'Delivery Agent',
    name: 'Demo Delivery Agent',
    phone: '9876500050',
    defaultPassword: 'password123',
    description: 'Delivery route fulfillment & stop updates'
  }
];

export default function DemoRoleLoginSection({
  demoRoles = [],
  agentsList = [],
  currentPhone = '',
  onApplyCredentials
}) {
  const effectiveRoles = (demoRoles && demoRoles.length > 0) ? demoRoles : CANONICAL_FALLBACK_ROLES;

  const handleRoleClick = (dr) => {
    if (onApplyCredentials) {
      onApplyCredentials({
        phone: dr.phone,
        password: dr.defaultPassword || 'password123',
        toastMessage: `Filled form with ${dr.role} demo credentials (${dr.phone}). Click "Sign In" to proceed.`
      });
    }
  };

  const handlePhoneChange = (val) => {
    if (!val) return;
    const matched = agentsList.find((u) => u.phone === val);
    if (onApplyCredentials) {
      onApplyCredentials({
        phone: val,
        password: matched?.defaultPassword || 'password123'
      });
    }
  };

  return (
    <div className="mt-6 pt-5 border-t border-[#edf0f2] text-left">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5 font-['Manrope']">
          <span>🛠️</span>
          <span>Demo role login</span>
        </span>
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-semibold border border-amber-300">
          LOCAL DEV ONLY
        </span>
      </div>

      <p className="text-[11px] text-slate-500 mb-3">
        Select a demo role below to fill the login form with synthetic test credentials, then sign in through the backend:
      </p>

      <div className="grid grid-cols-2 gap-2 mb-3">
        {effectiveRoles.map((dr) => (
          <button
            key={dr.role}
            type="button"
            onClick={() => handleRoleClick(dr)}
            className="p-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 hover:border-sky-300 transition-all text-left flex flex-col justify-between shadow-sm group cursor-pointer"
            title={`Fill ${dr.role} demo credentials`}
          >
            <div className="flex items-center gap-1 mb-1">
              <span className="text-xs font-bold text-slate-800 group-hover:text-sky-600 transition-colors">
                {dr.role === 'Admin' && '🛡️ '}
                {dr.role === 'Sales Manager' && '👔 '}
                {dr.role === 'Field Sales Agent' && '📋 '}
                {dr.role === 'Delivery Agent' && '🚚 '}
                {dr.role}
              </span>
            </div>
            <span className="text-[10px] font-mono text-slate-500">
              {dr.phone}
            </span>
          </button>
        ))}
      </div>

      {agentsList.length > 0 && (
        <select
          className="select w-full text-xs mb-3"
          value={currentPhone}
          onChange={(e) => handlePhoneChange(e.target.value)}
        >
          <option value="">-- Or select specific test agent account --</option>
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
      )}

      <p className="text-[10px] text-slate-400 leading-relaxed">
        Real Admin account (9870000001) credentials are never exposed. Demo accounts and shortcuts are strictly rejected in production.
      </p>
    </div>
  );
}
