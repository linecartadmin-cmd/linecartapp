import React, { useState, useEffect } from 'react';
import { DollarSign, ShoppingBag, Store, MapPin, Package, RefreshCw, CheckCircle2, Clock, Truck, ShieldAlert, ArrowUpRight } from 'lucide-react';
import { api } from '../api';

export default function AdminDashboard({ user }) {
  const [data, setData] = useState(null);
  const [orders, setOrders] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('ALL');
  const [editingItem, setEditingItem] = useState(null);
  const [editPrice, setEditPrice] = useState('');
  const [editCPrice, setEditCPrice] = useState('');

  const loadAdminData = async () => {
    setLoading(true);
    try {
      const [overviewRes, ordersRes, catalogRes] = await Promise.all([
        api.getAdminOverview(),
        api.getOrders(),
        api.getCatalog()
      ]);

      if (overviewRes.status === 1) setData(overviewRes);
      if (ordersRes.status === 1) setOrders(ordersRes.orders || []);
      if (catalogRes.status === 1) setCatalog(catalogRes.catalog || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAdminData();
  }, []);

  const handleSavePrice = async (itemid) => {
    try {
      await api.updateProduct(itemid, editPrice, editCPrice);
      setEditingItem(null);
      loadAdminData();
    } catch (err) {
      alert('Failed to update product');
    }
  };

  const filteredOrders = orders.filter((o) =>
    filterStatus === 'ALL' ? true : o.deliveryStatus === filterStatus
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-bold uppercase tracking-wider px-2.5 py-0.5 bg-purple-100 text-purple-800 rounded-md">
              Operations Headquarters
            </span>
          </div>
          <h2 className="text-2xl font-black text-slate-800 tracking-tight">Executive Territory Overview</h2>
          <p className="text-xs text-slate-500">Live operational command center for all market zones and wholesale distribution</p>
        </div>

        <button
          onClick={loadAdminData}
          className="self-start md:self-auto flex items-center gap-2 p-2.5 px-4 text-slate-700 bg-slate-50 hover:bg-slate-100 rounded-xl border border-slate-200 text-xs font-bold transition"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-purple-600' : ''}`} />
          <span>Refresh Data</span>
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-bold uppercase">Gross Revenue</span>
            <DollarSign className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-2xl font-black text-slate-900">
            ${(data?.metrics?.totalRevenue || 0).toLocaleString()}
          </div>
          <span className="text-[10px] font-semibold text-emerald-600 flex items-center gap-1 mt-1">
            <ArrowUpRight className="w-3 h-3" /> Live order volume
          </span>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-bold uppercase">Total Orders</span>
            <ShoppingBag className="w-4 h-4 text-blue-600" />
          </div>
          <div className="text-2xl font-black text-slate-900">{orders.length}</div>
          <span className="text-[10px] font-semibold text-slate-500 mt-1 block">Across all active zones</span>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-bold uppercase">Retail Stores</span>
            <Store className="w-4 h-4 text-purple-600" />
          </div>
          <div className="text-2xl font-black text-slate-900">{data?.metrics?.totalShops || 0}</div>
          <span className="text-[10px] font-semibold text-purple-600 mt-1 block">Onboarded merchants</span>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-bold uppercase">Market Zones</span>
            <MapPin className="w-4 h-4 text-amber-600" />
          </div>
          <div className="text-2xl font-black text-slate-900">{data?.metrics?.totalZones || 0}</div>
          <span className="text-[10px] font-semibold text-slate-500 mt-1 block">Assigned clusters</span>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm col-span-2 lg:col-span-1">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-bold uppercase">Catalog SKUs</span>
            <Package className="w-4 h-4 text-rose-600" />
          </div>
          <div className="text-2xl font-black text-slate-900">{catalog.length}</div>
          <span className="text-[10px] font-semibold text-slate-500 mt-1 block">Commodities in stock</span>
        </div>
      </div>

      {/* Main Grid: Orders & Catalog Manager */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Orders Log */}
        <div className="lg:col-span-7 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
            <div>
              <h3 className="text-base font-bold text-slate-800">Master Orders Feed</h3>
              <p className="text-xs text-slate-500">Live order booking stream across all sales officers</p>
            </div>

            <div className="flex items-center gap-1.5 text-xs bg-slate-100 p-1 rounded-xl">
              {['ALL', 'PENDING', 'IN_TRANSIT', 'DELIVERED'].map((st) => (
                <button
                  key={st}
                  onClick={() => setFilterStatus(st)}
                  className={`px-2.5 py-1 rounded-lg font-bold transition text-[11px] ${
                    filterStatus === st ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900'
                  }`}
                >
                  {st}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            {filteredOrders.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-xs">No orders matching this filter</div>
            ) : (
              filteredOrders.map((ord) => (
                <div key={ord.orderId} className="p-4 rounded-xl border border-slate-200 hover:border-slate-300 transition space-y-2.5">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold text-slate-800">{ord.orderId}</span>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          ord.deliveryStatus === 'DELIVERED'
                            ? 'bg-emerald-100 text-emerald-800'
                            : ord.deliveryStatus === 'IN_TRANSIT'
                            ? 'bg-blue-100 text-blue-800'
                            : 'bg-amber-100 text-amber-800'
                        }`}>
                          {ord.deliveryStatus}
                        </span>
                      </div>
                      <div className="text-xs font-bold text-slate-700 mt-1">{ord.shopName}</div>
                      <div className="text-[11px] text-slate-400">Route: {ord.clusterName || 'Downtown Zone'} • By: {ord.salesPersonName || 'Field Agent'}</div>
                    </div>

                    <div className="text-right">
                      <span className="text-sm font-black text-slate-900 block">${ord.totalAmount.toFixed(2)}</span>
                      <span className="text-[10px] text-slate-400 font-mono">{ord.createdAt}</span>
                    </div>
                  </div>

                  <div className="bg-slate-50 p-2 rounded-lg text-[11px] text-slate-600 flex flex-wrap gap-x-4 gap-y-1 border border-slate-100">
                    {ord.items?.map((it, idx) => (
                      <span key={idx}>
                        • {it.qty} {it.unitType}s {it.itemName}
                      </span>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Catalog & Wholesale Price Control */}
        <div className="lg:col-span-5 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
          <div className="pb-3 border-b border-slate-100">
            <h3 className="text-base font-bold text-slate-800">Wholesale Pricing Control</h3>
            <p className="text-xs text-slate-500">Configure base catalog prices vs customer bargaining rates</p>
          </div>

          <div className="space-y-3">
            {catalog.map((prod) => {
              const isEditing = editingItem === prod.itemid;
              return (
                <div key={prod.itemid} className="p-3.5 rounded-xl border border-slate-200 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <img src={prod.itemimage} alt={prod.itemName} className="w-12 h-12 object-cover rounded-lg bg-slate-100 flex-shrink-0" />
                    <div>
                      <h4 className="text-xs font-bold text-slate-800 leading-tight">{prod.itemName}</h4>
                      <span className="text-[10px] text-slate-400 block mt-0.5">{prod.kgsperunit} kg / {prod.unitType} • Stock: {prod.stock || 200}</span>
                      
                      {isEditing ? (
                        <div className="flex items-center gap-2 mt-2">
                          <input
                            type="number"
                            value={editPrice}
                            onChange={(e) => setEditPrice(e.target.value)}
                            placeholder="Base Price"
                            className="w-20 p-1 border rounded text-xs font-mono"
                          />
                          <input
                            type="number"
                            value={editCPrice}
                            onChange={(e) => setEditCPrice(e.target.value)}
                            placeholder="Wholesale Price"
                            className="w-20 p-1 border rounded text-xs font-mono"
                          />
                          <button
                            onClick={() => handleSavePrice(prod.itemid)}
                            className="px-2 py-1 bg-emerald-600 text-white rounded text-[10px] font-bold"
                          >
                            Save
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-3 text-xs font-mono mt-1">
                          <span className="text-slate-500">Retail: ${prod.price}</span>
                          <span className="text-emerald-700 font-bold">Wholesale: ${prod.cprice}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {!isEditing && (
                    <button
                      onClick={() => {
                        setEditingItem(prod.itemid);
                        setEditPrice(prod.price);
                        setEditCPrice(prod.cprice);
                      }}
                      className="text-xs font-semibold text-purple-600 hover:text-purple-700 hover:bg-purple-50 p-2 rounded-lg transition"
                    >
                      Edit Rate
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

      </div>
    </div>
  );
}
