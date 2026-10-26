import React, { useState, useEffect, useRef, useMemo } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { api } from '../api';
import { planRoadDeliveryRoute } from '../routing';
import { getGoogleMapsUrl } from '../utils';
import { createMapTileLayer, getMapTileConfig } from '../mapConfig';

const I18N = {
  en: {
    appTitle: 'Delivery Route',
    portalSubtitle: 'LineCart Logistics Route Fulfillment',
    langToggle: 'தமிழ்',
    back: 'Back',
    laptopView: 'Laptop view',
    mobilePreview: 'Mobile preview',
    signOut: 'Sign out',
    chooseCluster: 'Delivery Area',
    allClusters: 'All Assigned Areas',
    stops: 'Stops',
    pending: 'Pending',
    delivered: 'Delivered',
    issues: 'Issues',
    startRoute: 'Start Route',
    routeActive: 'Route Active',
    optimizingRoute: 'Optimizing road-distance route...',
    stopsInOrder: 'Assigned Delivery Stops',
    stop: 'Stop',
    markPickedUp: 'Mark as Picked Up',
    markDelivered: 'Mark as Delivered',
    couldNotDeliver: 'Could Not Deliver',
    callShop: 'Call Shop',
    openMap: 'Open Maps',
    confirmTitle: 'Confirm Order Update',
    confirmQuestion: 'Are you sure you want to update this order?',
    confirmAction: 'Confirm Update',
    cancel: 'Cancel',
    reasonTitle: 'Why could this not be delivered?',
    selectReason: 'Select a reason below:',
    reasons: {
      closed: 'Shop Closed',
      ownerUnavailable: 'Owner Not Available',
      rejected: 'Order Cancelled / Rejected',
      wrongAddress: 'Wrong Address / Location Not Found'
    },
    statusPending: 'Awaiting Pickup',
    statusInProgress: 'Ready to Pick Up',
    statusPickedUp: 'Picked Up (On the Way)',
    statusDelivered: 'Delivered Successfully',
    statusFailed: 'Delivery Issue',
    completedBadge: 'Completed',
    failedBadge: 'Not Delivered',
    nextStopBadge: 'NEXT STOP',
    noOrders: 'No delivery orders assigned to you in this area.',
    refresh: 'Refresh Stops',
    logout: 'Sign Out',
    speakBtn: 'Read aloud',
    showMap: 'Show Map',
    hideMap: 'Hide Map',
    disclaimerPrefix: 'Route note:',
    updating: 'Updating status...',
    updateSuccess: 'Order status updated successfully!',
    updateFailed: 'Failed to update order status. Please retry.',
    sharedAddress: 'Shared Location',
    sharedAddressBadge: 'Shared address with',
    gpsMissing: 'Location pin unavailable (Address only)',
    openMapByAddress: 'Open Maps (by Address)',
    noAddressOrGps: 'No location on file',
    unmappedNotice: 'stop(s) have missing GPS coordinates and are routed by address.'
  },
  ta: {
    appTitle: 'டெலிவரி வழித்தடம்',
    portalSubtitle: 'லைன்கார்ட் டெலிவரி சேவை',
    langToggle: 'English',
    back: 'பின்செல்',
    laptopView: 'லேப்டாப் பார்வை',
    mobilePreview: 'மொபைல் பார்வை',
    signOut: 'வெளியேறு',
    chooseCluster: 'டெலிவரி பகுதி',
    allClusters: 'அனைத்து பகுதிகள்',
    stops: 'நிறுத்தங்கள்',
    pending: 'மீதம்',
    delivered: 'முடிந்தது',
    issues: 'சிக்கல்',
    startRoute: 'வழியைத் தொடங்கு',
    routeActive: 'பயணம் செயலில் உள்ளது',
    optimizingRoute: 'சாலை வழியை கணக்கிடுகிறது...',
    stopsInOrder: 'டெலிவரி நிறுத்தங்கள்',
    stop: 'நிறுத்தம்',
    markPickedUp: 'பொருட்கள் எடுத்தாச்சு',
    markDelivered: 'டெலிவரி முடிந்தது',
    couldNotDeliver: 'டெலிவரி செய்ய முடியவில்லை',
    callShop: 'கடைக்கு அழை',
    openMap: 'வரைபடம்',
    confirmTitle: 'செயலை உறுதிப்படுத்துங்கள்',
    confirmQuestion: 'இந்த ஆர்டரை மாற்ற விரும்புகிறீர்களா?',
    confirmAction: 'உறுதிப்படுத்து',
    cancel: 'ரத்துசெய்',
    reasonTitle: 'டெலிவரி செய்ய முடியாததற்கான காரணம் என்ன?',
    selectReason: 'காரணத்தைத் தேர்ந்தெடுக்கவும்:',
    reasons: {
      closed: 'கடை மூடப்பட்டுள்ளது',
      ownerUnavailable: 'உரிமையாளர் இல்லை',
      rejected: 'ஆர்டர் ரத்து செய்யப்பட்டது',
      wrongAddress: 'தவறான முகவரி / இடம் கிடைக்கவில்லை'
    },
    statusPending: 'எடுக்க காத்திருக்கிறது',
    statusInProgress: 'எடுக்க தயார்',
    statusPickedUp: 'எடுக்கப்பட்டது (வழியில்)',
    statusDelivered: 'டெலிவரி வெற்றிகரமாக முடிந்தது',
    statusFailed: 'டெலிவரி தோல்வி',
    completedBadge: 'முடிந்தது',
    failedBadge: 'டெலிவரி ஆகவில்லை',
    nextStopBadge: 'அடுத்த நிறுத்தம்',
    noOrders: 'இந்த பகுதியில் உங்களுக்கு எந்த டெலிவரி ஆர்டரும் இல்லை.',
    refresh: 'புதுப்பி',
    logout: 'வெளியேறு',
    speakBtn: 'வாசித்து காட்டு',
    showMap: 'வரைபடத்தைக் காட்டு',
    hideMap: 'வரைபடத்தை மறை',
    disclaimerPrefix: 'வழிக் குறிப்பு:',
    updating: 'நிலை மாற்றப்படுகிறது...',
    updateSuccess: 'ஆர்டர் நிலை வெற்றிகரமாக மாற்றப்பட்டது!',
    updateFailed: 'மாற்றுவதில் பிழை ஏற்பட்டது. மீண்டும் முயற்சிக்கவும்.',
    sharedAddress: 'பகிர்ந்த இடம்',
    sharedAddressBadge: 'பகிர்ந்த முகவரி:',
    gpsMissing: 'ஜிபிஎஸ் குறி இல்லை (முகவரி மட்டும்)',
    openMapByAddress: 'வரைபடம் (முகவரி வழியாக)',
    noAddressOrGps: 'முகவரி அல்லது ஜிபிஎஸ் இல்லை',
    unmappedNotice: 'நிறுத்தங்களுக்கு ஜிபிஎஸ் குறி இல்லை, முகவரியால் வழிநடத்தப்படுகிறது.'
  }
};

