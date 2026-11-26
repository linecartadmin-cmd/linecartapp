import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { MapPin, PlusCircle, Store, AlertTriangle, RefreshCw } from 'lucide-react';
import { api } from '../api';
import { Button, Card, List, ListItem, Metric, ProgressBar, Skeleton, SkeletonGroup, EmptyState, StatusPill } from '../ui';

// Field Sales Agent "Today": visit progress, today's orders and the next shops to visit.
// Data comes only from existing endpoints/props: GET /api/visits/my-shops (visit state per shop,
// server-scoped to this agent) and the orders list App.jsx already loads. Nothing is invented: a
// figure that could not be loaded is shown as unavailable, never as zero.

const rupees = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const localDate = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const orderDate = (o) => String(o.date || o.orderDate || o.order_date || o.createdAt || '').slice(0, 10);

export default function AgentTodayPanel({ orders = [], onNavigate, onOrderForCustomer, onOpenChangePassword, onRefreshUser }) {
  const [state, setState] = useState({ status: 'loading', data: null, error: null, code: null });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, status: 'loading', error: null, code: null }));
    try {
      const res = await api.getVisitShops('all');
      if (res?.status === 200) {
        setState({ status: 'ok', data: res, error: null, code: null });
      } else {
        const code = res?.code || (res?.status === 403 ? 'PASSWORD_CHANGE_REQUIRED' : null);
        setState({
          status: 'error',
          data: null,
          error: res?.message || 'Could not load your visit list.',
          code
        });
        if (code === 'PASSWORD_CHANGE_REQUIRED' && onRefreshUser) {
          onRefreshUser();
        }
      }
    } catch {
      setState({ status: 'error', data: null, error: 'Could not load your visit list. Check your connection.', code: null });
    }
  }, [onRefreshUser]);

  const handleRetry = useCallback(async () => {
    if (onRefreshUser) await onRefreshUser();
    await load();
  }, [load, onRefreshUser]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const onPasswordChanged = () => load();
    window.addEventListener('linecart:password_changed', onPasswordChanged);
    return () => window.removeEventListener('linecart:password_changed', onPasswordChanged);
  }, [load]);

  const today = useMemo(() => {
    const day = state.data?.date || localDate();
    const list = (orders || []).filter((o) => orderDate(o) === day && !String(o.status || '').toLowerCase().includes('cancel'));
    return { count: list.length, value: list.reduce((s, o) => s + Number(o.total || 0), 0) };
  }, [orders, state.data?.date]);

  const counts = state.data?.counts;
  const shops = state.data?.shops || [];
  const toVisit = shops.filter((s) => Number(s.visitsToday || 0) === 0).slice(0, 5);

  return (
    <section className="lc-stack" aria-label="Today" style={{ marginBottom: 'var(--lc-space-6)' }}>
      <div className="lc-grid lc-grid--3">
        <div className="lc-metric">
          <span className="lc-metric__label">Visits today</span>
          {state.status === 'loading' ? (
            <Skeleton width="60%" height={28} />
          ) : counts ? (
            <>
              <span className="lc-metric__value">
                {counts.visitedToday} <span style={{ fontSize: 'var(--lc-text-md)', color: 'var(--lc-muted)', fontWeight: 600 }}>of {counts.all} shops</span>
              </span>
              <ProgressBar label="Visit progress" showValue={false} value={counts.visitedToday} max={Math.max(1, counts.all)} />
            </>
          ) : (
            <span className="lc-metric__hint">Unavailable</span>
          )}
        </div>
        <Metric label="Orders today" value={today.count} hint={`${rupees(today.value)} placed today`} />
        <Metric
          label="Shops without a location pin"
          value={state.status === 'ok' ? counts?.withoutLocation ?? '—' : null}
          loading={state.status === 'loading'}
          hint="Visits at these shops cannot be GPS-verified"
        />
      </div>

      <Card
        title="Shops to visit today"
        subtitle="Assigned shops with no visit recorded today"
        actions={
          <>
            <Button variant="secondary" size="sm" icon={MapPin} onClick={() => onNavigate && onNavigate('visits')}>
              All visits
            </Button>
            <Button size="sm" icon={PlusCircle} onClick={() => onOrderForCustomer && onOrderForCustomer('')}>
              New order
            </Button>
          </>
        }
      >
        {state.status === 'loading' ? (
          <SkeletonGroup label="Loading shops">
            <Skeleton height={56} />
            <Skeleton height={56} />
          </SkeletonGroup>
        ) : state.status === 'error' ? (
          <EmptyState
            icon={AlertTriangle}
            title="Visit list unavailable"
            action={
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'center' }}>
                <Button variant="secondary" icon={RefreshCw} onClick={handleRetry}>Try again</Button>
                {state.code === 'PASSWORD_CHANGE_REQUIRED' ? (
                  <Button
                    variant="primary"
                    onClick={() => {
                      if (onOpenChangePassword) onOpenChangePassword();
                      else if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('linecart:open-change-password'));
                    }}
                  >
                    Change password
                  </Button>
                ) : null}
              </div>
            }
          >
            {state.error}
          </EmptyState>
        ) : toVisit.length === 0 ? (
          <EmptyState icon={Store} title={shops.length ? 'Every assigned shop has a visit today' : 'No shops assigned yet'}>
            {shops.length ? 'Good work. New visits appear in My visits.' : 'Shops appear here once a manager assigns them to you.'}
          </EmptyState>
        ) : (
          <List label="Shops to visit today">
            {toVisit.map((s) => (
              <ListItem
                key={s.shopId}
                leadingIcon={Store}
                title={s.shopName}
                meta={
                  <>
                    {[s.shopShortId, s.address].filter(Boolean).join(' · ')}
                    {!s.locationRegistered ? (
                      <span style={{ display: 'block', marginTop: 'var(--lc-space-1)' }}>
                        <StatusPill tone="warning" icon={MapPin} label="No pin" />
                      </span>
                    ) : null}
                  </>
                }
                trailing={
                  <Button variant="secondary" size="sm" onClick={() => onOrderForCustomer && onOrderForCustomer(s.shopName)}>
                    Order
                  </Button>
                }
              />
            ))}
          </List>
        )}
      </Card>
    </section>
  );
}
