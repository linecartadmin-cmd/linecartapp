import React, { useState, useEffect } from 'react';
import { Store, ShoppingCart, Package, Truck, CheckCircle, Clock, Plus, Minus, ArrowRight, RefreshCw, AlertCircle } from 'lucide-react';
import { api } from '../api';

export default function BuyerDashboard({ user }) {
  const [catalog, setCatalog] = useState([]);
  const [orders, setOrders] = useState([]);
  const [activeTab, setActiveTab] = useState('order'); // 'order' | 'history'
  const [loading, setLoading] = useState(true);
  const [cart, setCart] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState('');

  const loadData = async () => {
    setLoading(true);
    try {
      const [catRes, ordRes] = await Promise.all([
        api.getCatalog(),
        api.getOrders(user.shopid || 501)
      ]);

      if (catRes.status === 1) setCatalog(catRes.catalog || []);
      if (ordRes.status === 1) setOrders(ordRes.orders || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [user.shopid]);

  const updateCartQty = (itemid, delta) => {
    setCart((prev) => {
      const current = prev[itemid] || 0;
      const next = Math.max(0, current + delta);
      if (next === 0) {
        const copy = { ...prev };
        delete copy[itemid];
        return copy;
      }
      return { ...prev, [itemid]: next };
    });
  };

  const cartItemIds = Object.keys(cart);
  const cartTotal = cartItemIds.reduce((sum, id) => {
    const item = catalog.find((c) => c.itemid === parseInt(id, 10));
    return sum + (cart[id] * (item?.cprice || item?.price || 0));
  }, 0);

  const handlePlaceOrder = async () => {
    if (cartItemIds.length === 0) return;
    setSubmitting(true);
    setMsg('');

    const orderList = cartItemIds.map((id) => {
      const item = catalog.find((c) => c.itemid === parseInt(id, 10));
      return {
        customerid: user.shopid || 501,
        itemid: parseInt(id, 10),
        qty: cart[id],
        actprice: item.price,
        custprice: item.cprice,
        spersonid: 1, // direct order
        clusterid: user.clusterid || 101,
        remarks: 1
      };
    });

    try {
      const res = await api.createOrder(orderList, { shopid: user.shopid || 501 });
      if (res.status === 1) {
        setMsg('Wholesale order placed successfully! A delivery van will be dispatched.');
        setCart({});
        loadData();
        setTimeout(() => setMsg(''), 4000);
      }
    } catch (err) {
      alert('Failed to place order');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Merchant Store Banner */}
      <div className="bg-gradient-to-r from-blue-900 to-indigo-900 text-white p-6 rounded-3xl shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Store className="w-5 h-5 text-blue-300" />
            <span className="text-xs font-bold uppercase tracking-wider text-blue-200">
              Verified Retail Partner Portal
            </span>
          </div>
          <h2 className="text-2xl font-black">{user.shopName || 'City Supermarket & Provisions'}</h2>
          <p className="text-xs text-blue-200 mt-0.5">
            Owner: {user.name} • Shop ID #{user.shopid || 501} • Route: {user.zoneName || 'Downtown Zone'}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setActiveTab('order')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition ${
              activeTab === 'order' ? 'bg-white text-blue-900 shadow-md' : 'bg-blue-800/60 text-white hover:bg-blue-800'
            }`}
          >
            Direct Wholesale Catalog
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 ${
              activeTab === 'history' ? 'bg-white text-blue-900 shadow-md' : 'bg-blue-800/60 text-white hover:bg-blue-800'
            }`}
          >
            <Truck className="w-3.5 h-3.5" />
            <span>Track Deliveries ({orders.length})</span>
          </button>
        </div>
      </div>

      {msg && (
        <div className="p-4 bg-emerald-50 border-l-4 border-emerald-500 text-emerald-800 rounded-xl text-sm flex items-center gap-3">
          <CheckCircle className="w-5 h-5 text-emerald-600 flex-shrink-0" />
          <span>{msg}</span>
        </div>
      )}

      {/* View 1: Wholesale Ordering Catalog */}
      {activeTab === 'order' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-bold text-slate-800">Direct Wholesale Commodities</h3>
              <p className="text-xs text-slate-500">Order directly at bulk wholesale distributor prices</p>
            </div>

            {cartItemIds.length > 0 && (
              <button
                onClick={handlePlaceOrder}
                disabled={submitting}
                className="bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-bold py-2.5 px-5 rounded-xl text-sm shadow-md transition flex items-center gap-2"
              >
                <ShoppingCart className="w-4 h-4" />
                <span>{submitting ? 'Placing...' : `Checkout $${cartTotal.toFixed(2)} (${cartItemIds.length} items)`}</span>
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {catalog.map((item) => {
              const inCart = (cart[item.itemid] || 0) > 0;
              const qty = cart[item.itemid] || 0;
              return (
                <div
                  key={item.itemid}
                  className={`bg-white rounded-2xl p-5 border transition flex flex-col justify-between ${
                    inCart ? 'border-blue-500 ring-2 ring-blue-500/20 shadow-md' : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div>
                    <div className="h-36 w-full rounded-xl overflow-hidden bg-slate-100 mb-3 relative">
                      <img src={item.itemimage} alt={item.itemName} className="w-full h-full object-cover" />
                      <span className="absolute bottom-2 right-2 bg-slate-900/80 text-white text-[11px] px-2 py-0.5 rounded font-mono">
                        {item.kgsperunit} kg / {item.unitType}
                      </span>
                    </div>

                    <h4 className="font-bold text-slate-800 text-sm leading-tight">{item.itemName}</h4>
                    <div className="flex items-baseline gap-2 mt-2">
                      <span className="text-lg font-black text-blue-900">${item.cprice.toFixed(2)}</span>
                      <span className="text-xs text-slate-400 line-through">${item.price.toFixed(2)}</span>
                      <span className="text-xs text-emerald-700 font-semibold bg-emerald-50 px-2 py-0.5 rounded">
                        Wholesale Rate
                      </span>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => updateCartQty(item.itemid, -1)}
                        disabled={qty === 0}
                        className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center justify-center font-bold disabled:opacity-40"
                      >
                        <Minus className="w-3.5 h-3.5" />
                      </button>
                      <span className="w-6 text-center font-bold text-xs">{qty}</span>
                      <button
                        onClick={() => updateCartQty(item.itemid, 1)}
                        className="w-8 h-8 rounded-lg bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center font-bold"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {inCart && (
                      <span className="text-xs font-bold text-blue-900">
                        ${(qty * item.cprice).toFixed(2)}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* View 2: Track Orders & Deliveries */}
      {activeTab === 'history' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between pb-2">
            <div>
              <h3 className="text-lg font-bold text-slate-800">Your Store's Delivery Pipeline</h3>
              <p className="text-xs text-slate-500">Live fulfillment status of pending and past shipments</p>
            </div>
            <button
              onClick={loadData}
              className="p-2 text-slate-600 hover:text-blue-600 bg-white rounded-xl border border-slate-200 transition"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-4">
            {orders.length === 0 ? (
              <div className="bg-white p-12 rounded-2xl text-center border border-slate-200 text-slate-400 text-xs">
                No active orders for this store yet
              </div>
            ) : (
              orders.map((ord) => (
                <div key={ord.orderId} className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-bold text-slate-900">{ord.orderId}</span>
                        <span className="text-xs text-slate-400">• Booked on {ord.createdAt}</span>
                      </div>
                      <span className="text-xs text-slate-500">Booked by representative: {ord.salesPersonName || 'Direct'}</span>
                    </div>

                    <div className="text-left sm:text-right">
                      <span className="text-base font-black text-slate-900 block">${ord.totalAmount.toFixed(2)}</span>
                      <span className="text-[11px] text-slate-500">{ord.totalWeightKg || 50} kg total shipment</span>
                    </div>
                  </div>

                  {/* Status Progress Bar */}
                  <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                    <div className="flex items-center justify-between text-xs font-bold mb-2">
                      <span className={ord.deliveryStatus === 'PENDING' ? 'text-amber-600' : 'text-slate-400'}>
                        1. Packing at Warehouse
                      </span>
                      <span className={ord.deliveryStatus === 'IN_TRANSIT' ? 'text-blue-600 font-extrabold' : 'text-slate-400'}>
                        2. In Transit / Van Dispatch
                      </span>
                      <span className={ord.deliveryStatus === 'DELIVERED' ? 'text-emerald-600 font-extrabold' : 'text-slate-400'}>
                        3. Delivered to Store
                      </span>
                    </div>

                    <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden flex">
                      <div className={`h-full ${ord.deliveryStatus ? 'bg-emerald-500' : 'bg-slate-300'}`} style={{ width: '33.3%' }}></div>
                      <div className={`h-full ${ord.deliveryStatus === 'IN_TRANSIT' || ord.deliveryStatus === 'DELIVERED' ? 'bg-emerald-500' : 'bg-slate-300'}`} style={{ width: '33.3%' }}></div>
                      <div className={`h-full ${ord.deliveryStatus === 'DELIVERED' ? 'bg-emerald-500' : 'bg-slate-300'}`} style={{ width: '33.4%' }}></div>
                    </div>
                  </div>

                  {/* Line Items List */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    {ord.items?.map((it, idx) => (
                      <div key={idx} className="p-2.5 bg-slate-50 rounded-lg flex items-center justify-between">
                        <span className="font-semibold text-slate-800">{it.qty} {it.unitType}s {it.itemName}</span>
                        <span className="font-mono text-slate-600">${it.subtotal?.toFixed(2) || (it.qty * it.custprice).toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
