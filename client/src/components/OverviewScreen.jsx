import React, { useState, useMemo } from 'react';
import { formatShopId, getPaymentSummary } from '../utils';

export default function OverviewScreen({
  user,
  orders = [],
  shops = [],
  clusters = [],
  onNavigate,
  onOrderForCustomer,
  showToast
}) {
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedShopId, setSelectedShopId] = useState('all');

  const todayStr = new Date().toISOString().slice(0, 10);
  const displayToday = new Date().toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  }).toUpperCase();

  const initials = (name) =>
    (name || 'Shop')
      .split(/\s+/)
      .slice(0, 2)
      .map((x) => x[0])
      .join('')
      .toUpperCase();

  // 1. Scoped Shops: Only shops assigned to the logged-in agent
  const assignedShops = useMemo(() => {
    if (!shops || shops.length === 0) return [];
    if (!user?.id) return shops;
    const uid = Number(user.id);
    const hasAssignedProp = shops.some((s) => s.assignedAgentId !== undefined && s.assignedAgentId !== null);
    if (hasAssignedProp) {
      return shops.filter((s) => {
        const agId = Number(s.assignedAgentId ?? s.assigned_agent_id ?? s.createdby ?? s.created_by);
        return agId === uid;
      });
    }
    return shops;
  }, [shops, user?.id]);

  // 2. Filtered Shops based on selectedShopId
  const displayedShops = useMemo(() => {
    if (selectedShopId === 'all') return assignedShops;
    return assignedShops.filter((s) => Number(s.shopid) === Number(selectedShopId));
  }, [assignedShops, selectedShopId]);

  // 3. Filtered Orders based on assigned shops, selectedShopId, and selectedDate
  const displayedOrders = useMemo(() => {
    const assignedShopIds = new Set(assignedShops.map((s) => Number(s.shopid)));
    const assignedShopNames = new Set(assignedShops.map((s) => (s.shopName || '').toLowerCase().trim()));

    return (orders || []).filter((o) => {
      // Must belong to an assigned shop or created by this agent
      const matchesShopId = o.shopid && assignedShopIds.has(Number(o.shopid));
      const matchesCustomerId = o.customerId && assignedShopIds.has(Number(o.customerId));
      const matchesCustomerName = o.customer && assignedShopNames.has(o.customer.toLowerCase().trim());
      const matchesAgent = user?.id && Number(o.spersonid) === Number(user.id);

      if (!matchesShopId && !matchesCustomerId && !matchesCustomerName && !matchesAgent) {
        return false;
      }

      // Shop filter
      if (selectedShopId !== 'all') {
        const selId = Number(selectedShopId);
        const shopObj = assignedShops.find((s) => Number(s.shopid) === selId);
        const matchesThisShopId = Number(o.shopid) === selId || Number(o.customerId) === selId;
        const matchesThisShopName = shopObj && (o.customer || '').toLowerCase().trim() === (shopObj.shopName || '').toLowerCase().trim();
        if (!matchesThisShopId && !matchesThisShopName) return false;
      }

      // Date filter
      if (selectedDate) {
        const orderDateStr = (o.date || o.order_date || o.createdAt || '').slice(0, 10);
        if (orderDateStr !== selectedDate) return false;
      }

      return true;
    });
  }, [orders, assignedShops, selectedShopId, selectedDate, user?.id]);

  // 4. Summary Table data: Total shops, current orders, shop counts by category, order counts by category
  const summaryByCategory = useMemo(() => {
    const shopCategoryMap = new Map();
    for (const s of assignedShops) {
      const cat = (s.shopCategory || 'Retail').trim();
      shopCategoryMap.set(Number(s.shopid), cat);
      if (s.shopName) shopCategoryMap.set(s.shopName.toLowerCase().trim(), cat);
    }

    const categoryShopCounts = {};
    for (const s of displayedShops) {
      const cat = (s.shopCategory || 'Retail').trim();
      categoryShopCounts[cat] = (categoryShopCounts[cat] || 0) + 1;
    }

    const categoryOrderCounts = {};
    for (const o of displayedOrders) {
      let cat = o.shopCategory;
      if (!cat) {
        if (o.shopid && shopCategoryMap.has(Number(o.shopid))) cat = shopCategoryMap.get(Number(o.shopid));
        else if (o.customerId && shopCategoryMap.has(Number(o.customerId))) cat = shopCategoryMap.get(Number(o.customerId));
        else if (o.customer && shopCategoryMap.has(o.customer.toLowerCase().trim())) cat = shopCategoryMap.get(o.customer.toLowerCase().trim());
      }
      cat = (cat || 'Retail').trim();
      categoryOrderCounts[cat] = (categoryOrderCounts[cat] || 0) + 1;
    }

    const allCategories = Array.from(new Set([
      ...Object.keys(categoryShopCounts),
      ...Object.keys(categoryOrderCounts)
    ])).sort();

    return allCategories.map((cat) => ({
      category: cat,
      shopCount: categoryShopCounts[cat] || 0,
      orderCount: categoryOrderCounts[cat] || 0
    }));
  }, [displayedShops, displayedOrders, assignedShops]);

  // 5. Orders by shop, item, and quantity in kilograms
  const orderItemRows = useMemo(() => {
    const rows = [];
    for (const order of displayedOrders) {
      const items = order.orderList && order.orderList.length > 0
        ? order.orderList
        : (order.itemsList && order.itemsList.length > 0 ? order.itemsList : null);

      const matchedShop = assignedShops.find(
        (s) => Number(s.shopid) === Number(order.shopid || order.customerId) ||
               (s.shopName && s.shopName.toLowerCase().trim() === (order.customer || '').toLowerCase().trim())
      );
      const shopDisplayName = order.customer || matchedShop?.shopName || `Shop #${order.shopid || order.customerId || '—'}`;
      const shopCode = order.shopId || (matchedShop ? formatShopId(matchedShop.shopid) : '');
      const formattedDate = (order.date || order.order_date || order.createdAt || '—').slice(0, 10);
      const statusText = order.status || 'In progress';

      if (items && items.length > 0) {
        items.forEach((item, idx) => {
          const qtyKg = Number(item.qty || 0);
          rows.push({
            rowKey: `${order.id || order.orderId}-${item.itemId || item.itemid || idx}-${idx}`,
            orderId: order.id || order.orderId,
            shopName: shopDisplayName,
            shopCode,
            itemName: item.itemName || item.name || `Item #${item.itemId || item.itemid || idx + 1}`,
            quantityKg: qtyKg,
            unit: item.unitType || item.unit || 'Kg',
            orderDate: formattedDate,
            status: statusText,
            total: order.total,
            order
          });
        });
      } else {
        rows.push({
          rowKey: `${order.id || order.orderId}-main`,
          orderId: order.id || order.orderId,
          shopName: shopDisplayName,
          shopCode,
          itemName: `Produce Order (${order.itemsCount || 1} items)`,
          quantityKg: '—',
          unit: 'Kg',
          orderDate: formattedDate,
          status: statusText,
          total: order.total,
          order
        });
      }
    }
    return rows;
  }, [displayedOrders, assignedShops]);

  return (
    <div className="overview-container" style={{ width: '100%', maxWidth: '100%', boxSizing: 'border-box' }}>
      {/* Page Heading */}
      <div className="page-heading">
        <div>
          <p className="eyebrow">{displayToday}</p>
          <h1>Good morning, {user?.name || 'Field Sales Agent'}</h1>
          <p>Here’s what’s happening with your wholesale produce orders today.</p>
        </div>
      </div>

      {/* Date & Shop Selectors Panel */}
      <div
        className="card selectors-card"
        style={{
          padding: '16px',
          background: '#ffffff',
          borderRadius: '12px',
          border: '1px solid #edf0f2',
          marginBottom: '20px',
          boxShadow: '0 4px 16px rgba(28, 54, 67, 0.04)'
        }}
      >
        {/* 1. Date Selector (Placed ABOVE shop selector) */}
        <div style={{ marginBottom: '14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px', flexWrap: 'wrap', gap: '8px' }}>
            <label
              htmlFor="overviewDateFilter"
              style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '1px', color: '#64748b', display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              <span>📅</span>
              <span>DATE</span>
            </label>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button
                type="button"
                onClick={() => setSelectedDate(todayStr)}
                style={{
                  fontSize: '11px',
                  fontWeight: 600,
                  padding: '3px 10px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  background: selectedDate === todayStr ? '#0284c7' : '#f8fafc',
                  color: selectedDate === todayStr ? '#ffffff' : '#334155'
                }}
              >
                Today
              </button>
              <button
                type="button"
                onClick={() => setSelectedDate('')}
                style={{
                  fontSize: '11px',
                  fontWeight: 600,
                  padding: '3px 10px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  background: !selectedDate ? '#0284c7' : '#f8fafc',
                  color: !selectedDate ? '#ffffff' : '#334155'
                }}
              >
                All Dates
              </button>
            </div>
          </div>
          <input
            id="overviewDateFilter"
            type="date"
            className="field"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            style={{ width: '100%', height: '40px', fontSize: '13px', borderRadius: '8px', border: '1px solid #cbd5e1', padding: '0 12px' }}
          />
        </div>

        {/* 2. Shop Selector (Replaces "Cluster Route", lists only assigned shops) */}
        <div>
          <label
            htmlFor="overviewShopSelect"
            style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '1px', color: '#64748b', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}
          >
            <span>🏪</span>
            <span>SHOPS</span>
          </label>
          <select
            id="overviewShopSelect"
            className="select"
            value={selectedShopId}
            onChange={(e) => setSelectedShopId(e.target.value)}
            style={{ width: '100%', height: '42px', fontSize: '13px', borderRadius: '8px', border: '1px solid #cbd5e1', padding: '0 12px', background: '#fff' }}
          >
            <option value="all">All assigned shops ({assignedShops.length} stores)</option>
            {assignedShops.map((s) => (
              <option key={s.shopid} value={String(s.shopid)}>
                [{formatShopId(s.shopid)}] {s.shopName} ({s.shopCategory || 'Retail'})
              </option>
            ))}
          </select>
        </div>
      </div>

      {assignedShops.length === 0 && (
        <div style={{ padding: '2rem', textAlign: 'center', background: '#ffffff', borderRadius: '12px', border: '1px solid #e2e8f0', marginBottom: '20px' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '8px' }}>🏪</div>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#1e293b', margin: '0 0 6px 0' }}>No Assigned Shops</h2>
          <p style={{ fontSize: '12px', color: '#64748b', maxWidth: '380px', margin: '0 auto', lineHeight: 1.5 }}>
            You have no assigned shops yet. Please contact your Sales Manager or Admin to have stores assigned to your route.
          </p>
        </div>
      )}

      {/* Table 1: Category Summary Table */}
      <section className="table-panel" style={{ marginBottom: '24px' }}>
        <div
          className="table-heading"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '16px 20px',
            borderBottom: '1px solid #edf0f2',
            flexWrap: 'wrap',
            gap: '8px'
          }}
        >
          <div>
            <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>Summary by Category</h2>
            <p style={{ margin: '3px 0 0', fontSize: '12px', color: '#64748b' }}>
              {displayedShops.length} {displayedShops.length === 1 ? 'shop' : 'shops'} · {displayedOrders.length} {displayedOrders.length === 1 ? 'order' : 'orders'} {selectedDate ? `for ${selectedDate}` : '(all time)'}
            </p>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <span style={{ fontSize: '12px', background: '#e0f2fe', color: '#0369a1', padding: '4px 10px', borderRadius: '6px', fontWeight: 700 }}>
              Total Shops: {displayedShops.length}
            </span>
            <span style={{ fontSize: '12px', background: '#dcfce7', color: '#15803d', padding: '4px 10px', borderRadius: '6px', fontWeight: 700 }}>
              Current Orders: {displayedOrders.length}
            </span>
          </div>
        </div>

        <div className="table-scroll-container">
          <table className="data-table" style={{ width: '100%', minWidth: '400px' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '10px 16px' }}>Category</th>
                <th style={{ textAlign: 'center', padding: '10px 16px' }}>Total Shops</th>
                <th style={{ textAlign: 'center', padding: '10px 16px' }}>Current Orders</th>
              </tr>
            </thead>
            <tbody>
              {summaryByCategory.length > 0 ? (
                summaryByCategory.map((row) => (
                  <tr key={row.category}>
                    <td style={{ padding: '12px 16px', fontWeight: 600 }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#0284c7' }} />
                        {row.category}
                      </span>
                    </td>
                    <td style={{ textAlign: 'center', padding: '12px 16px', fontWeight: 700, color: '#0f172a' }}>
                      {row.shopCount}
                    </td>
                    <td style={{ textAlign: 'center', padding: '12px 16px', fontWeight: 700, color: row.orderCount > 0 ? '#15803d' : '#64748b' }}>
                      {row.orderCount}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="3" style={{ textAlign: 'center', padding: '24px', color: '#64748b' }}>
                    No category data available for the selected filters.
                  </td>
                </tr>
              )}
            </tbody>
            {summaryByCategory.length > 0 && (
              <tfoot>
                <tr style={{ background: '#f8fafc', fontWeight: 800, borderTop: '2px solid #e2e8f0' }}>
                  <td style={{ padding: '12px 16px' }}>Total (All Categories)</td>
                  <td style={{ textAlign: 'center', padding: '12px 16px', color: '#0f172a' }}>
                    {displayedShops.length} {displayedShops.length === 1 ? 'shop' : 'shops'}
                  </td>
                  <td style={{ textAlign: 'center', padding: '12px 16px', color: '#15803d' }}>
                    {displayedOrders.length} {displayedOrders.length === 1 ? 'order' : 'orders'}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </section>

      {/* Table 2: Orders by Shop, Item, and Quantity in Kilograms */}
      <section className="table-panel">
        <div
          className="table-heading"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '16px 20px',
            borderBottom: '1px solid #edf0f2',
            flexWrap: 'wrap',
            gap: '8px'
          }}
        >
          <div>
            <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>Orders by Shop & Item (Kg)</h2>
            <p style={{ margin: '3px 0 0', fontSize: '12px', color: '#64748b' }}>
              Listing all items and quantities in kilograms for assigned shops
            </p>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <span style={{ fontSize: '12px', background: '#f1f5f9', color: '#475569', padding: '4px 10px', borderRadius: '6px', fontWeight: 600 }}>
              {orderItemRows.length} {orderItemRows.length === 1 ? 'item entry' : 'item entries'}
            </span>
          </div>
        </div>

        <div className="table-scroll-container">
          <table className="data-table" style={{ width: '100%', minWidth: '600px' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '10px 14px' }}>Order ID</th>
                <th style={{ textAlign: 'left', padding: '10px 14px' }}>Shop</th>
                <th style={{ textAlign: 'left', padding: '10px 14px' }}>Item</th>
                <th style={{ textAlign: 'center', padding: '10px 14px' }}>Quantity (Kg)</th>
                <th style={{ textAlign: 'center', padding: '10px 14px' }}>Order Date</th>
                <th style={{ textAlign: 'center', padding: '10px 14px' }}>Status</th>
                <th style={{ textAlign: 'center', padding: '10px 14px' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {orderItemRows.length > 0 ? (
                orderItemRows.map((row) => (
                  <tr key={row.rowKey}>
                    <td style={{ padding: '12px 14px' }}>
                      <strong className="order-id-tag">{row.orderId}</strong>
                    </td>
                    <td style={{ padding: '12px 14px' }}>
                      <div className="customer-cell" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span className="customer-dot">{initials(row.shopName)}</span>
                        <div>
                          <strong>{row.shopName}</strong>
                          {row.shopCode && (
                            <small className="order-shop-badge" style={{ display: 'block', color: '#64748b', fontSize: '10px' }}>
                              {row.shopCode}
                            </small>
                          )}
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: '12px 14px', fontWeight: 600, color: '#1e293b' }}>
                      {row.itemName}
                    </td>
                    <td style={{ textAlign: 'center', padding: '12px 14px', fontWeight: 700, color: '#0369a1' }}>
                      {typeof row.quantityKg === 'number' ? `${row.quantityKg} kg` : row.quantityKg}
                    </td>
                    <td style={{ textAlign: 'center', padding: '12px 14px', color: '#475569', fontSize: '12px' }}>
                      {row.orderDate}
                    </td>
                    <td style={{ textAlign: 'center', padding: '12px 14px' }}>
                      {(() => {
                        const pay = getPaymentSummary(row.order || { status: row.status, total: row.total });
                        return (
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap', justifyContent: 'center' }}>
                              <span className={`status ${(row.status || 'pending').toLowerCase().replace(/\s/g, '-')}`}>
                                {row.status}
                              </span>
                              <span style={{
                                fontSize: '10px',
                                fontWeight: 700,
                                padding: '1px 6px',
                                borderRadius: '999px',
                                background: pay.paymentStatus === 'Collected' ? '#dcfce7' : (pay.paymentStatus === 'Partially collected' ? '#fef3c7' : '#f1f5f9'),
                                color: pay.paymentStatus === 'Collected' ? '#15803d' : (pay.paymentStatus === 'Partially collected' ? '#b45309' : '#475569')
                              }}>
                                {pay.paymentStatus}
                              </span>
                            </div>
                            <span style={{ fontSize: '10px', color: '#64748b', fontWeight: 600 }}>
                              {pay.summaryText}
                            </span>
                          </div>
                        );
                      })()}
                    </td>
                    <td style={{ textAlign: 'center', padding: '12px 14px' }}>
                      <button
                        type="button"
                        className="quiet-button"
                        onClick={() => showToast && showToast(`${row.orderId} · ${row.shopName} · ${row.itemName} (${row.quantityKg} kg)`)}
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="7" style={{ textAlign: 'center', padding: '28px', color: '#64748b' }}>
                    <div style={{ fontSize: '1.5rem', marginBottom: '6px' }}>📦</div>
                    <div style={{ fontWeight: 600 }}>No orders match the selected date or shop.</div>
                    <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '4px' }}>
                      Try selecting "All Dates" or "All assigned shops" above.
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
