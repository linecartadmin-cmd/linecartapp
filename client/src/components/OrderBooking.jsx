import React, { useState } from 'react';
import { ArrowLeft, ShoppingCart, Plus, Minus, CheckCircle, Package, AlertCircle } from 'lucide-react';
import { api } from '../api';

export default function OrderBooking({ shop, cluster, user, onBack, onOrderComplete }) {
  const [items, setItems] = useState(
    (shop.itemsList || []).map((it) => ({
      ...it,
      orderQty: 0,
      customPrice: it.cprice || it.price,
      remarks: 0
    }))
  );
  const [submitting, setSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const updateQty = (itemid, delta) => {
    setItems((prev) =>
      prev.map((it) => {
        if (it.itemid === itemid) {
          const newQty = Math.max(0, it.orderQty + delta);
          return { ...it, orderQty: newQty };
        }
        return it;
      })
    );
  };

  const updateCustomPrice = (itemid, price) => {
    setItems((prev) =>
      prev.map((it) => {
        if (it.itemid === itemid) {
          return { ...it, customPrice: parseFloat(price) || 0 };
        }
        return it;
      })
    );
  };

  const orderedItems = items.filter((it) => it.orderQty > 0);
  const totalAmount = orderedItems.reduce((acc, it) => acc + it.orderQty * it.customPrice, 0);
  const totalWeight = orderedItems.reduce((acc, it) => acc + it.orderQty * (it.kgsperunit || 0), 0);

  const handleSubmitOrder = async () => {
    if (orderedItems.length === 0) {
      setErrorMsg('Please add at least 1 item to the order');
      return;
    }

    setSubmitting(true);
    setErrorMsg('');

    // Payload matching CreateOrderReq & OrderReq
    const orderList = orderedItems.map((it) => ({
      customerid: shop.shopid,
      itemid: it.itemid,
      qty: it.orderQty,
      actprice: it.price,
      custprice: it.customPrice,
      spersonid: user.id,
      clusterid: cluster.clusterId,
      remarks: it.remarks || 0
    }));

    try {
      const resp = await api.createOrder(orderList);
      if (resp.status === 1) {
        setSuccessMsg(resp.message || 'Order placed successfully!');
        setTimeout(() => {
          onOrderComplete();
        }, 1800);
      } else {
        setErrorMsg(resp.message || 'Failed to place order.');
      }
    } catch (err) {
      setErrorMsg('Failed to connect to API server.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Navigation Header */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="p-2.5 text-slate-600 hover:text-slate-900 bg-slate-50 hover:bg-slate-100 rounded-xl border border-slate-200 transition min-w-[40px] min-h-[40px] flex items-center justify-center"
            title="Go back"
            aria-label="Go back"
          >
            <ArrowLeft className="w-5 h-5" aria-hidden="true" />
            <span className="sr-only">Go back</span>
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold text-slate-800">{shop.shopName}</h2>
              <span className="text-xs px-2 py-0.5 bg-emerald-50 text-emerald-700 font-semibold rounded-md border border-emerald-200">
                Shop #{shop.shopid}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">Route: {cluster.clusterName}</p>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <div className="text-right">
            <span className="text-xs text-slate-500 block uppercase font-medium">Cart Value</span>
            <span className="text-xl font-black text-emerald-600">${totalAmount.toFixed(2)}</span>
          </div>
          <button
            onClick={handleSubmitOrder}
            disabled={submitting || orderedItems.length === 0}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 disabled:opacity-50 text-white font-semibold py-2.5 px-5 rounded-xl shadow-md shadow-emerald-600/20 transition text-sm"
          >
            <ShoppingCart className="w-4 h-4" />
            <span>{submitting ? 'Placing Order...' : `Confirm Order (${orderedItems.length})`}</span>
          </button>
        </div>
      </div>

      {successMsg && (
        <div className="p-4 bg-emerald-50 border-l-4 border-emerald-500 text-emerald-800 rounded-xl text-sm flex items-center gap-3">
          <CheckCircle className="w-5 h-5 text-emerald-600 flex-shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {errorMsg && (
        <div className="p-4 bg-red-50 border-l-4 border-red-500 text-red-800 rounded-xl text-sm flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Main Items Catalog */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {items.map((item) => {
          const inCart = item.orderQty > 0;
          return (
            <div
              key={item.itemid}
              className={`bg-white rounded-2xl p-5 border transition flex flex-col justify-between ${
                inCart
                  ? 'border-emerald-500 shadow-md ring-1 ring-emerald-500/20'
                  : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              <div>
                <div className="relative h-40 w-full mb-4 rounded-xl overflow-hidden bg-slate-100 flex items-center justify-center">
                  {item.itemimage ? (
                    <img
                      src={item.itemimage}
                      alt={item.itemName}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <Package className="w-12 h-12 text-slate-300" />
                  )}
                  <span className="absolute bottom-2 right-2 bg-slate-900/80 backdrop-blur-sm text-white text-xs px-2.5 py-1 rounded-lg font-medium">
                    {item.kgsperunit} kg / {item.unitType}
                  </span>
                </div>

                <h3 className="font-bold text-slate-800 text-base">{item.itemName}</h3>
                <div className="flex items-baseline gap-2 mt-2">
                  <span className="text-lg font-bold text-slate-900">${item.customPrice.toFixed(2)}</span>
                  {item.price !== item.customPrice && (
                    <span className="text-xs text-slate-400 line-through">${item.price.toFixed(2)}</span>
                  )}
                  <span className="text-xs text-slate-500">per {item.unitType}</span>
                </div>
              </div>

              <div className="mt-5 pt-4 border-t border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => updateQty(item.itemid, -1)}
                    disabled={item.orderQty === 0}
                    className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 disabled:opacity-40 text-slate-700 font-bold flex items-center justify-center transition"
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                  <span className="w-8 text-center font-bold text-slate-800 text-sm">
                    {item.orderQty}
                  </span>
                  <button
                    onClick={() => updateQty(item.itemid, 1)}
                    className="w-9 h-9 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold flex items-center justify-center transition shadow-sm"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>

                {inCart && (
                  <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-lg">
                    Sub: ${(item.orderQty * item.customPrice).toFixed(2)}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Floating Bottom Bar for mobile/tablet */}
      {orderedItems.length > 0 && (
        <div className="fixed bottom-4 left-4 right-4 sm:hidden bg-slate-900 text-white p-4 rounded-2xl shadow-2xl flex items-center justify-between z-50">
          <div>
            <div className="text-xs text-slate-400">{orderedItems.length} items • {totalWeight} kg</div>
            <div className="text-lg font-bold">${totalAmount.toFixed(2)}</div>
          </div>
          <button
            onClick={handleSubmitOrder}
            disabled={submitting}
            className="bg-emerald-500 hover:bg-emerald-600 text-slate-900 font-bold px-4 py-2.5 rounded-xl text-sm transition"
          >
            {submitting ? 'Placing...' : 'Submit Order'}
          </button>
        </div>
      )}
    </div>
  );
}
