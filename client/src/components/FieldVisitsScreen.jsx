import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { getFreshVisitLocation } from '../utils/locationService';
import VisitMap from './VisitMap';

const todayIst = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const daysAgo = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() - n * 86400000));
const fmtTime = (iso) => (iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');

const STATUS_STYLE = {
  verified: { label: 'Verified', bg: '#dcfce7', fg: '#166534' },
  flagged: { label: 'Flagged: needs review', bg: '#fef3c7', fg: '#92400e' },
  rejected: { label: 'Rejected on review', bg: '#fee2e2', fg: '#991b1b' },
  too_far: { label: 'Too far', bg: '#fee2e2', fg: '#991b1b' },
  poor_accuracy: { label: 'GPS insufficient', bg: '#ede9fe', fg: '#5b21b6' },
  location_not_registered: { label: 'No shop location', bg: '#f1f5f9', fg: '#334155' }
};
const FLAG_TEXT = {
  mock_location_detected: 'Mock location detected',
  stale_gps_fix: 'Old GPS fix',
  implausible_travel_speed: 'Impossible travel speed'
};

const card = { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: 14 };
const th = { textAlign: 'left', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#64748b', padding: '8px 10px', borderBottom: '1px solid #e2e8f0', whiteSpace: 'nowrap' };
const td = { fontSize: 13, padding: '8px 10px', borderBottom: '1px solid #f1f5f9', verticalAlign: 'top' };

function StatusPill({ status }) {
  const s = STATUS_STYLE[status] || { label: status, bg: '#f1f5f9', fg: '#334155' };
  return <span style={{ background: s.bg, color: s.fg, borderRadius: 999, padding: '2px 8px', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>{s.label}</span>;
}

export default function FieldVisitsScreen({ user, showToast }) {
  const isAdmin = String(user?.role || '').toLowerCase() === 'admin';
  const [tab, setTab] = useState('summary');
  const [agents, setAgents] = useState([]);
  const tabs = [
    { id: 'summary', label: 'Daily summary' },
    { id: 'log', label: 'Visit log & map' },
    { id: 'review', label: 'Review flagged' },
    { id: 'locations', label: 'Shop locations' },
    ...(isAdmin ? [{ id: 'settings', label: 'Verification settings' }] : [])
  ];
  const toast = (m) => showToast && showToast(m);

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: 12, display: 'grid', gap: 12 }}>
      <header>
        <h1 style={{ margin: 0, fontSize: 22 }}>Field Visits</h1>
        <p style={{ margin: '2px 0 0', fontSize: 13, color: '#64748b' }}>
          GPS-verified shop visits {isAdmin ? 'for all agents' : 'by your team'}. Flagged visits count only after approval.
        </p>
      </header>
      <div role="tablist" aria-label="Field visits sections" style={{ display: 'flex', gap: 6, overflowX: 'auto' }}>
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            style={{ whiteSpace: 'nowrap', padding: '8px 12px', borderRadius: 999, border: `1px solid ${tab === t.id ? '#0f172a' : '#cbd5e1'}`, background: tab === t.id ? '#0f172a' : '#fff', color: tab === t.id ? '#fff' : '#334155', fontWeight: 700, fontSize: 13 }}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'summary' && <SummaryTab onAgents={setAgents} />}
      {tab === 'log' && <LogTab agents={agents} onAgents={setAgents} toast={toast} />}
      {tab === 'review' && <LogTab agents={agents} onAgents={setAgents} toast={toast} reviewOnly />}
      {tab === 'locations' && <LocationsTab toast={toast} />}
      {tab === 'settings' && isAdmin && <SettingsTab toast={toast} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
function SummaryTab({ onAgents }) {
  const [date, setDate] = useState(todayIst());
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    setError('');
    api.getVisitSummary(date).then((r) => {
      if (r?.status === 200) {
        setData(r);
        onAgents(r.agents.map((a) => ({ id: a.agentId, name: a.agentName })));
      } else setError(r?.message || 'Could not load the summary.');
    }).catch(() => setError('Could not load the summary. Check your connection.'));
  }, [date]);

  return (
    <section style={{ ...card, display: 'grid', gap: 12 }}>
      <label style={{ fontSize: 13, fontWeight: 700, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        Date
        <input id="visit-summary-date" type="date" value={date} max={todayIst()} onChange={(e) => setDate(e.target.value)} className="field" style={{ maxWidth: 180 }} />
      </label>
      {error && <div role="alert" style={{ color: '#991b1b' }}>{error}</div>}
      {data && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
            {[
              ['Shops visited', data.totals.shopsVisited],
              ['Verified visits', data.totals.verifiedVisits],
              ['Pending shops', data.totals.pendingShops],
              ['Flagged (review)', data.totals.flaggedPendingReview],
              ['Failed attempts', data.totals.failedAttempts]
            ].map(([label, value]) => (
              <div key={label} style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: 10 }}>
                <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
                <div style={{ fontSize: 22, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
              </div>
            ))}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Agent', 'Assigned', 'Visited', 'Verified visits', 'Pending', 'Flagged', 'Failed', 'No location', ''].map((h) => <th key={h} style={th}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {data.agents.length === 0 && (
                  <tr><td style={td} colSpan={9}>No Field Sales Agents in scope.</td></tr>
                )}
                {data.agents.map((a) => (
                  <tr key={a.agentId}>
                    <td style={td}><b>{a.agentName}</b>{!a.active && <span style={{ color: '#94a3b8' }}> (inactive)</span>}</td>
                    <td style={td}>{a.assignedShops}</td>
                    <td style={td}>{a.shopsVisited}</td>
                    <td style={td}>{a.verifiedVisits}</td>
                    <td style={td}>{a.pendingShops}</td>
                    <td style={td}>{a.flaggedPendingReview}</td>
                    <td style={td}>{a.failedAttempts}</td>
                    <td style={td}>{a.shopsWithoutLocation}</td>
                    <td style={td}>{a.suspicious && <span style={{ background: '#fee2e2', color: '#991b1b', borderRadius: 999, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>Check</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ margin: 0, fontSize: 12, color: '#64748b' }}>
            "Check" marks agents with a flagged visit or 3 or more failed attempts on this day. Geofence {data.settings.visitGeofenceRadiusM} m, accuracy ±{data.settings.visitMaxGpsAccuracyM} m.
          </p>
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
function LogTab({ agents, onAgents, toast, reviewOnly = false }) {
  const [from, setFrom] = useState(reviewOnly ? daysAgo(30) : daysAgo(6));
  const [to, setTo] = useState(todayIst());
  const [agentId, setAgentId] = useState('all');
  const [status, setStatus] = useState(reviewOnly ? 'flagged' : 'all');
  const [visits, setVisits] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [comment, setComment] = useState('');
  const [reviewing, setReviewing] = useState(false);

  useEffect(() => {
    if (agents.length === 0) {
      api.getVisitSummary().then((r) => r?.status === 200 && onAgents(r.agents.map((a) => ({ id: a.agentId, name: a.agentName })))).catch(() => {});
    }
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    api.getVisits({ from, to, agentId, status }).then((r) => {
      if (r?.status === 200) setVisits(r.visits);
      else setError(r?.message || 'Could not load visits.');
    }).catch(() => setError('Could not load visits. Check your connection.')).finally(() => setLoading(false));
  }, [from, to, agentId, status]);

  useEffect(() => { load(); setSelected(null); }, [load]);

  const decide = async (decision) => {
    if (!selected) return;
    if (decision === 'reject' && comment.trim().length < 3) {
      toast('Enter a short reason before rejecting.');
      return;
    }
    setReviewing(true);
    try {
      const r = await api.reviewVisit(selected.id, decision, comment.trim());
      if (r?.status === 200) {
        toast(r.message);
        setComment('');
        setSelected(r.visit);
        load();
      } else toast(r?.message || 'Review failed.');
    } catch {
      toast('Review failed. Check your connection.');
    } finally {
      setReviewing(false);
    }
  };

  const mapVisits = useMemo(() => (selected ? null : visits), [visits, selected]);

  return (
    <section style={{ display: 'grid', gap: 12, gridTemplateColumns: 'minmax(0, 1fr)' }}>
      <div style={{ ...card, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ fontSize: 12, fontWeight: 700, display: 'grid', gap: 2 }}>From<input id="visits-from" type="date" className="field" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
        <label style={{ fontSize: 12, fontWeight: 700, display: 'grid', gap: 2 }}>To<input id="visits-to" type="date" className="field" value={to} min={from} max={todayIst()} onChange={(e) => setTo(e.target.value)} /></label>
        <label style={{ fontSize: 12, fontWeight: 700, display: 'grid', gap: 2 }}>
          Agent
          <select id="visits-agent" className="field" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
            <option value="all">All agents</option>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        {!reviewOnly && (
          <label style={{ fontSize: 12, fontWeight: 700, display: 'grid', gap: 2 }}>
            Result
            <select id="visits-status" className="field" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="all">All attempts</option>
              <option value="verified">Verified</option>
              <option value="flagged">Flagged</option>
              <option value="rejected">Rejected on review</option>
              <option value="failed">All failed attempts</option>
              <option value="too_far">Too far</option>
              <option value="poor_accuracy">GPS insufficient</option>
              <option value="location_not_registered">No shop location</option>
            </select>
          </label>
        )}
        <button type="button" className="secondary-button" onClick={load} style={{ padding: '8px 12px' }}>Refresh</button>
      </div>

      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))', alignItems: 'start' }}>
        <div style={{ ...card, padding: 0, overflowX: 'auto' }}>
          {error && <div role="alert" style={{ padding: 12, color: '#991b1b' }}>{error}</div>}
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>{['When', 'Agent', 'Shop', 'Result', 'Distance', 'Accuracy'].map((h) => <th key={h} style={th}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {loading && <tr><td style={td} colSpan={6}>Loading…</td></tr>}
              {!loading && visits.length === 0 && <tr><td style={td} colSpan={6}>{reviewOnly ? 'No flagged visits waiting for review.' : 'No visits in this period.'}</td></tr>}
              {!loading && visits.map((v) => (
                <tr
                  key={v.id}
                  onClick={() => { setSelected(v); setComment(''); }}
                  style={{ cursor: 'pointer', background: selected?.id === v.id ? '#f8fafc' : undefined }}
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter') setSelected(v); }}
                >
                  <td style={td}>{fmtTime(v.visitedAt)}</td>
                  <td style={td}>{v.agentName}</td>
                  <td style={td}>{v.shopName}</td>
                  <td style={td}>
                    <StatusPill status={v.status} />
                    {v.riskFlags.length > 0 && <div style={{ fontSize: 11, color: '#92400e', marginTop: 2 }}>{v.riskFlags.map((f) => FLAG_TEXT[f] || f).join(', ')}</div>}
                  </td>
                  <td style={td}>{v.distanceM !== null ? `${Math.round(v.distanceM)} m` : '—'}</td>
                  <td style={td}>{v.gpsAccuracyM !== null ? `±${Math.round(v.gpsAccuracyM)} m` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ display: 'grid', gap: 10 }}>
          <VisitMap
            shop={selected && selected.shopLatitude !== null ? { latitude: selected.shopLatitude, longitude: selected.shopLongitude, shopName: selected.shopName } : null}
            radiusM={selected?.geofenceRadiusM || 100}
            agent={selected ? { latitude: selected.latitude, longitude: selected.longitude, accuracy: selected.gpsAccuracyM, status: selected.status, distanceM: selected.distanceM } : null}
            visits={mapVisits}
            height={320}
          />
          {selected ? (
            <div style={{ ...card, display: 'grid', gap: 6, fontSize: 13 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <b>{selected.agentName} at {selected.shopName}</b>
                <StatusPill status={selected.status} />
              </div>
              <div>Recorded: {fmtTime(selected.visitedAt)} (server time)</div>
              <div>Distance: {selected.distanceM !== null ? `${Math.round(selected.distanceM)} m` : '—'} of {selected.geofenceRadiusM ?? '—'} m allowed · Accuracy ±{selected.gpsAccuracyM !== null ? Math.round(selected.gpsAccuracyM) : '—'} m (limit {selected.maxAccuracyM ?? '—'} m)</div>
              <div>Device: {selected.platform || '—'} · Mock location: {selected.mockLocation}</div>
              {selected.riskFlags.length > 0 && <div style={{ color: '#92400e' }}>Flags: {selected.riskFlags.map((f) => FLAG_TEXT[f] || f).join(', ')}</div>}
              {selected.reviewDecision && (
                <div>Review: <b>{selected.reviewDecision}</b> by {selected.reviewedByName} on {fmtTime(selected.reviewedAt)}{selected.reviewComment ? ` · "${selected.reviewComment}"` : ''}</div>
              )}
              {selected.status === 'flagged' && (
                <div style={{ display: 'grid', gap: 6, borderTop: '1px solid #f1f5f9', paddingTop: 8 }}>
                  <label htmlFor="review-comment" style={{ fontWeight: 700 }}>Review note (required to reject)</label>
                  <textarea id="review-comment" className="field" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="e.g. Called the shop owner to confirm" />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button type="button" className="primary-button" disabled={reviewing} onClick={() => decide('approve')}>Approve visit</button>
                    <button type="button" className="secondary-button" disabled={reviewing} onClick={() => decide('reject')}>Reject visit</button>
                  </div>
                </div>
              )}
              <button type="button" className="secondary-button" style={{ justifySelf: 'start', padding: '4px 10px' }} onClick={() => setSelected(null)}>Show all on map</button>
            </div>
          ) : (
            <p style={{ margin: 0, fontSize: 12, color: '#64748b' }}>Select a visit to see the shop, its geofence and the agent's position.</p>
          )}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
function LocationsTab({ toast }) {
  const [filter, setFilter] = useState('missing');
  const [data, setData] = useState({ shops: [], totals: {} });
  const [selected, setSelected] = useState(null);
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [reason, setReason] = useState('');
  const [source, setSource] = useState('manual');
  const [history, setHistory] = useState([]);
  const [saving, setSaving] = useState(false);
  const [gpsBusy, setGpsBusy] = useState(false);

  const load = () => api.getShopLocations(filter).then((r) => r?.status === 200 && setData(r)).catch(() => toast('Could not load shops.'));
  useEffect(() => { load(); }, [filter]);

  const pick = (s) => {
    setSelected(s);
    setLat(s.locationRegistered ? String(s.latitude) : '');
    setLng(s.locationRegistered ? String(s.longitude) : '');
    setReason('');
    setSource('manual');
    api.getShopLocationHistory(s.shopId).then((r) => setHistory(r?.history || [])).catch(() => setHistory([]));
  };

  const useMyGps = async () => {
    setGpsBusy(true);
    const loc = await getFreshVisitLocation({ timeoutMs: 20000 });
    setGpsBusy(false);
    if (!loc.ok) return toast(loc.message);
    setLat(loc.latitude.toFixed(6));
    setLng(loc.longitude.toFixed(6));
    setSource('device_gps');
    toast(`Location captured (±${Math.round(loc.accuracy)} m). Check it on the map before saving.`);
  };

  const save = async () => {
    setSaving(true);
    try {
      const r = await api.updateShopLocation(selected.shopId, { latitude: Number(lat), longitude: Number(lng), reason, source });
      toast(r?.message || 'Saved.');
      if (r?.status === 200) {
        load();
        pick({ ...selected, latitude: Number(lat), longitude: Number(lng), locationRegistered: true });
      }
    } catch {
      toast('Could not save. Check your connection.');
    } finally {
      setSaving(false);
    }
  };

  const latN = Number(lat);
  const lngN = Number(lng);
  const valid = lat !== '' && lng !== '' && Number.isFinite(latN) && Number.isFinite(lngN) && latN >= 6 && latN <= 37.5 && lngN >= 68 && lngN <= 97.5;

  return (
    <section style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 380px), 1fr))', alignItems: 'start' }}>
      <div style={{ ...card, display: 'grid', gap: 8 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {[['missing', `Without location (${data.totals.missing ?? 0})`], ['all', `All shops (${data.totals.all ?? 0})`]].map(([id, label]) => (
            <button key={id} type="button" onClick={() => setFilter(id)} className={filter === id ? 'primary-button' : 'secondary-button'} style={{ padding: '6px 10px', fontSize: 12 }}>{label}</button>
          ))}
        </div>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4, maxHeight: 420, overflowY: 'auto' }}>
          {data.shops.length === 0 && <li style={{ fontSize: 13, color: '#64748b' }}>Every shop in your scope has a registered location.</li>}
          {data.shops.map((s) => (
            <li key={s.shopId}>
              <button type="button" onClick={() => pick(s)} style={{ width: '100%', textAlign: 'left', border: '1px solid #e2e8f0', borderRadius: 8, padding: 8, background: selected?.shopId === s.shopId ? '#f8fafc' : '#fff', cursor: 'pointer' }}>
                <b style={{ fontSize: 13 }}>{s.shopName}</b> <span style={{ fontSize: 11, color: '#64748b' }}>#{s.shopId} · {s.assignedAgentName}</span>
                <div style={{ fontSize: 12, color: s.locationRegistered ? '#64748b' : '#b91c1c' }}>{s.locationRegistered ? `${s.latitude}, ${s.longitude}` : 'Location not registered'}</div>
              </button>
            </li>
          ))}
        </ul>
      </div>

      {selected ? (
        <div style={{ ...card, display: 'grid', gap: 8 }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>{selected.shopName}</h3>
          <div style={{ fontSize: 12, color: '#64748b' }}>{selected.address || 'No address'} · Click the map to place the shop, or use your current GPS while standing at the shop.</div>
          <VisitMap
            shop={valid ? { latitude: latN, longitude: lngN, shopName: selected.shopName } : null}
            radiusM={100}
            onPick={(a, b) => { setLat(String(a)); setLng(String(b)); setSource('manual'); }}
            height={260}
          />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <label style={{ fontSize: 12, fontWeight: 700, display: 'grid', gap: 2 }}>Latitude<input id="shop-lat" className="field" inputMode="decimal" value={lat} onChange={(e) => { setLat(e.target.value); setSource('manual'); }} /></label>
            <label style={{ fontSize: 12, fontWeight: 700, display: 'grid', gap: 2 }}>Longitude<input id="shop-lng" className="field" inputMode="decimal" value={lng} onChange={(e) => { setLng(e.target.value); setSource('manual'); }} /></label>
          </div>
          <button type="button" className="secondary-button" onClick={useMyGps} disabled={gpsBusy} style={{ justifySelf: 'start', padding: '6px 10px' }}>{gpsBusy ? 'Getting GPS…' : 'Use my current GPS'}</button>
          <label style={{ fontSize: 12, fontWeight: 700, display: 'grid', gap: 2 }}>Reason for change *<input id="shop-location-reason" className="field" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Pinned during site visit" /></label>
          {!valid && (lat || lng) && <div role="alert" style={{ fontSize: 12, color: '#b91c1c' }}>Enter a location inside India (latitude 6 to 37.5, longitude 68 to 97.5).</div>}
          <button type="button" className="primary-button" disabled={!valid || reason.trim().length < 3 || saving} onClick={save}>{saving ? 'Saving…' : 'Save shop location'}</button>
          <h4 style={{ margin: '8px 0 0', fontSize: 14 }}>Change history</h4>
          {history.length === 0 ? (
            <div style={{ fontSize: 12, color: '#64748b' }}>No changes recorded.</div>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4, fontSize: 12 }}>
              {history.map((h) => (
                <li key={h.id} style={{ borderBottom: '1px solid #f1f5f9', paddingBottom: 4 }}>
                  {fmtTime(h.changedAt)} · <b>{h.changedByName}</b> ({h.changedByRole}): {h.oldLatitude ?? '—'}, {h.oldLongitude ?? '—'} → {h.newLatitude}, {h.newLongitude} · {h.source} · "{h.reason}"
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div style={{ ...card, fontSize: 13, color: '#64748b' }}>Select a shop to review or set its location. Visits are never verified against shops without a registered location.</div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
const SETTING_FIELDS = [
  ['visitGeofenceRadiusM', 'Geofence radius (metres)', 20, 1000],
  ['visitMaxGpsAccuracyM', 'Maximum GPS accuracy (metres)', 5, 200],
  ['visitDuplicateWindowMinutes', 'Duplicate protection window (minutes)', 0, 240],
  ['visitMaxFixAgeSeconds', 'Maximum GPS fix age (seconds)', 10, 600],
  ['visitMaxTravelSpeedKmh', 'Implausible travel speed (km/h)', 30, 1000]
];

function SettingsTab({ toast }) {
  const [values, setValues] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    api.getVisitSettings().then((r) => r?.status === 200 && setValues(Object.fromEntries(Object.entries(r.settings).map(([k, v]) => [k, String(v)])))).catch(() => {});
  }, []);
  if (!values) return <div style={card}>Loading settings…</div>;

  const save = async () => {
    setSaving(true);
    try {
      const body = Object.fromEntries(SETTING_FIELDS.map(([k]) => [k, Number(values[k])]));
      const r = await api.updateAdminSettings(body);
      toast(r?.status === 200 ? 'Verification settings saved.' : r?.message || 'Could not save.');
    } catch {
      toast('Could not save. Check your connection.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section style={{ ...card, display: 'grid', gap: 10, maxWidth: 520 }}>
      {SETTING_FIELDS.map(([key, label, min, max]) => (
        <label key={key} style={{ fontSize: 13, fontWeight: 700, display: 'grid', gap: 2 }}>
          {label} <span style={{ fontWeight: 400, color: '#64748b', fontSize: 12 }}>({min} to {max})</span>
          <input id={`setting-${key}`} className="field" type="number" min={min} max={max} value={values[key]} onChange={(e) => setValues({ ...values, [key]: e.target.value })} />
        </label>
      ))}
      <p style={{ margin: 0, fontSize: 12, color: '#64748b' }}>Defaults: 100 m radius, ±30 m accuracy, 30-minute duplicate window. Changes apply to new verifications only; past visits keep the values they were checked with.</p>
      <button type="button" className="primary-button" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save settings'}</button>
    </section>
  );
}
