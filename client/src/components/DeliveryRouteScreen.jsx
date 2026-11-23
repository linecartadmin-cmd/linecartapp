import React, { useEffect, useMemo, useState } from 'react';
import {
  Truck,
  Phone,
  Navigation,
  Volume2,
  Languages,
  RefreshCw,
  PackageCheck,
  XCircle,
  ChevronRight,
  MapPin,
  WifiOff,
  AlertTriangle,
  Store,
  CheckCircle2,
  Route as RouteIcon,
  Clock
} from 'lucide-react';
import { api } from '../api';
import { getGoogleMapsUrl, safeTel } from '../utils';
import {
  Button,
  IconButton,
  Icon,
  StatusPill,
  Dialog,
  ConfirmDialog,
  BottomSheet,
  SearchInput,
  Select,
  Field,
  TextInput,
  TextArea,
  SegmentedControl,
  ProgressBar,
  EmptyState,
  Skeleton,
  SkeletonGroup,
  Metric,
  registerOverlay
} from '../ui';
import { DELIVERY_I18N } from '../delivery/deliveryI18n';
import { useDeliveryRoute } from '../delivery/useDeliveryRoute';
import {
  STATUS,
  FAIL_REASONS,
  FILTERS,
  stopPhase,
  isOpen,
  filterStops,
  orderItems,
  paymentOutcome,
  validateCollected,
  hasCoords,
  rupees
} from '../delivery/deliveryModel';
import DeliveryRouteMap from './DeliveryRouteMap';
import '../delivery/delivery.css';

/**
 * Delivery Agent screen (page id 'delivery'; also opened by Admin as "Delivery fleet").
 * Views: Today (progress and next stop), All stops (search and filters), Map.
 * Details open in a bottom sheet; pick up, delivery with payment and could-not-deliver use dialogs.
 * Data and actions come from useDeliveryRoute, which keeps the previous offline queue behaviour.
 */
