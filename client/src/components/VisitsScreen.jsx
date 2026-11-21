import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { getFreshVisitLocation } from '../utils/locationService';
import { safeTel } from '../utils';
import useServerReachability from '../hooks/useServerReachability';
import VisitMap from './VisitMap';

const FILTERS = [
  { id: 'all', label: 'All shops' },
  { id: 'pending', label: 'Pending visits' },
  { id: 'visited_today', label: 'Visited today' },
  { id: 'not_visited_today', label: 'Not visited today' }
];

const STATUS_BADGE = {
  visited: { text: 'Visited today', bg: '#dcfce7', fg: '#166534' },
  pending_review: { text: 'Pending review', bg: '#fef3c7', fg: '#92400e' },
  pending: { text: 'Pending', bg: '#e0f2fe', fg: '#075985' }
};

// What the agent sees for each step of the verification
const PHASES = {
  idle: null,
  locating: { tone: 'info', title: 'Checking location…', text: 'Getting a fresh GPS fix. Stay still with a clear view of the sky.' },
  verifying: { tone: 'info', title: 'Verifying with the server…', text: 'Checking your distance from the shop.' },
  verified: { tone: 'ok', title: 'Visit Verified Successfully' },
  flagged: { tone: 'warn', title: 'Visit sent for review', text: 'Your visit was recorded but needs your manager\'s confirmation before it counts.' },
  too_far: { tone: 'bad', title: 'Too far from shop', text: 'You are too far from this shop. Please reach the shop to mark your visit.' },
  poor_accuracy: { tone: 'warn', title: 'GPS accuracy insufficient', text: 'GPS accuracy is insufficient. Please move to an open area and try again.' },
  location_not_registered: { tone: 'bad', title: 'Shop location not registered', text: 'This shop has no registered GPS location yet. Ask your manager to set it.' },
  location_error: { tone: 'bad', title: 'Location unavailable' },
  network_error: { tone: 'bad', title: 'Could not reach the server', text: 'The visit was NOT confirmed. Check your internet connection and try again.' },
  offline: { tone: 'bad', title: 'No internet connection', text: 'Visits are verified by the server. Connect to the internet and try again.' },
  error: { tone: 'bad', title: 'Visit not recorded' }
};
const TONE = {
  info: { bg: '#eff6ff', border: '#bfdbfe', fg: '#1e3a8a' },
  ok: { bg: '#f0fdf4', border: '#bbf7d0', fg: '#14532d' },
  warn: { bg: '#fffbeb', border: '#fde68a', fg: '#78350f' },
  bad: { bg: '#fef2f2', border: '#fecaca', fg: '#7f1d1d' }
};

const fmtTime = (iso) =>
  iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
