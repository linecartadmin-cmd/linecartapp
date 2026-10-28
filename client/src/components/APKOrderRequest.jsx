import React, { useState, useEffect, useRef } from 'react';
import { api } from '../api';
import { OutlinedInput, OutlinedDropdown, AndroidToast } from './MaterialUI';
import { queueOrderCreation } from '../offline/syncEngine';

// Exact remarks array from decompiled/resources/res/values/arrays.xml
const REMARKS_ARRAY = [
  'Not Connected',
  'Order Placed',
  'High Price',
  'Invntory Available',
  'Shop Closed',
  'May be Tomorrow',
  'Not interested'
];

export default function APKOrderRequest({ user }) {
  const [clustersList, setClustersList] = useState([]);
  const [oselectedCluster, setOselectedCluster] = useState(0);
  const [selectedClusterLabel, setSelectedClusterLabel] = useState('');

  const [shopsList, setShopsList] = useState([]);
  const [oselectedShop, setOselectedShop] = useState(0);
  const [selectedShopLabel, setSelectedShopLabel] = useState('');

  const [contact1, setContact1] = useState('');
  const [contact2, setContact2] = useState('');

  const [orderItems, setOrderItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [toastMsg, setToastMsg] = useState('');
  const toastTimerRef = useRef(null);

  const showToast = (msg) => {
    setToastMsg(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastMsg(''), 3000);
  };

  // Current date in dd-MM-yyyy format (OrderRequest.java lines 133-135)
  const todayDate = (() => {
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yyyy = now.getFullYear();
    return `${dd}-${mm}-${yyyy}`;
  })();

  const mapRawItemsToAdapterState = (items = []) =>
    items.map((it) => ({
      itemid: it.itemid,
      itemName: it.itemName,
      itemimage: it.itemimage || '/no_image.jpg',
      unitType: it.unitType || 'Kgs',
      kgsperunit: it.kgsperunit ?? 1,
      price: Number(it.price) || 0,
      qtyStr: '',
      qty: 0,
      subpriceStr: '',
      cpriceStr: Number(it.cprice) > 0 ? String(it.cprice) : '',
      cprice: Number(it.cprice) || 0,
      remarksIndex: 0,
      remarksLabel: 'Not Connected'
    }));

  // Load items order info on mount (matching OrderRequest.java getItemsOrdersInfo lines 241-277)
  useEffect(() => {
    let mounted = true;
    api
      .getItemsOrder(user?.id || 1)
      .then((res) => {
        if (!mounted) return;
        if ((res?.status === 200 || res?.status === 1) && res?.result?.clusterList) {
          const cList = res.result.clusterList;
          setClustersList(cList);
          // OrderRequest.java line 258: updateOrderItemsData(1, 0)
          const firstCluster = cList.find((c) => Number(c.clusterId) === 1) || cList[0];
          if (firstCluster?.shopsList?.length > 0) {
            setOrderItems(mapRawItemsToAdapterState(firstCluster.shopsList[0].itemsList || []));
          }
        } else {
          showToast('Failed to get clusterInfo');
        }
      })
      .catch(() => {
        if (mounted) showToast('Failed to get clusterInfo');
      });

    return () => {
      mounted = false;
    };
  }, [user?.id]);

  // Cluster selection handler (OrderRequest.java lines 142-151)
  const handleClusterSelect = (opt) => {
    const clusterId = opt.value;
    setOselectedCluster(clusterId);
    setSelectedClusterLabel(opt.label);

    const foundCluster = clustersList.find((c) => Number(c.clusterId) === Number(clusterId));
    const sList = foundCluster?.shopsList || [];
    setShopsList(sList);
    setSelectedShopLabel('');
    setContact1('');
    setContact2('');
    setOselectedShop(0);
  };

  // Shop selection handler (OrderRequest.java lines 153-163)
  const handleShopSelect = (opt) => {
    const shop = shopsList.find((s) => Number(s.shopid) === Number(opt.value));
    if (shop) {
      setOselectedShop(shop.shopid);
      setSelectedShopLabel(shop.shopName);
      setContact1(shop.contact1 || '');
      setContact2(shop.contact2 || '');
      setOrderItems(mapRawItemsToAdapterState(shop.itemsList || []));
    }
  };

  // Dialer click handler (OrderRequest.java lines 166-190)
  const handleDialContact = (phoneNum) => {
    if (phoneNum && phoneNum.trim().length > 0) {
      window.location.href = `tel:${phoneNum.trim()}`;
    }
  };

  // Units # change handler matching OrderItemsLinearAdapter.java lines 95-114
  const handleQtyChange = (idx, rawValue) => {
    setOrderItems((prev) =>
      prev.map((item, i) => {
        if (i !== idx) return item;
        const parsedQty = rawValue.length > 0 ? parseFloat(rawValue) || 0 : 0;
        const subprice = parsedQty * item.price;
        // OrderItemsLinearAdapter lines 105-109:
        // if qty <= 0 -> "Not Connected" (0), else -> "Order Placed" (1)
        const autoRemarksIndex = parsedQty <= 0 ? 0 : 1;
        return {
          ...item,
          qtyStr: rawValue,
          qty: parsedQty,
          subpriceStr: rawValue.length > 0 ? String(subprice) : '0.0',
          remarksIndex: autoRemarksIndex,
          remarksLabel: REMARKS_ARRAY[autoRemarksIndex]
        };
      })
    );
  };

  // Cust Price change handler matching OrderItemsLinearAdapter.java lines 124-137
  const handleCustPriceChange = (idx, rawValue) => {
    setOrderItems((prev) =>
      prev.map((item, i) => {
        if (i !== idx) return item;
        const parsedCPrice = rawValue.length > 0 ? parseFloat(rawValue) || 0 : 0;
        return {
          ...item,
          cpriceStr: rawValue,
          cprice: parsedCPrice
        };
      })
    );
  };

  // Remarks dropdown handler matching OrderItemsLinearAdapter.java lines 76-82
  const handleRemarksSelect = (idx, opt) => {
    setOrderItems((prev) =>
      prev.map((item, i) => {
        if (i !== idx) return item;
        return {
          ...item,
          remarksIndex: opt.value,
          remarksLabel: opt.label
        };
      })
    );
  };

  // Submit handler matching OrderRequest.java lines 318-358
  const handleSubmit = async (e) => {
    if (e) e.preventDefault();

    if (oselectedCluster === 0) {
      showToast('Please Select Valid Cluster.');
      return;
    }
    if (oselectedShop === 0) {
      showToast('Please Select Valid Shop.');
      return;
    }

    const spersonid = Number(user?.id || localStorage.getItem('LineCartPref_userid') || 1);
    const orderList = orderItems.map((it) => {
      const hasReq = it.cprice !== undefined && it.cprice !== null && Number(it.cprice) > 0 && Math.abs(Number(it.cprice) - Number(it.price)) > 0.001;
      return {
        customerid: oselectedShop,
        itemid: it.itemid,
        itemName: it.itemName,
        qty: it.qty,
        price: Number(it.price),
        catalogPrice: Number(it.price),
        actprice: Number(it.price),
        custprice: hasReq ? Number(it.cprice) : Number(it.price),
        requestedPrice: hasReq ? Number(it.cprice) : undefined,
        spersonid,
        clusterid: oselectedCluster,
        remarks: it.remarksIndex
      };
    });

    setLoading(true);

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      try {
        const curShop = shopsList.find((s) => Number(s.shopid) === Number(oselectedShop));
        await queueOrderCreation(user?.id || spersonid, orderList, curShop, orderItems);
        showToast('Order saved locally (Offline). Waiting to sync.');
      } catch (err) {
        showToast(`Failed to save offline order: ${err.message}`);
      } finally {
        setLoading(false);
      }
      return;
    }

    try {
      const res = await api.createOrder(orderList);
      if (res && (res.status === 200 || res.status === 1)) {
        showToast('Order Created Successfully');
      } else {
        showToast('Failed to create Order.');
      }
    } catch {
      try {
        const curShop = shopsList.find((s) => Number(s.shopid) === Number(oselectedShop));
        await queueOrderCreation(user?.id || spersonid, orderList, curShop, orderItems);
        showToast('Network drop: Order saved locally. Waiting to sync.');
      } catch {
        showToast('Failed to create Order.');
      }
    } finally {
      setLoading(false);
    }
  };

  const clusterOptions = clustersList.map((c) => ({
    value: c.clusterId,
    label: c.clusterName
  }));

  const shopOptions = shopsList.map((s) => ({
    value: s.shopid,
    label: s.shopName
  }));

  const remarksOptions = REMARKS_ARRAY.map((label, idx) => ({
    value: idx,
    label
  }));

  return (
    <div className="w-full min-h-full bg-[#19afe6] p-4 pb-20 select-none">
      {/* Title (@+id/formtitle) */}
      <h2
        id="formtitle"
        className="text-[25px] font-bold font-serif text-[#f7ef02] mb-2 leading-tight"
      >
        Order Request
      </h2>

      <form onSubmit={handleSubmit} method="POST" action="/createorder" noValidate className="space-y-[10px]">
        {/* 1. Date (@+id/cdate) */}
        <OutlinedInput
          id="cdate"
          label="Date"
          value={todayDate}
          readOnly
          bgColor="#19afe6"
        />

        {/* 2. Cluster (@+id/clusteridlayoutOR -> @+id/clusteridspinnerOR) */}
        <OutlinedDropdown
          id="clusteridspinnerOR"
          label="Cluster"
          value={selectedClusterLabel}
          options={clusterOptions}
          onChange={handleClusterSelect}
          bgColor="#19afe6"
        />

        {/* 3. Shop Name (@+id/shpnamelayoutOR -> @+id/shopnamespinnerOR) */}
        <OutlinedDropdown
          id="shopnamespinnerOR"
          label="Shop Name"
          value={selectedShopLabel}
          options={shopOptions}
          onChange={handleShopSelect}
          bgColor="#19afe6"
        />

        {/* 4. Side-by-side Contact1 & Contact2 (@+id/contact1OR, @+id/contact2OR) */}
        <div className="grid grid-cols-2 gap-3 pt-1">
          <OutlinedInput
            id="contact1OR"
            label="Contact"
            value={contact1}
            readOnly
            onClick={() => handleDialContact(contact1)}
            bgColor="#19afe6"
          />
          <OutlinedInput
            id="contact2OR"
            label="Contact"
            value={contact2}
            readOnly
            onClick={() => handleDialContact(contact2)}
            bgColor="#19afe6"
          />
        </div>

        {/* 5. orderitemsRecyclerView (item_order_recyclerview.xml) */}
        <div className="space-y-4 pt-3">
          {orderItems.map((item, idx) => (
            <div
              key={item.itemid || idx}
              className="flex items-start gap-2.5 pb-3 border-b border-white/15"
            >
              {/* Left Column: Image (100dp x 100dp, 20% radius, 2dp #f7ef02 border) + Title + Unit Type */}
              <div className="w-[110px] flex-shrink-0 flex flex-col">
                <img
                  src={item.itemimage}
                  alt={item.itemName}
                  onError={(e) => {
                    e.currentTarget.onerror = null;
                    e.currentTarget.src = '/no_image.jpg';
                  }}
                  className="w-[100px] h-[100px] object-cover rounded-[20px] border-2 border-[#f7ef02] bg-white"
                />
                <div className="text-[18px] font-bold text-[#f7ef02] leading-snug mt-1 mb-1.5 break-words">
                  {item.itemName}
                </div>
                <OutlinedInput
                  id={`unittype_${item.itemid}`}
                  label="Unit Type"
                  value={item.unitType}
                  readOnly
                  bgColor="#19afe6"
                />
              </div>

              {/* Right Area: 2x2 grid (Units #, Unit Price, Total, Cust Price) + Remarks dropdown */}
              <div className="flex-1 space-y-2.5">
                <div className="grid grid-cols-2 gap-2.5">
                  {/* Units # (@+id/itemqty) */}
                  <OutlinedInput
                    id={`itemqty_${item.itemid}`}
                    label="Units #"
                    type="text"
                    inputMode="decimal"
                    maxLength={6}
                    value={item.qtyStr}
                    onChange={(e) => handleQtyChange(idx, e.target.value)}
                    bgColor="#19afe6"
                  />

                  {/* Unit Price (@+id/itemtodayprice) */}
                  <OutlinedInput
                    id={`itemtodayprice_${item.itemid}`}
                    label="Unit Price"
                    value={String(item.price)}
                    readOnly
                    bgColor="#19afe6"
                  />

                  {/* Total (@+id/itemsubprice) */}
                  <OutlinedInput
                    id={`itemsubprice_${item.itemid}`}
                    label="Total"
                    value={item.subpriceStr}
                    readOnly
                    bgColor="#19afe6"
                  />

                  {/* Cust Price (@+id/custreqprice) */}
                  <OutlinedInput
                    id={`custreqprice_${item.itemid}`}
                    label="Cust Price"
                    type="text"
                    inputMode="decimal"
                    maxLength={6}
                    value={item.cpriceStr}
                    onChange={(e) => handleCustPriceChange(idx, e.target.value)}
                    bgColor="#19afe6"
                  />
                </div>

                {/* Remarks (@+id/remarkstxt1 -> @+id/citemremarks) */}
                <OutlinedDropdown
                  id={`citemremarks_${item.itemid}`}
                  label="Remarks"
                  value={item.remarksLabel}
                  options={remarksOptions}
                  onChange={(opt) => handleRemarksSelect(idx, opt)}
                  bgColor="#19afe6"
                />
              </div>
            </div>
          ))}
        </div>

        {/* 6. ProgressBar (@+id/orderloading) & Submit Button (@+id/createorderbtn) */}
        {loading && (
          <div className="flex justify-center py-2" role="status" aria-label="Submitting Order">
            <div className="w-9 h-9 border-4 border-[#f7ef02] border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        <div className="pt-4 pb-10 flex justify-center">
          <button
            id="createorderbtn"
            type="submit"
            disabled={loading}
            className="bg-[#212121] hover:bg-[#303030] active:bg-[#111111] text-white font-bold text-[14px] uppercase tracking-wider px-8 py-2.5 rounded-full shadow-md transition disabled:opacity-60"
          >
            SUBMIT
          </button>
        </div>
      </form>

      <AndroidToast message={toastMsg} />
    </div>
  );
}