export default function DeliveryRouteScreen({ user, showToast }) {
  const [lang, setLang] = useState('en');
  const t = DELIVERY_I18N[lang];
  const route = useDeliveryRoute({ user, showToast, t });
  const { activeStops, counts, nextIndex, syncMap, online, loading, clusters, selectedClusterId } = route;

  const [view, setView] = useState('today');

  // Android back on 'All stops' or 'Map' returns to 'Today' first (open sheets and dialogs still
  // close before this, because they register on top of it).
  useEffect(() => {
    if (view === 'today') return undefined;
    return registerOverlay({ onRequestClose: () => setView('today') });
  }, [view]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [detailId, setDetailId] = useState(null);
  const [pickUpFor, setPickUpFor] = useState(null);
  const [deliverFor, setDeliverFor] = useState(null);
  const [failFor, setFailFor] = useState(null);
  const [result, setResult] = useState(null);

  const speak = (text) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang === 'ta' ? 'ta-IN' : 'en-IN';
      u.rate = 0.95;
      window.speechSynthesis.speak(u);
    } catch {}
  };

  const indexOf = (stop) => activeStops.findIndex((s) => String(s.id) === String(stop.id));
  const byId = (id) => activeStops.find((s) => String(s.id) === String(id)) || route.orders.find((s) => String(s.id) === String(id));
  const detail = detailId ? byId(detailId) : null;
  const nextStop = nextIndex >= 0 ? activeStops[nextIndex] : null;

  const pendingSync = useMemo(() => [...syncMap.values()].filter((s) => s.state === 'pending').length, [syncMap]);
  const failedSync = useMemo(() => [...syncMap.entries()].filter(([, s]) => s.state === 'failed'), [syncMap]);

  const speakStop = (stop) => {
    const n = indexOf(stop) + 1;
    speak(
      lang === 'ta'
        ? `நிறுத்தம் எண் ${n}. கடை பெயர்: ${stop.shopName}. முகவரி: ${stop.address || 'முகவரி இல்லை'}. நிலை: ${stop.status}.`
        : `Stop number ${n}. Shop: ${stop.shopName}. Address: ${stop.address || 'No address'}. Status: ${stop.status}.`
    );
  };

  const handleStartRoute = async () => {
    const planned = await route.startRoute();
    if (!planned) return;
    speak(lang === 'ta' ? `டெலிவரி வழி தயார். மொத்தம் ${planned.orderedStops.length} நிறுத்தங்கள்.` : `Route active. ${planned.orderedStops.length} stops arranged in road routing order.`);
    showToast && showToast(lang === 'ta' ? 'டெலிவரி வழி தொடங்கியது!' : 'Delivery route started!', 'success');
  };

  // ----- Workflow actions -----
  const confirmPickUp = async () => {
    const stop = pickUpFor;
    const r = await route.updateStatus(stop.id, STATUS.PICKED_UP);
    if (r.outcome === 'synced' || r.outcome === 'queued') {
      setPickUpFor(null);
      if (r.outcome === 'synced') speak(lang === 'ta' ? `${stop.shopName} பொருட்கள் எடுக்கப்பட்டது.` : `${stop.shopName} order picked up.`);
    }
  };

  const confirmDelivered = async (stop, collected) => {
    const r = await route.updateStatus(stop.id, STATUS.DELIVERED, { paymentAmountCollected: collected });
    if (r.outcome === 'synced' || r.outcome === 'queued') {
      setDeliverFor(null);
      setResult({ stop, outcome: r.outcome, payment: r.payment });
      if (r.outcome === 'synced') speak(lang === 'ta' ? `${stop.shopName} கடைக்கு டெலிவரி முடிந்தது.` : `${stop.shopName} marked as Delivered.`);
    }
  };

  const confirmFailed = async (stop, reason, note) => {
    const r = await route.updateStatus(stop.id, STATUS.COULD_NOT_DELIVER, { reason, note: note || null });
    if (r.outcome === 'synced' || r.outcome === 'queued') setFailFor(null);
  };

  const openStop = (stop) => setDetailId(String(stop.id));

  const filtered = useMemo(
    () => filterStops(activeStops, { filter, query, syncMap }),
    [activeStops, filter, query, syncMap]
  );

  const filterLabels = {
    all: t.filterAll,
    toPickUp: t.filterToPickUp,
    onTheWay: t.filterOnTheWay,
    delivered: t.filterDelivered,
    failed: t.filterFailed,
    pendingSync: t.filterPendingSync
  };

  return (
    <div className={`dl ${lang === 'ta' ? 'lc-tamil' : ''}`} lang={lang === 'ta' ? 'ta' : 'en'}>
      {/* Controls: area, language, refresh */}
      <div className="dl-head">
        {clusters.length > 1 ? (
          <div className="dl-head__area">
            <label className="lc-sr-only" htmlFor="dl-area">{t.area}</label>
            <Select
              id="dl-area"
              value={selectedClusterId}
              onChange={(e) => route.setSelectedClusterId(e.target.value)}
              options={[
                { value: 'all', label: t.allClusters },
                ...clusters.map((c) => ({ value: String(c.clusterId), label: c.clusterName || `Cluster ${c.clusterId}` }))
              ]}
            />
          </div>
        ) : (
          <div className="dl-head__title">
            <Icon icon={Truck} size={22} />
            <span>{clusters[0]?.clusterName || ''}</span>
          </div>
        )}
        <Button variant="secondary" size="sm" icon={Languages} onClick={() => setLang(lang === 'en' ? 'ta' : 'en')} aria-label={`${t.language}: ${t.langToggle}`}>
          <span className={lang === 'en' ? 'lc-tamil' : ''}>{t.langToggle}</span>
        </Button>
        <IconButton icon={RefreshCw} label={t.refresh} outlined onClick={() => route.reload()} />
      </div>

      {/* Connection and sync state */}
      {!online ? (
        <div className="dl-banner dl-banner--offline" role="status">
          <Icon icon={WifiOff} size={20} />
          <span>{t.offlineBanner}</span>
        </div>
      ) : null}
      {pendingSync > 0 || failedSync.length > 0 ? (
        <div className="dl-banner dl-banner--sync" role="status">
          <Icon icon={failedSync.length ? AlertTriangle : Clock} size={20} />
          <span>
            {pendingSync > 0 ? `${pendingSync} ${t.pendingSummary}` : null}
            {pendingSync > 0 && failedSync.length > 0 ? ' · ' : null}
            {failedSync.length > 0 ? `${failedSync.length} ${t.failedSummary}` : null}
          </span>
          {failedSync.length > 0 ? (
            <Button variant="ghost" size="sm" onClick={() => { setFilter('pendingSync'); setView('stops'); }}>
              {t.allStops}
            </Button>
          ) : null}
        </div>
      ) : null}

      <SegmentedControl
        label={t.appTitle}
        className="dl-tabs"
        value={view}
        onChange={setView}
        options={[
          { value: 'today', label: t.today },
          { value: 'stops', label: `${t.allStops} (${counts.total})` },
          { value: 'map', label: t.map }
        ]}
      />

      {loading && route.orders.length === 0 ? (
        <SkeletonGroup label={t.loading}>
          <Skeleton height={96} />
          <Skeleton height={220} />
          <Skeleton height={72} />
        </SkeletonGroup>
      ) : view === 'today' ? (
        <TodayView
          t={t}
          counts={counts}
          nextStop={nextStop}
          nextNumber={nextIndex + 1}
          syncMap={syncMap}
          route={route}
          failedSync={failedSync}
          byId={byId}
          onStartRoute={handleStartRoute}
          onOpen={openStop}
          onSpeak={speakStop}
          onPickUp={setPickUpFor}
          onDeliver={setDeliverFor}
          onFail={setFailFor}
        />
      ) : view === 'stops' ? (
        <div className="dl-stack">
          <SearchInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t.search} aria-label={t.search} />
          <SegmentedControl
            label={t.filterAll}
            className="dl-filters"
            value={filter}
            onChange={setFilter}
            options={FILTERS.map((f) => ({ value: f, label: filterLabels[f] }))}
          />
          {route.currentStops.length === 0 ? (
            <EmptyState icon={Truck} title={t.noOrders}>{t.noStopsYet}</EmptyState>
          ) : filtered.length === 0 ? (
            <EmptyState icon={Store} title={t.noMatches} />
          ) : (
            <ul className="dl-list" aria-label={t.allStops}>
              {filtered.map((stop) => (
                <li key={stop.id}>
                  <StopRow t={t} stop={stop} number={indexOf(stop) + 1} isNext={stop === nextStop} sync={syncMap.get(String(stop.id))} onOpen={() => openStop(stop)} />
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="dl-stack">
          <DeliveryRouteMap
            stops={activeStops}
            routeInfo={route.routeInfo}
            nextIndex={nextIndex}
            labels={{ callShop: t.callShop, openMap: t.openMap, order: t.order, map: t.map }}
          />
          <RouteNote t={t} route={route} />
        </div>
      )}

      {/* Stop details */}
      <BottomSheet open={Boolean(detail)} onClose={() => setDetailId(null)} title={detail?.shopName}>
        {detail ? (
          <StopDetail
            t={t}
            stop={detail}
            number={indexOf(detail) + 1}
            sync={syncMap.get(String(detail.id))}
            user={user}
            busy={route.updatingId === String(detail.id)}
            onSpeak={() => speakStop(detail)}
            onPickUp={() => setPickUpFor(detail)}
            onDeliver={() => setDeliverFor(detail)}
            onFail={() => setFailFor(detail)}
          />
        ) : null}
      </BottomSheet>

      {/* Pick up */}
      <ConfirmDialog
        open={Boolean(pickUpFor)}
        title={t.markPickedUp}
        message={pickUpFor ? `${pickUpFor.shopName} · ${t.order} ${pickUpFor.id}. ${t.pickUpQuestion}` : ''}
        confirmLabel={t.confirmAction}
        cancelLabel={t.cancel}
        onCancel={() => setPickUpFor(null)}
        onConfirm={confirmPickUp}
      />

      {/* Delivered with payment */}
      <DeliverDialog t={t} stop={deliverFor} busy={Boolean(deliverFor) && route.updatingId === String(deliverFor?.id)} onCancel={() => setDeliverFor(null)} onConfirm={confirmDelivered} />

      {/* Could not deliver */}
      <FailDialog t={t} stop={failFor} busy={Boolean(failFor) && route.updatingId === String(failFor?.id)} onCancel={() => setFailFor(null)} onConfirm={confirmFailed} />

      {/* Result after delivery: confirmed only when the server accepted it */}
      <Dialog
        open={Boolean(result)}
        onClose={() => setResult(null)}
        title={result?.outcome === 'synced' ? t.deliveredSaved : t.deliveredQueued}
        footer={<Button onClick={() => setResult(null)}>{t.done}</Button>}
      >
        {result ? (
          <div className="dl-stack dl-stack--sm">
            <div className="dl-result__shop">{result.stop.shopName}</div>
            <StatusPill status={result.outcome === 'synced' ? 'Delivered' : 'pending'} label={result.outcome === 'synced' ? t.syncSynced : t.syncPending} tone={result.outcome === 'synced' ? 'success' : 'warning'} />
            <dl className="dl-kv">
              <dt>{t.total}</dt><dd className="lc-num">{rupees(result.payment?.total)}</dd>
              <dt>{t.collected}</dt><dd className="lc-num">{rupees(result.payment?.collected)}</dd>
              <dt>{t.balance}</dt><dd className="lc-num">{rupees(result.payment?.balance)}</dd>
              <dt>{t.payment}</dt><dd><StatusPill status={result.payment?.status} /></dd>
            </dl>
            {result.outcome === 'queued' ? <p className="dl-muted">{t.queuedToast}</p> : null}
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}

// ---------- Pieces ----------

function SyncChip({ t, sync }) {
  if (!sync || sync.state === 'synced' || !sync.state) return null;
  if (sync.state === 'pending') return <StatusPill tone="warning" icon={Clock} label={t.syncPending} />;
  return <StatusPill tone="danger" icon={AlertTriangle} label={t.syncFailed} />;
}

function phaseLabel(t, stop) {
  const p = stopPhase(stop);
  if (p === 'delivered') return t.completedBadge;
  if (p === 'failed') return t.failedBadge;
  if (p === 'onTheWay') return t.statusPickedUp;
  if (p === 'blocked') return t.statusPriceBlocked;
  if (p === 'cancelled') return stop.status;
  return t.statusInProgress;
}

function StopStatus({ t, stop }) {
  return <StatusPill status={stop.status} label={phaseLabel(t, stop)} />;
}

function ContactActions({ t, stop, onSpeak }) {
  const mapsUrl = getGoogleMapsUrl(stop);
  const tel = stop.contactPhone ? safeTel(stop.contactPhone) : '';
  return (
    <div className="dl-contact">
      {tel ? (
        <a className="lc-btn lc-btn--secondary" href={`tel:${tel}`}>
          <Icon icon={Phone} size={20} />
          <span>{t.callShop}</span>
        </a>
      ) : null}
      {mapsUrl ? (
        <a className="lc-btn lc-btn--secondary" href={mapsUrl} target="_blank" rel="noopener noreferrer" aria-label={hasCoords(stop) ? t.navigate : t.openMapByAddress} title={hasCoords(stop) ? t.navigate : t.openMapByAddress}>
          <Icon icon={Navigation} size={20} />
          <span>{t.navigate}</span>
        </a>
      ) : null}
      <IconButton icon={Volume2} label={t.readAloud} outlined onClick={onSpeak} />
    </div>
  );
}

function PrimaryActions({ t, stop, busy, onPickUp, onDeliver, onFail }) {
  const p = stopPhase(stop);
  if (p === 'blocked') {
    return (
      <div className="dl-notice dl-notice--warning" role="note">
        <Icon icon={AlertTriangle} size={20} />
        <span>{t.priceBlocked}</span>
      </div>
    );
  }
  if (p === 'cancelled') {
    return (
      <div className="dl-notice" role="note">
        <Icon icon={XCircle} size={20} />
        <span>{t.cancelledNotice}</span>
      </div>
    );
  }
  if (!isOpen(stop)) return null;
  return (
    <div className="dl-actions">
      {p === 'onTheWay' ? (
        <Button variant="success" size="lg" block icon={PackageCheck} loading={busy} onClick={onDeliver}>
          {t.markDelivered}
        </Button>
      ) : (
        <Button variant="primary" size="lg" block icon={Truck} loading={busy} onClick={onPickUp}>
          {t.markPickedUp}
        </Button>
      )}
      <Button variant="danger-ghost" block icon={XCircle} disabled={busy} onClick={onFail}>
        {t.couldNotDeliver}
      </Button>
    </div>
  );
}

function TodayView({ t, counts, nextStop, nextNumber, syncMap, route, failedSync, byId, onStartRoute, onOpen, onSpeak, onPickUp, onDeliver, onFail }) {
  if (counts.total === 0) {
    return <EmptyState icon={Truck} title={t.noOrders}>{t.noStopsYet}</EmptyState>;
  }
  return (
    <div className="dl-stack">
      <div className="dl-progressline">
        <ProgressBar label={t.progressLabel} value={counts.done} max={counts.total} valueText={`${counts.done} / ${counts.total}`} tone={counts.done === counts.total ? 'success' : undefined} />
      </div>

      {nextStop ? (
        <section className="lc-card dl-next" aria-labelledby="dl-next-title">
          <div className="dl-next__top">
            <span className="dl-stopno" aria-hidden="true">{nextNumber}</span>
            <div className="dl-next__id">
              <div className="dl-over" id="dl-next-title">{t.nextDelivery}</div>
              <h2 className="dl-shop">{nextStop.shopName}</h2>
              <div className="dl-muted">{nextStop.address || t.noAddressOrGps}</div>
            </div>
          </div>
          <div className="dl-chips">
            <StopStatus t={t} stop={nextStop} />
            <SyncChip t={t} sync={syncMap.get(String(nextStop.id))} />
            {!hasCoords(nextStop) ? <StatusPill tone="warning" icon={MapPin} label={t.gpsMissing} /> : null}
          </div>
          <div className="dl-row">
            <span className="dl-muted">{t.order} {nextStop.id} · {nextStop.itemsCount || orderItems(nextStop).length} {t.items}</span>
            <span className="dl-amount lc-num">{rupees(nextStop.total)}</span>
          </div>
          <ContactActions t={t} stop={nextStop} onSpeak={() => onSpeak(nextStop)} />
          <PrimaryActions
            t={t}
            stop={nextStop}
            busy={route.updatingId === String(nextStop.id)}
            onPickUp={() => onPickUp(nextStop)}
            onDeliver={() => onDeliver(nextStop)}
            onFail={() => onFail(nextStop)}
          />
          <Button variant="ghost" block iconAfter={ChevronRight} onClick={() => onOpen(nextStop)}>{t.details}</Button>
        </section>
      ) : (
        <EmptyState icon={CheckCircle2} title={t.allDone} />
      )}

      <section className="dl-metrics" aria-label={t.today}>
        <Metric label={t.assigned} value={counts.total} />
        <Metric label={t.pending} value={counts.pending} />
        <Metric label={t.delivered} value={counts.delivered} />
        <Metric label={t.failed} value={counts.failed} />
      </section>

      {failedSync.length > 0 ? (
        <section className="lc-card lc-card--pad" aria-label={t.syncFailed}>
          <h3 className="dl-section">{t.syncFailed}</h3>
          <ul className="dl-list">
            {failedSync.map(([id, s]) => {
              const stop = byId(id);
              return (
                <li key={id}>
                  <button type="button" className="dl-attn" onClick={() => stop && onOpen(stop)}>
                    <Icon icon={AlertTriangle} size={20} />
                    <span className="dl-attn__body">
                      <b>{stop?.shopName || `${t.order} ${id}`}</b>
                      <span className="dl-muted">{s.status} · {s.error || t.updateFailed}</span>
                    </span>
                    <Icon icon={ChevronRight} size={20} />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <section className="lc-card lc-card--pad dl-stack dl-stack--sm">
        <Button variant="secondary" block icon={RouteIcon} loading={route.optimizing} onClick={onStartRoute}>
          {route.routeInfo ? t.routeActive : t.startRoute}
        </Button>
        <RouteNote t={t} route={route} />
      </section>
    </div>
  );
}

function RouteNote({ t, route }) {
  const missing = route.activeStops.filter((s) => !hasCoords(s)).length;
  return (
    <>
      {route.routeInfo ? (
        <p className="dl-muted">
          <b>{t.disclaimerPrefix}</b> {route.routeInfo.disclaimer}
          {route.routeInfo.distanceMeters > 0
            ? ` · ${(route.routeInfo.distanceMeters / 1000).toFixed(1)} km (~${Math.round(route.routeInfo.durationSeconds / 60)} min)`
            : ''}
        </p>
      ) : null}
      {missing > 0 ? (
        <p className="dl-muted"><Icon icon={MapPin} size={16} /> {missing} {t.unmappedNotice}</p>
      ) : null}
    </>
  );
}

function StopRow({ t, stop, number, isNext, sync, onOpen }) {
  return (
    <button type="button" className={`dl-stop ${isNext ? 'is-next' : ''}`} onClick={onOpen} aria-label={`${t.stopNumber} ${number}: ${stop.shopName}, ${phaseLabel(t, stop)}`}>
      <span className="dl-stopno" aria-hidden="true">{number > 0 ? number : '•'}</span>
      <span className="dl-stop__body">
        <span className="dl-stop__name">{stop.shopName}</span>
        <span className="dl-muted dl-stop__addr">{stop.address || t.noAddressOrGps}</span>
        <span className="dl-chips">
          {isNext ? <StatusPill tone="info" icon={null} label={t.nextStopBadge} /> : null}
          <StopStatus t={t} stop={stop} />
          <SyncChip t={t} sync={sync} />
        </span>
      </span>
      <span className="dl-stop__side">
        <span className="dl-amount lc-num">{rupees(stop.total)}</span>
        <span className="dl-muted">{stop.paymentStatus || 'Not collected'}</span>
        <Icon icon={ChevronRight} size={20} />
      </span>
    </button>
  );
}

function StopDetail({ t, stop, number, sync, user, busy, onSpeak, onPickUp, onDeliver, onFail }) {
  const items = orderItems(stop);
  const [recent, setRecent] = useState({ state: 'loading', orders: [] });

  useEffect(() => {
    let active = true;
    setRecent({ state: 'loading', orders: [] });
    const shop = stop.customerId;
    if (!shop) {
      setRecent({ state: 'error', orders: [] });
      return undefined;
    }
    api
      .getShopOrderHistory(shop, 7, user?.id)
      .then((res) => {
        if (!active) return;
        if (res && res.status === 200 && Array.isArray(res.orders)) {
          setRecent({ state: 'ok', orders: res.orders.filter((o) => String(o.orderId) !== String(stop.id)) });
        } else setRecent({ state: 'error', orders: [] });
      })
      .catch(() => active && setRecent({ state: 'error', orders: [] }));
    return () => {
      active = false;
    };
  }, [stop.id, stop.customerId, user?.id]);

  return (
    <div className="dl-stack dl-detail">
      <div className="dl-chips">
        <span className="dl-over">{t.stopNumber} {number > 0 ? number : '—'} · {t.order} {stop.id}</span>
      </div>
      <div className="dl-chips">
        <StopStatus t={t} stop={stop} />
        <SyncChip t={t} sync={sync} />
      </div>
      {sync?.state === 'failed' ? (
        <div className="dl-notice dl-notice--danger" role="alert">
          <Icon icon={AlertTriangle} size={20} />
          <span>{t.syncFailed}: {sync.error || t.updateFailed}</span>
        </div>
      ) : null}

      <dl className="dl-kv">
        {stop.ownerName ? (<><dt>{t.owner}</dt><dd>{stop.ownerName}</dd></>) : null}
        {stop.contactPhone ? (<><dt>{t.phone}</dt><dd className="lc-num">{stop.contactPhone}</dd></>) : null}
        <dt>{t.address}</dt>
        <dd>{[stop.address, stop.pincode].filter(Boolean).join(' – ') || t.noAddressOrGps}{!hasCoords(stop) ? <span className="dl-muted dl-block">{t.gpsMissing}</span> : null}</dd>
      </dl>

      <ContactActions t={t} stop={stop} onSpeak={onSpeak} />
      <PrimaryActions t={t} stop={stop} busy={busy} onPickUp={onPickUp} onDeliver={onDeliver} onFail={onFail} />

      {stopPhase(stop) === 'failed' || stopPhase(stop) === 'cancelled' ? (
        <dl className="dl-kv">
          {stop.deliveryReason ? (<><dt>{t.closedReason}</dt><dd>{stop.deliveryReason}</dd></>) : null}
          {stop.deliveryNote ? (<><dt>{t.note.replace(/\s*\(.*\)$/, '')}</dt><dd>{stop.deliveryNote}</dd></>) : null}
        </dl>
      ) : null}

      <section aria-label={t.orderItems}>
        <h3 className="dl-section">{t.orderItems}</h3>
        {items.length ? (
          <table className="dl-items">
            <tbody>
              {items.map((it) => (
                <tr key={it.key}>
                  <td>{it.name}</td>
                  <td className="lc-num dl-items__qty">{it.qty} {it.unit}</td>
                  <td className="lc-num dl-items__amt">{rupees(it.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={2}>{t.total}</th>
                <td className="lc-num dl-items__amt">{rupees(stop.total)}</td>
              </tr>
            </tfoot>
          </table>
        ) : (
          <div className="dl-row"><span className="dl-muted">{stop.itemsCount || 0} {t.items}</span><span className="dl-amount lc-num">{rupees(stop.total)}</span></div>
        )}
      </section>

      <section aria-label={t.payment}>
        <h3 className="dl-section">{t.payment}</h3>
        <dl className="dl-kv">
          <dt>{t.payment}</dt><dd><StatusPill status={stop.paymentStatus || 'Not collected'} /></dd>
          <dt>{t.collected}</dt><dd className="lc-num">{rupees(stop.paymentAmountCollected)}</dd>
          <dt>{t.balance}</dt><dd className="lc-num">{rupees(stop.paymentBalanceDue ?? Math.max(0, Number(stop.total || 0) - Number(stop.paymentAmountCollected || 0)))}</dd>
          {stop.deliveryUpdatedAt ? (<><dt>{t.lastUpdate}</dt><dd className="lc-num">{new Date(stop.deliveryUpdatedAt).toLocaleString('en-IN')}</dd></>) : null}
        </dl>
      </section>

      <section aria-label={t.recentOrders}>
        <h3 className="dl-section">{t.recentOrders}</h3>
        {recent.state === 'loading' ? (
          <Skeleton height={48} />
        ) : recent.state === 'error' ? (
          <p className="dl-muted">{t.recentUnavailable}</p>
        ) : recent.orders.length === 0 ? (
          <p className="dl-muted">{t.noRecentOrders}</p>
        ) : (
          <ul className="dl-recent">
            {recent.orders.map((o) => (
              <li key={o.orderId}>
                <span>
                  <b className="lc-num">{o.date}</b>
                  <span className="dl-muted"> · {o.itemsCount} {t.items} · {rupees(o.total)}</span>
                </span>
                <span className="dl-chips"><StatusPill status={o.status} /><StatusPill status={o.paymentStatus} /></span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function DeliverDialog({ t, stop, busy, onCancel, onConfirm }) {
  const [mode, setMode] = useState('full');
  const [amount, setAmount] = useState('');
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (stop) {
      setMode('full');
      setAmount('');
      setTouched(false);
    }
  }, [stop?.id]);
  if (!stop) return <Dialog open={false} onClose={onCancel} title="" />;
  const total = Number(stop.total || 0);
  const check = mode === 'partial' ? validateCollected(amount, total) : { ok: true, value: mode === 'full' ? total : 0 };
  const preview = paymentOutcome(total, check.ok ? check.value : 0);
  return (
    <Dialog
      open={Boolean(stop)}
      onClose={onCancel}
      dismissible={!busy}
      title={t.markDelivered}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>{t.cancel}</Button>
          <Button
            variant="success"
            loading={busy}
            disabled={!check.ok}
            onClick={() => {
              setTouched(true);
              if (check.ok) onConfirm(stop, check.value);
            }}
          >
            {t.confirmDelivered}
          </Button>
        </>
      }
    >
      <div className="dl-stack">
        <div>
          <div className="dl-result__shop">{stop.shopName}</div>
          <div className="dl-row"><span className="dl-muted">{t.order} {stop.id}</span><span className="dl-amount lc-num">{rupees(total)}</span></div>
        </div>
        <div className="dl-stack dl-stack--sm">
          <span className="lc-field__label" id="dl-pay-q">{t.paymentQuestion}</span>
          <SegmentedControl
            label={t.paymentQuestion}
            value={mode}
            onChange={(m) => { setMode(m); if (m === 'partial' && amount === '') setAmount(''); }}
            options={[
              { value: 'full', label: `${t.paidFull} ${rupees(total)}` },
              { value: 'partial', label: t.paidPartial },
              { value: 'none', label: t.paidNone }
            ]}
          />
        </div>
        {mode === 'partial' ? (
          <Field label={t.amountCollected} error={touched || amount !== '' ? (check.ok ? null : t[check.error]) : null}>
            <TextInput type="number" inputMode="decimal" min="0" max={total} step="any" value={amount} onChange={(e) => setAmount(e.target.value)} onBlur={() => setTouched(true)} data-autofocus />
          </Field>
        ) : null}
        <dl className="dl-kv">
          <dt>{t.collected}</dt><dd className="lc-num">{rupees(preview.collected)}</dd>
          <dt>{t.balance}</dt><dd className="lc-num">{rupees(preview.balance)}</dd>
          <dt>{t.payment}</dt><dd><StatusPill status={preview.status} /></dd>
        </dl>
      </div>
    </Dialog>
  );
}

function FailDialog({ t, stop, busy, onCancel, onConfirm }) {
  const [reason, setReason] = useState(FAIL_REASONS[0].id);
  const [note, setNote] = useState('');
  useEffect(() => {
    if (stop) {
      setReason(FAIL_REASONS[0].id);
      setNote('');
    }
  }, [stop?.id]);
  if (!stop) return <Dialog open={false} onClose={onCancel} title="" />;
  return (
    <Dialog
      open={Boolean(stop)}
      onClose={onCancel}
      dismissible={!busy}
      title={t.reasonTitle}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>{t.cancel}</Button>
          <Button variant="danger" loading={busy} onClick={() => onConfirm(stop, reason, note.trim())}>{t.confirmNotDelivered}</Button>
        </>
      }
    >
      <div className="dl-stack">
        <div className="dl-result__shop">{stop.shopName}</div>
        <div role="radiogroup" aria-label={t.selectReason} className="dl-reasons">
          {FAIL_REASONS.map((r) => (
            <button
              key={r.id}
              type="button"
              role="radio"
              aria-checked={reason === r.id}
              className="dl-reason"
              onClick={() => setReason(r.id)}
            >
              <span className="dl-reason__dot" aria-hidden="true" />
              <span>{t.reasons[r.key]}</span>
            </button>
          ))}
        </div>
        <Field label={t.note}>
          <TextArea value={note} onChange={(e) => setNote(e.target.value)} placeholder={t.notePlaceholder} maxLength={300} />
        </Field>
      </div>
    </Dialog>
  );
}
