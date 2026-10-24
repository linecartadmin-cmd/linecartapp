import React, { useState, useEffect } from 'react';
import { Truck, Package, MapPin, Phone, CheckCircle, Clock, ArrowRight, RefreshCw, AlertCircle } from 'lucide-react';
import { api } from '../api';

export default function DeliveryDashboard({ user }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState(null);
  const [statusFilter, setStatusFilter] = useState('ALL');

  const loadDeliveryOrders = async () => {
    setLoading(true);
    try {
      const res = await api.getOrders();
      if (res.status === 1) {
        setOrders(res.orders || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDeliveryOrders();
  }, []);

  const handleUpdateStatus = async (orderId, newStatus) => {
    setUpdatingId(orderId);
    try {
      const res = await api.updateOrderStatus(orderId, newStatus);
      if (res.status === 1) {
        loadDeliveryOrders();
      }
    } catch (err) {
      alert('Failed to update status');
    } finally {
      setUpdatingId(null);
    }
  };

  const pending = orders.filter((o) => o.deliveryStatus === 'PENDING');
  const inTransit = orders.filter((o) => o.deliveryStatus === 'IN_TRANSIT');
  const delivered = orders.filter((o) => o.deliveryStatus === 'DELIVERED');

  const displayedOrders = orders.filter((o) =>
    statusFilter === 'ALL' ? true : o.deliveryStatus === statusFilter
  );

  return (
    <div className="space-y-6">
      {/* Fleet Header */}
      <div className="bg-gradient-to-r from-amber-600 via-orange-600 to-amber-700 text-white p-6 rounded-3xl shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Truck className="w-5 h-5 text-amber-200" />
            <span className="text-xs font-bold uppercase tracking-wider text-amber-100">
              Fleet & Warehouse Dispatch Portal
            </span>
          </div>
          <h2 className="text-2xl font-black">Logistics Fulfillment Hub</h2>
          <p className="text-xs text-amber-100 mt-0.5">
            Dispatcher: {user.name} • Central Distribution Hub
          </p>
        </div>

        <button
          onClick={loadDeliveryOrders}
          className="self-start md:self-auto flex items-center gap-2 bg-white/20 hover:bg-white/30 text-white p-2.5 px-4 rounded-xl text-xs font-bold transition"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          <span>Sync Fleet Orders</span>
        </button>
      </div>

      {/* KPI Status Badges */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <button
          onClick={() => setStatusFilter(statusFilter === 'PENDING' ? 'ALL' : 'PENDING')}
          className={`p-5 rounded-2xl border text-left transition ${
            statusFilter === 'PENDING' ? 'bg-amber-50 border-amber-500 shadow-md ring-2 ring-amber-500/20' : 'bg-white border-slate-200'
          }`}
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-bold uppercase text-amber-700">1. Awaiting Dispatch</span>
            <Clock className="w-4 h-4 text-amber-600" />
          </div>
          <div className="text-2xl font-black text-slate-900">{pending.length}</div>
          <span className="text-[11px] text-slate-500">Packed & ready for vehicle loading</span>
        </button>

        <button
          onClick={() => setStatusFilter(statusFilter === 'IN_TRANSIT' ? 'ALL' : 'IN_TRANSIT')}
          className={`p-5 rounded-2xl border text-left transition ${
            statusFilter === 'IN_TRANSIT' ? 'bg-blue-50 border-blue-500 shadow-md ring-2 ring-blue-500/20' : 'bg-white border-slate-200'
          }`}
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-bold uppercase text-blue-700">2. Out on Delivery Van</span>
            <Truck className="w-4 h-4 text-blue-600" />
          </div>
          <div className="text-2xl font-black text-slate-900">{inTransit.length}</div>
          <span className="text-[11px] text-slate-500">In transit on route to retail stores</span>
        </button>

        <button
          onClick={() => setStatusFilter(statusFilter === 'DELIVERED' ? 'ALL' : 'DELIVERED')}
          className={`p-5 rounded-2xl border text-left transition ${
            statusFilter === 'DELIVERED' ? 'bg-emerald-50 border-emerald-500 shadow-md ring-2 ring-emerald-500/20' : 'bg-white border-slate-200'
          }`}
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-bold uppercase text-emerald-700">3. Successfully Delivered</span>
            <CheckCircle className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-2xl font-black text-slate-900">{delivered.length}</div>
          <span className="text-[11px] text-slate-500">Fulfilled & signed by merchant</span>
        </button>
      </div>

      {/* Orders List for Dispatch Action */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-slate-800">
            Dispatch Queue ({displayedOrders.length} {statusFilter !== 'ALL' ? statusFilter : 'Total'} Orders)
          </h3>
          {statusFilter !== 'ALL' && (
            <button
              onClick={() => setStatusFilter('ALL')}
              className="text-xs font-bold text-slate-500 hover:text-slate-900 underline"
            >
              Clear Filter
            </button>
          )}
        </div>

        {displayedOrders.length === 0 ? (
          <div className="bg-white p-12 text-center rounded-2xl border border-slate-200 text-slate-400 text-xs">
            No orders found in this category
          </div>
        ) : (
          displayedOrders.map((ord) => {
            const isUpdating = updatingId === ord.orderId;
            return (
              <div key={ord.orderId} className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 pb-3 border-b border-slate-100">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-base font-bold text-slate-900">{ord.orderId}</span>
                      <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full ${
                        ord.deliveryStatus === 'DELIVERED'
                          ? 'bg-emerald-100 text-emerald-800'
                          : ord.deliveryStatus === 'IN_TRANSIT'
                          ? 'bg-blue-100 text-blue-800'
                          : 'bg-amber-100 text-amber-800'
                      }`}>
                        {ord.deliveryStatus}
                      </span>
                    </div>

                    <h4 className="text-base font-bold text-slate-800 mt-1">{ord.shopName}</h4>
                    <div className="text-xs text-slate-500 flex items-center gap-1.5 mt-0.5">
                      <MapPin className="w-3.5 h-3.5 text-slate-400" />
                      <span>Route: {ord.clusterName || 'Downtown Zone'}</span>
                    </div>
                  </div>

                  <div className="flex items-center sm:items-end flex-col gap-1">
                    <span className="text-base font-black text-slate-900">${ord.totalAmount.toFixed(2)}</span>
                    <span className="text-xs font-semibold px-2 py-0.5 bg-slate-100 text-slate-700 rounded">
                      Weight: {ord.totalWeightKg || 50} KG to load
                    </span>
                  </div>
                </div>

                {/* Items to Load */}
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 text-xs">
                  <span className="font-bold text-slate-700 block mb-1">Manifest Items to Deliver:</span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {ord.items?.map((it, idx) => (
                      <div key={idx} className="flex justify-between text-slate-600 bg-white p-2 rounded-lg border border-slate-200/60">
                        <span>• {it.qty} {it.unitType}s {it.itemName}</span>
                        <span className="font-mono font-bold">${it.subtotal?.toFixed(2) || (it.qty * it.custprice).toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Action Buttons to update state */}
                <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                  <span className="text-[11px] text-slate-400 font-mono">
                    Order Timestamp: {ord.createdAt}
                  </span>

                  <div className="flex items-center gap-2">
                    {ord.deliveryStatus === 'PENDING' && (
                      <button
                        onClick={() => handleUpdateStatus(ord.orderId, 'IN_TRANSIT')}
                        disabled={isUpdating}
                        className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-2 rounded-xl text-xs shadow-md transition flex items-center gap-1.5"
                      >
                        <Truck className="w-4 h-4" />
                        <span>{isUpdating ? 'Updating...' : 'Dispatch Van (Mark In-Transit)'}</span>
                      </button>
                    )}

                    {ord.deliveryStatus === 'IN_TRANSIT' && (
                      <button
                        onClick={() => handleUpdateStatus(ord.orderId, 'DELIVERED')}
                        disabled={isUpdating}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-4 py-2 rounded-xl text-xs shadow-md transition flex items-center gap-1.5"
                      >
                        <CheckCircle className="w-4 h-4" />
                        <span>{isUpdating ? 'Updating...' : 'Confirm Delivered to Store'}</span>
                      </button>
                    )}

                    {ord.deliveryStatus === 'DELIVERED' && (
                      <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 px-3 py-1.5 rounded-xl border border-emerald-200">
                        <CheckCircle className="w-4 h-4 text-emerald-600" />
                        <span>Delivery Fulfilled</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