export default function DeliveryRouteScreen({
  user,
  onLogout,
  onBack,
  isMobilePreview = false,
  onTogglePreview,
  showToast
}) {
  const [lang, setLang] = useState('en'); // 'en' | 'ta'
  const t = I18N[lang];

  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [orders, setOrders] = useState([]);
  const [clusters, setClusters] = useState([]);
  const [selectedClusterId, setSelectedClusterId] = useState('all');

  // Route optimization state
  const [routeActive, setRouteActive] = useState(false);
  const [routeInfo, setRouteInfo] = useState(null);
  const [optimizing, setOptimizing] = useState(false);
  const [showMap, setShowMap] = useState(true);

  // Modal interaction states
  const [confirmModal, setConfirmModal] = useState(null); // { order, targetStatus, title, text }
  const [failModal, setFailModal] = useState(null); // { order }
  const [selectedReason, setSelectedReason] = useState('Shop Closed');
  const [customNote, setCustomNote] = useState('');

  // Map DOM and Leaflet references
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersLayerRef = useRef(null);
  const polylineLayerRef = useRef(null);

  // Spoken voice assistant using Web Speech API
  const speak = (text) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = lang === 'ta' ? 'ta-IN' : 'en-IN';
      utterance.rate = 0.95;
      window.speechSynthesis.speak(utterance);
    } catch (e) {
      console.warn('SpeechSynthesis error:', e);
    }
  };

  // Load orders assigned to this delivery agent
  const loadAssignedOrders = async () => {
    setLoading(true);
    try {
      const res = await api.getDeliveryOrders(selectedClusterId === 'all' ? undefined : selectedClusterId);
      if (res && res.status === 200) {
        setOrders(res.orders || []);
        if (res.clusters && res.clusters.length > 0) {
          setClusters(res.clusters);
          if (res.clusters.length === 1 && selectedClusterId === 'all') {
            setSelectedClusterId(String(res.clusters[0].clusterId));
          }
        }
      } else {
        if (showToast) showToast(res?.message || 'Error loading deliveries');
      }
    } catch (err) {
      console.error('Failed to load delivery orders:', err);
      if (showToast) showToast('Network error loading deliveries');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAssignedOrders();
  }, [selectedClusterId]);

  // Filtered stops for current cluster
  const currentStops = useMemo(() => {
    if (selectedClusterId === 'all') return orders;
    return orders.filter(o => String(o.clusterId) === String(selectedClusterId));
  }, [orders, selectedClusterId]);

  // Cluster counts
  const kpis = useMemo(() => {
    let pending = 0;
    let delivered = 0;
    let issues = 0;
    currentStops.forEach(o => {
      const s = (o.status || '').toLowerCase();
      if (s === 'delivered') delivered++;
      else if (s === 'could not deliver' || s === 'cancelled') issues++;
      else pending++;
    });
    return { total: currentStops.length, pending, delivered, issues };
  }, [currentStops]);

  // Plan road route when "Start route" is triggered
  const handleStartRoute = async () => {
    setOptimizing(true);
    try {
      const planned = await planRoadDeliveryRoute(currentStops);
      setRouteInfo(planned);
      setRouteActive(true);

      const text = lang === 'ta'
        ? `டெலிவரி வழி தயார். மொத்தம் ${planned.orderedStops.length} நிறுத்தங்கள்.`
        : `Route active. ${planned.orderedStops.length} stops arranged in road routing order.`;
      speak(text);

      if (showToast) {
        showToast(lang === 'ta' ? 'டெலிவரி வழி தொடங்கியது!' : 'Delivery route started!');
      }
    } catch (err) {
      console.error('Route optimization error:', err);
    } finally {
      setOptimizing(false);
    }
  };

  // The active sequence of stops: either ordered from route optimization or natural list
  const activeStops = useMemo(() => {
    if (routeInfo && routeInfo.orderedStops && routeInfo.orderedStops.length > 0) {
      return routeInfo.orderedStops.map(rs => {
        const fresh = orders.find(o => String(o.id) === String(rs.id));
        return fresh || rs;
      });
    }
    return currentStops;
  }, [routeInfo, currentStops, orders]);

  // Identify next incomplete stop in sequence
  const nextIncompleteIndex = useMemo(() => {
    return activeStops.findIndex(s => {
      const st = (s.status || '').toLowerCase();
      return st !== 'delivered' && st !== 'could not deliver' && st !== 'cancelled';
    });
  }, [activeStops]);

  // Validation helper for GPS coordinates
  const isValidCoord = (lat, lng) => {
    const nLat = parseFloat(lat);
    const nLng = parseFloat(lng);
    return !isNaN(nLat) && !isNaN(nLng) && (nLat !== 0 || nLng !== 0);
  };

  // Grouping lookup for stops sharing the same coordinates
  const coordGroupLookup = useMemo(() => {
    const map = new Map();
    activeStops.forEach((stop, index) => {
      if (isValidCoord(stop.latitude, stop.longitude)) {
        const key = `${parseFloat(stop.latitude).toFixed(5)},${parseFloat(stop.longitude).toFixed(5)}`;
        if (!map.has(key)) map.set(key, []);
        map.get(key).push({ stop, index });
      }
    });
    return map;
  }, [activeStops]);

  // Counts of valid vs missing coordinates
  const { validStopsCount, missingStopsCount } = useMemo(() => {
    let valid = 0;
    let missing = 0;
    activeStops.forEach(s => {
      if (isValidCoord(s.latitude, s.longitude)) valid++;
      else missing++;
    });
    return { validStopsCount: valid, missingStopsCount: missing };
  }, [activeStops]);

  // Color & Icon mapping for delivery statuses
  const getStatusColor = (status) => {
    const st = (status || '').toLowerCase();
    if (st === 'delivered') return '#10b981'; // emerald-500
    if (st === 'could not deliver' || st === 'cancelled') return '#ef4444'; // rose-500
    if (st === 'picked up') return '#3b82f6'; // blue-500
    return '#f59e0b'; // amber-500
  };

  const getStatusIcon = (status) => {
    const st = (status || '').toLowerCase();
    if (st === 'delivered') return '✅';
    if (st === 'could not deliver' || st === 'cancelled') return '❌';
    if (st === 'picked up') return '🚚';
    return '📦';
  };

  // Ensure map is visible on laptop view
  useEffect(() => {
    if (!isMobilePreview) {
      setShowMap(true);
    }
  }, [isMobilePreview]);

  // 1. Initialize Leaflet Map Instance once container is mounted
  useEffect(() => {
    if (!showMap || !mapContainerRef.current) return;

    if (!mapInstanceRef.current) {
      if (mapContainerRef.current._leaflet_id) {
        delete mapContainerRef.current._leaflet_id;
      }

      const defaultCenter = [10.5758, 77.2415]; // Cluster 1 center default
      const map = L.map(mapContainerRef.current, {
        center: defaultCenter,
        zoom: 13,
        zoomControl: true,
        scrollWheelZoom: true
      });

      // Legitimate, policy-compliant tile layer with caching & fallback
      const tileLayer = createMapTileLayer(L);
      tileLayer.addTo(map);

      markersLayerRef.current = L.layerGroup().addTo(map);
      polylineLayerRef.current = L.layerGroup().addTo(map);
      mapInstanceRef.current = map;

      // Force dimension calculation once rendered in layout
      requestAnimationFrame(() => {
        map.invalidateSize();
      });
      setTimeout(() => {
        map.invalidateSize();
      }, 150);
    }

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [showMap]);

  // 2. Resize Leaflet map whenever preview mode or visibility changes
  useEffect(() => {
    if (mapInstanceRef.current) {
      const timer = setTimeout(() => {
        mapInstanceRef.current?.invalidateSize();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [isMobilePreview, showMap]);

  // 3. Render markers, overlapping pin fan-out, leader lines, and route polyline
  useEffect(() => {
    if (!showMap || !mapInstanceRef.current || !markersLayerRef.current || !polylineLayerRef.current) return;

    const map = mapInstanceRef.current;
    markersLayerRef.current.clearLayers();
    polylineLayerRef.current.clearLayers();

    // Collect valid mapped stops
    const validMappedStops = [];
    activeStops.forEach((stop, index) => {
      if (isValidCoord(stop.latitude, stop.longitude)) {
        validMappedStops.push({
          stop,
          index, // 0-based sequence in active stops (Stop #index+1)
          lat: parseFloat(stop.latitude),
          lng: parseFloat(stop.longitude)
        });
      }
    });

    if (validMappedStops.length === 0) return;

    // Group valid stops by coordinate (precision 5 decimals ~ 1 meter)
    const coordGroups = new Map();
    validMappedStops.forEach(item => {
      const key = `${item.lat.toFixed(5)},${item.lng.toFixed(5)}`;
      if (!coordGroups.has(key)) coordGroups.set(key, []);
      coordGroups.get(key).push(item);
    });

    const allPlotPoints = [];

    // Helper to generate custom stop pin marker
    const buildMarker = (stop, index, lat, lng, isShared, sharedCount) => {
      const pinColor = getStatusColor(stop.status);
      const pinIcon = getStatusIcon(stop.status);
      const isNext = index === nextIncompleteIndex;

      const ringEffect = isNext
        ? 'box-shadow: 0 0 0 4px #2563eb, 0 4px 12px rgba(0,0,0,0.35); transform: scale(1.15);'
        : 'box-shadow: 0 3px 8px rgba(0,0,0,0.25);';

      const customIcon = L.divIcon({
        className: 'delivery-custom-pin',
        html: `
          <div style="background-color: ${pinColor}; width: 38px; height: 38px; border-radius: 50%; display: flex; flex-direction: column; align-items: center; justify-content: center; color: white; font-weight: 800; font-size: 13px; border: 2.5px solid #ffffff; ${ringEffect}">
            <span>#${index + 1}</span>
          </div>
        `,
        iconSize: [38, 38],
        iconAnchor: [19, 19],
        popupAnchor: [0, -19]
      });

      const marker = L.marker([lat, lng], { icon: customIcon });

      const sharedNotice = isShared
        ? `<div style="background: #eef2ff; color: #4338ca; padding: 4px 8px; border-radius: 6px; font-size: 11px; font-weight: 700; margin-bottom: 6px;">🏢 Shared Location (${sharedCount} stops at this address)</div>`
        : '';

      const mapsUrl = getGoogleMapsUrl(stop);
      const openMapsBtn = mapsUrl
        ? `<a href="${mapsUrl}" target="_blank" rel="noopener noreferrer" style="display: inline-block; padding: 5px 10px; background: #f1f5f9; color: #334155; border: 1px solid #cbd5e1; border-radius: 8px; text-decoration: none; font-weight: 700; font-size: 11px; margin-top: 6px;">🗺️ Open Maps</a>`
        : '';

      marker.bindPopup(`
        <div style="font-family: inherit; font-size: 13px; min-width: 180px;">
          ${sharedNotice}
          <div style="font-weight: 800; font-size: 14px; margin-bottom: 2px;">#${index + 1} ${stop.shopName}</div>
          <div style="color: #64748b; font-size: 11px; margin-bottom: 6px;">${stop.address || ''}</div>
          <div style="font-size: 11px; font-weight: 700; color: ${pinColor}; margin-bottom: 6px;">
            ${pinIcon} ${stop.status}
          </div>
          <div style="font-size: 11px; color: #475569; margin-bottom: 6px;">
            Order #${stop.id} • ₹${Number(stop.total || 0).toLocaleString()}
          </div>
          <div style="display: flex; gap: 6px; flex-wrap: wrap;">
            ${stop.contactPhone ? `<a href="tel:${stop.contactPhone}" style="display: inline-block; padding: 5px 10px; background: #0284c7; color: white; border-radius: 8px; text-decoration: none; font-weight: 700; font-size: 11px;">📞 Call</a>` : ''}
            ${openMapsBtn}
          </div>
        </div>
      `);

      return marker;
    };

    // Plot markers and fan out overlapping locations
    coordGroups.forEach((groupItems) => {
      const count = groupItems.length;
      const baseLat = groupItems[0].lat;
      const baseLng = groupItems[0].lng;
      allPlotPoints.push([baseLat, baseLng]);

      if (count === 1) {
        // Solitary stop: draw directly at coordinate
        const { stop, index, lat, lng } = groupItems[0];
        const marker = buildMarker(stop, index, lat, lng, false, 1);
        marker.addTo(markersLayerRef.current);
      } else {
        // Multiple stops at identical coordinates: Disambiguate without altering source records!
        // 1. Central location hub anchor pin
        const hubHtml = `
          <div style="background-color: #0f172a; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-weight: 800; font-size: 11px; border: 2px solid #ffffff; box-shadow: 0 2px 8px rgba(0,0,0,0.35);">
            <span>🏢${count}</span>
          </div>
        `;
        const hubIcon = L.divIcon({
          className: 'delivery-hub-anchor',
          html: hubHtml,
          iconSize: [28, 28],
          iconAnchor: [14, 14]
        });

        const hubMarker = L.marker([baseLat, baseLng], { icon: hubIcon, zIndexOffset: -10 }).addTo(markersLayerRef.current);
        const hubPopupContent = `
          <div style="font-family: inherit; font-size: 13px; min-width: 220px;">
            <div style="font-weight: 800; font-size: 14px; margin-bottom: 4px; color: #0f172a;">🏢 Shared Address (${count} Deliveries)</div>
            <div style="color: #64748b; font-size: 11px; margin-bottom: 8px;">${groupItems[0].stop.address || ''}</div>
            <div style="border-top: 1px solid #e2e8f0; padding-top: 6px; display: grid; gap: 6px;">
              ${groupItems.map(gi => `
                <div style="display: flex; align-items: center; justify-content: space-between; font-size: 12px;">
                  <b>#${gi.index + 1} ${gi.stop.shopName}</b>
                  <span style="font-size: 11px; font-weight: 700; color: ${getStatusColor(gi.stop.status)};">${gi.stop.status}</span>
                </div>
              `).join('')}
            </div>
          </div>
        `;
        hubMarker.bindPopup(hubPopupContent);

        // 2. Fan out individual stop markers radially so every stop is discoverable & clickable
        const radius = 0.00018; // approx 20 meters
        groupItems.forEach((gi, i) => {
          const angle = (2 * Math.PI * i) / count - Math.PI / 2;
          const offsetLat = baseLat + radius * Math.cos(angle);
          const offsetLng = baseLng + (radius / Math.cos(baseLat * Math.PI / 180)) * Math.sin(angle);
          allPlotPoints.push([offsetLat, offsetLng]);

          // Draw connecting leader line from central hub to offset pin
          L.polyline([[baseLat, baseLng], [offsetLat, offsetLng]], {
            color: '#64748b',
            weight: 1.5,
            dashArray: '3, 4',
            opacity: 0.8
          }).addTo(markersLayerRef.current);

          const marker = buildMarker(gi.stop, gi.index, offsetLat, offsetLng, true, count);
          marker.addTo(markersLayerRef.current);
        });
      }
    });

    // Render polyline
    if (routeInfo && routeInfo.polyline && routeInfo.polyline.length > 1) {
      L.polyline(routeInfo.polyline, {
        color: '#2563eb',
        weight: 5,
        opacity: 0.85,
        lineJoin: 'round'
      }).addTo(polylineLayerRef.current);
    } else if (validMappedStops.length > 1) {
      const lineCoords = validMappedStops.map(s => [s.lat, s.lng]);
      L.polyline(lineCoords, {
        color: '#3b82f6',
        weight: 3,
        dashArray: '6, 8',
        opacity: 0.7
      }).addTo(polylineLayerRef.current);
    }

    if (allPlotPoints.length > 0) {
      const bounds = L.latLngBounds(allPlotPoints);
      map.fitBounds(bounds, { padding: [45, 45], maxZoom: 16 });
    }

    setTimeout(() => {
      map.invalidateSize();
    }, 100);
  }, [showMap, activeStops, routeInfo, nextIncompleteIndex]);

  // Execute authenticated delivery status update
  const executeStatusUpdate = async (orderId, newStatus, reason = null, note = null) => {
    setUpdating(true);
    try {
      const res = await api.updateDeliveryStatus(orderId, newStatus, reason, note);
      if (res && res.status === 200) {
        if (showToast) showToast(t.updateSuccess);

        setOrders(prev => prev.map(o => {
          if (String(o.id) === String(orderId)) {
            return {
              ...o,
              status: newStatus,
              deliveryReason: reason,
              deliveryNote: note,
              deliveryUpdatedAt: new Date().toISOString()
            };
          }
          return o;
        }));

        const orderShop = orders.find(o => String(o.id) === String(orderId))?.shopName || 'Shop';
        if (newStatus === 'Delivered') {
          speak(lang === 'ta' ? `${orderShop} கடைக்கு டெலிவரி முடிந்தது.` : `${orderShop} marked as Delivered.`);
        } else if (newStatus === 'Picked up') {
          speak(lang === 'ta' ? `${orderShop} பொருட்கள் எடுக்கப்பட்டது.` : `${orderShop} order picked up.`);
        }

        setConfirmModal(null);
        setFailModal(null);
      } else {
        if (showToast) showToast(res?.message || t.updateFailed);
      }
    } catch (err) {
      console.error('Failed to update status:', err);
      if (showToast) showToast(t.updateFailed);
    } finally {
      setUpdating(false);
    }
  };

  // Render Stop Card
  const renderStopCard = (stop, index) => {
    const st = (stop.status || '').toLowerCase();
    const isDelivered = st === 'delivered';
    const isFailed = st === 'could not deliver' || st === 'cancelled';
    const isPickedUp = st === 'picked up';
    const isReadyForPickup = st === 'pending' || st === 'in progress';
    const isNext = index === nextIncompleteIndex;

    const hasCoords = isValidCoord(stop.latitude, stop.longitude);
    const coordKey = hasCoords ? `${parseFloat(stop.latitude).toFixed(5)},${parseFloat(stop.longitude).toFixed(5)}` : null;
    const sharedGroup = (coordKey && coordGroupLookup.get(coordKey)) || [];
    const isShared = sharedGroup.length > 1;
    const otherStopNums = isShared ? sharedGroup.filter(item => item.stop.id !== stop.id).map(item => `#${item.index + 1}`) : [];

    return (
      <div
        key={stop.id}
        className={`bg-white rounded-3xl p-4 sm:p-5 border transition shadow-sm relative ${
          isNext
            ? 'ring-2 ring-blue-500 border-blue-400 shadow-md bg-blue-50/20'
            : isDelivered
            ? 'border-emerald-200 bg-emerald-50/10 opacity-90'
            : isFailed
            ? 'border-rose-200 bg-rose-50/20'
            : 'border-slate-200'
        }`}
      >
        {/* Top Badge Row */}
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2">
            <span className={`w-8 h-8 rounded-full flex items-center justify-center font-black text-xs text-white ${
              isDelivered ? 'bg-emerald-500' : isFailed ? 'bg-rose-500' : isPickedUp ? 'bg-blue-600' : 'bg-amber-500'
            }`}>
              #{index + 1}
            </span>

            {isNext && (
              <span className="bg-blue-600 text-white text-[10px] font-black tracking-wider px-2 py-0.5 rounded-full uppercase animate-pulse">
                ⭐ {t.nextStopBadge}
              </span>
            )}

            <span className="font-mono text-xs font-bold text-slate-500">
              {stop.shopId || `S${String(stop.customerId || '').padStart(3, '0')}`}
            </span>
          </div>

          {/* Status Indicator */}
          <div>
            {isDelivered ? (
              <span className="bg-emerald-100 text-emerald-800 border border-emerald-300 text-xs font-extrabold px-3 py-1 rounded-full flex items-center gap-1">
                ✅ {t.statusDelivered}
              </span>
            ) : isFailed ? (
              <span className="bg-rose-100 text-rose-800 border border-rose-300 text-xs font-extrabold px-3 py-1 rounded-full flex items-center gap-1">
                ❌ {stop.deliveryReason || t.statusFailed}
              </span>
            ) : isPickedUp ? (
              <span className="bg-blue-100 text-blue-800 border border-blue-300 text-xs font-extrabold px-3 py-1 rounded-full flex items-center gap-1">
                🚚 {t.statusPickedUp}
              </span>
            ) : (
              <span className="bg-amber-100 text-amber-800 border border-amber-300 text-xs font-extrabold px-3 py-1 rounded-full flex items-center gap-1">
                📦 {t.statusInProgress}
              </span>
            )}
          </div>
        </div>

        {/* Shop Name & Information */}
        <div className="mb-3">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-lg font-black text-slate-900 leading-snug">
              {stop.shopName}
            </h3>

            {/* Audio Reader Button */}
            <button
              type="button"
              onClick={() => {
                const speechText = lang === 'ta'
                  ? `நிறுத்தம் எண் ${index + 1}. கடை பெயர்: ${stop.shopName}. முகவரி: ${stop.address || 'முகவரி இல்லை'}. நிலை: ${stop.status}.`
                  : `Stop number ${index + 1}. Shop: ${stop.shopName}. Address: ${stop.address || 'No address'}. Status: ${stop.status}.`;
                speak(speechText);
              }}
              className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 active:scale-95 transition"
              title={t.speakBtn}
            >
              🔊
            </button>
          </div>

          {stop.ownerName && (
            <p className="text-xs font-medium text-slate-600 mt-0.5">
              👤 {stop.ownerName}
            </p>
          )}

          <p className="text-xs text-slate-500 mt-1 leading-relaxed">
            📍 {stop.address || 'Address on file'}
          </p>

          {/* Location status badge: Missing GPS vs Shared Address */}
          {!hasCoords ? (
            <div className="mt-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-bold bg-amber-50 text-amber-900 border border-amber-300">
                <span>⚠️</span>
                <span>{t.gpsMissing}</span>
              </span>
            </div>
          ) : isShared ? (
            <div className="mt-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-bold bg-indigo-50 text-indigo-900 border border-indigo-200">
                <span>🏢</span>
                <span>{t.sharedAddressBadge} {otherStopNums.join(', ')}</span>
              </span>
            </div>
          ) : null}
        </div>

        {/* Order Summary & Contact Pills */}
        <div className="flex flex-wrap items-center gap-2 mb-4 pt-2 border-t border-slate-100">
          <span className="text-xs font-bold text-slate-700 bg-slate-100 px-2.5 py-1 rounded-lg">
            🧾 Order #{stop.id}
          </span>
          <span className="text-xs font-bold text-slate-700 bg-slate-100 px-2.5 py-1 rounded-lg">
            📦 {stop.itemsCount || 1} items
          </span>
          <span className="text-xs font-extrabold text-slate-900 bg-slate-100 px-2.5 py-1 rounded-lg">
            ₹{Number(stop.total || 0).toLocaleString()}
          </span>

          {stop.contactPhone && (
            <a
              href={`tel:${stop.contactPhone}`}
              className="ml-auto inline-flex items-center gap-1 text-xs font-bold bg-sky-50 text-sky-700 border border-sky-200 hover:bg-sky-100 px-3 py-1.5 rounded-xl transition min-h-[36px]"
            >
              📞 {t.callShop}
            </a>
          )}

          {hasCoords ? (
            <a
              href={getGoogleMapsUrl(stop)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs font-bold bg-slate-100 text-slate-700 border border-slate-200 hover:bg-slate-200 px-3 py-1.5 rounded-xl transition min-h-[36px]"
              title="Open Google Maps with GPS coordinates"
            >
              🗺️ {t.openMap}
            </a>
          ) : stop.address ? (
            <a
              href={getGoogleMapsUrl(stop)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs font-bold bg-amber-50 text-amber-800 border border-amber-300 hover:bg-amber-100 px-3 py-1.5 rounded-xl transition min-h-[36px]"
              title="Open Google Maps search with store street address"
            >
              🗺️ {t.openMapByAddress}
            </a>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-400 bg-slate-50 border border-slate-200 px-2.5 py-1.5 rounded-xl min-h-[36px]">
              📍 {t.noAddressOrGps}
            </span>
          )}
        </div>

        {/* Single Obvious Action Button Bar */}
        {!isDelivered && !isFailed && (
          <div className="pt-2 flex flex-col sm:flex-row items-stretch gap-2.5">
            {isReadyForPickup ? (
              <button
                type="button"
                disabled={updating}
                onClick={() => {
                  setConfirmModal({
                    order: stop,
                    targetStatus: 'Picked up',
                    title: t.markPickedUp,
                    text: lang === 'ta'
                      ? `இந்த ஆர்டரை (${stop.id}) வண்டியில் ஏற்றிவிட்டீர்களா?`
                      : `Are you ready to mark Order #${stop.id} as Picked Up?`
                  });
                }}
                className="flex-1 bg-amber-500 hover:bg-amber-600 active:scale-98 text-white font-black text-sm py-3.5 px-4 rounded-2xl shadow-md transition flex items-center justify-center gap-2 min-h-[54px]"
              >
                <span className="text-xl">📦</span>
                <span>{t.markPickedUp}</span>
              </button>
            ) : (
              <button
                type="button"
                disabled={updating}
                onClick={() => {
                  setConfirmModal({
                    order: stop,
                    targetStatus: 'Delivered',
                    title: t.markDelivered,
                    text: lang === 'ta'
                      ? `இந்த ஆர்டரை (${stop.id}) ${stop.shopName} கடைக்கு டெலிவரி செய்துவிட்டீர்களா?`
                      : `Confirm delivery of Order #${stop.id} to ${stop.shopName}?`
                  });
                }}
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 active:scale-98 text-white font-black text-base py-3.5 px-4 rounded-2xl shadow-md transition flex items-center justify-center gap-2 min-h-[56px]"
              >
                <span className="text-2xl">✅</span>
                <span>{t.markDelivered}</span>
              </button>
            )}

            <button
              type="button"
              disabled={updating}
              onClick={() => setFailModal({ order: stop })}
              className="bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-bold text-xs py-3 px-4 rounded-2xl transition flex items-center justify-center gap-1.5 min-h-[50px]"
            >
              <span>❌</span>
              <span>{t.couldNotDeliver}</span>
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="w-full text-[#1e293b] font-sans pb-16">
      {/* Top Delivery Header Bar with Back, Preview Switcher, Language & Sign out */}
      <div className="bg-[#0f172a] text-white p-3.5 sm:p-4 rounded-3xl shadow-md border border-slate-800 mb-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Left: Back Button & Branding */}
          <div className="flex items-center gap-2 sm:gap-3">
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                className="bg-slate-800 hover:bg-slate-700 active:scale-95 text-white text-base font-bold w-10 h-10 min-w-[40px] min-h-[40px] rounded-xl border border-slate-700 flex items-center justify-center transition"
                title="Go back"
                aria-label="Go back"
              >
                <span aria-hidden="true">←</span>
                <span className="sr-only">Go back</span>
              </button>
            )}

            <div className="flex items-center gap-2">
              <span className="text-2xl">🚚</span>
              <div>
                <h1 className="text-base sm:text-lg font-black tracking-tight leading-tight flex items-center gap-1.5">
                  {t.appTitle}
                  <span className="text-[10px] font-semibold bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full border border-emerald-500/30">
                    {user?.name || 'Agent'}
                  </span>
                </h1>
                <p className="text-[11px] text-slate-400 hidden sm:block">
                  {t.portalSubtitle}
                </p>
              </div>
            </div>
          </div>

          {/* Right: Preview Switcher, Bilingual Toggle & Sign Out */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Laptop / Mobile View Switcher */}
            {onTogglePreview && (
              <div className="flex items-center bg-slate-800 p-0.5 rounded-xl border border-slate-700">
                <button
                  type="button"
                  onClick={() => onTogglePreview(false)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1 min-h-[34px] ${
                    !isMobilePreview
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-white'
                  }`}
                  title="Switch to Laptop wide layout"
                >
                  <span>💻</span>
                  <span className="hidden sm:inline">{t.laptopView}</span>
                </button>
                <button
                  type="button"
                  onClick={() => onTogglePreview(true)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1 min-h-[34px] ${
                    isMobilePreview
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-white'
                  }`}
                  title="Switch to Mobile phone preview"
                >
                  <span>📱</span>
                  <span className="hidden sm:inline">{t.mobilePreview}</span>
                </button>
              </div>
            )}

            {/* Bilingual Toggle */}
            <button
              type="button"
              onClick={() => {
                const nextLang = lang === 'en' ? 'ta' : 'en';
                setLang(nextLang);
                speak(nextLang === 'ta' ? 'தமிழ் தேர்ந்தெடுக்கப்பட்டது' : 'English selected');
              }}
              className="bg-slate-800 hover:bg-slate-700 active:scale-95 text-xs font-bold px-3 py-2 rounded-xl border border-slate-700 text-amber-400 flex items-center gap-1.5 transition min-h-[38px]"
              title="Toggle Tamil / English"
            >
              <span>🌐</span>
              <span>{t.langToggle}</span>
            </button>

            {/* Sign Out Button */}
            {onLogout && (
              <button
                type="button"
                onClick={onLogout}
                className="bg-rose-600 hover:bg-rose-700 active:scale-95 text-white text-xs font-bold px-3 py-2 rounded-xl transition flex items-center gap-1.5 min-h-[38px]"
                title={t.logout}
              >
                <span>🚪</span>
                <span>{t.signOut}</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main Delivery Workflow Layout: Responsive Side-by-Side on Laptop, Stacked on Mobile */}
      <div className={`space-y-4 ${!isMobilePreview ? 'max-w-7xl mx-auto' : 'max-w-2xl mx-auto'}`}>
        {/* Top Controls: Cluster / Area Selector */}
        {clusters.length > 0 && (
          <div className="bg-white p-3 rounded-2xl shadow-sm border border-slate-200">
            <label className="text-[11px] font-black text-slate-400 uppercase tracking-wider block px-1 mb-2">
              📍 {t.chooseCluster}
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setSelectedClusterId('all')}
                className={`py-2.5 px-3 rounded-xl text-xs font-black transition flex flex-col items-center justify-center min-h-[48px] ${
                  selectedClusterId === 'all'
                    ? 'bg-slate-900 text-white shadow-md'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                <span>{t.allClusters}</span>
                <span className="text-[10px] opacity-75 font-normal">
                  ({orders.length} {t.stops})
                </span>
              </button>

              {clusters.map(c => (
                <button
                  key={c.clusterId}
                  type="button"
                  onClick={() => setSelectedClusterId(String(c.clusterId))}
                  className={`py-2.5 px-3 rounded-xl text-xs font-black transition flex flex-col items-center justify-center min-h-[48px] ${
                    selectedClusterId === String(c.clusterId)
                      ? 'bg-blue-600 text-white shadow-md'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  <span className="truncate max-w-full">{c.clusterName}</span>
                  <span className="text-[10px] opacity-80 font-normal">
                    {c.pendingCount} {t.pending} • {c.deliveredCount} {t.delivered}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* KPI Tiles Row */}
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          <div className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-sm text-center">
            <span className="text-xl block mb-1">📦</span>
            <div className="text-2xl font-black text-amber-600 leading-none">{kpis.pending}</div>
            <span className="text-[11px] font-bold text-slate-500 uppercase">{t.pending}</span>
          </div>

          <div className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-sm text-center">
            <span className="text-xl block mb-1">✅</span>
            <div className="text-2xl font-black text-emerald-600 leading-none">{kpis.delivered}</div>
            <span className="text-[11px] font-bold text-slate-500 uppercase">{t.delivered}</span>
          </div>

          <div className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-sm text-center">
            <span className="text-xl block mb-1">❌</span>
            <div className="text-2xl font-black text-rose-600 leading-none">{kpis.issues}</div>
            <span className="text-[11px] font-bold text-slate-500 uppercase">{t.issues}</span>
          </div>
        </div>

        {/* Start Route Action Banner */}
        <div className="bg-gradient-to-r from-blue-700 via-indigo-700 to-blue-800 text-white p-4 sm:p-5 rounded-3xl shadow-lg">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 mb-2.5">
            <div>
              <span className="text-xs font-extrabold uppercase tracking-widest text-blue-200 block mb-0.5">
                {routeActive ? `🟢 ${t.routeActive}` : `📍 ${t.stopsInOrder}`}
              </span>
              <h2 className="text-xl font-black">
                {activeStops.length} {t.stops} • {kpis.pending} {t.pending}
              </h2>
            </div>

            <div className="flex items-center gap-2">
              {/* On mobile preview, allow toggling map visibility */}
              {isMobilePreview && (
                <button
                  type="button"
                  onClick={() => setShowMap(!showMap)}
                  className="bg-white/20 hover:bg-white/30 text-white font-bold text-xs px-3.5 py-3 rounded-xl transition flex items-center justify-center gap-1.5 flex-1 min-h-[48px]"
                >
                  <span>🗺️</span>
                  <span>{showMap ? t.hideMap : t.showMap}</span>
                </button>
              )}

              <button
                type="button"
                disabled={optimizing || activeStops.length === 0}
                onClick={handleStartRoute}
                className="bg-amber-400 hover:bg-amber-300 text-slate-950 font-black text-sm px-5 py-3 rounded-xl shadow-md active:scale-95 transition flex items-center justify-center gap-2 flex-1 sm:flex-initial min-h-[48px]"
              >
                <span>{optimizing ? '⏳' : '🚚'}</span>
                <span>{optimizing ? t.optimizingRoute : t.startRoute}</span>
              </button>
            </div>
          </div>

          {/* Route Disclaimer Notice */}
          {routeInfo && (
            <div className="bg-white/10 p-2.5 rounded-xl text-xs text-blue-100 flex items-start gap-2 border border-white/10">
              <span className="text-base">ℹ️</span>
              <div className="leading-snug">
                <span className="font-bold">{t.disclaimerPrefix} </span>
                <span>{routeInfo.disclaimer}</span>
                {routeInfo.distanceMeters > 0 && (
                  <span className="block mt-0.5 opacity-90">
                    Est. road distance: {(routeInfo.distanceMeters / 1000).toFixed(1)} km (~{Math.round(routeInfo.durationSeconds / 60)} mins)
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* =========================================================================
            RESPONSIVE CONTENT: SIDE-BY-SIDE ON LAPTOP VIEW, STACKED ON MOBILE PREVIEW
           ========================================================================= */}
        <div className={`grid gap-5 items-start ${!isMobilePreview ? 'grid-cols-1 lg:grid-cols-12' : 'grid-cols-1'}`}>
          {/* Map Section: Left Column on Laptop (Sticky), Collapsible on Mobile */}
          {(!isMobilePreview || showMap) && (
            <div className={`${!isMobilePreview ? 'lg:col-span-6 xl:col-span-5 lg:sticky lg:top-24 space-y-3' : 'space-y-2'}`}>
              <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden delivery-route-map-wrapper">
                <div className="p-3 bg-slate-900 text-white flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-base">🗺️</span>
                    <span className="text-xs font-black tracking-wide uppercase">Route Map</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {missingStopsCount > 0 && (
                      <span className="text-[10px] bg-amber-400 text-slate-950 px-2 py-0.5 rounded-full font-black">
                        ⚠️ {missingStopsCount} No GPS
                      </span>
                    )}
                    <span className="text-[10px] bg-white/20 text-blue-200 px-2 py-0.5 rounded-full font-bold">
                      {validStopsCount} Mapped
                    </span>
                  </div>
                </div>
                <div
                  ref={mapContainerRef}
                  className="w-full bg-slate-100 leaflet-map-canvas"
                  style={{
                    width: '100%',
                    height: isMobilePreview ? '300px' : '480px',
                    minHeight: isMobilePreview ? '300px' : '480px',
                    position: 'relative'
                  }}
                />
                <div className="bg-slate-50 p-2.5 px-3.5 text-[11px] text-slate-500 flex items-center justify-between border-t border-slate-200">
                  <span className="font-semibold">Tap marker pins to inspect contact</span>
                  <span className="font-mono text-slate-400">Leaflet | Map data © OSM / CARTO</span>
                </div>
              </div>
            </div>
          )}

          {/* Delivery Stops Section: Right Column on Laptop, Stacked on Mobile */}
          <div className={`${!isMobilePreview ? 'lg:col-span-6 xl:col-span-7 space-y-3' : 'space-y-3'}`}>
            <div className="flex items-center justify-between px-1">
              <h3 className="text-sm font-black text-slate-800 uppercase tracking-wider flex items-center gap-2">
                <span>📦</span>
                <span>{t.stopsInOrder} ({activeStops.length})</span>
              </h3>
              <button
                type="button"
                onClick={loadAssignedOrders}
                className="text-xs text-blue-600 font-bold hover:underline"
              >
                🔄 {t.refresh}
              </button>
            </div>

            {/* Empty State */}
            {!loading && activeStops.length === 0 && (
              <div className="bg-white rounded-3xl p-8 text-center border border-slate-200 shadow-sm space-y-3">
                <span className="text-5xl block">📦</span>
                <h3 className="text-base font-bold text-slate-700">{t.noOrders}</h3>
                <button
                  type="button"
                  onClick={loadAssignedOrders}
                  className="bg-slate-900 text-white font-bold text-xs px-4 py-2.5 rounded-xl shadow-sm hover:bg-slate-800 transition"
                >
                  🔄 {t.refresh}
                </button>
              </div>
            )}

            {/* Stops Cards */}
            <div className="space-y-3">
              {activeStops.map((stop, index) => renderStopCard(stop, index))}
            </div>
          </div>
        </div>
      </div>

      {/* Confirmation Modal Sheet */}
      {confirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="text-center">
              <span className="text-5xl block mb-2">
                {confirmModal.targetStatus === 'Delivered' ? '✅' : '📦'}
              </span>
              <h2 className="text-xl font-black text-slate-900">
                {confirmModal.title}
              </h2>
              <div className="mt-2 p-3 bg-slate-50 rounded-2xl border border-slate-200 text-left">
                <span className="text-xs font-bold text-slate-500 uppercase block">Shop</span>
                <span className="text-base font-extrabold text-slate-900 block">{confirmModal.order.shopName}</span>
                <span className="text-xs text-slate-600 block mt-1">Order #{confirmModal.order.id} • ₹{confirmModal.order.total}</span>
              </div>
              <p className="text-sm text-slate-600 font-medium mt-3">
                {confirmModal.text}
              </p>
            </div>

            <div className="flex flex-col gap-2.5 pt-2">
              <button
                type="button"
                disabled={updating}
                onClick={() => executeStatusUpdate(confirmModal.order.id, confirmModal.targetStatus)}
                className={`w-full text-white font-black text-base py-3.5 px-4 rounded-2xl shadow-lg transition flex items-center justify-center gap-2 min-h-[54px] ${
                  confirmModal.targetStatus === 'Delivered'
                    ? 'bg-emerald-600 hover:bg-emerald-700'
                    : 'bg-amber-500 hover:bg-amber-600'
                }`}
              >
                <span>{updating ? '⏳' : '✓'}</span>
                <span>{updating ? t.updating : t.confirmAction}</span>
              </button>

              <button
                type="button"
                disabled={updating}
                onClick={() => setConfirmModal(null)}
                className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-sm py-3 px-4 rounded-2xl transition min-h-[46px]"
              >
                {t.cancel}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Could Not Deliver Reason Modal */}
      {failModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="text-center">
              <span className="text-4xl block mb-1">❌</span>
              <h2 className="text-xl font-black text-slate-900">
                {t.reasonTitle}
              </h2>
              <p className="text-xs text-slate-500 font-medium mt-1">
                {failModal.order.shopName} (Order #{failModal.order.id})
              </p>
            </div>

            {/* Reason Selection Tiles */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-700 block">
                {t.selectReason}
              </label>

              {[
                { id: 'Shop Closed', label: t.reasons.closed, icon: '🔒' },
                { id: 'Owner Not Available', label: t.reasons.ownerUnavailable, icon: '👤' },
                { id: 'Order Cancelled / Rejected', label: t.reasons.rejected, icon: '🚫' },
                { id: 'Wrong Address / Location Not Found', label: t.reasons.wrongAddress, icon: '📍' }
              ].map(r => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setSelectedReason(r.id)}
                  className={`w-full p-3.5 rounded-2xl border text-left font-bold text-xs flex items-center gap-3 transition min-h-[50px] ${
                    selectedReason === r.id
                      ? 'bg-rose-50 border-rose-500 text-rose-900 ring-2 ring-rose-400/30'
                      : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <span className="text-xl">{r.icon}</span>
                  <span className="flex-1">{r.label}</span>
                  {selectedReason === r.id && <span className="text-rose-600 font-black">●</span>}
                </button>
              ))}
            </div>

            {/* Optional Note */}
            <div>
              <input
                type="text"
                placeholder={lang === 'ta' ? 'கூடுதல் குறிப்பு (தேவைப்பட்டால்)' : 'Additional note (optional)'}
                value={customNote}
                onChange={e => setCustomNote(e.target.value)}
                className="w-full text-xs p-3 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:border-rose-500 outline-none"
              />
            </div>

            {/* Action Buttons */}
            <div className="flex flex-col gap-2 pt-2">
              <button
                type="button"
                disabled={updating}
                onClick={() => executeStatusUpdate(failModal.order.id, 'Could not deliver', selectedReason, customNote)}
                className="w-full bg-rose-600 hover:bg-rose-700 text-white font-black text-sm py-3.5 px-4 rounded-2xl shadow-md transition flex items-center justify-center gap-2 min-h-[52px]"
              >
                <span>{updating ? '⏳' : '❌'}</span>
                <span>{updating ? t.updating : t.couldNotDeliver}</span>
              </button>

              <button
                type="button"
                disabled={updating}
                onClick={() => setFailModal(null)}
                className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-sm py-3 px-4 rounded-2xl transition min-h-[46px]"
              >
                {t.cancel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
