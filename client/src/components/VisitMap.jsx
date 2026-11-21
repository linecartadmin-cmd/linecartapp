import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { createMapTileLayer } from '../mapConfig';
import { escapeHtml } from '../utils';

const STATUS_COLORS = {
  verified: '#15803d',
  flagged: '#b45309',
  rejected: '#b91c1c',
  too_far: '#b91c1c',
  poor_accuracy: '#7c3aed',
  location_not_registered: '#64748b'
};

function dot(color, size = 16) {
  return L.divIcon({
    className: 'visit-map-dot',
    html: `<span style="display:block;width:${size}px;height:${size}px;border-radius:50%;background:${color};border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2]
  });
}

function shopIcon() {
  return L.divIcon({
    className: 'visit-map-shop',
    html: '<span style="display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:50%;background:#0f172a;color:#fff;font-size:15px;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35)">🏪</span>',
    iconSize: [30, 30],
    iconAnchor: [15, 15]
  });
}

/**
 * Leaflet map for visits. Reuses the app's tile configuration.
 * Props:
 *  - shop: { latitude, longitude, shopName } registered shop position (optional)
 *  - radiusM: geofence radius drawn around the shop
 *  - agent: { latitude, longitude, accuracy, status, distanceM } device reading to show (optional)
 *  - visits: [{ id, latitude, longitude, status, shopName, agentName, visitedAt }] many points (optional)
 *  - onPick: (lat, lng) => void  enables click-to-place (coordinate editor)
 *  - height
 */
export default function VisitMap({ shop = null, radiusM = 100, agent = null, visits = null, onPick = null, height = 260 }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const pickRef = useRef(onPick);
  pickRef.current = onPick;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return undefined;
    const map = L.map(containerRef.current, { zoomControl: true, attributionControl: true }).setView([10.6583, 77.0082], 13);
    createMapTileLayer(L).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    map.on('click', (e) => {
      if (pickRef.current) pickRef.current(Number(e.latlng.lat.toFixed(6)), Number(e.latlng.lng.toFixed(6)));
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    const bounds = [];

    const hasShop = shop && Number.isFinite(Number(shop.latitude)) && Number.isFinite(Number(shop.longitude)) && !(Number(shop.latitude) === 0 && Number(shop.longitude) === 0);
    if (hasShop) {
      const s = [Number(shop.latitude), Number(shop.longitude)];
      L.circle(s, { radius: Number(radiusM) || 100, color: '#2563eb', weight: 2, fillColor: '#3b82f6', fillOpacity: 0.12 }).addTo(layer);
      L.marker(s, { icon: shopIcon() })
        .bindPopup(`<b>${escapeHtml(shop.shopName || 'Shop')}</b><br/>Registered location<br/>Geofence: ${Number(radiusM) || 100} m`)
        .addTo(layer);
      bounds.push(s);
    }

    if (agent && Number.isFinite(Number(agent.latitude)) && Number.isFinite(Number(agent.longitude))) {
      const a = [Number(agent.latitude), Number(agent.longitude)];
      const color = STATUS_COLORS[agent.status] || '#0284c7';
      if (Number(agent.accuracy) > 0) {
        L.circle(a, { radius: Number(agent.accuracy), color, weight: 1, dashArray: '4 4', fillOpacity: 0.05 }).addTo(layer);
      }
      L.marker(a, { icon: dot(color) })
        .bindPopup(`Agent position<br/>Accuracy: ±${escapeHtml(Math.round(Number(agent.accuracy) || 0))} m${agent.distanceM !== null && agent.distanceM !== undefined ? `<br/>Distance from shop: ${escapeHtml(Math.round(agent.distanceM))} m` : ''}`)
        .addTo(layer);
      bounds.push(a);
      if (hasShop) {
        const line = L.polyline([[Number(shop.latitude), Number(shop.longitude)], a], { color, weight: 2, dashArray: '6 6' }).addTo(layer);
        if (agent.distanceM !== null && agent.distanceM !== undefined) {
          line.bindTooltip(`${escapeHtml(Math.round(agent.distanceM))} m`, { permanent: true, direction: 'center', className: 'visit-distance-label' });
        }
      }
    }

    if (Array.isArray(visits)) {
      for (const v of visits) {
        if (!Number.isFinite(Number(v.latitude)) || !Number.isFinite(Number(v.longitude))) continue;
        const p = [Number(v.latitude), Number(v.longitude)];
        L.marker(p, { icon: dot(STATUS_COLORS[v.status] || '#0284c7', 12) })
          .bindPopup(
            `<b>${escapeHtml(v.shopName)}</b><br/>${escapeHtml(v.agentName)}<br/>${escapeHtml(v.status)}${v.distanceM !== null && v.distanceM !== undefined ? ` · ${escapeHtml(Math.round(v.distanceM))} m` : ''}<br/>${escapeHtml(new Date(v.visitedAt).toLocaleString('en-IN'))}`
          )
          .addTo(layer);
        bounds.push(p);
      }
    }

    if (bounds.length === 1) map.setView(bounds[0], 17);
    else if (bounds.length > 1) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 18 });
    setTimeout(() => map.invalidateSize(), 50);
  }, [shop?.latitude, shop?.longitude, shop?.shopName, radiusM, agent?.latitude, agent?.longitude, agent?.status, agent?.accuracy, agent?.distanceM, visits]);

  return (
    <div
      ref={containerRef}
      style={{ height, width: '100%', borderRadius: '12px', overflow: 'hidden', border: '1px solid #e2e8f0', cursor: onPick ? 'crosshair' : undefined }}
      role="application"
      aria-label={onPick ? 'Map. Click to place the shop location.' : 'Map of shop and visit locations'}
    />
  );
}
