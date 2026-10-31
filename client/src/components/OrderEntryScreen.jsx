import React, { useState, useEffect, useRef } from 'react';
import { api } from '../api';
import { formatShopId, getGoogleMapsUrl, getPaymentSummary } from '../utils';
import { queueOrderCreation } from '../offline/syncEngine';

const REMARKS_OPTIONS = [
  'Not Connected',
  'Order Placed',
  'High Price',
  'Invntory Available',
  'Shop Closed',
  'May be Tomorrow',
  'Not interested'
];

function getIstTodayString() {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function formatIstDateDisplay(dateStr) {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr || '—';
  try {
    const [y, m, d] = dateStr.split('-').map(Number);
    // Construct a UTC noon timestamp for that calendar date and format in Asia/Kolkata
    const utcNoon = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    }).format(utcNoon);
  } catch {
    return dateStr;
  }
}

function addDays(dateStr, days) {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return '';
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (isNaN(d.getTime())) return '';
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
}

function normalizeUnit(u) {
  const s = String(u || 'kg').trim();
  if (!s || s.toLowerCase().startsWith('kg')) return 'kg';
  return s;
}

export default function OrderEntryScreen({
  user,
  clusters = [],
  shops = [],
  catalogItems = [],
  initialOrderRows = null,
  defaultExpandedItemId = null,
  preselectedShop = '',
  onOrderPlaced,
  onNavigate,
  showToast
}) {
  const isAgent = user?.role === 'Field Sales Agent';
  const agentAssignedShops = isAgent && user?.id
    ? shops.filter((s) => {
        const assignedId = s.assignedAgentId ?? s.assigned_agent_id ?? s.salesExecId ?? s.salesexecid;
        return assignedId === undefined || assignedId === null || Number(assignedId) === Number(user.id);
      })
    : shops;

  // Strictly scope clusters to those containing shops assigned to this agent
  const availableClusters = clusters.filter((c) =>
    agentAssignedShops.some((s) => Number(s.clusterid ?? s.clusterId) === Number(c.clusterId ?? c.id))
  );
  const hasSingleAssignedCluster = availableClusters.length <= 1;
  const singleClusterId = availableClusters.length === 1
    ? String(availableClusters[0].clusterId ?? availableClusters[0].id)
    : (agentAssignedShops[0]?.clusterid ? String(agentAssignedShops[0].clusterid) : String(user?.clusterid || 1));

  const [selectedClusterId, setSelectedClusterId] = useState(() =>
    hasSingleAssignedCluster ? singleClusterId : 'all'
  );
  const todayIst = getIstTodayString();
  const [selectedShopId, setSelectedShopId] = useState(() =>
    agentAssignedShops.length > 0 ? String(agentAssignedShops[0].shopid ?? agentAssignedShops[0].id) : ''
  );
  const [orderDate, setOrderDate] = useState(() => getIstTodayString());
  const [orderRows, setOrderRows] = useState(() => {
    if (Array.isArray(initialOrderRows) && initialOrderRows.length > 0) {
      return initialOrderRows;
    }
    return (catalogItems || []).map((item) => ({
      itemid: item.itemid ?? item.id,
      itemName: item.itemName ?? item.name,
      itemimage: item.itemimage || '/lincart_flashicon.png',
      unitType: normalizeUnit(item.unitType || item.unit || 'kg'),
      price: Number(item.price) || 50,
      qty: 0,
      custprice: Number(item.price) || 50,
      requestedPrice: '',
      requestReason: '',
      remarks: 'Not Connected'
    }));
  });
  const [expandedItemId, setExpandedItemId] = useState(defaultExpandedItemId);
  const [orderNotes, setOrderNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Foreground Location State (single foreground request on open/use, never continuous tracking)
  const [locationCoords, setLocationCoords] = useState(null); // { lat, lng, accuracy }
  const [locationText, setLocationText] = useState('');
  const [locationStatus, setLocationStatus] = useState('idle'); // 'idle' | 'loading' | 'ok' | 'poor_accuracy' | 'denied' | 'unavailable'
  const [locationMessage, setLocationMessage] = useState('');

  // In-App Camera / Visit Photo State
  const [visitPhoto, setVisitPhoto] = useState(null);
  const [visitPhotoStatus, setVisitPhotoStatus] = useState(null); // 'ready' | 'waiting_offline' | 'synced'
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [isOffline, setIsOffline] = useState(() => typeof navigator !== 'undefined' && !navigator.onLine);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const fileInputRef = useRef(null);

  // Last saved order summary for quick confirmation
  const [lastSavedOrder, setLastSavedOrder] = useState(null);

  // 7-Day Order History State
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

  // Monitor online/offline status for photo sync indicator
  useEffect(() => {
    const onOnline = () => {
      setIsOffline(false);
      setVisitPhotoStatus((prev) => (prev === 'waiting_offline' ? 'ready' : prev));
    };
    const onOffline = () => {
      setIsOffline(true);
      setVisitPhotoStatus((prev) => (prev === 'ready' ? 'waiting_offline' : prev));
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  // Automatically enforce single assigned cluster when agent has only one assigned cluster
  useEffect(() => {
    if (hasSingleAssignedCluster && singleClusterId && selectedClusterId !== singleClusterId) {
      setSelectedClusterId(singleClusterId);
    }
  }, [hasSingleAssignedCluster, singleClusterId, selectedClusterId]);

  // Filter shops strictly to agent's assigned shops in the selected cluster
  const clusterShops = (hasSingleAssignedCluster || selectedClusterId === 'all')
    ? (hasSingleAssignedCluster
        ? agentAssignedShops.filter((s) => Number(s.clusterid ?? s.clusterId) === Number(singleClusterId))
        : agentAssignedShops)
    : agentAssignedShops.filter((s) => Number(s.clusterid ?? s.clusterId) === Number(selectedClusterId));

  const effectiveShops = clusterShops.length > 0 ? clusterShops : agentAssignedShops;

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
    if (effectiveShops.length > 0 && !selectedShopId) {
      setSelectedShopId(String(effectiveShops[0].shopid));
    }
  }, [preselectedShop, selectedClusterId, shops]);

  // Load catalog items into order rows (unit normalized to 'kg' where applicable)
  useEffect(() => {
    if (catalogItems.length > 0) {
      setOrderRows(
        catalogItems.map((item) => ({
          itemid: item.itemid,
          itemName: item.itemName,
          itemimage: item.itemimage || '/lincart_flashicon.png',
          unitType: normalizeUnit(item.unitType || 'kg'),
          price: Number(item.price) || 50,
          qty: 0,
          custprice: Number(item.price) || 50,
          requestedPrice: '',
          requestReason: '',
          remarks: 'Not Connected'
        }))
      );
    }
  }, [catalogItems]);

  // Foreground Location Fetch (single one-shot request when agent opens/uses the Location field; never continuous)
  const requestForegroundLocation = () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setLocationStatus('unavailable');
      setLocationMessage('GPS unavailable on this device or browser.');
      return;
    }

    setLocationStatus('loading');
    setLocationMessage('Requesting foreground GPS location...');

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = Number(pos.coords.latitude);
        const lng = Number(pos.coords.longitude);
        const acc = Math.round(Number(pos.coords.accuracy || 0));
        const formatted = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
        setLocationCoords({ lat, lng, accuracy: acc });
        setLocationText(formatted);

        if (acc > 100) {
          setLocationStatus('poor_accuracy');
          setLocationMessage(`Poor GPS accuracy (±${acc}m). Coordinates recorded, or tap Retry in an open area.`);
        } else {
          setLocationStatus('ok');
          setLocationMessage(`Foreground GPS captured (accuracy ±${acc}m).`);
        }
      },
      (err) => {
        if (err && err.code === 1) {
          setLocationStatus('denied');
          setLocationMessage('Location permission denied. Please enable foreground location access in settings and tap Retry.');
        } else if (err && err.code === 2) {
          setLocationStatus('unavailable');
          setLocationMessage('GPS position unavailable. Please check that device location/GPS is turned on.');
        } else if (err && err.code === 3) {
          setLocationStatus('unavailable');
          setLocationMessage('GPS request timed out. Move to an area with clear sky view and tap Retry.');
        } else {
          setLocationStatus('unavailable');
          setLocationMessage(err?.message || 'Unable to retrieve GPS coordinates.');
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0
      }
    );
  };

  // Stop camera stream cleanly when modal closes or component unmounts
  const stopCameraStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  };

  useEffect(() => {
    return () => stopCameraStream();
  }, []);

  const handleOpenCamera = async () => {
    setCameraError('');
    if (typeof navigator !== 'undefined' && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      try {
        setCameraOpen(true);
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
      } catch (err) {
        stopCameraStream();
        setCameraOpen(false);
        // Fallback to native file input with camera capture
        if (fileInputRef.current) {
          fileInputRef.current.click();
        } else {
          setCameraError('Camera access was denied or is unavailable on this device.');
        }
      }
    } else if (fileInputRef.current) {
      fileInputRef.current.click();
    } else {
      setCameraError('Camera is not supported in this environment.');
    }
  };

  const handleCaptureVideoFrame = () => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    const maxDim = 960;
    let w = video.videoWidth || 640;
    let h = video.videoHeight || 480;
    if (w > maxDim || h > maxDim) {
      if (w > h) {
        h = Math.round((h * maxDim) / w);
        w = maxDim;
      } else {
        w = Math.round((w * maxDim) / h);
        h = maxDim;
      }
    }
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, w, h);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.78);
    setVisitPhoto(dataUrl);
    setVisitPhotoStatus(navigator.onLine ? 'ready' : 'waiting_offline');
    stopCameraStream();
    setCameraOpen(false);
    if (showToast) {
      showToast(navigator.onLine ? 'Visit photo captured and attached to order.' : 'Visit photo captured (waiting to sync offline).');
    }
  };

  const handleFilePhotoSelected = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const maxDim = 960;
        let w = img.width || 640;
        let h = img.height || 480;
        if (w > maxDim || h > maxDim) {
          if (w > h) {
            h = Math.round((h * maxDim) / w);
            w = maxDim;
          } else {
            w = Math.round((w * maxDim) / h);
            h = maxDim;
          }
        }
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        const compressed = canvas.toDataURL('image/jpeg', 0.78);
        setVisitPhoto(compressed);
        setVisitPhotoStatus(navigator.onLine ? 'ready' : 'waiting_offline');
        if (showToast) {
          showToast(navigator.onLine ? 'Visit photo attached to order.' : 'Visit photo attached (waiting to sync offline).');
        }
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  };

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

    api.getShopOrderHistory(shopId, 7, user?.id)
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
  const expectedDeliveryDate = addDays(orderDate, 1);

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

  // Entering a customer-requested price records a price request for approval ONLY;
  // it NEVER changes the catalog price (r.price), custprice, line totals, or order total.
  const handleRequestedPriceChange = (idx, val) => {
    setOrderRows((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, requestedPrice: val } : r))
    );
  };

  const handleRequestReasonChange = (idx, val) => {
    setOrderRows((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, requestReason: val } : r))
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
          unitType: normalizeUnit(nextItem.unitType || 'kg'),
          price: Number(nextItem.price) || 50,
          qty: 1,
          custprice: Number(nextItem.price) || 50,
          requestedPrice: '',
          requestReason: '',
          remarks: 'Order Placed'
        }
      ]);
      setExpandedItemId(nextItem.itemid);
    } else {
      showToast('All catalog items are already in this order.');
    }
  };

  // Active items with quantity > 0
  const activeItems = orderRows.filter((r) => Number(r.qty) > 0);
  const hasPriceReq = activeItems.some(
    (r) =>
      r.requestedPrice !== undefined &&
      r.requestedPrice !== null &&
      r.requestedPrice !== '' &&
      Math.abs(Number(r.requestedPrice) - Number(r.price)) > 0.001
  );

  // Order total & line totals strictly use catalog price (r.price); requestedPrice is pending approval
  const subtotal = activeItems.reduce((sum, r) => {
    const qty = Number(r.qty) || 0;
    const catalogPrice = Number(r.price) || 0;
    return sum + qty * catalogPrice;
  }, 0);

  const totalQuantityKg = activeItems.reduce((sum, r) => sum + (Number(r.qty) || 0), 0);

  const handleSubmitOrder = async (e) => {
    if (e) e.preventDefault();
    if (!currentShop) {
      showToast('Please select a valid assigned customer store.');
      return;
    }
    if (activeItems.length === 0) {
      showToast('Please enter quantity for at least one item.');
      return;
    }

    // Validate requested prices
    for (const r of activeItems) {
      if (r.requestedPrice !== undefined && r.requestedPrice !== null && r.requestedPrice !== '') {
        const p = parseFloat(r.requestedPrice);
        if (isNaN(p) || p < 0) {
          showToast(`Invalid requested price for '${r.itemName}'. Must be a non-negative amount.`);
          return;
        }
      }
    }

    setSubmitting(true);
    const spersonid = Number(user?.id || localStorage.getItem('LineCartPref_userid') || 1);
    const finalClusterId = Number(currentShop?.clusterid || singleClusterId || 1);

    const extraMeta = {
      orderDate,
      expectedDeliveryDate,
      locationLat: locationCoords?.lat ?? null,
      locationLng: locationCoords?.lng ?? null,
      locationAccuracy: locationCoords?.accuracy ?? null,
      locationText: locationText || null,
      visitPhoto: visitPhoto || null
    };

    const orderList = orderRows.map((r) => {
      const hasReq = r.requestedPrice !== undefined && r.requestedPrice !== null && r.requestedPrice !== '';
      const reqVal = hasReq ? parseFloat(r.requestedPrice) : null;
      const isCustom = hasReq && reqVal !== null && !isNaN(reqVal) && Math.abs(reqVal - Number(r.price)) > 0.001;
      const catPrice = Number(r.price);
      return {
        customerid: currentShop.shopid,
        itemid: r.itemid,
        itemName: r.itemName,
        unitType: normalizeUnit(r.unitType),
        qty: r.qty,
        price: catPrice,
        catalogPrice: catPrice,
        actprice: catPrice,
        custprice: catPrice, // Catalog price preserved until price request is approved
        requestedPrice: isCustom ? reqVal : undefined,
        requestReason: r.requestReason || '',
        spersonid,
        clusterid: finalClusterId,
        date: orderDate,
        expectedDeliveryDate,
        locationLat: extraMeta.locationLat,
        locationLng: extraMeta.locationLng,
        locationAccuracy: extraMeta.locationAccuracy,
        locationText: extraMeta.locationText,
        remarks: REMARKS_OPTIONS.indexOf(r.remarks) >= 0 ? REMARKS_OPTIONS.indexOf(r.remarks) : 0,
        notes: orderNotes
      };
    });

    const shortId = formatShopId(currentShop.shopid);
    const finalStatus = hasPriceReq ? 'Price approval pending' : 'In progress';
    const savedItemsSnapshot = activeItems.map((r) => {
      const hasReq = r.requestedPrice !== undefined && r.requestedPrice !== null && r.requestedPrice !== '';
      const reqVal = hasReq ? parseFloat(r.requestedPrice) : null;
      const isCustom = hasReq && reqVal !== null && !isNaN(reqVal) && Math.abs(reqVal - Number(r.price)) > 0.001;
      return {
        itemid: r.itemid,
        itemName: r.itemName,
        qty: Number(r.qty),
        unitType: normalizeUnit(r.unitType),
        price: Number(r.price),
        catalogPrice: Number(r.price),
        lineTotal: Number((Number(r.qty) * Number(r.price)).toFixed(2)),
        requestedPrice: isCustom ? reqVal : null,
        priceRequestStatus: isCustom ? 'pending' : null
      };
    });

    // If offline, queue locally immediately without attempting remote fetch
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      try {
        const { tempRef, idempotencyKey } = await queueOrderCreation(
          user?.id || spersonid,
          orderList,
          currentShop,
          activeItems,
          extraMeta
        );
        if (visitPhoto) setVisitPhotoStatus('waiting_offline');
        showToast(
          hasPriceReq
            ? 'Order & price request saved locally (Offline). Waiting to sync.'
            : 'Order saved locally (Offline). Waiting to sync.'
        );
        const placedObj = {
          id: tempRef,
          orderId: tempRef,
          tempRef,
          idempotencyKey,
          customer: currentShop.shopName,
          shopName: currentShop.shopName,
          shopCategory: currentShop.shopCategory || 'Retail',
          shopId: shortId,
          shopid: currentShop.shopid,
          clusterId: finalClusterId,
          date: orderDate,
          expectedDeliveryDate,
          items: savedItemsSnapshot.length,
          itemsCount: savedItemsSnapshot.length,
          total: subtotal,
          status: finalStatus,
          priceApprovalPending: hasPriceReq,
          locationLat: extraMeta.locationLat,
          locationLng: extraMeta.locationLng,
          locationAccuracy: extraMeta.locationAccuracy,
          locationText: extraMeta.locationText,
          visitPhoto: visitPhoto || null,
          visitPhotoStatus: visitPhoto ? 'waiting_offline' : null,
          syncState: 'waiting',
          syncStatus: 'waiting',
          orderList: savedItemsSnapshot,
          itemsList: savedItemsSnapshot
        };
        setLastSavedOrder(placedObj);
        if (onOrderPlaced) {
          onOrderPlaced(placedObj);
        }
        onNavigate('reports');
      } catch (err) {
        showToast(`Failed to save offline order: ${err.message}`);
      } finally {
        setSubmitting(false);
      }
      return;
    }

    try {
      const res = await api.createOrder(orderList, null, null, extraMeta);
      if (res && (res.status === 200 || res.status === 1)) {
        if (visitPhoto) setVisitPhotoStatus('synced');
        showToast(
          hasPriceReq
            ? 'Order placed at catalog price! Customer price request sent for approval.'
            : `Order for ${currentShop.shopName} placed successfully!`
        );
        fetchOrderHistory(selectedShopId);
        const serial = res.id || Math.floor(Math.random() * 90000 + 10000);
        const orderId = res.orderId || `${shortId}-${serial}`;
        const placedObj = {
          id: orderId,
          orderId,
          customer: currentShop.shopName,
          shopName: currentShop.shopName,
          shopCategory: currentShop.shopCategory || 'Retail',
          shopId: shortId,
          shopid: currentShop.shopid,
          clusterId: finalClusterId,
          date: orderDate,
          expectedDeliveryDate: res.expectedDeliveryDate || expectedDeliveryDate,
          items: savedItemsSnapshot.length,
          itemsCount: savedItemsSnapshot.length,
          total: subtotal,
          status: res.statusName || finalStatus,
          priceApprovalPending: res.priceApprovalPending ?? hasPriceReq,
          locationLat: extraMeta.locationLat,
          locationLng: extraMeta.locationLng,
          locationAccuracy: extraMeta.locationAccuracy,
          locationText: extraMeta.locationText,
          visitPhoto: visitPhoto || null,
          visitPhotoStatus: visitPhoto ? 'synced' : null,
          syncState: 'synced',
          syncStatus: 'synced',
          orderList: savedItemsSnapshot,
          itemsList: savedItemsSnapshot
        };
        setLastSavedOrder(placedObj);
        if (onOrderPlaced) {
          onOrderPlaced(placedObj);
        }
        onNavigate('reports');
      } else {
        showToast(res?.message || 'Failed to place order.');
      }
    } catch (networkErr) {
      // If network fails during online submission, fall back gracefully to offline queue
      try {
        const { tempRef, idempotencyKey } = await queueOrderCreation(
          user?.id || spersonid,
          orderList,
          currentShop,
          activeItems,
          extraMeta
        );
        if (visitPhoto) setVisitPhotoStatus('waiting_offline');
        showToast('Network drop: Order & photo queued locally. Waiting to sync.');
        const placedObj = {
          id: tempRef,
          orderId: tempRef,
          tempRef,
          idempotencyKey,
          customer: currentShop.shopName,
          shopName: currentShop.shopName,
          shopCategory: currentShop.shopCategory || 'Retail',
          shopId: shortId,
          shopid: currentShop.shopid,
          clusterId: finalClusterId,
          date: orderDate,
          expectedDeliveryDate,
          items: savedItemsSnapshot.length,
          itemsCount: savedItemsSnapshot.length,
          total: subtotal,
          status: finalStatus,
          priceApprovalPending: hasPriceReq,
          locationLat: extraMeta.locationLat,
          locationLng: extraMeta.locationLng,
          locationAccuracy: extraMeta.locationAccuracy,
          locationText: extraMeta.locationText,
          visitPhoto: visitPhoto || null,
          visitPhotoStatus: visitPhoto ? 'waiting_offline' : null,
          syncState: 'waiting',
          syncStatus: 'waiting',
          orderList: savedItemsSnapshot,
          itemsList: savedItemsSnapshot
        };
        setLastSavedOrder(placedObj);
        if (onOrderPlaced) {
          onOrderPlaced(placedObj);
        }
        onNavigate('reports');
      } catch {
        showToast('Failed to connect or save offline order.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (shops.length === 0) {
    return (
      <div className="order-entry-page p-6 max-w-xl mx-auto">
        <div className="p-8 text-center bg-white rounded-2xl border border-slate-200 shadow-sm mt-8">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-amber-50 flex items-center justify-center text-3xl">
            🏪
          </div>
          <h2 className="text-xl font-bold text-slate-800 mb-2">No Assigned Shops</h2>
          <p className="text-sm text-slate-600 mb-6">
            You currently have no customer shops assigned to your account. Please contact your manager or Admin to have customer stores assigned to your route.
          </p>
          <button
            type="button"
            className="secondary-button"
            onClick={() => (onNavigate ? onNavigate('overview') : window.location.reload())}
          >
            ← Return to Home
          </button>
        </div>
      </div>
    );
  }

  const assignedClusterObj =
    availableClusters.find((c) => Number(c.clusterId) === Number(currentShop?.clusterid || singleClusterId)) ||
    clusters.find((c) => Number(c.clusterId) === Number(currentShop?.clusterid || singleClusterId));
  const assignedClusterName =
    assignedClusterObj?.clusterName ||
    (Number(currentShop?.clusterid || singleClusterId) === 2 ? 'Thuthukudi' : 'Pollachi and Udumalapet');

  return (
    <div>
      {/* Page Heading */}
      <div className="page-heading">
        <div>
          <p className="eyebrow">ORDER MANAGEMENT · {assignedClusterName.toUpperCase()}</p>
          <h1>Create order</h1>
          <p>Select your assigned shop, capture visit location & photo, and enter wholesale item quantities.</p>
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
          <h2>Order & visit details</h2>
          <p className="section-help">
            {hasSingleAssignedCluster
              ? `Assigned cluster route: ${assignedClusterName} (${effectiveShops.length} assigned ${effectiveShops.length === 1 ? 'shop' : 'shops'}).`
              : 'Choose an assigned cluster route and customer store to start taking replenishment orders.'}
          </p>

          <div className="field-grid">
            {/* When agent has only one assigned cluster, hide Cluster selector and put Order Date in that space */}
            {hasSingleAssignedCluster ? (
              <div className="field-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <label htmlFor="orderDate">Order Date (IST · Asia/Kolkata) *</label>
                  <span className="order-date-ist-pill" data-testid="order-date-ist-display">
                    📅 {orderDate === todayIst ? 'Today (IST)' : 'Selected (IST)'}: {formatIstDateDisplay(orderDate)}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <input
                    id="orderDate"
                    type="date"
                    className="field"
                    value={orderDate}
                    onChange={(e) => setOrderDate(e.target.value)}
                  />
                  {orderDate !== todayIst && (
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => setOrderDate(todayIst)}
                      style={{ whiteSpace: 'nowrap', flexShrink: 0 }}
                    >
                      Today (IST)
                    </button>
                  )}
                </div>
                <small style={{ fontSize: '11.5px', color: '#0369a1', fontWeight: 600 }}>
                  🚚 Expected delivery date: {formatIstDateDisplay(expectedDeliveryDate)} (Order date + 1 day)
                </small>
              </div>
            ) : (
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
                  <option value="all">All assigned routes ({shops.length} stores)</option>
                  {availableClusters.map((c) => {
                    const cnt = shops.filter((s) => Number(s.clusterid) === Number(c.clusterId)).length;
                    return (
                      <option key={c.clusterId} value={String(c.clusterId)}>
                        {c.clusterName} ({cnt} stores)
                      </option>
                    );
                  })}
                </select>
              </div>
            )}

            {/* Customer Store Select */}
            <div className="field-group">
              <label htmlFor="shopSelect">Customer Store ({effectiveShops.length}) *</label>
              <select
                id="shopSelect"
                className="select"
                value={selectedShopId}
                onChange={(e) => setSelectedShopId(e.target.value)}
              >
                <option value="">Select a store</option>
                {effectiveShops.map((s) => (
                  <option key={s.shopid} value={s.shopid}>
                    [{formatShopId(s.shopid)}] {s.shopName} · {s.shopCategory || 'Retail'}
                  </option>
                ))}
              </select>
            </div>

            {/* If multiple clusters, show Order Date on the next row */}
            {!hasSingleAssignedCluster && (
              <div className="field-group full">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <label htmlFor="orderDate">Order Date (IST · Asia/Kolkata) *</label>
                  <span className="order-date-ist-pill" data-testid="order-date-ist-display">
                    📅 {orderDate === todayIst ? 'Today (IST)' : 'Selected (IST)'}: {formatIstDateDisplay(orderDate)}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <input
                    id="orderDate"
                    type="date"
                    className="field"
                    value={orderDate}
                    onChange={(e) => setOrderDate(e.target.value)}
                  />
                  {orderDate !== todayIst && (
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => setOrderDate(todayIst)}
                      style={{ whiteSpace: 'nowrap', flexShrink: 0 }}
                    >
                      Today (IST)
                    </button>
                  )}
                </div>
                <small style={{ fontSize: '11.5px', color: '#0369a1', fontWeight: 600 }}>
                  🚚 Expected delivery date: {formatIstDateDisplay(expectedDeliveryDate)} (Order date + 1 day)
                </small>
              </div>
            )}

            {/* Shop Category Field */}
            <div className="field-group">
              <label htmlFor="shopCategoryField">Shop Category</label>
              <input
                id="shopCategoryField"
                type="text"
                className="field"
                value={currentShop?.shopCategory || 'Retail'}
                readOnly
                style={{ background: '#f8fafc', fontWeight: 600, color: '#334155' }}
              />
            </div>

            {/* Location Field directly after Shop Category */}
            <div className="field-group">
              <label htmlFor="orderLocationField">Location (Latitude, Longitude)</label>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <input
                  id="orderLocationField"
                  type="text"
                  className="field"
                  readOnly
                  value={locationText}
                  placeholder="Tap here or 'Fetch GPS' to capture lat, lng"
                  onFocus={() => {
                    if (locationStatus === 'idle') {
                      requestForegroundLocation();
                    }
                  }}
                  onClick={() => {
                    if (locationStatus === 'idle' || locationStatus === 'denied' || locationStatus === 'unavailable') {
                      requestForegroundLocation();
                    }
                  }}
                  style={{ cursor: 'pointer', fontFamily: locationText ? 'monospace' : 'inherit' }}
                  aria-label="Foreground GPS Latitude and Longitude"
                />
                <button
                  type="button"
                  className="secondary-button"
                  onClick={requestForegroundLocation}
                  disabled={locationStatus === 'loading'}
                  style={{ whiteSpace: 'nowrap', padding: '0 12px', flexShrink: 0 }}
                  title="Request foreground GPS coordinates"
                >
                  {locationStatus === 'loading' ? '⏳ Locating...' : locationText ? '↻ Retry GPS' : '📍 Fetch GPS'}
                </button>
              </div>
              {locationStatus !== 'idle' && (
                <div
                  role="status"
                  style={{
                    fontSize: '11.5px',
                    fontWeight: 600,
                    padding: '4px 8px',
                    borderRadius: '6px',
                    marginTop: '2px',
                    background:
                      locationStatus === 'ok'
                        ? '#dcfce7'
                        : locationStatus === 'poor_accuracy'
                        ? '#fef3c7'
                        : locationStatus === 'loading'
                        ? '#e0f2fe'
                        : '#fee2e2',
                    color:
                      locationStatus === 'ok'
                        ? '#15803d'
                        : locationStatus === 'poor_accuracy'
                        ? '#b45309'
                        : locationStatus === 'loading'
                        ? '#0369a1'
                        : '#b91c1c'
                  }}
                >
                  {locationStatus === 'ok' && '✓ '}
                  {locationStatus === 'poor_accuracy' && '⚠️ '}
                  {(locationStatus === 'denied' || locationStatus === 'unavailable') && '⚠️ '}
                  {locationMessage}
                </div>
              )}
            </div>

            {/* In-App Camera Action for Order/Visit Record */}
            <div className="field-group full">
              <label>Order / Visit Photo Capture</label>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: '10px',
                  padding: '12px 14px',
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '10px'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                  {visitPhoto ? (
                    <img
                      src={visitPhoto}
                      alt="Captured shop visit"
                      style={{
                        width: '64px',
                        height: '64px',
                        objectFit: 'cover',
                        borderRadius: '8px',
                        border: '2px solid #0284c7'
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        width: '52px',
                        height: '52px',
                        borderRadius: '8px',
                        background: '#e0f2fe',
                        color: '#0284c7',
                        display: 'grid',
                        placeItems: 'center',
                        fontSize: '22px'
                      }}
                    >
                      📷
                    </div>
                  )}
                  <div>
                    <strong style={{ display: 'block', fontSize: '13px', color: '#0f172a' }}>
                      {visitPhoto ? 'Visit Photo Attached' : 'Capture Shop Visit Photo'}
                    </strong>
                    <span style={{ fontSize: '12px', color: '#475569' }}>
                      {visitPhoto
                        ? isOffline || visitPhotoStatus === 'waiting_offline'
                          ? '⏳ Waiting to sync offline (saved locally with order)'
                          : visitPhotoStatus === 'synced'
                          ? '✓ Photo saved & synced to server'
                          : '✓ Photo ready — will save & sync when order is placed'
                        : 'Take a photo using the in-app camera to attach to this order/visit record.'}
                    </span>
                    {cameraError && (
                      <div style={{ fontSize: '11.5px', color: '#b91c1c', marginTop: '3px', fontWeight: 600 }}>
                        ⚠️ {cameraError}
                      </div>
                    )}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={handleFilePhotoSelected}
                    style={{ display: 'none' }}
                    aria-label="Capture or attach visit photo"
                  />
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={handleOpenCamera}
                    style={{ borderColor: '#0284c7', color: '#0284c7', fontWeight: 700 }}
                  >
                    📷 {visitPhoto ? 'Retake Camera Photo' : 'Take Camera Photo'}
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => fileInputRef.current && fileInputRef.current.click()}
                  >
                    📁 Attach Photo
                  </button>
                  {visitPhoto && (
                    <button
                      type="button"
                      className="quiet-button"
                      onClick={() => {
                        setVisitPhoto(null);
                        setVisitPhotoStatus(null);
                      }}
                      style={{ color: '#b91c1c', fontWeight: 600 }}
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* In-App Live Camera Modal */}
          {cameraOpen && (
            <div
              role="dialog"
              aria-modal="true"
              aria-label="In-app camera capture"
              style={{
                position: 'fixed',
                inset: 0,
                zIndex: 999,
                background: 'rgba(15, 23, 42, 0.82)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '16px'
              }}
            >
              <div
                style={{
                  background: '#ffffff',
                  borderRadius: '14px',
                  maxWidth: '480px',
                  width: '100%',
                  padding: '16px',
                  boxShadow: '0 20px 50px rgba(0,0,0,0.35)'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  <strong style={{ fontSize: '15px', color: '#0f172a' }}>📷 In-App Visit Camera</strong>
                  <button
                    type="button"
                    className="quiet-button"
                    onClick={() => {
                      stopCameraStream();
                      setCameraOpen(false);
                    }}
                  >
                    ✕ Close
                  </button>
                </div>
                <div style={{ background: '#000', borderRadius: '10px', overflow: 'hidden', aspectRatio: '4/3' }}>
                  <video
                    ref={videoRef}
                    playsInline
                    muted
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '14px' }}>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => {
                      stopCameraStream();
                      setCameraOpen(false);
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="primary-button"
                    onClick={handleCaptureVideoFrame}
                  >
                    📸 Capture & Attach Photo
                  </button>
                </div>
              </div>
            </div>
          )}

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
                  {loadingHistory && (
                    <div className="history-status-state loading" role="status">
                      <div className="history-spinner" aria-hidden="true" />
                      <span>Loading recent orders from database...</span>
                    </div>
                  )}

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

                  {!loadingHistory && !historyError && historyOrders.length > 0 && (
                    <div className="history-orders-list">
                      {historyOrders.map((order) => {
                        const statusLower = (order.status || 'in progress').toLowerCase();
                        const statusClass = statusLower === 'delivered' ? 'delivered' : statusLower === 'cancelled' ? 'cancelled' : 'in-progress';
                        const expDeliv = order.expectedDeliveryDate || addDays(String(order.date || '').slice(0, 10), 1);

                        return (
                          <div key={order.orderId || order.serialNo} className="history-order-card">
                            <div className="history-order-top">
                              <div className="history-order-meta">
                                <span className="history-order-badge">
                                  #{order.serialNo || order.orderId}
                                </span>
                                <span className="history-order-date">
                                  📅 Ordered: {formatOrderDate(order.date)}
                                </span>
                                {expDeliv && (
                                  <span className="history-order-date" style={{ color: '#0369a1', fontWeight: 600 }}>
                                    🚚 Expected delivery: {formatOrderDate(expDeliv)}
                                  </span>
                                )}
                                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                  <span className={`status ${statusClass}`}>
                                    {order.status || 'In progress'}
                                  </span>
                                  {(() => {
                                    const pay = getPaymentSummary(order);
                                    return (
                                      <span style={{
                                        fontSize: '11px',
                                        fontWeight: 700,
                                        padding: '1px 8px',
                                        borderRadius: '999px',
                                        background: pay.paymentStatus === 'Collected' ? '#dcfce7' : (pay.paymentStatus === 'Partially collected' ? '#fef3c7' : '#f1f5f9'),
                                        color: pay.paymentStatus === 'Collected' ? '#15803d' : (pay.paymentStatus === 'Partially collected' ? '#b45309' : '#475569')
                                      }}>
                                        {pay.paymentStatus}
                                      </span>
                                    );
                                  })()}
                                </div>
                              </div>
                              <div className="history-order-total-block" style={{ textAlign: 'right' }}>
                                <span className="history-total-label">Order total:</span>
                                <strong className="history-total-value">{money(order.total)}</strong>
                                {(() => {
                                  const pay = getPaymentSummary(order);
                                  return (
                                    <div style={{ fontSize: '11px', color: '#475569', fontWeight: 600, marginTop: '2px' }}>
                                      {pay.summaryText}
                                    </div>
                                  );
                                })()}
                              </div>
                            </div>

                            <div className="history-items-table-wrapper">
                              <table className="history-items-table responsive-stack-table">
                                <thead>
                                  <tr>
                                    <th style={{ width: '36%' }}>Item Description</th>
                                    <th style={{ width: '18%' }}>Ordered Qty</th>
                                    <th style={{ width: '26%' }}>Catalog / Approved Price</th>
                                    <th style={{ width: '20%', textAlign: 'right' }}>Line Total</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {(order.items || []).map((it, idx) => {
                                    const unitLabel = normalizeUnit(it.unit || 'kg');
                                    const hasReq = it.requestedPrice !== null && it.requestedPrice !== undefined && Math.abs(Number(it.requestedPrice) - Number(it.unitPrice)) > 0.001;
                                    return (
                                      <tr key={it.id || idx}>
                                        <td data-label="Item Description">
                                          <b>{it.name}</b>
                                        </td>
                                        <td data-label="Ordered Qty">
                                          <span className="qty-highlight">
                                            {it.qty} {unitLabel}
                                          </span>
                                        </td>
                                        <td data-label="Catalog / Approved Price">
                                          <span className="unit-price-pill">
                                            {money(it.unitPrice)} <small className="unit-type">/{unitLabel}</small>
                                          </span>
                                          {hasReq && (
                                            <div style={{
                                              fontSize: '11px',
                                              color: it.priceRequestStatus === 'approved' ? '#15803d' : it.priceRequestStatus === 'rejected' ? '#b91c1c' : '#92400e',
                                              marginTop: '2px',
                                              fontWeight: 600
                                            }}>
                                              Catalog: {money(it.catalogPrice || it.unitPrice)}/{unitLabel} · Requested: {money(it.requestedPrice)}/{unitLabel} ·{' '}
                                              {it.priceRequestStatus === 'approved'
                                                ? '✓ Approved'
                                                : it.priceRequestStatus === 'rejected'
                                                ? '✕ Rejected'
                                                : '⏳ Pending approval'}
                                            </div>
                                          )}
                                        </td>
                                        <td className="row-total" data-label="Line Total" style={{ textAlign: 'right' }}>
                                          <b>{money(it.lineTotal)}</b>
                                        </td>
                                      </tr>
                                    );
                                  })}
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

          {/* Items Section: Tappable Item Catalog with Compact Quantity & Customer-Price Entry (Zero Horizontal Scroll) */}
          <div className="items-head">
            <div>
              <strong>Order items catalog</strong>
              <span style={{ display: 'block', marginTop: '2px' }}>
                Tap any item to open quantity &amp; customer-price entry · Line totals use catalog price
              </span>
            </div>
            <span className="catalog-count-pill">
              {activeItems.length}/{orderRows.length} selected
            </span>
          </div>

          <div className="order-catalog-list" role="list" aria-label="Order items catalog" data-testid="order-catalog-list">
            {orderRows.map((r, i) => {
              const unitLabel = normalizeUnit(r.unitType);
              const catalogPrice = Number(r.price) || 0;
              const qtyVal = Number(r.qty) || 0;
              const hasCustomReq =
                r.requestedPrice !== undefined &&
                r.requestedPrice !== null &&
                r.requestedPrice !== '' &&
                !isNaN(parseFloat(r.requestedPrice)) &&
                Math.abs(parseFloat(r.requestedPrice) - catalogPrice) > 0.001;
              // Line total strictly uses catalogPrice (customer-requested price does NOT alter catalog price or line total)
              const rowTotal = qtyVal * catalogPrice;
              const isExpanded = expandedItemId === r.itemid;

              return (
                <div
                  key={r.itemid || i}
                  role="listitem"
                  data-testid={`catalog-card-${r.itemid}`}
                  className={`order-catalog-card ${isExpanded ? 'is-expanded' : ''} ${qtyVal > 0 ? 'has-qty' : ''}`}
                >
                  {/* Tappable Item Header */}
                  <button
                    type="button"
                    className="order-catalog-card-trigger"
                    data-testid={`catalog-trigger-${r.itemid}`}
                    onClick={() => setExpandedItemId((prev) => (prev === r.itemid ? null : r.itemid))}
                    aria-expanded={isExpanded}
                    aria-controls={`catalog-entry-${r.itemid}`}
                  >
                    <div className="order-catalog-item-main">
                      <img
                        src={r.itemimage}
                        alt=""
                        className="order-catalog-item-thumb"
                        onError={(e) => {
                          e.currentTarget.onerror = null;
                          e.currentTarget.src = '/lincart_flashicon.png';
                        }}
                      />
                      <div className="order-catalog-item-titles">
                        <div className="order-catalog-item-name-row">
                          <strong className="order-catalog-item-name">{r.itemName}</strong>
                          <span className="order-catalog-unit-badge">{unitLabel}</span>
                        </div>
                        <div className="order-catalog-price-sub">
                          <span>Catalog price: <b>{money(catalogPrice)}/{unitLabel}</b></span>
                          {hasCustomReq && (
                            <span className="order-catalog-req-chip">
                              ⏳ Req: {money(r.requestedPrice)}/{unitLabel} (Pending)
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="order-catalog-item-summary">
                      {qtyVal > 0 ? (
                        <div className="order-catalog-active-metrics">
                          <span className="order-catalog-qty-pill">
                            {qtyVal} {unitLabel}
                          </span>
                          <span className="order-catalog-linetotal-pill">
                            {money(rowTotal)}
                          </span>
                        </div>
                      ) : (
                        <span className="order-catalog-tap-hint">
                          {isExpanded ? 'Close ▲' : '＋ Tap to enter'}
                        </span>
                      )}
                      {qtyVal > 0 && (
                        <span className="order-catalog-chevron" aria-hidden="true">
                          {isExpanded ? '▲' : '✎'}
                        </span>
                      )}
                    </div>
                  </button>

                  {/* Compact Quantity & Customer-Price Entry Drawer (Shown when item is tapped) */}
                  {isExpanded && (
                    <div
                      id={`catalog-entry-${r.itemid}`}
                      className="order-catalog-entry-panel"
                      role="region"
                      aria-label={`Quantity and price entry for ${r.itemName}`}
                    >
                      {/* Clearly Separated 4-Box Metric Strip */}
                      <div className="order-catalog-separated-strip">
                        <div className="separated-metric-box">
                          <span className="separated-metric-label">Catalog Price</span>
                          <strong className="separated-metric-value">{money(catalogPrice)}/{unitLabel}</strong>
                        </div>
                        <div className="separated-metric-box">
                          <span className="separated-metric-label">Requested Price</span>
                          <strong className={`separated-metric-value ${hasCustomReq ? 'is-pending-req' : 'is-muted'}`}>
                            {hasCustomReq ? `${money(r.requestedPrice)}/${unitLabel}` : 'Not requested'}
                          </strong>
                        </div>
                        <div className="separated-metric-box">
                          <span className="separated-metric-label">Quantity</span>
                          <strong className="separated-metric-value">{qtyVal} {unitLabel}</strong>
                        </div>
                        <div className="separated-metric-box is-total-box">
                          <span className="separated-metric-label">Line Total (Catalog)</span>
                          <strong className="separated-metric-value">{money(rowTotal)}</strong>
                        </div>
                      </div>

                      <div className="order-catalog-inputs-grid">
                        {/* Quantity Entry with Large Touch Targets */}
                        <div className="order-catalog-input-group">
                          <label htmlFor={`qty-input-${r.itemid}`}>
                            Quantity ({unitLabel})
                          </label>
                          <div className="qty-stepper-control">
                            <button
                              type="button"
                              className="qty-stepper-btn"
                              onClick={() => handleQtyChange(i, Math.max(0, qtyVal - 1))}
                              aria-label={`Decrease ${r.itemName} quantity`}
                            >
                              −
                            </button>
                            <input
                              id={`qty-input-${r.itemid}`}
                              type="number"
                              inputMode="decimal"
                              min="0"
                              step="1"
                              className="qty-stepper-input"
                              value={r.qty === 0 ? '' : r.qty}
                              onChange={(e) => handleQtyChange(i, e.target.value)}
                              placeholder="0"
                              aria-label={`${r.itemName} quantity in ${unitLabel}`}
                            />
                            <button
                              type="button"
                              className="qty-stepper-btn"
                              onClick={() => handleQtyChange(i, qtyVal + 1)}
                              aria-label={`Increase ${r.itemName} quantity`}
                            >
                              ＋
                            </button>
                          </div>
                          <div className="qty-quick-chips">
                            {[5, 10, 25, 50].map((preset) => (
                              <button
                                key={preset}
                                type="button"
                                className="qty-quick-chip"
                                onClick={() => handleQtyChange(i, qtyVal + preset)}
                              >
                                +{preset} {unitLabel}
                              </button>
                            ))}
                            {qtyVal > 0 && (
                              <button
                                type="button"
                                className="qty-quick-chip is-clear"
                                onClick={() => handleQtyChange(i, 0)}
                              >
                                Clear (0)
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Customer-Requested Price Entry (Separated & Pending Approval Only) */}
                        <div className="order-catalog-input-group">
                          <label htmlFor={`req-price-input-${r.itemid}`}>
                            Requested Customer Price (₹/{unitLabel}) <span style={{ fontWeight: 500, color: '#64748b' }}>· Optional</span>
                          </label>
                          <input
                            id={`req-price-input-${r.itemid}`}
                            type="number"
                            inputMode="decimal"
                            min="0"
                            step="0.5"
                            className="field req-price-input"
                            value={r.requestedPrice !== undefined ? r.requestedPrice : ''}
                            onChange={(e) => handleRequestedPriceChange(i, e.target.value)}
                            placeholder={`Catalog rate is ₹${catalogPrice}/${unitLabel} (enter to request approval)`}
                            aria-label={`${r.itemName} customer-requested price`}
                          />
                          <small className="req-price-help-note">
                            Entering a customer price creates a <b>pending price request</b>. Line total ({money(rowTotal)}) stays at catalog price ({money(catalogPrice)}/{unitLabel}) until approved.
                          </small>

                          {hasCustomReq && (
                            <div className="req-price-pending-box">
                              <div className="req-price-pending-badge">
                                <span>Catalog: <b>{money(catalogPrice)}/{unitLabel}</b></span>
                                <span>·</span>
                                <span>Requested: <b>{money(r.requestedPrice)}/{unitLabel}</b></span>
                                <span>·</span>
                                <span>⏳ Pending single approval</span>
                              </div>
                              <input
                                type="text"
                                className="field req-reason-input"
                                placeholder="Reason for customer price request (optional)..."
                                value={r.requestReason || ''}
                                onChange={(e) => handleRequestReasonChange(i, e.target.value)}
                                aria-label="Price request reason"
                              />
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="order-catalog-entry-footer">
                        <button
                          type="button"
                          className="quiet-button"
                          onClick={() => handleRemoveItem(i)}
                          style={{ color: '#b91c1c', fontWeight: 600 }}
                        >
                          Remove item
                        </button>
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => setExpandedItemId(null)}
                          style={{ fontWeight: 700, borderColor: '#0284c7', color: '#0284c7' }}
                        >
                          ✓ Done with {r.itemName}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
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
          <p className="section-help">
            Live order breakdown using catalog prices. Customer-requested prices are recorded separately for approval.
          </p>

          <div className="summary-lines">
            <div className="summary-line">
              <span>Selected store</span>
              <b>{currentShop?.shopName || '—'}</b>
            </div>
            <div className="summary-line">
              <span>Shop category</span>
              <b>{currentShop?.shopCategory || 'Retail'}</b>
            </div>
            <div className="summary-line">
              <span>Cluster route</span>
              <b>{assignedClusterName}</b>
            </div>
            <div className="summary-line">
              <span>Order date (IST)</span>
              <b>{formatIstDateDisplay(orderDate)} ({orderDate})</b>
            </div>
            <div className="summary-line">
              <span>Expected delivery</span>
              <b style={{ color: '#0369a1' }}>{formatIstDateDisplay(expectedDeliveryDate)}</b>
            </div>
            <div className="summary-line">
              <span>Visit GPS location</span>
              <b style={{ fontFamily: locationText ? 'monospace' : 'inherit', fontSize: '11.5px' }}>
                {locationText || 'Not captured yet'}
              </b>
            </div>
            <div className="summary-line">
              <span>Visit photo status</span>
              <b>
                {visitPhoto
                  ? isOffline || visitPhotoStatus === 'waiting_offline'
                    ? '⏳ Waiting to sync offline'
                    : visitPhotoStatus === 'synced'
                    ? '✓ Saved & synced'
                    : '📷 Attached (ready)'
                  : 'None attached'}
              </b>
            </div>
          </div>

          {/* Ordered Items List (Each item's description and ordered quantity with unit 'kg') */}
          <div style={{ marginTop: '16px', paddingTop: '12px', borderTop: '1px solid #edf0f1' }}>
            <strong style={{ display: 'block', fontSize: '12.5px', color: '#0f172a', marginBottom: '8px' }}>
              Ordered items ({activeItems.length} {activeItems.length === 1 ? 'item' : 'items'} · {totalQuantityKg} kg)
            </strong>

            {activeItems.length === 0 ? (
              <div
                style={{
                  padding: '12px',
                  background: '#f8fafc',
                  border: '1px dashed #cbd5e1',
                  borderRadius: '8px',
                  fontSize: '12px',
                  color: '#64748b'
                }}
              >
                {historyOrders.length > 0 || lastSavedOrder ? (
                  <div>
                    <strong style={{ display: 'block', color: '#334155', marginBottom: '6px' }}>
                      Latest saved order ({(lastSavedOrder || historyOrders[0]).orderId || `#${historyOrders[0]?.serialNo}`}):
                    </strong>
                    {((lastSavedOrder ? lastSavedOrder.orderList : historyOrders[0]?.items) || []).map((it, idx) => {
                      const desc = it.itemName || it.name || `Item #${it.itemid || it.itemId}`;
                      const unit = normalizeUnit(it.unitType || it.unit || 'kg');
                      return (
                        <div
                          key={idx}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            padding: '4px 0',
                            borderBottom: '1px solid #f1f5f9',
                            color: '#1e293b'
                          }}
                        >
                          <span>{desc}</span>
                          <b>
                            {it.qty} {unit}
                          </b>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  'Enter a quantity above to see each item description, quantity (kg), and catalog line total.'
                )}
              </div>
            ) : (
              <div style={{ display: 'grid', gap: '8px' }}>
                {activeItems.map((r) => {
                  const unitLabel = normalizeUnit(r.unitType);
                  const catPrice = Number(r.price) || 0;
                  const lineTotal = Number(r.qty || 0) * catPrice;
                  const hasReq =
                    r.requestedPrice !== undefined &&
                    r.requestedPrice !== null &&
                    r.requestedPrice !== '' &&
                    !isNaN(parseFloat(r.requestedPrice)) &&
                    Math.abs(parseFloat(r.requestedPrice) - catPrice) > 0.001;
                  return (
                    <div
                      key={r.itemid}
                      style={{
                        padding: '8px 10px',
                        background: '#f8fafc',
                        border: '1px solid #e2e8f0',
                        borderRadius: '8px',
                        fontSize: '12px'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontWeight: 700, color: '#0f172a' }}>
                        <span>{r.itemName}</span>
                        <span>
                          {r.qty} {unitLabel} × {money(catPrice)} = {money(lineTotal)}
                        </span>
                      </div>
                      {hasReq && (
                        <div style={{ marginTop: '4px', fontSize: '11.5px', color: '#92400e', fontWeight: 600 }}>
                          Catalog: {money(catPrice)}/{unitLabel} · Requested: {money(r.requestedPrice)}/{unitLabel} (⏳ Pending approval)
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="summary-lines" style={{ marginTop: '14px' }}>
            <div className="summary-line">
              <span>Total quantity</span>
              <b>{totalQuantityKg} kg</b>
            </div>
            <div className="summary-line">
              <span>Catalog order subtotal</span>
              <b>{money(subtotal)}</b>
            </div>
            <div className="summary-total">
              <span>Total order value (Catalog)</span>
              <strong>{money(subtotal)}</strong>
            </div>
          </div>

          {hasPriceReq && (
            <div style={{
              background: '#fffbeb',
              border: '1px solid #fde68a',
              borderRadius: '8px',
              padding: '10px 12px',
              margin: '12px 0',
              color: '#92400e',
              fontSize: '12px',
              lineHeight: 1.45
            }}>
              ⏳ <b>Price Request Recorded for Approval:</b> Catalog prices and order total ({money(subtotal)}) remain unchanged when placing the order. Requested customer rates will be applied only after Admin/Sales Manager approval.
            </div>
          )}

          <button
            type="button"
            className="primary-button"
            disabled={submitting || activeItems.length === 0 || !currentShop}
            onClick={handleSubmitOrder}
          >
            {submitting ? 'Placing order...' : 'Place order →'}
          </button>

          <p className="summary-note">
            Orders placed today default to tomorrow ({formatOrderDate(expectedDeliveryDate)}) as their expected delivery date.
          </p>
        </aside>
      </div>
    </div>
  );
}