const newKey = () => `visit-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

export default function VisitsScreen({ user, showToast }) {
  const [filter, setFilter] = useState('all');
  const [data, setData] = useState({ shops: [], counts: {}, settings: null, date: '' });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [phase, setPhase] = useState('idle');
  const [detailText, setDetailText] = useState('');
  const [result, setResult] = useState(null); // server visit + reading
  const [shopVisits, setShopVisits] = useState([]);
  const busyRef = useRef(false);
  const { isConnected, recheck } = useServerReachability();

  const load = useCallback(async (f = filter) => {
    setLoading(true);
    setLoadError('');
    try {
      const res = await api.getVisitShops(f);
      if (res?.status === 200) setData(res);
      else setLoadError(res?.message || 'Could not load your shops.');
    } catch {
      setLoadError('Could not load your shops. Check your internet connection.');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { load(filter); }, [filter]);

  const selected = useMemo(() => data.shops.find((s) => s.shopId === selectedId) || null, [data.shops, selectedId]);

  useEffect(() => {
    setPhase('idle');
    setResult(null);
    setDetailText('');
    if (!selectedId) return;
    const from = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    api.getVisits({ shopId: selectedId, from }).then((r) => {
      if (r?.status === 200) setShopVisits(r.visits || []);
    }).catch(() => setShopVisits([]));
  }, [selectedId]);

  const markVisited = async () => {
    if (!selected || busyRef.current) return;
    busyRef.current = true;
    setResult(null);
    setDetailText('');
    try {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        setPhase('offline');
        return;
      }
      if (!selected.locationRegistered) {
        setPhase('location_not_registered');
        return;
      }
      setPhase('locating');
      const loc = await getFreshVisitLocation({ timeoutMs: 20000 });
      if (!loc.ok) {
        setPhase('location_error');
        setDetailText(loc.message);
        return;
      }
      setPhase('verifying');
      const reachable = await recheck();
      if (!reachable) {
        setPhase('offline');
        return;
      }
      const key = newKey();
      const payload = {
        shopId: selected.shopId,
        latitude: loc.latitude,
        longitude: loc.longitude,
        accuracy: loc.accuracy,
        fixTimestamp: loc.fixTimestamp,
        mockLocation: loc.mockLocation,
        platform: loc.platform
      };
      let res;
      try {
        res = await api.verifyVisit(payload, key);
      } catch (err) {
        if (!err?.uncertain) throw err;
        // Unknown outcome: ask again with the same key; the server returns the recorded result, never a duplicate
        await new Promise((r) => setTimeout(r, 1500));
        try {
          res = await api.verifyVisit(payload, key);
        } catch {
          setPhase('network_error');
          return;
        }
      }
      const reading = { latitude: loc.latitude, longitude: loc.longitude, accuracy: loc.accuracy };
      if (res?.visit) setResult({ ...res.visit, ...reading, distanceM: res.visit.distanceM, radiusM: res.radiusM, maxAccuracyM: res.maxAccuracyM, duplicate: res.duplicate });
      if (res?.status === 401) {
        setPhase('error');
        setDetailText('Your session has expired. Sign in again.');
      } else if (res?.result && PHASES[res.result]) {
        setPhase(res.result);
        if (res.result === 'verified' && showToast) showToast('Visit Verified Successfully');
        if (res.result === 'verified' || res.result === 'flagged') load(filter);
      } else {
        setPhase('error');
        setDetailText(res?.message || 'The server did not accept the visit.');
      }
    } catch (err) {
      setPhase('error');
      setDetailText(err?.message || 'Unexpected error.');
    } finally {
      busyRef.current = false;
    }
  };

  const busy = phase === 'locating' || phase === 'verifying';
  const p = PHASES[phase];
  const tone = p ? TONE[p.tone] : null;
  const settings = data.settings || { visitGeofenceRadiusM: 100, visitMaxGpsAccuracyM: 30 };

  // ------------------------------------------------------------------ detail view
  if (selected) {
    const badge = STATUS_BADGE[selected.visitStatus];
    return (
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '12px', display: 'grid', gap: '12px' }}>
        <button type="button" className="secondary-button" style={{ justifySelf: 'start', padding: '6px 12px' }} onClick={() => setSelectedId(null)}>
          ← All shops
        </button>

        <section style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: 16, display: 'grid', gap: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div style={{ minWidth: 0 }}>
              <h2 style={{ margin: 0, fontSize: 19, color: '#0f172a' }}>{selected.shopName}</h2>
              <div style={{ fontSize: 12, color: '#64748b' }}>{selected.shopShortId}</div>
            </div>
            <span style={{ background: badge.bg, color: badge.fg, borderRadius: 999, padding: '3px 10px', fontSize: 12, fontWeight: 700 }}>{badge.text}</span>
          </div>
          <div style={{ fontSize: 14, color: '#334155', display: 'grid', gap: 4 }}>
            <div>👤 {selected.ownerName || '—'}</div>
            <div>📍 {selected.address || '—'}</div>
            <div>
              📞 {selected.contact1 && safeTel(selected.contact1) ? <a href={`tel:${safeTel(selected.contact1)}`}>{selected.contact1}</a> : (selected.contact1 || '—')}
            </div>
            <div>
              🛰 {selected.locationRegistered ? `${selected.latitude.toFixed(6)}, ${selected.longitude.toFixed(6)}` : <b style={{ color: '#b91c1c' }}>Shop location not registered</b>}
            </div>
            <div>🕒 Last verified visit: {fmtTime(selected.lastVisitAt)} · Today: {selected.visitsToday}</div>
          </div>
        </section>

        {selected.locationRegistered && (
          <VisitMap
            shop={{ latitude: selected.latitude, longitude: selected.longitude, shopName: selected.shopName }}
            radiusM={result?.radiusM || settings.visitGeofenceRadiusM}
            agent={result ? { latitude: result.latitude, longitude: result.longitude, accuracy: result.accuracy, status: result.status, distanceM: result.distanceM } : null}
            height={240}
          />
        )}

        {p && (
          <div role={busy ? 'status' : 'alert'} aria-live="polite" style={{ background: tone.bg, border: `1px solid ${tone.border}`, color: tone.fg, borderRadius: 12, padding: 14 }}>
            <div style={{ fontWeight: 800, fontSize: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              {busy && <span className="sync-spinner" aria-hidden="true">⏳</span>}
              {p.title}
            </div>
            {(detailText || p.text) && <div style={{ marginTop: 4, fontSize: 14 }}>{detailText || p.text}</div>}
            {result && ['verified', 'flagged', 'too_far', 'poor_accuracy'].includes(phase) && (
              <div style={{ marginTop: 8, fontSize: 13, display: 'grid', gap: 2 }}>
                {['verified', 'flagged'].includes(phase) && <div>Recorded at <b>{fmtTime(result.visitedAt)}</b>{result.duplicate ? ' (already recorded)' : ''}</div>}
                {result.distanceM !== null && <div>Distance from shop: <b>{Math.round(result.distanceM)} m</b> (allowed {result.radiusM} m)</div>}
                <div>GPS accuracy: <b>±{Math.round(result.accuracy)} m</b> (needed ±{result.maxAccuracyM} m or better)</div>
              </div>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={markVisited}
          disabled={busy || !isConnected || !selected.locationRegistered}
          aria-busy={busy}
          style={{
            padding: '18px 16px',
            fontSize: 18,
            fontWeight: 900,
            letterSpacing: '0.04em',
            borderRadius: 14,
            border: 'none',
            color: '#fff',
            background: busy || !isConnected || !selected.locationRegistered ? '#94a3b8' : '#15803d',
            cursor: busy ? 'progress' : 'pointer',
            minHeight: 60
          }}
        >
          {busy ? (phase === 'locating' ? 'GETTING GPS…' : 'VERIFYING…') : !isConnected ? 'OFFLINE: CONNECT TO MARK VISIT' : !selected.locationRegistered ? 'SHOP LOCATION NOT REGISTERED' : phase === 'verified' ? 'MARK ANOTHER VISIT' : 'MARK AS VISITED'}
        </button>
        <p style={{ margin: 0, fontSize: 12, color: '#64748b', textAlign: 'center' }}>
          You must be within {settings.visitGeofenceRadiusM} m of the shop with GPS accuracy of ±{settings.visitMaxGpsAccuracyM} m or better.
        </p>

        <section style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: 14 }}>
          <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>Your recent visits here (30 days)</h3>
          {shopVisits.length === 0 ? (
            <div style={{ fontSize: 13, color: '#64748b' }}>No visits recorded yet.</div>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
              {shopVisits.slice(0, 15).map((v) => (
                <li key={v.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13, borderBottom: '1px solid #f1f5f9', paddingBottom: 4 }}>
                  <span>{fmtTime(v.visitedAt)}</span>
                  <span style={{ fontWeight: 700 }}>{v.status.replace(/_/g, ' ')}{v.distanceM !== null ? ` · ${Math.round(v.distanceM)} m` : ''}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    );
  }

  // ------------------------------------------------------------------ list view
  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '12px', display: 'grid', gap: 12 }}>
      <header>
        <h1 style={{ margin: 0, fontSize: 22 }}>My Visits</h1>
        <p style={{ margin: '2px 0 0', fontSize: 13, color: '#64748b' }}>
          {data.date ? `Today (${data.date})` : 'Today'} · {data.counts.visitedToday ?? 0} of {data.counts.all ?? 0} shops visited
          {data.counts.withoutLocation ? ` · ${data.counts.withoutLocation} without a registered location` : ''}
        </p>
      </header>

      {!isConnected && (
        <div role="alert" style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', borderRadius: 10, padding: 10, fontSize: 13 }}>
          No connection to the LineCart server. Visits can only be verified online.
        </div>
      )}

      <div role="tablist" aria-label="Filter shops" style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            role="tab"
            aria-selected={filter === f.id}
            onClick={() => setFilter(f.id)}
            style={{
              whiteSpace: 'nowrap',
              padding: '8px 12px',
              borderRadius: 999,
              border: `1px solid ${filter === f.id ? '#0f172a' : '#cbd5e1'}`,
              background: filter === f.id ? '#0f172a' : '#fff',
              color: filter === f.id ? '#fff' : '#334155',
              fontWeight: 700,
              fontSize: 13
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ padding: 20, textAlign: 'center', color: '#64748b' }}>Loading your shops…</div>
      ) : loadError ? (
        <div role="alert" style={{ padding: 14, color: '#991b1b' }}>
          {loadError} <button type="button" className="secondary-button" onClick={() => load(filter)}>Retry</button>
        </div>
      ) : data.shops.length === 0 ? (
        <div style={{ padding: 20, textAlign: 'center', color: '#64748b' }}>No shops in this list.</div>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
          {data.shops.map((s) => {
            const badge = STATUS_BADGE[s.visitStatus];
            return (
              <li key={s.shopId}>
                <button
                  type="button"
                  onClick={() => setSelectedId(s.shopId)}
                  style={{ width: '100%', textAlign: 'left', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 12, display: 'grid', gap: 4, cursor: 'pointer' }}
                >
                  <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <b style={{ fontSize: 15, color: '#0f172a', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.shopName}</b>
                    <span style={{ background: badge.bg, color: badge.fg, borderRadius: 999, padding: '1px 8px', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>{badge.text}</span>
                  </span>
                  <span style={{ fontSize: 12, color: '#475569' }}>{s.ownerName || '—'} · {s.contact1 || 'no phone'}</span>
                  <span style={{ fontSize: 12, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.address || '—'}</span>
                  <span style={{ fontSize: 12, color: s.locationRegistered ? '#64748b' : '#b91c1c' }}>
                    {s.locationRegistered ? `🛰 ${s.latitude.toFixed(5)}, ${s.longitude.toFixed(5)}` : 'Shop location not registered'} · Last visit: {fmtTime(s.lastVisitAt)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
