import React, { useState, useEffect } from 'react';
import { api } from '../api';

export default function APKOrderReports({ user }) {
  // Generate the 3 dynamic dates matching APK's Today, Yesterday, Day-before tabs
  const now = new Date();
  const formatIsoDate = (d) => d.toISOString().slice(0, 10);
  const formatDisplayDate = (d) => {
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}-${month}-${year}`;
  };

  const todayDate = new Date(now);
  const ydayDate = new Date(now);
  ydayDate.setDate(now.getDate() - 1);
  const dydayDate = new Date(now);
  dydayDate.setDate(now.getDate() - 2);

  const tabs = [
    { key: 'TODAY', label: 'TODAY', iso: formatIsoDate(todayDate), display: 'TODAY' },
    { key: 'YESTERDAY', label: formatDisplayDate(ydayDate), iso: formatIsoDate(ydayDate), display: formatDisplayDate(ydayDate) },
    { key: 'DAY_BEFORE', label: formatDisplayDate(dydayDate), iso: formatIsoDate(dydayDate), display: formatDisplayDate(dydayDate) }
  ];

  const [activeTabKey, setActiveTabKey] = useState('TODAY');
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    api.getOrders(user?.id)
      .then((res) => {
        if (res && res.status === 200 && Array.isArray(res.orders)) {
          setOrders(res.orders);
        }
      })
      .catch((err) => {
        console.warn('Could not load orders for APK order reports', err);
      })
      .finally(() => setLoading(false));
  }, [user?.id]);

  const activeTab = tabs.find((t) => t.key === activeTabKey) || tabs[0];

  // Filter orders matching selected date (matching ISO date prefix or locale date)
  const filteredOrders = orders.filter((o) => {
    const orderDateStr = String(o.date || o.orderDate || o.createdAt || '').slice(0, 10);
    if (!orderDateStr) return false;
    // Check ISO format YYYY-MM-DD
    if (orderDateStr === activeTab.iso) return true;
    // Check DD-MM-YYYY format
    const parts = orderDateStr.split('-');
    if (parts.length === 3 && parts[0].length === 2) {
      const reorderedIso = `${parts[2]}-${parts[1]}-${parts[0]}`;
      if (reorderedIso === activeTab.iso) return true;
    }
    return false;
  });

  return (
    <div className="w-full min-h-full bg-[#fffbfe] flex flex-col select-none">
      {/* Top 80dp margin area matching fragment_order_reports.xml android:layout_marginTop="80dp" */}
      <div className="h-[60px] sm:h-[80px] bg-[#fffbfe] flex-shrink-0" />

      {/* ScrollView body (#00aae6) matching fragment_order_reports.xml */}
      <div className="flex-1 bg-[#00aae6] text-white px-2.5 pt-2 pb-16">
        {/* Horizontal LinearLayout with 3 dark pill buttons */}
        <div className="flex items-center gap-3 mb-6 flex-wrap">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              id={tab.key === 'TODAY' ? 'todaybtn' : tab.key === 'YESTERDAY' ? 'ydaybtn' : 'dydaybtn'}
              type="button"
              onClick={() => setActiveTabKey(tab.key)}
              className={`bg-[#212121] hover:bg-[#303030] text-white font-bold text-[13px] uppercase px-5 py-2.5 rounded-full shadow transition ${
                activeTabKey === tab.key ? 'ring-2 ring-[#f7ef02]' : ''
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="text-white text-center py-8 font-medium">
            Loading order reports...
          </div>
        ) : filteredOrders.length > 0 ? (
          <div className="space-y-6">
            {filteredOrders.map((order, orderIdx) => {
              const shopId = order.shopId || order.shopid || order.customerId || `S${orderIdx + 1}`;
              const shopName = order.customer || order.shopName || 'Shop';
              const items = order.orderList || order.itemsList || [];

              return (
                <div key={order.id || orderIdx} className="space-y-1 bg-[#0098cf] p-3 rounded-lg">
                  <div className="flex items-baseline">
                    <span className="w-[155px] text-[20px] sm:text-[24px] font-normal text-white">
                      ShopID
                    </span>
                    <span className="w-[190px] text-white text-[20px] sm:text-[24px] font-bold border-b border-black/60 pb-0.5">
                      {shopId}
                    </span>
                  </div>

                  <div className="flex items-baseline">
                    <span className="w-[155px] text-[20px] sm:text-[24px] font-normal text-white">
                      ShopName
                    </span>
                    <span className="w-[190px] text-white text-[20px] sm:text-[24px] font-bold border-b border-black/60 pb-0.5">
                      {shopName}
                    </span>
                  </div>

                  {/* Order Table matching APK table structure */}
                  <div className="pt-2 text-[15px] sm:text-[17px] leading-snug">
                    <div className="grid grid-cols-12 gap-1 font-bold text-[#f7ef02] border-b border-white/30 pb-1">
                      <div className="col-span-4">Item</div>
                      <div className="col-span-2">QTY</div>
                      <div className="col-span-3">Amount</div>
                      <div className="col-span-3">Delivary Status</div>
                    </div>

                    {items.length > 0 ? (
                      items.map((it, itIdx) => {
                        const itName = it.itemName || it.item_name || `Item #${it.itemid || itIdx + 1}`;
                        const itQty = it.qty ?? 0;
                        const itPrice = it.custprice ?? it.cust_price ?? it.price ?? it.item_price ?? 0;
                        const itAmount = it.total_price ?? (itQty * itPrice);
                        const itStatus = it.approval_status === 'pending'
                          ? 'Approval Pending'
                          : order.status || 'In progress';

                        return (
                          <div key={it.id || itIdx} className="grid grid-cols-12 gap-1 text-white py-1 border-b border-white/10 items-center">
                            <div className="col-span-4 truncate font-medium">{itName}</div>
                            <div className="col-span-2">{itQty}</div>
                            <div className="col-span-3">₹{Number(itAmount).toFixed(0)}</div>
                            <div className="col-span-3 text-[13px]">{itStatus}</div>
                          </div>
                        );
                      })
                    ) : (
                      <div className="text-white/80 py-2 text-sm italic">
                        Total order value: ₹{Number(order.total || 0).toFixed(0)} ({order.itemsCount || 1} items)
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="bg-[#0098cf] p-6 rounded-lg text-center text-white space-y-2">
            <div className="text-xl font-bold">No Orders Placed</div>
            <p className="text-sm text-white/90">
              No orders found for {activeTab.display}. Orders created on this date will appear here in real time.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
