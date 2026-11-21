import React, { useState, useEffect, useRef, useMemo } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { api } from '../api';
import { createMapTileLayer } from '../mapConfig';
import { escapeHtml, safeTel } from '../utils';

export default function ShopMapScreen({ user, clusters, showToast }) {
  const [loading, setLoading] = useState(true);
  const [shopsData, setShopsData] = useState([]);
  const [summary, setSummary] = useState({
    total: 0,
    orderedCount: 0,
    notOrderedCount: 0,
    validCount: 0,
    unmappedCount: 0
  });

  const roleLower = (user?.role || '').toLowerCase();
  const isAdmin = roleLower === 'admin';

  // Filters
  const [selectedCluster, setSelectedCluster] = useState('1');
  const [selectedManager, setSelectedManager] = useState('all');
  const [managersList, setManagersList] = useState([]);
  const [filterMode, setFilterMode] = useState('all'); // 'all' | 'ordered' | 'not_ordered'
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [showUnmappedList, setShowUnmappedList] = useState(false);

  // Grouping & Spiderfy interaction states
  const [selectedShop, setSelectedShop] = useState(null);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [spiderfiedGroupId, setSpiderfiedGroupId] = useState(null);

  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersLayerRef = useRef(null);
  const spiderfyLayerRef = useRef(null);

  // Load Sales Managers list if user is Admin
  useEffect(() => {
    if (isAdmin) {
      api.getAdminUsers()
        .then((res) => {
          if (res && res.users) {
            const managers = res.users.filter((u) => (u.role || '').toLowerCase() === 'sales manager');
            setManagersList(managers);
          }
        })
        .catch(() => {});
    }
  }, [isAdmin]);

  // Load shops with order status
  const fetchShops = () => {
    if (!user) return;
    setLoading(true);

    const params = {
      clusterId: selectedCluster,
      fromDate: fromDate || undefined,
      toDate: toDate || undefined
    };

    if (isAdmin) {
      if (selectedManager !== 'all') {
        params.managerId = selectedManager;
      }
    } else {
      params.managerId = user.id;
    }

    api.getManagerShops(params)
      .then((res) => {
        if (res && res.shops) {
          setShopsData(res.shops);
          setSummary(res.summary || {
            total: res.shops.length,
            orderedCount: res.shops.filter((s) => s.hasOrdered).length,
            notOrderedCount: res.shops.filter((s) => !s.hasOrdered).length,
            validCount: res.shops.filter((s) => s.hasValidCoords).length,
            unmappedCount: res.shops.filter((s) => !s.hasValidCoords).length
          });
        }
      })
      .catch((err) => {
        console.error('Failed to load shop map data', err);
        if (showToast) showToast('Error loading shop map');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchShops();
  }, [user, selectedCluster, selectedManager, fromDate, toDate]);

  // Filtered shops to display based on tab
  const displayShops = useMemo(() => {
    return shopsData.filter((shop) => {
      if (filterMode === 'ordered') return shop.hasOrdered;
      if (filterMode === 'not_ordered') return !shop.hasOrdered;
      return true;
    });
  }, [shopsData, filterMode]);

  // Valid shops for map pins
  const pinShops = useMemo(() => {
    return displayShops.filter((shop) => shop.hasValidCoords);
  }, [displayShops]);

  // Shops with missing or out-of-bounds coordinates
  const unmappedShops = useMemo(() => {
    return shopsData.filter((shop) => !shop.hasValidCoords);
  }, [shopsData]);

  // Group overlapping and adjacent shops (~35m threshold) to prevent hidden/buried pins
  const locationGroups = useMemo(() => {
    const threshold = 0.00035; // ~35 meters
    const groups = [];

    pinShops.forEach((shop) => {
      const lat = parseFloat(shop.latitude);
      const lng = parseFloat(shop.longitude);

      let matched = null;
      for (const g of groups) {
        const dLat = Math.abs(g.lat - lat);
        const dLng = Math.abs(g.lng - lng);
        if (dLat < threshold && dLng < threshold) {
          matched = g;
          break;
        }
      }

      if (matched) {
        matched.shops.push(shop);
        if (shop.hasOrdered) matched.orderedCount++;
        else matched.notOrderedCount++;
      } else {
        groups.push({
          id: `grp_${lat.toFixed(5)}_${lng.toFixed(5)}`,
          lat,
          lng,
          shops: [shop],
          orderedCount: shop.hasOrdered ? 1 : 0,
          notOrderedCount: shop.hasOrdered ? 0 : 1
        });
      }
    });

    return groups;
  }, [pinShops]);

  // Initialize Leaflet Map
  useEffect(() => {
    if (!mapContainerRef.current) return;

    if (!mapInstanceRef.current) {
      const map = L.map(mapContainerRef.current, {
        zoomControl: true,
        attributionControl: true
      }).setView([10.5758, 77.2415], 12);

      const tileLayer = createMapTileLayer(L);
      tileLayer.addTo(map);

      const markersGroup = L.layerGroup().addTo(map);
      markersLayerRef.current = markersGroup;

      const spiderfyGroup = L.layerGroup().addTo(map);
      spiderfyLayerRef.current = spiderfyGroup;

      mapInstanceRef.current = map;
    }

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  // Window-level handler for popup actions
  useEffect(() => {
    window.__linecartSpiderfyGroup = (groupId) => {
      setSpiderfiedGroupId(groupId);
      const grp = locationGroups.find((g) => g.id === groupId);
      if (grp) {
        setSelectedGroup(grp);
        setSelectedShop(grp.shops[0]);
      }
    };

    window.__linecartCollapseSpiderfy = () => {
      setSpiderfiedGroupId(null);
    };

    window.__linecartSelectShop = (shopId) => {
      const s = shopsData.find((item) => Number(item.shopid) === Number(shopId));
      if (s) {
        setSelectedShop(s);
        const grp = locationGroups.find((g) => g.shops.some((item) => Number(item.shopid) === Number(shopId)));
        if (grp) setSelectedGroup(grp);
      }
    };

    return () => {
      delete window.__linecartSpiderfyGroup;
      delete window.__linecartCollapseSpiderfy;
      delete window.__linecartSelectShop;
    };
  }, [locationGroups, shopsData]);

  // Render markers, groups, and spiderfied pins
  useEffect(() => {
    if (!mapInstanceRef.current || !markersLayerRef.current || !spiderfyLayerRef.current) return;

    markersLayerRef.current.clearLayers();
    spiderfyLayerRef.current.clearLayers();

    if (locationGroups.length === 0) return;

    const bounds = [];

    locationGroups.forEach((group) => {
      bounds.push([group.lat, group.lng]);
      const count = group.shops.length;

      // CASE A: Multi-shop group currently spiderfied / fanned out
      if (count > 1 && spiderfiedGroupId === group.id) {
        // 1. Center hub marker
        const hubIcon = L.divIcon({
          className: 'custom-map-pin',
          html: `<div class="spiderfy-hub-dot" title="Location Hub (${count} stores)"></div>`,
          iconSize: [14, 14],
          iconAnchor: [7, 7]
        });
        const hubMarker = L.marker([group.lat, group.lng], { icon: hubIcon });
        hubMarker.bindPopup(`
          <div style="font-family: inherit; font-size: 0.8rem; text-align: center;">
            <strong>${count} Stores at this Center</strong><br/>
            <button onclick="window.__linecartCollapseSpiderfy()" style="margin-top: 6px; padding: 4px 10px; font-size: 0.75rem; border-radius: 4px; border: 1px solid #cbd5e1; background: #ffffff; cursor: pointer;">
              Collapse Pins
            </button>
          </div>
        `);
        spiderfyLayerRef.current.addLayer(hubMarker);

        // 2. Radial spiderfied pins
        const radius = 0.00032; // ~35 meters
        group.shops.forEach((shop, idx) => {
          const angle = (2 * Math.PI * idx) / count;
          const offsetLat = group.lat + radius * Math.cos(angle);
          const offsetLng = group.lng + (radius / Math.cos(group.lat * Math.PI / 180)) * Math.sin(angle);

          // Connector line
          const line = L.polyline([[group.lat, group.lng], [offsetLat, offsetLng]], {
            color: '#0284c7',
            weight: 2,
            dashArray: '3, 4',
            opacity: 0.8
          });
          spiderfyLayerRef.current.addLayer(line);

          // Individual fanned-out marker
          const isOrdered = shop.hasOrdered;
          const markerColor = isOrdered ? '#16a34a' : '#64748b';
          const badgeIcon = isOrdered ? '✓' : '•';

          const fannedIcon = L.divIcon({
            className: 'custom-map-pin',
            html: `
              <div class="pin-marker ${isOrdered ? 'pin-ordered' : 'pin-idle'}" title="${escapeHtml(shop.shopName)}">
                <div class="spiderfy-pin-bubble" style="background: ${markerColor}">
                  <span class="pin-symbol">${badgeIcon}</span>
                </div>
                <div class="pin-shadow"></div>
              </div>
            `,
            iconSize: [24, 32],
            iconAnchor: [12, 30],
            popupAnchor: [0, -28]
          });

          const fannedMarker = L.marker([offsetLat, offsetLng], { icon: fannedIcon });
          const popupHtml = `
            <div class="map-popup-card">
              <div class="popup-header">
                <span class="popup-title">${escapeHtml(shop.shopName)}</span>
                <span class="popup-category">${escapeHtml(shop.shopCategory || 'Retail')}</span>
              </div>
              <div class="popup-details">
                ${shop.ownerName ? `<div class="popup-row">👤 <span>${escapeHtml(shop.ownerName)}</span></div>` : ''}
                ${shop.contact1 ? `<div class="popup-row">📞 <a href="tel:${safeTel(shop.contact1)}" class="popup-tel">${escapeHtml(shop.contact1)}</a></div>` : ''}
                ${shop.address ? `<div class="popup-row muted-row">📍 <span>${escapeHtml(shop.address)}</span></div>` : ''}
              </div>
              <div class="popup-status-badge ${isOrdered ? 'status-ordered' : 'status-not-ordered'}">
                ${isOrdered
                  ? `<strong>✓ Ordered:</strong> ₹${shop.orderTotal?.toLocaleString('en-IN')} (${shop.orderCount} order${shop.orderCount > 1 ? 's' : ''})`
                  : '⚠️ No orders recorded in this period'}
              </div>
              <div class="popup-actions" style="display: flex; gap: 6px; margin-top: 8px;">
                <button onclick="window.__linecartSelectShop(${Number(shop.shopid) || 0})" style="flex: 1; padding: 4px 8px; font-size: 0.75rem; background: #0284c7; color: #fff; border: none; border-radius: 4px; cursor: pointer;">
                  Select Shop
                </button>
                <button onclick="window.__linecartCollapseSpiderfy()" style="padding: 4px 8px; font-size: 0.75rem; background: #f1f5f9; color: #475569; border: 1px solid #cbd5e1; border-radius: 4px; cursor: pointer;">
                  Collapse
                </button>
              </div>
            </div>
          `;
          fannedMarker.bindPopup(popupHtml, { maxWidth: 300 });
          fannedMarker.on('click', () => {
            setSelectedShop(shop);
            setSelectedGroup(group);
          });
          spiderfyLayerRef.current.addLayer(fannedMarker);
        });

        return;
      }

      // CASE B: Multi-shop group pin (collapsed cluster)
      if (count > 1) {
        const isAllOrdered = group.orderedCount === count;
        const hasAnyOrdered = group.orderedCount > 0;
        const markerColor = isAllOrdered ? '#16a34a' : hasAnyOrdered ? '#2563eb' : '#64748b';

        const groupIcon = L.divIcon({
          className: 'custom-map-pin-group',
          html: `
            <div class="pin-marker ${hasAnyOrdered ? 'pin-ordered' : 'pin-idle'}" title="${count} shops at this location">
              <div class="pin-bubble group-bubble" style="background: ${markerColor}">
                <span class="group-count-text">${count}</span>
              </div>
              <div class="pin-shadow"></div>
            </div>
          `,
          iconSize: [30, 38],
          iconAnchor: [15, 36],
          popupAnchor: [0, -34]
        });

        const groupMarker = L.marker([group.lat, group.lng], { icon: groupIcon });

        const groupPopupHtml = `
          <div class="map-popup-group-card">
            <div class="group-popup-header">
              <div>
                <div class="group-popup-title">📍 ${count} Stores at this Location</div>
                <div class="group-popup-subtitle">${Number(group.orderedCount) || 0} Ordered · ${Number(group.notOrderedCount) || 0} Idle</div>
              </div>
            </div>

            <button class="btn-spiderfy-action" onclick="window.__linecartSpiderfyGroup('${String(group.id).replace(/[^A-Za-z0-9_.:-]/g, '')}')">
              🕸️ Fan Out ${count} Pins on Map
            </button>

            <div class="group-shops-scroll-list">
              ${group.shops.map((s) => `
                <div class="group-shop-row-card">
                  <div class="group-shop-header-row">
                    <span class="group-shop-name">${escapeHtml(s.shopName)}</span>
                    <span class="group-shop-badge ${s.hasOrdered ? 'badge-ordered-chip' : 'badge-idle-chip'}">
                      ${s.hasOrdered ? `✓ ₹${(s.orderTotal || 0).toLocaleString('en-IN')}` : 'No orders'}
                    </span>
                  </div>
                  <div style="font-size: 0.72rem; color: #64748b;">
                    ${s.ownerName ? `<span>👤 ${escapeHtml(s.ownerName)}</span> · ` : ''}
                    ${s.contact1 ? `<a href="tel:${safeTel(s.contact1)}" style="color: #0284c7; text-decoration: none;">📞 ${escapeHtml(s.contact1)}</a>` : 'No phone'}
                  </div>
                  <button onclick="window.__linecartSelectShop(${Number(s.shopid) || 0})" style="margin-top: 4px; padding: 3px 6px; font-size: 0.7rem; border-radius: 4px; border: 1px solid #cbd5e1; background: #ffffff; cursor: pointer; align-self: flex-start;">
                    Inspect Store Details ➔
                  </button>
                </div>
              `).join('')}
            </div>
          </div>
        `;

        groupMarker.bindPopup(groupPopupHtml, { maxWidth: 320 });
        groupMarker.on('click', () => {
          setSelectedGroup(group);
          setSelectedShop(group.shops[0]);
        });

        markersLayerRef.current.addLayer(groupMarker);
        return;
      }

      // CASE C: Single isolated shop pin
      const singleShop = group.shops[0];
      const isOrdered = singleShop.hasOrdered;
      const markerColor = isOrdered ? '#16a34a' : '#64748b';
      const badgeIcon = isOrdered ? '✓' : '•';

      const singleIcon = L.divIcon({
        className: 'custom-map-pin',
        html: `
          <div class="pin-marker ${isOrdered ? 'pin-ordered' : 'pin-idle'}" title="${escapeHtml(singleShop.shopName)}">
            <div class="pin-bubble" style="background: ${markerColor}">
              <span class="pin-symbol">${badgeIcon}</span>
            </div>
            <div class="pin-shadow"></div>
          </div>
        `,
        iconSize: [28, 36],
        iconAnchor: [14, 34],
        popupAnchor: [0, -32]
      });

      const singleMarker = L.marker([group.lat, group.lng], { icon: singleIcon });
      const singlePopupHtml = `
        <div class="map-popup-card">
          <div class="popup-header">
            <span class="popup-title">${escapeHtml(singleShop.shopName)}</span>
            <span class="popup-category">${escapeHtml(singleShop.shopCategory || 'Retail')}</span>
          </div>
          <div class="popup-details">
            ${singleShop.ownerName ? `<div class="popup-row">👤 <span>${escapeHtml(singleShop.ownerName)}</span></div>` : ''}
            ${singleShop.contact1 ? `<div class="popup-row">📞 <a href="tel:${safeTel(singleShop.contact1)}" class="popup-tel">${escapeHtml(singleShop.contact1)}</a></div>` : ''}
            ${singleShop.address ? `<div class="popup-row muted-row">📍 <span>${escapeHtml(singleShop.address)}</span></div>` : ''}
          </div>
          <div class="popup-status-badge ${isOrdered ? 'status-ordered' : 'status-not-ordered'}">
            ${isOrdered
              ? `<strong>✓ Ordered:</strong> ₹${singleShop.orderTotal?.toLocaleString('en-IN')} (${singleShop.orderCount} order${singleShop.orderCount > 1 ? 's' : ''})`
              : '⚠️ No orders recorded in this period'}
          </div>
          <div class="popup-actions">
            <a href="https://www.google.com/maps?q=${Number(singleShop.latitude)},${Number(singleShop.longitude)}" target="_blank" rel="noopener noreferrer" class="popup-maps-link">
              Open in Google Maps ↗
            </a>
          </div>
        </div>
      `;

      singleMarker.bindPopup(singlePopupHtml, { maxWidth: 300 });
      singleMarker.on('click', () => {
        setSelectedShop(singleShop);
        setSelectedGroup(group);
      });

      markersLayerRef.current.addLayer(singleMarker);
    });

    if (bounds.length > 0 && !spiderfiedGroupId) {
      try {
        mapInstanceRef.current.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
      } catch (err) {
        console.warn('fitBounds error', err);
      }
    }
  }, [locationGroups, spiderfiedGroupId]);

  return (
    <div className="manager-map-page">
      {/* Header */}
      <div className="page-header-row">
        <div>
          <h1 className="page-title">Cluster Shop Map</h1>
          <p className="page-subtitle">
            {isAdmin
              ? 'Organization-wide interactive map showing customer shops, geolocation, and order activity'
              : 'Interactive map view showing customer shops, geolocation, and order activity for assigned team'}
          </p>
        </div>
      </div>

      {/* KPI & Status Filter Pills */}
      <div className="map-kpi-bar card">
        <div className="filter-pill-group">
          <button
            type="button"
            className={`map-pill ${filterMode === 'all' ? 'active' : ''}`}
            onClick={() => setFilterMode('all')}
          >
            All Shops ({summary.total})
          </button>
          <button
            type="button"
            className={`map-pill pill-ordered ${filterMode === 'ordered' ? 'active' : ''}`}
            onClick={() => setFilterMode('ordered')}
          >
            <span className="dot-indicator dot-green"></span>
            Ordered ({summary.orderedCount})
          </button>
          <button
            type="button"
            className={`map-pill pill-not-ordered ${filterMode === 'not_ordered' ? 'active' : ''}`}
            onClick={() => setFilterMode('not_ordered')}
          >
            <span className="dot-indicator dot-gray"></span>
            Did Not Order ({summary.notOrderedCount})
          </button>
        </div>

        {/* Cluster, Manager & Date Selectors */}
        <div className="map-toolbar-controls">
          <div className="map-control-item">
            <label>Cluster:</label>
            <select
              value={selectedCluster}
              onChange={(e) => setSelectedCluster(e.target.value)}
              className="map-select"
            >
              <option value="all">All Clusters</option>
              {clusters.map((c) => (
                <option key={c.clusterId} value={c.clusterId}>
                  {c.clusterName || `Cluster ${c.clusterId}`}
                </option>
              ))}
            </select>
          </div>

          {isAdmin && (
            <div className="map-control-item">
              <label>Manager:</label>
              <select
                value={selectedManager}
                onChange={(e) => setSelectedManager(e.target.value)}
                className="map-select"
              >
                <option value="all">All Managers (Org-wide)</option>
                {managersList.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="map-control-item">
            <label>From:</label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="map-date-input"
            />
          </div>

          <div className="map-control-item">
            <label>To:</label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="map-date-input"
            />
          </div>
        </div>
      </div>

      {/* Spiderfy Reset Banner if active */}
      {spiderfiedGroupId && (
        <div className="card" style={{ padding: '0.6rem 1rem', background: '#eff6ff', border: '1px solid #bfdbfe', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '0.8125rem', color: '#1e40af', fontWeight: 600 }}>
            🕸️ Spiderfy active: Fanned out overlapping stores at selected location
          </span>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setSpiderfiedGroupId(null)}
            style={{ padding: '0.25rem 0.75rem', fontSize: '0.75rem' }}
          >
            Collapse Pins
          </button>
        </div>
      )}

      {/* Missing Coordinates Warning Banner */}
      {unmappedShops.length > 0 && (
        <div className="unmapped-warning-banner card">
          <div className="unmapped-banner-content">
            <span className="warning-icon">⚠️</span>
            <div>
              <strong>{unmappedShops.length} shop(s) have missing or invalid GPS coordinates</strong>
              <p>These stores remain counted in totals but cannot be plotted until latitude/longitude coordinates are registered.</p>
            </div>
          </div>
          <button
            type="button"
            className="btn-unmapped-toggle"
            onClick={() => setShowUnmappedList(!showUnmappedList)}
          >
            {showUnmappedList ? 'Hide List ▲' : 'View Unmapped Shops ▼'}
          </button>
        </div>
      )}

      {/* Accordion List of Unmapped Shops */}
      {showUnmappedList && unmappedShops.length > 0 && (
        <div className="unmapped-shops-list card">
          <h4 className="unmapped-title">Shops Without Coordinates ({unmappedShops.length})</h4>
          <div className="unmapped-grid">
            {unmappedShops.map((s) => (
              <div key={s.shopid} className="unmapped-item">
                <strong>{s.shopName}</strong>
                <span className="muted-text">{s.shopCategory || 'Retail'} · {s.contact1 || 'No phone'}</span>
                <small className="muted-text address-line">{s.address || 'Address unrecorded'}</small>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main Map Container */}
      <div className="card map-wrapper-card">
        {loading && <div className="map-loading-overlay">Loading shop coordinates &amp; orders...</div>}
        <div ref={mapContainerRef} className="leaflet-map-canvas" style={{ height: '520px', width: '100%', borderRadius: '10px' }} />

        {/* Map Legend */}
        <div className="map-legend-overlay">
          <span className="legend-title">LEGEND</span>
          <div className="legend-row">
            <span className="legend-pin green-pin">✓</span>
            <span>Ordered in period ({summary.orderedCount})</span>
          </div>
          <div className="legend-row">
            <span className="legend-pin gray-pin">•</span>
            <span>Did not order ({summary.notOrderedCount})</span>
          </div>
          <div className="legend-row" style={{ marginTop: '4px', paddingTop: '4px', borderTop: '1px solid #e2e8f0' }}>
            <span style={{ display: 'inline-block', width: '18px', height: '18px', borderRadius: '50%', background: '#2563eb', color: '#fff', fontSize: '10px', textAlign: 'center', lineHeight: '18px', fontWeight: 'bold' }}>
              N
            </span>
            <span>Shared Location Group</span>
          </div>
        </div>
      </div>

      {/* Selected Shop / Group Floating Quick Card */}
      {selectedShop && (
        <div className="card selected-shop-card">
          <div className="selected-shop-header">
            <div>
              <span className="shop-kicker">
                {selectedGroup && selectedGroup.shops.length > 1
                  ? `SHARED LOCATION (${selectedGroup.shops.length} STORES)`
                  : 'SELECTED STORE PIN'}
              </span>
              <h3 className="shop-name-title">{selectedShop.shopName}</h3>
            </div>
            <button
              type="button"
              className="btn-close-sm"
              onClick={() => {
                setSelectedShop(null);
                setSelectedGroup(null);
              }}
            >
              ✕
            </button>
          </div>

          {/* If selected group has multiple stores, provide switcher tabs */}
          {selectedGroup && selectedGroup.shops.length > 1 && (
            <div className="group-tabs-bar">
              {selectedGroup.shops.map((s) => (
                <button
                  key={s.shopid}
                  type="button"
                  className={`group-tab-btn ${selectedShop.shopid === s.shopid ? 'active' : ''}`}
                  onClick={() => setSelectedShop(s)}
                >
                  {s.hasOrdered ? '✓ ' : ''}{s.shopName}
                </button>
              ))}
            </div>
          )}

          <div className="selected-shop-body">
            <div className="shop-info-cols">
              <div>
                <span className="info-label">CATEGORY &amp; CLUSTER</span>
                <div className="info-value">{selectedShop.shopCategory || 'Retail'} · Cluster {selectedShop.clusterid}</div>
              </div>
              <div>
                <span className="info-label">CONTACT PERSON</span>
                <div className="info-value">{selectedShop.ownerName || 'Store Manager'} ({selectedShop.contact1 || 'N/A'})</div>
              </div>
              <div>
                <span className="info-label">ORDER STATUS</span>
                <div className={`info-value ${selectedShop.hasOrdered ? 'text-green' : 'text-muted'}`}>
                  {selectedShop.hasOrdered
                    ? `✓ Placed ${selectedShop.orderCount} order(s) (₹${selectedShop.orderTotal?.toLocaleString('en-IN')})`
                    : 'No orders recorded in current filter period'}
                </div>
              </div>
            </div>

            <div className="shop-actions-row">
              {selectedShop.contact1 && (
                <a href={`tel:${selectedShop.contact1}`} className="btn-secondary btn-sm">
                  📞 Call Store
                </a>
              )}
              {selectedShop.hasValidCoords && (
                <a
                  href={`https://www.google.com/maps?q=${selectedShop.latitude},${selectedShop.longitude}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-primary btn-sm"
                >
                  📍 Open in Google Maps
                </a>
              )}
              {selectedGroup && selectedGroup.shops.length > 1 && !spiderfiedGroupId && (
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={() => setSpiderfiedGroupId(selectedGroup.id)}
                >
                  🕸️ Fan Out {selectedGroup.shops.length} Pins
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
