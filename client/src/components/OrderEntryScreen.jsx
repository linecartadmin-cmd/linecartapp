import React, { useState, useEffect } from 'react';
import { api } from '../api';
import { formatShopId, getGoogleMapsUrl } from '../utils';

const REMARKS_OPTIONS = [
  'Not Connected',
  'Order Placed',
  'High Price',
  'Invntory Available',
  'Shop Closed',
  'May be Tomorrow',
  'Not interested'
];

export default function OrderEntryScreen({
  user,
  clusters = [],
  shops = [],
  catalogItems = [],
  preselectedShop = '',
  onOrderPlaced,
  onNavigate,
  showToast
}) {
  const [selectedClusterId, setSelectedClusterId] = useState('all');
  const [selectedShopId, setSelectedShopId] = useState('');
  const [orderDate, setOrderDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [orderRows, setOrderRows] = useState([]);
  const [orderNotes, setOrderNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [historyOrders, setHistoryOrders] = useState([]);
  const [historyPeriod, setHistoryPeriod] = useState(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState(null);
  const [historyCollapsed, setHistoryCollapsed] = useState(false);

  const money = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');
  const initials = (name) =>
    (name || 'Shop')
      .split(/\s+/)
      .slice(0, 2)
      .map((x) => x[0])
      .join('')
      .toUpperCase();

  // Filter shops by selected cluster
  const clusterShops = selectedClusterId === 'all'
    ? shops
    : shops.filter((s) => Number(s.clusterid) === Number(selectedClusterId));

  // Initialize selected shop if preselectedShop passed or cluster changes
  useEffect(() => {
    if (preselectedShop) {
      const match = shops.find((s) => s.shopName === preselectedShop);
      if (match) {
        setSelectedClusterId(String(match.clusterid));
        setSelectedShopId(String(match.shopid));
        return;
      }
    }
    if (clusterShops.length > 0 && !selectedShopId) {
      setSelectedShopId(String(clusterShops[0].shopid));
    }
  }, [preselectedShop, selectedClusterId, shops]);

  // Load catalog items into order rows
  useEffect(() => {
    if (catalogItems.length > 0) {
      setOrderRows(
        catalogItems.map((item) => ({
          itemid: item.itemid,
          itemName: item.itemName,
          itemimage: item.itemimage || '/lincart_flashicon.png',
          unitType: item.unitType || 'Kgs',
          price: Number(item.price) || 50,
          qty: 0,
          custprice: Number(item.cprice) > 0 ? Number(item.cprice) : Number(item.price) || 50,
          remarks: 'Not Connected'
        }))
      );
    }
  }, [catalogItems]);

  const fetchOrderHistory = (shopId) => {
    if (!shopId) {
      setHistoryOrders([]);
      setHistoryPeriod(null);
      setHistoryError(null);
      setLoadingHistory(false);
      return;
    }

    setLoadingHistory(true);
    setHistoryError(null);

    api.getShopOrderHistory(shopId, 7)
      .then((res) => {
        if (res && res.status === 200) {
          setHistoryOrders(Array.isArray(res.orders) ? res.orders : []);
          setHistoryPeriod(res.period || null);
          setHistoryError(null);
        } else {
          setHistoryOrders([]);
          setHistoryPeriod(null);
          setHistoryError(res?.message || 'Failed to load order history');
        }
      })
      .catch((err) => {
        setHistoryOrders([]);
        setHistoryPeriod(null);
        setHistoryError(err?.message || 'Network error fetching order history');
      })
      .finally(() => {
        setLoadingHistory(false);
      });
  };

  useEffect(() => {
    fetchOrderHistory(selectedShopId);
  }, [selectedShopId]);

  const formatOrderDate = (dateStr) => {
    if (!dateStr) return '—';
    try {
      const d = new Date(dateStr + (dateStr.length === 10 ? 'T00:00:00' : ''));
      return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch {
      return dateStr;
    }
  };

  const formatPeriodDates = (period) => {
    if (!period || !period.cutoffDate || !period.today) return 'Previous 7 days (including today)';
    try {
      const d1 = new Date(period.cutoffDate + 'T00:00:00');
      const d2 = new Date(period.today + 'T00:00:00');
      const s1 = d1.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
      const s2 = d2.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
      return `${s1} – ${s2} (including today)`;
    } catch {
      return `${period.cutoffDate} to ${period.today}`;
    }
  };

  const currentShop = shops.find((s) => String(s.shopid) === String(selectedShopId));

  const handleQtyChange = (idx, val) => {
    const numeric = parseFloat(val) || 0;
    setOrderRows((prev) =>
      prev.map((r, i) => {
        if (i !== idx) return r;
        const autoRemarks = numeric > 0 ? 'Order Placed' : 'Not Connected';
        return {
          ...r,
          qty: numeric,
          remarks: autoRemarks
        };
      })
    );
  };

  const handleCustPriceChange = (idx, val) => {
    const numeric = parseFloat(val) || 0;
    setOrderRows((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, custprice: numeric } : r))
    );
  };

  const handleRemarksChange = (idx, val) => {
    setOrderRows((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, remarks: val } : r))
    );
  };

  const handleRemoveItem = (idx) => {
    setOrderRows((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleAddItem = () => {
    const existingIds = new Set(orderRows.map((r) => r.itemid));
    const nextItem = catalogItems.find((it) => !existingIds.has(it.itemid));
    if (nextItem) {
      setOrderRows((prev) => [
        ...prev,
        {
          itemid: nextItem.itemid,
          itemName: nextItem.itemName,
          itemimage: nextItem.itemimage || '/lincart_flashicon.png',
          unitType: nextItem.unitType || 'Kgs',
          price: Number(nextItem.price) || 50,
          qty: 1,
          custprice: Number(nextItem.price) || 50,
          remarks: 'Order Placed'
        }
      ]);
    } else {
      showToast('All catalog items are already in this order.');
    }
  };

  // Subtotal calculated from valid items
  const activeItems = orderRows.filter((r) => Number(r.qty) > 0);
  const subtotal = orderRows.reduce((sum, r) => sum + (Number(r.qty) || 0) * (Number(r.custprice) || Number(r.price) || 0), 0);

  const handleSubmitOrder = async (e) => {
    if (e) e.preventDefault();
    if (!currentShop) {
      showToast('Please select a valid customer.');
      return;
    }
    if (activeItems.length === 0) {
      showToast('Please enter quantity for at least one item.');
      return;
    }

    setSubmitting(true);
    const spersonid = Number(user?.id || localStorage.getItem('LineCartPref_userid') || 1);
    const finalClusterId = currentShop?.clusterid || (selectedClusterId !== 'all' ? Number(selectedClusterId) : 1);
    const orderList = orderRows.map((r) => ({
      customerid: currentShop.shopid,
      itemid: r.itemid,
      qty: r.qty,
      actprice: r.price,
      custprice: r.custprice,
      spersonid,
      clusterid: finalClusterId,
      remarks: REMARKS_OPTIONS.indexOf(r.remarks) >= 0 ? REMARKS_OPTIONS.indexOf(r.remarks) : 0,
      notes: orderNotes
    }));

    try {
      const res = await api.createOrder(orderList);
      if (res && (res.status === 200 || res.status === 1)) {
        showToast(`Order for ${currentShop.shopName} placed successfully!`);
        fetchOrderHistory(selectedShopId);
        if (onOrderPlaced) {
          const shortId = formatShopId(currentShop.shopid);
          const serial = res.id || Math.floor(Math.random() * 90000 + 10000);
          const orderId = res.orderId || `${shortId}-${serial}`;

          onOrderPlaced({
            id: orderId,
            customer: currentShop.shopName,
            shopId: shortId,
            shopid: currentShop.shopid,
            clusterId: finalClusterId,
            date: orderDate,
            items: activeItems.length,
            itemsCount: activeItems.length,
            total: subtotal,
            status: 'In progress',
            itemsList: activeItems
          });
        }
        onNavigate('reports');
      } else {
        showToast(res?.message || 'Failed to place order.');
      }
    } catch {
      showToast('Failed to connect to order service.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      {/* Page Heading */}
      <div className="page-heading">
        <div>
          <p className="eyebrow">ORDER MANAGEMENT</p>
          <h1>Create order</h1>
          <p>Add wholesale items for a customer and review the live delivery total.</p>
        </div>
        <button
          type="button"
          className="secondary-button icon-back-btn"
          onClick={() => onNavigate('overview')}
          title="Go back"
          aria-label="Go back"
        >
          <span aria-hidden="true">←</span>
          <span className="sr-only">Go back</span>
        </button>
      </div>

      <div className="form-grid">
        {/* Left Form Panel */}
        <section className="panel form-panel">
          <h2>Order details</h2>
          <p className="section-help">Choose a cluster route and customer store to start taking replenishment orders.</p>

          <div className="field-grid">
            {/* Cluster Route Select */}
            <div className="field-group">
              <label htmlFor="clusterSelect">Cluster Route *</label>
              <select
                id="clusterSelect"
                className="select"
                value={selectedClusterId}
                onChange={(e) => {
                  setSelectedClusterId(e.target.value);
                  setSelectedShopId('');
                }}
              >
                <option value="all">All clusters ({shops.length} stores)</option>
                {clusters.map((c) => {
                  const cnt = shops.filter((s) => Number(s.clusterid) === Number(c.clusterId)).length;
                  return (
                    <option key={c.clusterId} value={String(c.clusterId)}>
                      {c.clusterName} ({cnt} stores)
                    </option>
                  );
                })}
              </select>
            </div>

            {/* Customer Store Select */}
            <div className="field-group">
              <label htmlFor="shopSelect">Customer Store ({clusterShops.length}) *</label>
              <select
                id="shopSelect"
                className="select"
                value={selectedShopId}
                onChange={(e) => setSelectedShopId(e.target.value)}
              >
                <option value="">Select a store</option>
                {clusterShops.map((s) => (
                  <option key={s.shopid} value={s.shopid}>
                    [{formatShopId(s.shopid)}] {s.shopName} · {s.shopCategory || 'Retail'}
                  </option>
                ))}
              </select>
            </div>

            {/* Order Date */}
            <div className="field-group full">
              <label htmlFor="orderDate">Delivery Order Date *</label>
              <input
                id="orderDate"
                type="date"
                className="field"
                value={orderDate}
                onChange={(e) => setOrderDate(e.target.value)}
              />
            </div>
          </div>

          {/* Selected Customer Hero Card */}
          {currentShop && (() => {
            const mapsUrl = getGoogleMapsUrl(currentShop);

            return (
              <div className="customer-hero mt-4">
                <span className="customer-dot">{initials(currentShop.shopName)}</span>
                <div className="customer-hero-info">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <b>{currentShop.shopName}</b>
                    <span className="shop-code-pill">{formatShopId(currentShop.shopid)}</span>
                  </div>
                  <small>
                    {currentShop.ownerName || 'Store Owner'} · {currentShop.shopCategory || 'Retail'} · {currentShop.address || 'Local Route'}
                  </small>
                  {mapsUrl && (
                    <div className="customer-hero-map mt-2">
                      <a
                        href={mapsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="map-location-link"
                        title={`View ${currentShop.shopName} on Google Maps`}
                      >
                        <span className="map-pin-icon">📍</span>
                        <span>View location on Google Maps</span>
                        <span className="external-arrow">↗</span>
                      </a>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 ml-auto customer-hero-actions">
                  {currentShop.contact1 && (
                    <a
                      href={`tel:${currentShop.contact1}`}
                      className="status in-progress hover:opacity-90 no-underline"
                      title="Click to dial primary phone"
                    >
                      📞 {currentShop.contact1}
                    </a>
                  )}
                  {currentShop.contact2 && (
                    <a
                      href={`tel:${currentShop.contact2}`}
                      className="status pending hover:opacity-90 no-underline"
                      title="Click to dial secondary phone"
                    >
                      📞 {currentShop.contact2}
                    </a>
                  )}
                </div>
              </div>
            );
          })()}

          {/* 7-Day Order History Section */}
          {currentShop && (
            <div className="shop-history-container mt-3 mb-4" aria-labelledby="history-heading">
              <div className="shop-history-header">
                <div className="shop-history-header-title">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="history-icon" aria-hidden="true">📋</span>
                    <strong id="history-heading" className="text-sm">7-Day Order History</strong>
                    <span className="shop-code-pill">{formatShopId(currentShop.shopid)}</span>
                    {!loadingHistory && !historyError && (
                      <span className="history-count-badge">
                        {historyOrders.length} {historyOrders.length === 1 ? 'order' : 'orders'}
                      </span>
                    )}
                  </div>
                  <small className="text-xs text-muted block mt-1">
                    {formatPeriodDates(historyPeriod)}
                  </small>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="btn-history-toggle"
                    onClick={() => setHistoryCollapsed(!historyCollapsed)}
                    aria-expanded={!historyCollapsed}
                  >
                    {historyCollapsed ? 'Show past orders ▼' : 'Hide past orders ▲'}
                  </button>
                </div>
              </div>

              {!historyCollapsed && (
                <div className="shop-history-body mt-2">
                  {/* Loading State */}
                  {loadingHistory && (
                    <div className="history-status-state loading" role="status">
                      <div className="history-spinner" aria-hidden="true" />
                      <span>Loading recent orders from database...</span>
                    </div>
                  )}

                  {/* Error State */}
                  {!loadingHistory && historyError && (
                    <div className="history-status-state error" role="alert">
                      <div className="flex items-center gap-2">
                        <span aria-hidden="true">⚠️</span>
                        <span>{historyError}</span>
                      </div>
                      <button
                        type="button"
                        className="btn-history-retry"
                        onClick={() => fetchOrderHistory(selectedShopId)}
                      >
                        Retry
                      </button>
                    </div>
                  )}

                  {/* Empty State */}
                  {!loadingHistory && !historyError && historyOrders.length === 0 && (
                    <div className="history-status-state empty">
                      <span className="empty-state-icon" aria-hidden="true">📦</span>
                      <div>
                        <b>No orders placed in the past 7 days</b>
                        <p className="empty-subtext">
                          No previous orders found for {currentShop.shopName} in the period {formatPeriodDates(historyPeriod)}. Newly created orders will be displayed here immediately.
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Orders List */}
                  {!loadingHistory && !historyError && historyOrders.length > 0 && (
                    <div className="history-orders-list">
                      {historyOrders.map((order) => {
                        const statusLower = (order.status || 'in progress').toLowerCase();
                        const statusClass = statusLower === 'delivered' ? 'delivered' : statusLower === 'cancelled' ? 'cancelled' : 'in-progress';

                        return (
                          <div key={order.orderId || order.serialNo} className="history-order-card">
                            <div className="history-order-top">
                              <div className="history-order-meta">
                                <span className="history-order-badge">
                                  #{order.serialNo || order.orderId}
                                </span>
                                <span className="history-order-date">
                                  📅 {formatOrderDate(order.date)}
                                </span>
                                <span className={`status ${statusClass}`}>
                                  {order.status || 'In progress'}
                                </span>
                              </div>
                              <div className="history-order-total-block">
                                <span className="history-total-label">Order total:</span>
                                <strong className="history-total-value">{money(order.total)}</strong>
                              </div>
                            </div>

                            <div className="history-items-table-wrapper">
                              <table className="history-items-table">
                                <thead>
                                  <tr>
                                    <th style={{ width: '38%' }}>Item</th>
                                    <th style={{ width: '20%' }}>Quantity</th>
                                    <th style={{ width: '22%' }}>Historical Unit Price</th>
                                    <th style={{ width: '20%', textAlign: 'right' }}>Line Total</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {(order.items || []).map((it, idx) => (
                                    <tr key={it.id || idx}>
                                      <td>
                                        <b>{it.name}</b>
                                      </td>
                                      <td>
                                        <span className="qty-highlight">
                                          {it.qty} {it.unit || 'Kgs'}
                                        </span>
                                      </td>
                                      <td>
                                        <span className="unit-price-pill">
                                          {money(it.unitPrice)} <small className="unit-type">/{it.unit || 'unit'}</small>
                                        </span>
                                      </td>
                                      <td className="row-total" style={{ textAlign: 'right' }}>
                                        <b>{money(it.lineTotal)}</b>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Items Section */}
          <div className="items-head">
            <strong>Order items catalog</strong>
            <span>{orderRows.length} commodities available</span>
          </div>

          <div className="table-scroll-container">
            <table className="order-table" style={{ minWidth: '560px' }}>
              <thead>
                <tr>
                  <th style={{ width: '30%' }}>Item</th>
                  <th style={{ width: '12%' }}>Unit</th>
                  <th style={{ width: '14%' }}>Unit price</th>
                  <th style={{ width: '14%' }}>Units #</th>
                  <th style={{ width: '14%' }}>Cust price</th>
                  <th style={{ width: '16%', textAlign: 'right' }}>Total</th>
                  <th style={{ width: '4%' }}></th>
                </tr>
              </thead>
              <tbody>
                {orderRows.map((r, i) => {
                  const rowTotal = (Number(r.qty) || 0) * (Number(r.custprice) || Number(r.price) || 0);
                  return (
                    <tr key={r.itemid || i}>
                      <td>
                        <div className="flex items-center gap-2">
                          <img
                            src={r.itemimage}
                            alt=""
                            className="w-7 h-7 object-cover rounded"
                            onError={(e) => {
                              e.currentTarget.onerror = null;
                              e.currentTarget.src = '/lincart_flashicon.png';
                            }}
                          />
                          <span>{r.itemName}</span>
                        </div>
                      </td>
                      <td><span className="status pending">{r.unitType}</span></td>
                      <td>{money(r.price)}</td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={r.qty === 0 ? '' : r.qty}
                          onChange={(e) => handleQtyChange(i, e.target.value)}
                          placeholder="0"
                          aria-label={`${r.itemName} quantity`}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          step="0.5"
                          value={r.custprice}
                          onChange={(e) => handleCustPriceChange(i, e.target.value)}
                          aria-label={`${r.itemName} customer price`}
                        />
                      </td>
                      <td className="row-total">{money(rowTotal)}</td>
                      <td>
                        <button
                          type="button"
                          className="remove-row"
                          onClick={() => handleRemoveItem(i)}
                          title="Remove item"
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <button
            type="button"
            className="add-row"
            onClick={handleAddItem}
          >
            ＋ Add another commodity
          </button>

          <div className="field-group full mt-3">
            <label htmlFor="orderNotes">Order notes & delivery instructions</label>
            <input
              id="orderNotes"
              className="field"
              placeholder="e.g. Morning delivery before 8:00 AM, unloading at back entrance"
              value={orderNotes}
              onChange={(e) => setOrderNotes(e.target.value)}
            />
          </div>
        </section>

        {/* Right Summary Panel */}
        <aside className="panel form-panel order-summary">
          <h2>Order summary</h2>
          <p className="section-help">Review line items and customer pricing before submission.</p>

          <div className="summary-lines">
            <div className="summary-line">
              <span>Selected store</span>
              <b>{currentShop?.shopName || '—'}</b>
            </div>
            <div className="summary-line">
              <span>Cluster route</span>
              <b>{currentShop ? (clusters.find((c) => Number(c.clusterId) === Number(currentShop.clusterid))?.clusterName || (Number(currentShop.clusterid) === 2 ? 'Thuthukudi' : 'Pollachi and Udumalapet')) : (selectedClusterId === 'all' ? 'All clusters' : (clusters.find((c) => String(c.clusterId) === String(selectedClusterId))?.clusterName || 'Pollachi and Udumalapet'))}</b>
            </div>
            <div className="summary-line">
              <span>Active items ({activeItems.length})</span>
              <b>{money(subtotal)}</b>
            </div>
            <div className="summary-line">
              <span>Route freight</span>
              <b>Included</b>
            </div>
            <div className="summary-line">
              <span>Taxes</span>
              <b>—</b>
            </div>
            <div className="summary-total">
              <span>Total order value</span>
              <strong>{money(subtotal)}</strong>
            </div>
          </div>

          <button
            type="button"
            className="primary-button"
            disabled={submitting || activeItems.length === 0 || !currentShop}
            onClick={handleSubmitOrder}
          >
            {submitting ? 'Placing order...' : 'Place order →'}
          </button>

          <p className="summary-note">
            The customer’s replenishment order will be stored and synchronized with the live summary report and route dispatch.
          </p>
        </aside>
      </div>
    </div>
  );
}
