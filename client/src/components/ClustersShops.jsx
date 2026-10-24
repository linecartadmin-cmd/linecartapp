import React, { useState, useEffect } from 'react';
import { Store, MapPin, Phone, ArrowRight, PlusCircle, Search, RefreshCw, ShoppingBag } from 'lucide-react';
import { api } from '../api';

export default function ClustersShops({ user, onSelectShop, onOpenRegister }) {
  const [clustersData, setClustersData] = useState([]);
  const [selectedClusterId, setSelectedClusterId] = useState(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await api.getItemsOrder(user.id);
      if (data.status === 1 && data.result?.clusterList) {
        setClustersData(data.result.clusterList);
        if (data.result.clusterList.length > 0) {
          setSelectedClusterId(data.result.clusterList[0].clusterId);
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [user.id]);

  const currentCluster = clustersData.find((c) => c.clusterId === selectedClusterId);
  const filteredShops = (currentCluster?.shopsList || []).filter(
    (s) =>
      s.shopName.toLowerCase().includes(search.toLowerCase()) ||
      s.contact1.includes(search)
  );

  return (
    <div className="space-y-6">
      {/* Top Header Controls */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Assigned Market Routes</h2>
          <p className="text-sm text-slate-500">Select a territory route to view stores or book orders</p>
        </div>
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <button
            onClick={loadData}
            className="p-2.5 text-slate-600 hover:text-emerald-600 bg-slate-50 hover:bg-emerald-50 rounded-xl border border-slate-200 transition"
            title="Refresh Routes"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
          <button
            onClick={() => onOpenRegister(selectedClusterId)}
            className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-medium py-2.5 px-4 rounded-xl shadow-sm transition text-sm"
          >
            <PlusCircle className="w-4 h-4" />
            <span>Register New Store</span>
          </button>
        </div>
      </div>

      {/* Cluster / Zone Tabs */}
      <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-none">
        {clustersData.map((cluster) => {
          const isSelected = cluster.clusterId === selectedClusterId;
          return (
            <button
              key={cluster.clusterId}
              onClick={() => setSelectedClusterId(cluster.clusterId)}
              className={`px-5 py-3 rounded-xl font-medium text-sm whitespace-nowrap transition flex items-center gap-2 border ${
                isSelected
                  ? 'bg-emerald-600 text-white border-emerald-600 shadow-md shadow-emerald-600/20'
                  : 'bg-white text-slate-700 hover:bg-slate-50 border-slate-200'
              }`}
            >
              <MapPin className={`w-4 h-4 ${isSelected ? 'text-white' : 'text-emerald-600'}`} />
              <span>{cluster.clusterName}</span>
              <span
                className={`text-xs px-2 py-0.5 rounded-full ${
                  isSelected ? 'bg-emerald-700 text-emerald-100' : 'bg-slate-100 text-slate-600'
                }`}
              >
                {cluster.shopsList?.length || 0} stores
              </span>
            </button>
          );
        })}
      </div>

      {/* Search Bar */}
      <div className="relative">
        <Search className="w-5 h-5 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by store name or phone number..."
          className="w-full pl-11 pr-4 py-3 bg-white border border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 shadow-sm"
        />
      </div>

      {/* Stores Grid */}
      {loading ? (
        <div className="p-12 text-center text-slate-400">Loading stores and route items...</div>
      ) : filteredShops.length === 0 ? (
        <div className="bg-white rounded-2xl p-12 text-center border border-slate-200">
          <Store className="w-12 h-12 mx-auto text-slate-300 mb-3" />
          <p className="text-slate-600 font-medium">No stores found in this route</p>
          <p className="text-xs text-slate-400 mt-1">Try another search or register a new store</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredShops.map((shop) => (
            <div
              key={shop.shopid}
              className="bg-white rounded-2xl p-5 border border-slate-200 hover:border-emerald-300 hover:shadow-lg transition flex flex-col justify-between group"
            >
              <div>
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold text-sm">
                    {shop.shopName.charAt(0)}
                  </div>
                  <span className="text-xs font-semibold px-2.5 py-1 bg-slate-100 text-slate-600 rounded-lg">
                    ID #{shop.shopid}
                  </span>
                </div>
                <h3 className="text-base font-bold text-slate-800 group-hover:text-emerald-700 transition">
                  {shop.shopName}
                </h3>
                <div className="flex items-center gap-2 text-xs text-slate-500 mt-2">
                  <Phone className="w-3.5 h-3.5 text-slate-400" />
                  <span>{shop.contact1}</span>
                  {shop.contact2 && <span>• {shop.contact2}</span>}
                </div>
              </div>

              <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between">
                <span className="text-xs text-slate-500">
                  {shop.itemsList?.length || 0} Catalog Items
                </span>
                <button
                  onClick={() => onSelectShop(shop, currentCluster)}
                  className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600 hover:text-emerald-700 bg-emerald-50 hover:bg-emerald-100 py-2 px-3 rounded-lg transition"
                >
                  <ShoppingBag className="w-3.5 h-3.5" />
                  <span>Book Order</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
