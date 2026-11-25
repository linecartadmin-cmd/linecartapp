import React, { useState, useRef, useEffect } from 'react';
import { MapPin, Camera, Loader2 } from 'lucide-react';
import { Icon, registerOverlay } from '../ui';
import { api } from '../api';
import { formatShopId, getGoogleMapsUrl } from '../utils';
import { fetchCurrentDeviceLocation, reverseGeocodeCoordinates } from '../utils/locationService';

const SHOP_CATEGORIES = ['Retail', 'SuperMarket', 'HoReCa', 'ChainRetail', 'FruitShop'];
const PAYMENT_MODES = ['Online', 'Cash'];

export default function CustomersScreen({
  user,
  clusters = [],
  shops = [],
  defaultViewMode = 'list',
  onShopAdded,
  onOrderForCustomer,
  showToast
}) {
  const [viewMode, setViewMode] = useState(defaultViewMode); // 'list' or 'newCustomer'

  // Android back on the add-shop form returns to the shop list instead of leaving Shops (and
  // dropping what was typed); dialogs opened from the form register later and still close first.
  useEffect(() => {
    if (viewMode === 'list') return undefined;
    return registerOverlay({ onRequestClose: () => setViewMode('list') });
  }, [viewMode]);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [selectedClusterFilter, setSelectedClusterFilter] = useState('all');
  const [salespersonFilter, setSalespersonFilter] = useState('all');
  const [assignmentStatusFilter, setAssignmentStatusFilter] = useState('all');
  const [selectedShopIds, setSelectedShopIds] = useState([]);
  const [bulkActionAgentId, setBulkActionAgentId] = useState('');
  const [isBulkSubmitting, setIsBulkSubmitting] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 12;

  const roleLower = (user?.role || '').toLowerCase();
  const isAdmin = roleLower === 'admin';
  const isManager = roleLower === 'sales manager';
  const isAgent = !isAdmin && !isManager;
  const canAssign = isAdmin || isManager;

  const [assignableAgents, setAssignableAgents] = useState([]);
  const [localShops, setLocalShops] = useState(shops);
  const [assigningShopId, setAssigningShopId] = useState(null);

  useEffect(() => {
    setLocalShops(shops);
  }, [shops]);

  useEffect(() => {
    if (!canAssign) return;
    if (isAdmin) {
      api.getAdminUsers()
        .then((res) => {
          if (res?.users) {
            setAssignableAgents(res.users.filter((u) => (u.role || '').toLowerCase() === 'field sales agent'));
          }
        })
        .catch(() => {});
    } else if (isManager && user?.id) {
      api.getManagerAssignments(user.id)
        .then((res) => {
          const list = res?.assignedAgents || res?.agents || [];
          setAssignableAgents(list.filter((u) => (u.role || '').toLowerCase() === 'field sales agent'));
        })
        .catch(() => {});
    }
  }, [canAssign, isAdmin, isManager, user?.id]);

  const handleAssignAgent = async (shopId, agentId) => {
    if (!canAssign) return;
    const isUnassign = agentId === '' || agentId === 'unassign' || agentId === null;
    setAssigningShopId(shopId);
    try {
      const res = await api.assignShopAgent(shopId, isUnassign ? null : Number(agentId));
      if (res && (res.status === 200 || res.status === 1)) {
        showToast(res.message || (isUnassign ? 'Shop unassigned successfully!' : 'Shop assigned successfully!'));
        setLocalShops((prev) =>
          prev.map((s) => (Number(s.shopid) === Number(shopId) ? {
            ...s,
            assignedAgentId: isUnassign ? null : Number(agentId),
            assigned_agent_id: isUnassign ? null : Number(agentId),
            assignedAgentName: isUnassign ? 'Unassigned' : (assignableAgents.find(a => Number(a.id) === Number(agentId))?.name || `Agent #${agentId}`)
          } : s))
        );
      } else {
        showToast(res?.message || 'Failed to update shop assignment.');
      }
    } catch {
      showToast('Error connecting to assignment service.');
    } finally {
      setAssigningShopId(null);
    }
  };

  const handleBulkAssign = async () => {
    if (!canAssign || selectedShopIds.length === 0 || !bulkActionAgentId) return;
    const isUnassign = bulkActionAgentId === 'unassign';
    setIsBulkSubmitting(true);
    try {
      const res = await api.bulkAssignShops(
        selectedShopIds,
        isUnassign ? null : Number(bulkActionAgentId),
        isUnassign ? 'Admin bulk unassignment' : 'Admin bulk assignment'
      );
      if (res && (res.status === 200 || res.status === 1)) {
        showToast(res.message || 'Bulk assignment completed successfully!');
        const newAid = isUnassign ? null : Number(bulkActionAgentId);
        const newName = isUnassign ? 'Unassigned' : (assignableAgents.find(a => Number(a.id) === Number(bulkActionAgentId))?.name || `Agent #${bulkActionAgentId}`);
        const updatedIds = new Set(selectedShopIds.map(Number));
        setLocalShops((prev) =>
          prev.map((s) => (updatedIds.has(Number(s.shopid)) ? {
            ...s,
            assignedAgentId: newAid,
            assigned_agent_id: newAid,
            assignedAgentName: newName
          } : s))
        );
        setSelectedShopIds([]);
        setBulkActionAgentId('');
      } else {
        showToast(res?.message || 'Failed to complete bulk assignment.');
      }
    } catch {
      showToast('Error connecting to bulk assignment service.');
    } finally {
      setIsBulkSubmitting(false);
    }
  };

  const handleToggleSelectShop = (shopId) => {
    const sid = Number(shopId);
    setSelectedShopIds((prev) =>
      prev.includes(sid) ? prev.filter((id) => id !== sid) : [...prev, sid]
    );
  };

  const handleSelectAllCurrentShops = () => {
    const pageShopIds = paginatedShops.map((s) => Number(s.shopid));
    const allSelected = pageShopIds.length > 0 && pageShopIds.every((id) => selectedShopIds.includes(id));
    if (allSelected) {
      setSelectedShopIds((prev) => prev.filter((id) => !pageShopIds.includes(id)));
    } else {
      setSelectedShopIds((prev) => Array.from(new Set([...prev, ...pageShopIds])));
    }
  };

  // Form state for adding new customer
  const [formData, setFormData] = useState({
    clusterid: 1,
    shopName: '',
    shopCategory: 'Retail',
    ownerName: '',
    contact1: '',
    contact2: '',
    paymentmode: 'Online',
    latitude: '10.658300',
    longitude: '77.008200',
    address: '',
    pincode: '642100'
  });
  const [surveyItems, setSurveyItems] = useState([]);
  const [photoPreview, setPhotoPreview] = useState('/no_image.jpg');
  const [photoFile, setPhotoFile] = useState(null);
  const [isPhotoUploaded, setIsPhotoUploaded] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locationFeedback, setLocationFeedback] = useState(null);
  const fileInputRef = useRef(null);

  const initials = (name) =>
    (name || 'Shop')
      .split(/\s+/)
      .slice(0, 2)
      .map((x) => x[0])
      .join('')
      .toUpperCase();

  // Initialize survey items from cluster
  useEffect(() => {
    const c = clusters.find((cl) => Number(cl.clusterId) === Number(formData.clusterid)) || clusters[0];
    if (c?.surveyItemsList) {
      setSurveyItems(
        c.surveyItemsList.map((it) => ({
          itemid: it.itemid,
          itemName: it.itemName,
          value: ''
        }))
      );
    }
  }, [formData.clusterid, clusters]);

  // Reverse geocode coordinates and fill street address & pincode when available
  const applyReverseGeocode = async (lat, lon) => {
    const geo = await reverseGeocodeCoordinates(lat, lon);
    if (geo.ok && geo.address) {
      setFormData((prev) => ({
        ...prev,
        address: geo.address,
        pincode: geo.pincode || prev.pincode
      }));
      return true;
    }
    return false;
  };

  const handleMapCanvasClick = async (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = (e.clientX - rect.left) / rect.width - 0.5;
    const relY = 0.5 - (e.clientY - rect.top) / rect.height;
    const baseLat = parseFloat(formData.latitude) || 10.6583;
    const baseLon = parseFloat(formData.longitude) || 77.0082;
    const newLat = (baseLat + relY * 0.008).toFixed(6);
    const newLon = (baseLon + relX * 0.008).toFixed(6);
    setFormData((prev) => ({ ...prev, latitude: String(newLat), longitude: String(newLon) }));
    setLocationFeedback({
      type: 'info',
      reason: 'manual_pin',
      message: `Pin placed manually at ${newLat}, ${newLon}. Looking up street address…`
    });
    const filled = await applyReverseGeocode(newLat, newLon);
    setLocationFeedback({
      type: 'success',
      reason: 'manual_pin',
      message: filled
        ? `Manual map pin set (${newLat}, ${newLon}) and street address updated.`
        : `Manual map pin set (${newLat}, ${newLon}). Enter or edit the street address if needed.`
    });
  };

  // Shared one-shot location flow used by both "Use current location" and "GPS Detect"
  const handleUseCurrentLocation = async () => {
    if (locating) return;
    setLocating(true);
    setLocationFeedback({
      type: 'info',
      reason: 'loading',
      message: 'Requesting device GPS location…'
    });

    try {
      const loc = await fetchCurrentDeviceLocation();
      if (!loc.ok) {
        setLocationFeedback({
          type: 'error',
          reason: loc.reason || 'unavailable',
          message: loc.message
        });
        if (showToast) showToast(loc.message);
        return;
      }

      setFormData((prev) => ({
        ...prev,
        latitude: String(loc.latitude),
        longitude: String(loc.longitude)
      }));

      setLocationFeedback({
        type: 'info',
        reason: 'geocoding',
        message: `GPS coordinates found (${loc.latitude}, ${loc.longitude}). Looking up street address…`
      });

      const addressFilled = await applyReverseGeocode(loc.latitude, loc.longitude);
      const accSuffix = loc.accuracy ? ` (±${loc.accuracy}m)` : '';

      if (loc.lowAccuracy) {
        const msg = addressFilled
          ? `Approximate location captured (${loc.latitude}, ${loc.longitude}${accSuffix}) and street address filled. Please verify the map pin or tap the map to adjust.`
          : `Approximate location captured (${loc.latitude}, ${loc.longitude}${accSuffix}), but street address could not be auto-filled. Verify the map pin and enter the street address manually.`;
        setLocationFeedback({
          type: 'warning',
          reason: 'low_accuracy',
          message: msg
        });
        if (showToast) showToast('Approximate GPS location captured. Please verify the map pin.');
      } else if (addressFilled) {
        setLocationFeedback({
          type: 'success',
          reason: 'ok',
          message: `Current location captured (${loc.latitude}, ${loc.longitude}${accSuffix}) and street address filled.`
        });
        if (showToast) showToast('Current GPS location and street address updated.');
      } else {
        setLocationFeedback({
          type: 'warning',
          reason: 'geocode_unavailable',
          message: `Current GPS coordinates captured (${loc.latitude}, ${loc.longitude}${accSuffix}), but street address could not be auto-filled. Please type the street address manually.`
        });
        if (showToast) showToast('GPS coordinates updated. Please enter the street address.');
      }
    } finally {
      setLocating(false);
    }
  };

  const handlePhotoChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      setPhotoFile(file);
      setIsPhotoUploaded(true);
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          setPhotoPreview(reader.result);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSaveCustomer = async (e) => {
    if (e) e.preventDefault();

    if (!formData.clusterid) {
      showToast('Please select a valid cluster.');
      return;
    }
    if (!formData.shopName.trim()) {
      showToast('Please enter a valid shop name.');
      return;
    }
    if (!formData.ownerName.trim()) {
      showToast('Please enter a valid owner name.');
      return;
    }
    if (!formData.contact1.trim()) {
      showToast('Please enter a primary contact number.');
      return;
    }
    const parsedLat = parseFloat(formData.latitude);
    const parsedLon = parseFloat(formData.longitude);
    if (
      !formData.latitude ||
      !formData.longitude ||
      !Number.isFinite(parsedLat) ||
      !Number.isFinite(parsedLon) ||
      parsedLat < -90 ||
      parsedLat > 90 ||
      parsedLon < -180 ||
      parsedLon > 180
    ) {
      showToast('Invalid location coordinates. Use current location or tap on the map.');
      return;
    }
    if (!formData.address.trim()) {
      showToast('Please enter a delivery address.');
      return;
    }
    if (!formData.pincode.trim()) {
      showToast('Please enter a postal pincode.');
      return;
    }

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      showToast('Shop registration requires an active internet connection.');
      return;
    }

    setSubmitting(true);
    const customerPayload = {
      clusterid: Number(formData.clusterid),
      shopName: formData.shopName.trim(),
      shopCategory: formData.shopCategory,
      ownerName: formData.ownerName.trim(),
      contact1: formData.contact1.trim(),
      contact2: formData.contact2.trim(),
      latitude: parseFloat(formData.latitude) || 0,
      longitude: parseFloat(formData.longitude) || 0,
      address: formData.address.trim(),
      pincode: formData.pincode.trim(),
      paymentmode: formData.paymentmode === 'Cash' ? 1 : 0,
      createdby: Number(user?.id || localStorage.getItem('LineCartPref_userid') || 1),
      survey: surveyItems.map((it) => ({ itemid: it.itemid, qty: parseFloat(it.value) || 0 }))
    };

    try {
      const res = await api.addCustomer(customerPayload, photoFile);
      if (res && (res.status === 200 || res.status === 1)) {
        showToast(`Store ${formData.shopName} registered successfully!`);
        if (onShopAdded) {
          onShopAdded({
            shopid: Number(res.id) || Math.floor(Math.random() * 9000 + 1000),
            ...customerPayload
          });
        }
        setViewMode('list');
      } else {
        showToast(res?.message || 'Failed to create customer.');
      }
    } catch {
      showToast('Failed to connect to customer service.');
    } finally {
      setSubmitting(false);
    }
  };

  // Strictly restrict shop visibility to the agent's assigned shops (no fallback to true)
  const visibleShops = isAgent
    ? localShops.filter((s) => {
        const rawAid = s.assignedAgentId !== undefined && s.assignedAgentId !== null
          ? s.assignedAgentId
          : (s.assigned_agent_id !== undefined && s.assigned_agent_id !== null ? s.assigned_agent_id : null);
        const aid = rawAid !== null && !isNaN(Number(rawAid)) && Number(rawAid) > 0 ? Number(rawAid) : null;
        if (aid !== null && user?.id !== undefined && user?.id !== null) {
          return aid === Number(user.id);
        }
        return false;
      })
    : localShops;

  // Filter clusters for agents so only routes containing their assigned shops are included
  const availableClusters = (() => {
    if (!isAgent) return clusters;
    const shopClusterIds = Array.from(
      new Set(visibleShops.map((s) => Number(s.clusterid || s.clusterId)).filter((id) => id > 0))
    );
    if (shopClusterIds.length > 0) {
      const matched = clusters.filter((c) => shopClusterIds.includes(Number(c.clusterId)));
      if (matched.length === shopClusterIds.length) return matched;
      return shopClusterIds.map((cid) => {
        const found = clusters.find((c) => Number(c.clusterId) === cid);
        return found || {
          clusterId: cid,
          clusterName: cid === 2 ? 'Thuthukudi' : `Cluster #${cid}`
        };
      });
    }
    if (clusters.length === 1) return clusters;
    if (user?.clusterid) {
      const userCluster = clusters.find((c) => Number(c.clusterId) === Number(user.clusterid));
      return userCluster ? [userCluster] : [{ clusterId: Number(user.clusterid), clusterName: Number(user.clusterid) === 2 ? 'Thuthukudi' : 'Pollachi and Udumalapet' }];
    }
    return [];
  })();

  const hasSingleAssignedCluster = isAgent && availableClusters.length <= 1;
  const singleAssignedCluster = hasSingleAssignedCluster
    ? availableClusters[0] ||
      clusters.find((c) => Number(c.clusterId) === Number(user?.clusterid || 1)) || {
        clusterId: Number(user?.clusterid || 1),
        clusterName: Number(user?.clusterid) === 2 ? 'Thuthukudi' : 'Pollachi and Udumalapet'
      }
    : null;

  useEffect(() => {
    if (hasSingleAssignedCluster && singleAssignedCluster) {
      const cidStr = String(singleAssignedCluster.clusterId);
      if (selectedClusterFilter !== 'all' && selectedClusterFilter !== cidStr) {
        setSelectedClusterFilter('all');
      }
      if (Number(formData.clusterid) !== Number(singleAssignedCluster.clusterId)) {
        setFormData((prev) => ({ ...prev, clusterid: Number(singleAssignedCluster.clusterId) }));
      }
    } else if (isAgent && availableClusters.length >= 2) {
      const validIds = availableClusters.map((c) => Number(c.clusterId));
      if (!validIds.includes(Number(formData.clusterid))) {
        setFormData((prev) => ({ ...prev, clusterid: validIds[0] }));
      }
      if (selectedClusterFilter !== 'all' && !validIds.includes(Number(selectedClusterFilter))) {
        setSelectedClusterFilter('all');
      }
    }
  }, [hasSingleAssignedCluster, singleAssignedCluster?.clusterId, isAgent, availableClusters.length, selectedClusterFilter, formData.clusterid]);

  // Filter shops for directory view
  const filteredShops = visibleShops.filter((s) => {
    if (hasSingleAssignedCluster && singleAssignedCluster) {
      if (Number(s.clusterid || s.clusterId) !== Number(singleAssignedCluster.clusterId)) {
        return false;
      }
    } else if (selectedClusterFilter !== 'all' && Number(s.clusterid || s.clusterId) !== Number(selectedClusterFilter)) {
      return false;
    }
    if (categoryFilter !== 'All' && (s.shopCategory || 'Retail').toLowerCase() !== categoryFilter.toLowerCase()) return false;
    if (canAssign) {
      const rawAid = s.assignedAgentId !== undefined && s.assignedAgentId !== null
        ? s.assignedAgentId
        : (s.assigned_agent_id !== undefined && s.assigned_agent_id !== null ? s.assigned_agent_id : null);
      const aid = rawAid !== null && !isNaN(Number(rawAid)) && Number(rawAid) > 0 ? Number(rawAid) : null;

      if (assignmentStatusFilter === 'assigned' && aid === null) return false;
      if (assignmentStatusFilter === 'unassigned' && aid !== null) return false;

      if (salespersonFilter === 'unassigned' && aid !== null) return false;
      if (salespersonFilter !== 'all' && salespersonFilter !== 'unassigned' && aid !== Number(salespersonFilter)) return false;
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const match =
        (s.shopName || '').toLowerCase().includes(q) ||
        (s.ownerName || '').toLowerCase().includes(q) ||
        formatShopId(s.shopid).toLowerCase().includes(q) ||
        String(s.shopid).includes(q) ||
        (s.address || '').toLowerCase().includes(q) ||
        String(s.contact1 || '').includes(q);
      if (!match) return false;
    }
    return true;
  });

  const totalPages = Math.ceil(filteredShops.length / pageSize) || 1;
  const paginatedShops = filteredShops.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  return (
    <div>
      {viewMode === 'list' ? (
        /* --- VIEW A: CUSTOMER DIRECTORY --- */
        <div className="shops-page">
          <div className="page-heading">
            <div>
              <p className="eyebrow">CUSTOMER DIRECTORY</p>
              <h1>Customers</h1>
              <p>Manage retail produce accounts and keep shop routes close at hand.</p>
            </div>
            <button
              className="primary-button"
              onClick={() => {
                setLocationFeedback(null);
                setViewMode('newCustomer');
              }}
            >
              ＋ &nbsp;Add customer
            </button>
          </div>

          <div className="shops-toolbar">
            <div className="shops-search-row">
              <div className="shops-search-wrap">
                <input
                  className="search-input shops-search-input"
                  placeholder="Search customer, owner, or area..."
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setCurrentPage(1);
                  }}
                />
              </div>

              {hasSingleAssignedCluster ? (
                <div className="shops-cluster-filter-wrap shops-single-cluster-badge" data-testid="assigned-cluster-label">
                  <span className="shops-cluster-label">ASSIGNED CLUSTER</span>
                  <strong className="shops-cluster-static-value">
                    📍 {singleAssignedCluster?.clusterName || 'Assigned Route'} ({visibleShops.length})
                  </strong>
                </div>
              ) : (
                <div className="shops-cluster-filter-wrap">
                  <label htmlFor="shopsClusterSelect" className="shops-cluster-label">
                    {isAgent ? 'ASSIGNED CLUSTERS' : 'CLUSTER'}
                  </label>
                  <select
                    id="shopsClusterSelect"
                    className="select shops-cluster-select"
                    value={selectedClusterFilter}
                    onChange={(e) => {
                      setSelectedClusterFilter(e.target.value);
                      setCurrentPage(1);
                    }}
                  >
                    <option value="all">
                      {isAgent ? `All assigned clusters (${visibleShops.length})` : `All clusters (${visibleShops.length})`}
                    </option>
                    {availableClusters.map((c) => {
                      const count = visibleShops.filter((s) => Number(s.clusterid || s.clusterId) === Number(c.clusterId)).length;
                      return (
                        <option key={c.clusterId} value={String(c.clusterId)}>
                          {c.clusterName} ({count})
                        </option>
                      );
                    })}
                  </select>
                </div>
              )}

              <span className="shops-count-badge">
                {filteredShops.length} {isAgent ? 'assigned' : 'registered'} {filteredShops.length === 1 ? 'customer' : 'customers'}
              </span>
            </div>

            {canAssign && (
              <div className="shops-admin-filters-row flex items-center justify-between gap-3 flex-wrap pt-2 border-t border-slate-100">
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="shops-salesperson-filter flex items-center gap-2">
                    <label htmlFor="shopsSalespersonSelect" className="text-xs font-semibold text-slate-500 whitespace-nowrap">
                      SALESPERSON:
                    </label>
                    <select
                      id="shopsSalespersonSelect"
                      className="select text-xs py-1 px-2 border border-slate-200 rounded-lg"
                      value={salespersonFilter}
                      onChange={(e) => {
                        setSalespersonFilter(e.target.value);
                        setCurrentPage(1);
                      }}
                    >
                      <option value="all">All Salespeople</option>
                      <option value="unassigned">Unassigned Shops Only</option>
                      {assignableAgents.map((ag) => {
                        const count = localShops.filter(
                          (s) => Number(s.assignedAgentId ?? s.assigned_agent_id) === Number(ag.id)
                        ).length;
                        return (
                          <option key={ag.id} value={String(ag.id)}>
                            {ag.name} ({count} shops)
                          </option>
                        );
                      })}
                    </select>
                  </div>

                  <div className="shops-status-pills flex items-center gap-1 bg-slate-100 p-1 rounded-lg">
                    {[
                      { id: 'all', label: 'All Status' },
                      { id: 'assigned', label: 'Assigned' },
                      { id: 'unassigned', label: 'Unassigned' }
                    ].map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        className={`text-xs px-2.5 py-1 rounded-md font-medium transition-colors ${
                          assignmentStatusFilter === tab.id
                            ? 'bg-white text-emerald-700 shadow-sm font-semibold'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                        onClick={() => {
                          setAssignmentStatusFilter(tab.id);
                          setCurrentPage(1);
                        }}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                </div>

                {paginatedShops.length > 0 && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="text-xs px-3 py-1 border border-slate-200 rounded-lg bg-white text-slate-700 hover:bg-slate-50 font-medium transition-colors"
                      onClick={handleSelectAllCurrentShops}
                    >
                      {paginatedShops.every((s) => selectedShopIds.includes(Number(s.shopid)))
                        ? 'Deselect Page'
                        : `Select Page (${paginatedShops.length})`}
                    </button>
                    {selectedShopIds.length > 0 && (
                      <button
                        type="button"
                        className="text-xs text-rose-600 hover:underline font-medium"
                        onClick={() => setSelectedShopIds([])}
                      >
                        Clear Selection ({selectedShopIds.length})
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="shops-tabs-wrap">
              <div className="tabs shops-tabs">
                {['All', ...SHOP_CATEGORIES].map((cat) => (
                  <button
                    key={cat}
                    className={`tab ${categoryFilter === cat ? 'selected' : ''}`}
                    onClick={() => {
                      setCategoryFilter(cat);
                      setCurrentPage(1);
                    }}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {visibleShops.length === 0 ? (
            <div className="p-12 text-center bg-white rounded-2xl border border-slate-200 m-4 shadow-sm">
              <div className="text-4xl mb-3">🏪</div>
              <h3 className="text-lg font-bold text-slate-800 mb-1">
                {isAgent ? 'No Assigned Shops' : 'No Shops Available'}
              </h3>
              <p className="text-sm text-slate-500 max-w-sm mx-auto">
                {isAgent
                  ? 'You have no assigned shops yet. Please contact your manager or Admin to have customer stores assigned to your route.'
                  : 'No customer stores found.'}
              </p>
            </div>
          ) : (
            <>
              {/* Customer Cards Grid */}
              <div className="customer-cards">
                {paginatedShops.map((c) => (
                  <article key={c.shopid} className="customer-card">
                    <div className="customer-card-top">
                      {canAssign && (
                        <input
                          type="checkbox"
                          className="mr-2 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                          checked={selectedShopIds.includes(Number(c.shopid))}
                          onChange={() => handleToggleSelectShop(c.shopid)}
                          aria-label={`Select ${c.shopName}`}
                        />
                      )}
                      <span className="customer-dot">{initials(c.shopName)}</span>
                      <div className="flex-1">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <h3>{c.shopName}</h3>
                          <span className="shop-code-pill">{formatShopId(c.shopid)}</span>
                        </div>
                        <small>ID: {c.shopid} · {c.shopCategory || 'Retail'}</small>
                      </div>
                    </div>

                    <div className="customer-meta">
                      <span>
                        Contact{' '}
                        <b>
                          {c.contact1 ? (
                            <a href={`tel:${c.contact1}`} className="text-[#12aee2] hover:underline">
                              {c.contact1}
                            </a>
                          ) : (
                            '—'
                          )}
                        </b>
                      </span>
                      <span>
                        Owner <b>{c.ownerName || '—'}</b>
                      </span>
                      <span>
                        Cluster <b>{clusters.find((cl) => Number(cl.clusterId) === Number(c.clusterid || c.clusterId))?.clusterName || (Number(c.clusterid) === 2 ? 'Thuthukudi' : 'Pollachi and Udumalapet')}</b>
                      </span>
                      <span>
                        Payment <b>{Number(c.paymentmode) === 1 ? 'Cash' : 'Online'}</b>
                      </span>
                      <span>
                        Area <b>{(c.address || '').split(',')[0] || 'Local Cluster'}</b>
                      </span>
                      <span>
                        Assigned Agent{' '}
                        <b>
                          {c.assignedAgentName ||
                           assignableAgents.find((a) => Number(a.id) === Number(c.assignedAgentId || c.assigned_agent_id))?.name ||
                           (c.assignedAgentId ? `Agent #${c.assignedAgentId}` : 'Unassigned')}
                        </b>
                      </span>
                    </div>

                    {canAssign && (
                      <div className="customer-card-assignment mt-3 pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
                        <label htmlFor={`assign-${c.shopid}`} className="text-[11px] font-semibold text-slate-500">
                          Assign Agent:
                        </label>
                        <select
                          id={`assign-${c.shopid}`}
                          className="select text-xs py-1 px-2 border border-slate-200 rounded-lg max-w-[180px]"
                          value={c.assignedAgentId || c.assigned_agent_id || ''}
                          disabled={assigningShopId === c.shopid}
                          onChange={(e) => handleAssignAgent(c.shopid, e.target.value)}
                        >
                          <option value="">Choose Agent</option>
                          <option value="unassign">-- Unassign (Remove) --</option>
                          {assignableAgents.map((ag) => (
                            <option key={ag.id} value={ag.id}>
                              {ag.name} ({ag.employeeId || `ID: ${ag.id}`})
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    <div className="customer-card-foot">
                      <span className="today-label">Pin: {c.pincode || '642100'}</span>
                      <div className="customer-card-actions">
                        {getGoogleMapsUrl(c) && (
                          <a
                            href={getGoogleMapsUrl(c)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="map-location-link"
                            title={`View ${c.shopName} on Google Maps`}
                          >
                            <span className="map-pin-icon">📍</span>
                            <span>Maps</span>
                            <span className="external-arrow">↗</span>
                          </a>
                        )}
                        <button
                          className="new-order-action-btn"
                          onClick={() => {
                            if (onOrderForCustomer) onOrderForCustomer(c.shopName);
                          }}
                        >
                          New order →
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>

              {/* Pagination */}
              <div className="table-footer mt-4">
                <span>
                  Showing {filteredShops.length ? (currentPage - 1) * pageSize + 1 : 0}–
                  {Math.min(currentPage * pageSize, filteredShops.length)} of {filteredShops.length} stores
                </span>
                <div className="pagination">
                  <button
                    disabled={currentPage <= 1}
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  >
                    ‹
                  </button>
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    const pageNum = i + 1;
                    return (
                      <button
                        key={pageNum}
                        className={currentPage === pageNum ? 'active' : ''}
                        onClick={() => setCurrentPage(pageNum)}
                      >
                        {pageNum}
                      </button>
                    );
                  })}
                  <button
                    disabled={currentPage >= totalPages}
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  >
                    ›
                  </button>
                </div>
              </div>

              {/* Floating Bulk Action Bar */}
              {canAssign && selectedShopIds.length > 0 && (
                <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 bg-slate-900 text-white px-5 py-3 rounded-2xl shadow-2xl border border-slate-700 flex items-center gap-4 flex-wrap max-w-xl w-[90%] justify-between">
                  <div className="flex items-center gap-2">
                    <span className="bg-emerald-500 text-slate-950 text-xs font-bold px-2 py-0.5 rounded-full">
                      {selectedShopIds.length}
                    </span>
                    <span className="text-sm font-semibold">
                      {selectedShopIds.length === 1 ? 'shop selected' : 'shops selected'}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 flex-1 justify-end">
                    <select
                      className="text-xs bg-slate-800 text-white border border-slate-600 rounded-lg py-1.5 px-2.5 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      value={bulkActionAgentId}
                      onChange={(e) => setBulkActionAgentId(e.target.value)}
                    >
                      <option value="">Select Action / Agent</option>
                      <option value="unassign">-- Bulk Unassign --</option>
                      {assignableAgents.map((ag) => (
                        <option key={ag.id} value={ag.id}>
                          Assign to {ag.name}
                        </option>
                      ))}
                    </select>

                    <button
                      type="button"
                      disabled={!bulkActionAgentId || isBulkSubmitting}
                      className="text-xs bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-bold px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
                      onClick={handleBulkAssign}
                    >
                      {isBulkSubmitting ? 'Applying...' : 'Apply'}
                    </button>

                    <button
                      type="button"
                      className="text-xs text-slate-400 hover:text-white px-2 py-1.5 cursor-pointer"
                      onClick={() => setSelectedShopIds([])}
                    >
                      Clear
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      ) : (
        /* --- VIEW B: ADD CUSTOMER FORM --- */
        <>
          <div className="page-heading">
            <div>
              <p className="eyebrow">CUSTOMER DIRECTORY</p>
              <h1>Add a customer</h1>
              <p>Capture a shop’s details, location coordinates, and weekly requirements to start ordering.</p>
            </div>
            <button
              type="button"
              className="secondary-button icon-back-btn"
              onClick={() => setViewMode('list')}
              title="Go back"
              aria-label="Go back"
            >
              <span aria-hidden="true">←</span>
              <span className="sr-only">Go back</span>
            </button>
          </div>

          <form onSubmit={handleSaveCustomer} className="form-grid">
            {/* Left Panel: Shop Details */}
            <section className="panel form-panel">
              <h2>Shop details</h2>
              <p className="section-help">Basic information for the registered store profile.</p>

              <div className="field-grid">
                <div className="field-group">
                  <label htmlFor="regCluster">Assigned Cluster Route *</label>
                  {hasSingleAssignedCluster ? (
                    <div
                      id="regCluster"
                      className="field shops-single-cluster-readonly"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        background: '#f8fafc',
                        fontWeight: 700,
                        color: '#0f172a'
                      }}
                    >
                      <span>📍 {singleAssignedCluster?.clusterName || 'Assigned Route'}</span>
                    </div>
                  ) : (
                    <select
                      id="regCluster"
                      className="select"
                      value={formData.clusterid}
                      onChange={(e) => setFormData({ ...formData, clusterid: Number(e.target.value) })}
                    >
                      {availableClusters.map((c) => (
                        <option key={c.clusterId} value={c.clusterId}>
                          {c.clusterName}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                <div className="field-group">
                  <label htmlFor="regShopName">Shop name *</label>
                  <input
                    id="regShopName"
                    className="field"
                    required
                    maxLength={50}
                    placeholder="e.g. Green Valley Stores"
                    value={formData.shopName}
                    onChange={(e) => setFormData({ ...formData, shopName: e.target.value })}
                  />
                </div>

                <div className="field-group">
                  <label htmlFor="regCategory">Shop category *</label>
                  <select
                    id="regCategory"
                    className="select"
                    value={formData.shopCategory}
                    onChange={(e) => setFormData({ ...formData, shopCategory: e.target.value })}
                  >
                    {SHOP_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="field-group">
                  <label htmlFor="regOwner">Owner name *</label>
                  <input
                    id="regOwner"
                    className="field"
                    required
                    maxLength={50}
                    placeholder="Full owner name"
                    value={formData.ownerName}
                    onChange={(e) => setFormData({ ...formData, ownerName: e.target.value })}
                  />
                </div>

                <div className="field-group">
                  <label htmlFor="regPhone1">Contact number 1 *</label>
                  <input
                    id="regPhone1"
                    className="field"
                    required
                    type="tel"
                    maxLength={13}
                    placeholder="Primary mobile phone"
                    value={formData.contact1}
                    onChange={(e) => setFormData({ ...formData, contact1: e.target.value })}
                  />
                </div>

                <div className="field-group">
                  <label htmlFor="regPhone2">Contact number 2</label>
                  <input
                    id="regPhone2"
                    className="field"
                    type="tel"
                    maxLength={13}
                    placeholder="Secondary phone (optional)"
                    value={formData.contact2}
                    onChange={(e) => setFormData({ ...formData, contact2: e.target.value })}
                  />
                </div>

                <div className="field-group">
                  <label htmlFor="regPayment">Mode of payment</label>
                  <select
                    id="regPayment"
                    className="select"
                    value={formData.paymentmode}
                    onChange={(e) => setFormData({ ...formData, paymentmode: e.target.value })}
                  >
                    {PAYMENT_MODES.map((mode) => (
                      <option key={mode} value={mode}>
                        {mode}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="field-group">
                  <label htmlFor="regPincode">Pin code *</label>
                  <input
                    id="regPincode"
                    name="pincode"
                    className="field"
                    required
                    inputMode="numeric"
                    autoComplete="postal-code"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    maxLength={6}
                    placeholder="642100"
                    value={formData.pincode}
                    onChange={(e) => setFormData({ ...formData, pincode: e.target.value })}
                  />
                </div>

                <div className="field-group full">
                  <label htmlFor="regAddress">Full street address *</label>
                  <textarea
                    id="regAddress"
                    name="address"
                    className="textarea"
                    required
                    maxLength={250}
                    autoComplete="street-address"
                    aria-describedby={locationFeedback ? 'regLocationStatus' : undefined}
                    placeholder="Street name, landmark, area, city"
                    value={formData.address}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  />

                  <div className="address-location-bar">
                    <button
                      type="button"
                      id="useCurrentLocationBtn"
                      data-testid="use-current-location-btn"
                      className="use-current-location-btn"
                      disabled={locating}
                      onClick={handleUseCurrentLocation}
                    >
                      {locating ? <Icon icon={Loader2} size={16} /> : <Icon icon={MapPin} size={16} />}
                      <span>{locating ? 'Detecting location…' : 'Use current location'}</span>
                    </button>
                    <span className="address-location-hint">
                      Fetches device GPS, updates pin, and fills street address
                    </span>
                  </div>

                  {locationFeedback && (
                    <div
                      id="regLocationStatus"
                      data-testid="location-status-banner"
                      data-reason={locationFeedback.reason}
                      role={locationFeedback.type === 'error' ? 'alert' : 'status'}
                      aria-live="polite"
                      className={`location-status-banner is-${locationFeedback.type}`}
                    >
                      <span className="location-status-icon" aria-hidden="true">
                        {locationFeedback.type === 'error'
                          ? '⚠️'
                          : locationFeedback.type === 'warning'
                            ? '⚡'
                            : locationFeedback.type === 'success'
                              ? '✓'
                              : 'ℹ️'}
                      </span>
                      <div className="location-status-body">
                        <span className="location-status-text">{locationFeedback.message}</span>
                        {(locationFeedback.type === 'error' || locationFeedback.reason === 'low_accuracy') && (
                          <div className="location-status-actions">
                            <button
                              type="button"
                              data-testid="location-retry-btn"
                              className="location-retry-btn"
                              disabled={locating}
                              onClick={handleUseCurrentLocation}
                            >
                              ↻ Retry
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Weekly Requirement Survey Inputs */}
              <div className="mt-4 pt-3 border-t border-[#edf0f2]">
                <strong className="text-xs font-bold text-[#17232c] block mb-1">
                  Weekly Requirement In Units
                </strong>
                <p className="section-help mb-3">Estimated initial commodity volumes requested by store.</p>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  {surveyItems.map((item, idx) => (
                    <div key={item.itemid || idx} className="field-group">
                      <label className="text-[10px] text-slate-500 truncate" title={item.itemName}>
                        {item.itemName}
                      </label>
                      <input
                        type="number"
                        min="0"
                        className="field"
                        style={{ height: '32px', fontSize: '11px' }}
                        placeholder="0"
                        value={item.value}
                        onChange={(e) => {
                          const val = e.target.value;
                          setSurveyItems((prev) =>
                            prev.map((s, i) => (i === idx ? { ...s, value: val } : s))
                          );
                        }}
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Storefront Verification Photo */}
              <div className="mt-4 pt-3 border-t border-[#edf0f2]">
                <strong className="text-xs font-bold text-[#17232c] block mb-1">
                  Storefront Verification Photo
                </strong>
                <div className="flex items-center gap-3 mt-2">
                  <img
                    src={photoPreview}
                    alt="Preview"
                    className="w-16 h-16 object-cover rounded-lg border border-[#e4e9eb] bg-white cursor-pointer"
                    onClick={() => fileInputRef.current?.click()}
                  />
                  <div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={handlePhotoChange}
                    />
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <Icon icon={Camera} size={16} /> {isPhotoUploaded ? 'Change photo' : 'Upload photo'}
                    </button>
                    <span className="block text-[10px] text-slate-400 mt-1">
                      {isPhotoUploaded ? 'Store photo attached' : 'Optional storefront photo verification'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="form-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setViewMode('list')}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="primary-button"
                  disabled={submitting}
                >
                  {submitting ? 'Saving...' : 'Save customer'}
                </button>
              </div>
            </section>

            {/* Right Panel: Location & Map */}
            <aside className="panel form-panel">
              <h2>GPS Location & Geocoding</h2>
              <p className="section-help">Use device GPS or tap anywhere on the map to pin the shop and auto-detect address.</p>

              <div className="coords-row-wrap">
                <div className="coords-field-row" data-testid="lat-lon-row">
                  <div className="field-group">
                    <label htmlFor="regLat">Latitude</label>
                    <input
                      id="regLat"
                      name="latitude"
                      type="text"
                      inputMode="decimal"
                      autoCorrect="off"
                      autoCapitalize="off"
                      spellCheck={false}
                      className="field coord-input"
                      value={formData.latitude}
                      onChange={(e) => setFormData({ ...formData, latitude: e.target.value })}
                    />
                  </div>
                  <div className="field-group">
                    <label htmlFor="regLon">Longitude</label>
                    <input
                      id="regLon"
                      name="longitude"
                      type="text"
                      inputMode="decimal"
                      autoCorrect="off"
                      autoCapitalize="off"
                      spellCheck={false}
                      className="field coord-input"
                      value={formData.longitude}
                      onChange={(e) => setFormData({ ...formData, longitude: e.target.value })}
                    />
                  </div>
                </div>
              </div>

              {/* Interactive Map Box */}
              <div
                onClick={handleMapCanvasClick}
                data-testid="registration-map-box"
                title="Tap map to set pin and auto-fill address"
                className="w-full h-[220px] rounded-lg mt-3 bg-[#e8e4d8] relative overflow-hidden border border-[#edf1f2] cursor-crosshair shadow-inner"
              >
                <iframe
                  title="Shop Location Map"
                  src={`https://www.openstreetmap.org/export/embed.html?bbox=${
                    (parseFloat(formData.longitude) || 77.0082) - 0.005
                  }%2C${(parseFloat(formData.latitude) || 10.6583) - 0.005}%2C${
                    (parseFloat(formData.longitude) || 77.0082) + 0.005
                  }%2C${(parseFloat(formData.latitude) || 10.6583) + 0.005}&layer=mapnik&marker=${
                    parseFloat(formData.latitude) || 10.6583
                  }%2C${parseFloat(formData.longitude) || 77.0082}`}
                  className="w-full h-full pointer-events-none border-0"
                />

                {/* GPS Locate Button */}
                <button
                  type="button"
                  id="gpsDetectMapBtn"
                  data-testid="gps-detect-btn"
                  disabled={locating}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleUseCurrentLocation();
                  }}
                  title="Locate with device GPS"
                  className="gps-detect-map-btn"
                >
                  <span aria-hidden="true">{locating ? '⏳' : '⌖'}</span>
                  <span>{locating ? 'Locating…' : 'GPS Detect'}</span>
                </button>

                {/* Center Red Pin */}
                <div
                  data-testid="shop-map-pin"
                  className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-full pointer-events-none z-10 flex flex-col items-center"
                >
                  <span className="bg-white/95 text-[#17232c] text-[10px] font-bold px-1.5 py-0.5 rounded shadow mb-0.5 whitespace-nowrap">
                    Shop ({(parseFloat(formData.latitude) || 10.6583).toFixed(4)}, {(parseFloat(formData.longitude) || 77.0082).toFixed(4)})
                  </span>
                  <div className="w-4 h-4 rounded-full bg-red-600 border-2 border-white shadow-md"></div>
                </div>
              </div>

              {locationFeedback && (
                <div
                  data-testid="map-location-status"
                  role={locationFeedback.type === 'error' ? 'alert' : 'status'}
                  aria-live="polite"
                  className={`location-status-banner is-${locationFeedback.type} mt-2.5`}
                >
                  <span className="location-status-icon" aria-hidden="true">
                    {locationFeedback.type === 'error'
                      ? '⚠️'
                      : locationFeedback.type === 'warning'
                        ? '⚡'
                        : locationFeedback.type === 'success'
                          ? '✓'
                          : 'ℹ️'}
                  </span>
                  <div className="location-status-body">
                    <span className="location-status-text">{locationFeedback.message}</span>
                    {(locationFeedback.type === 'error' || locationFeedback.reason === 'low_accuracy') && (
                      <div className="location-status-actions">
                        <button
                          type="button"
                          className="location-retry-btn"
                          disabled={locating}
                          onClick={handleUseCurrentLocation}
                        >
                          ↻ Retry
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <span className="text-[11px] text-slate-500 block mt-2 text-center">
                Tap anywhere on map to reposition storefront coordinates manually
              </span>
            </aside>
          </form>
        </>
      )}
    </div>
  );
}
