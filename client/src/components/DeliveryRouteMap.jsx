import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { getGoogleMapsUrl, escapeHtml, safeTel } from '../utils';
import { createMapTileLayer } from '../mapConfig';

// Leaflet map for the delivery route. Logic moved unchanged from the previous DeliveryRouteScreen:
// numbered pins, fan-out for stops at the same address, route polyline, and popups built only from
// escaped values (checked by tests/xss-escaping.test.js).

const isValidCoord = (lat, lng) => {
  const nLat = parseFloat(lat);
  const nLng = parseFloat(lng);
  return !isNaN(nLat) && !isNaN(nLng) && (nLat !== 0 || nLng !== 0);
};

// Fixed colours per status (never echoes the status text)
const getStatusColor = (status) => {
  const st = String(status || '').toLowerCase();
  if (st === 'delivered') return '#1c7c4a';
  if (st === 'could not deliver' || st === 'cancelled') return '#b3261e';
  if (st === 'picked up') return '#5b4bb7';
  if (st === 'price approval pending') return '#8f5400';
  return '#0a6f94';
};

export default function DeliveryRouteMap({ stops, routeInfo, nextIndex, labels = {} }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef(null);
  const lineRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return undefined;
    if (containerRef.current._leaflet_id) delete containerRef.current._leaflet_id;
    const map = L.map(containerRef.current, { center: [10.5758, 77.2415], zoom: 13, zoomControl: true, scrollWheelZoom: true });
    createMapTileLayer(L).addTo(map);
    markersRef.current = L.layerGroup().addTo(map);
    lineRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    const t1 = setTimeout(() => map.invalidateSize(), 150);
    return () => {
      clearTimeout(t1);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !markersRef.current || !lineRef.current) return;
    markersRef.current.clearLayers();
    lineRef.current.clearLayers();

    const valid = [];
    stops.forEach((stop, index) => {
      if (isValidCoord(stop.latitude, stop.longitude)) {
        valid.push({ stop, index, lat: parseFloat(stop.latitude), lng: parseFloat(stop.longitude) });
      }
    });
    if (valid.length === 0) return;

    const groups = new Map();
    valid.forEach((item) => {
      const key = `${item.lat.toFixed(5)},${item.lng.toFixed(5)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    });

    const points = [];
    const callLabel = escapeHtml(labels.callShop || 'Call');
    const mapsLabel = escapeHtml(labels.openMap || 'Open Maps');
    const orderLabel = escapeHtml(labels.order || 'Order');

    const buildMarker = (stop, index, lat, lng, isShared, sharedCount) => {
      const color = getStatusColor(stop.status);
      const isNext = index === nextIndex;
      const ring = isNext ? 'box-shadow: 0 0 0 4px #0a6f94, 0 4px 12px rgba(0,0,0,0.35);' : 'box-shadow: 0 2px 6px rgba(0,0,0,0.3);';
      const icon = L.divIcon({
        className: 'delivery-custom-pin',
        html: `<div style="background:${color};width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font:800 13px Inter,system-ui,sans-serif;border:2px solid #fff;${ring}">${index + 1}</div>`,
        iconSize: [36, 36],
        iconAnchor: [18, 18],
        popupAnchor: [0, -18]
      });
      const marker = L.marker([lat, lng], { icon });
      const sharedNotice = isShared
        ? `<div style="background:#efedfb;color:#5b4bb7;padding:4px 8px;border-radius:6px;font-size:12px;font-weight:700;margin-bottom:6px;">Shared address (${Number(sharedCount)} stops)</div>`
        : '';
      const mapsUrl = getGoogleMapsUrl(stop);
      const mapsBtn = mapsUrl
        ? `<a href="${escapeHtml(mapsUrl)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:8px 12px;background:#eef2f4;color:#17232c;border-radius:6px;text-decoration:none;font-weight:700;font-size:13px;">${mapsLabel}</a>`
        : '';
      const callBtn = stop.contactPhone
        ? `<a href="tel:${safeTel(stop.contactPhone)}" style="display:inline-block;padding:8px 12px;background:#0a6f94;color:#fff;border-radius:6px;text-decoration:none;font-weight:700;font-size:13px;">${callLabel}</a>`
        : '';
      marker.bindPopup(`
        <div style="font-family:Inter,system-ui,sans-serif;font-size:13px;min-width:190px;">
          ${sharedNotice}
          <div style="font-weight:800;font-size:14px;margin-bottom:2px;">${index + 1}. ${escapeHtml(stop.shopName)}</div>
          <div style="color:#5e6e77;font-size:12px;margin-bottom:6px;">${escapeHtml(stop.address)}</div>
          <div style="font-size:12px;font-weight:700;color:${getStatusColor(stop.status)};margin-bottom:6px;">${escapeHtml(stop.status)}</div>
          <div style="font-size:12px;color:#34434c;margin-bottom:8px;">${orderLabel} ${escapeHtml(stop.id)} · ₹${Number(stop.total || 0).toLocaleString('en-IN')}</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">${callBtn}${mapsBtn}</div>
        </div>`);
      return marker;
    };

    groups.forEach((items) => {
      const count = items.length;
      const baseLat = items[0].lat;
      const baseLng = items[0].lng;
      points.push([baseLat, baseLng]);
      if (count === 1) {
        const { stop, index, lat, lng } = items[0];
        buildMarker(stop, index, lat, lng, false, 1).addTo(markersRef.current);
        return;
      }
      const hub = L.marker([baseLat, baseLng], {
        icon: L.divIcon({
          className: 'delivery-hub-anchor',
          html: `<div style="background:#17232c;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font:800 12px Inter,system-ui,sans-serif;border:2px solid #fff;">${Number(count)}</div>`,
          iconSize: [28, 28],
          iconAnchor: [14, 14]
        }),
        zIndexOffset: -10
      }).addTo(markersRef.current);
      hub.bindPopup(`
        <div style="font-family:Inter,system-ui,sans-serif;font-size:13px;min-width:220px;">
          <div style="font-weight:800;font-size:14px;margin-bottom:4px;">Shared address (${Number(count)} deliveries)</div>
          <div style="color:#5e6e77;font-size:12px;margin-bottom:8px;">${escapeHtml(items[0].stop.address)}</div>
          <div style="border-top:1px solid #e1e7ea;padding-top:6px;display:grid;gap:6px;">
            ${items.map((gi) => `<div style="display:flex;justify-content:space-between;gap:8px;font-size:12px;"><b>${gi.index + 1}. ${escapeHtml(gi.stop.shopName)}</b><span style="font-weight:700;color:${getStatusColor(gi.stop.status)};">${escapeHtml(gi.stop.status)}</span></div>`).join('')}
          </div>
        </div>`);
      const radius = 0.00018;
      items.forEach((gi, i) => {
        const angle = (2 * Math.PI * i) / count - Math.PI / 2;
        const oLat = baseLat + radius * Math.cos(angle);
        const oLng = baseLng + (radius / Math.cos((baseLat * Math.PI) / 180)) * Math.sin(angle);
        points.push([oLat, oLng]);
        L.polyline([[baseLat, baseLng], [oLat, oLng]], { color: '#5e6e77', weight: 1.5, dashArray: '3, 4', opacity: 0.8 }).addTo(markersRef.current);
        buildMarker(gi.stop, gi.index, oLat, oLng, true, count).addTo(markersRef.current);
      });
    });

    if (routeInfo?.polyline?.length > 1) {
      L.polyline(routeInfo.polyline, { color: '#0a6f94', weight: 5, opacity: 0.85, lineJoin: 'round' }).addTo(lineRef.current);
    } else if (valid.length > 1) {
      L.polyline(valid.map((s) => [s.lat, s.lng]), { color: '#0a6f94', weight: 3, dashArray: '6, 8', opacity: 0.6 }).addTo(lineRef.current);
    }
    if (points.length) map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 16 });
    const t2 = setTimeout(() => map.invalidateSize(), 100);
    return () => clearTimeout(t2);
  }, [stops, routeInfo, nextIndex, labels.callShop, labels.openMap, labels.order]);

  return <div ref={containerRef} className="dl-map" role="region" aria-label={labels.map || 'Route map'} />;
}
