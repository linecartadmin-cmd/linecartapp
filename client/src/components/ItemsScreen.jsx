import React, { useState, useEffect, useMemo } from 'react';
import { api } from '../api';
import {
  queuePriceUpdate,
  resolvePriceConflictKeepServer,
  resolvePriceConflictOverwrite,
  getNetworkState,
  subscribeSyncState
} from '../offline/syncEngine';
import { getSyncQueue } from '../offline/offlineDb';

export default function ItemsScreen({ user, clusters = [], showToast, onNavigate }) {
  const isAdmin = (user?.role || '').toLowerCase() === 'admin';
  const isManager = (user?.role || '').toLowerCase() === 'sales manager';

  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [serverClusters, setServerClusters] = useState([]);
  const [authorizedClusterIds, setAuthorizedClusterIds] = useState([]);
  const [selectedCluster, setSelectedCluster] = useState('all');
  const [statusFilter, setStatusFilter] = useState('active'); // 'all' | 'active' | 'archived'
  const [unitFilter, setUnitFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [pendingPriceMutations, setPendingPriceMutations] = useState([]);

  // Modals
  const [priceModalOpen, setPriceModalOpen] = useState(false);
  const [selectedItemForPrice, setSelectedItemForPrice] = useState(null);
  const [priceForm, setPriceForm] = useState({
    newPrice: '',
    clusterId: '1',
    effectiveDate: new Date().toISOString().slice(0, 10)
  });
  const [priceModalError, setPriceModalError] = useState('');
  const [savingPrice, setSavingPrice] = useState(false);

  // Price History Modal
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [historyItem, setHistoryItem] = useState(null);
  const [historyList, setHistoryList] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Admin Add / Edit Product Modal
  const [productModalOpen, setProductModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [productForm, setProductForm] = useState({
    itemName: '',
    unitType: 'Kgs',
    price: '',
    kgsPerUnit: 50,
    itemImage: ''
  });
  const [productModalError, setProductModalError] = useState('');
  const [savingProduct, setSavingProduct] = useState(false);

  // Conflict Resolution Modal
  const [conflictModalOpen, setConflictModalOpen] = useState(false);
  const [activeConflict, setActiveConflict] = useState(null);

  // Load items from backend or offline cache
  const loadItems = async () => {
    setLoading(true);
    try {
      const clusterParam = selectedCluster === 'all' ? 'all' : selectedCluster;
      const res = await api.getItems(clusterParam, user?.id);
      if (res && res.items) {
        setItems(res.items);
        if (res.clusters && res.clusters.length > 0) {
          setServerClusters(res.clusters);
        }
        if (res.authorizedClusterIds) {
          setAuthorizedClusterIds(res.authorizedClusterIds);
          if (isManager && res.authorizedClusterIds.length > 0 && selectedCluster === 'all') {
            setSelectedCluster(String(res.authorizedClusterIds[0]));
          }
        }
      }
    } catch (err) {
      console.warn('[ItemsScreen] Could not fetch remote items; loaded from cache if available:', err);
      if (showToast) showToast('Working in offline mode: viewing cached catalog');
    } finally {
      setLoading(false);
    }
  };

  // Sync state & network listeners
  useEffect(() => {
    loadItems();

    const refreshPendingQueue = async () => {
      if (!user?.id) return;
      try {
        const queue = await getSyncQueue(user.id);
        const priceMutations = queue.filter(
          (m) => m.type === 'UPDATE_ITEM_PRICE' && (m.status === 'waiting' || m.status === 'syncing' || m.status === 'failed')
        );
        setPendingPriceMutations(priceMutations);

        // Check if any mutation has conflict
        const conflict = priceMutations.find((m) => m.isConflict);
        if (conflict && !conflictModalOpen) {
          setActiveConflict(conflict);
        }
      } catch {}
    };

    refreshPendingQueue();

    const unsubSync = subscribeSyncState((state) => {
      if (state.isOnline !== undefined) setIsOnline(state.isOnline);
      refreshPendingQueue();
    });

    const handlePricesUpdated = () => {
      loadItems();
      refreshPendingQueue();
    };

    const handlePriceConflict = (e) => {
      if (e.detail?.mutation) {
        setActiveConflict(e.detail.mutation);
        setConflictModalOpen(true);
      }
    };

    window.addEventListener('linecart:prices_updated', handlePricesUpdated);
    window.addEventListener('linecart:price_conflict', handlePriceConflict);

    return () => {
      unsubSync();
      window.removeEventListener('linecart:prices_updated', handlePricesUpdated);
      window.removeEventListener('linecart:price_conflict', handlePriceConflict);
    };
  }, [user?.id, selectedCluster]);

  const activeClusters = useMemo(() => {
    if (serverClusters.length > 0) return serverClusters;
    if (clusters.length > 0) return clusters;
    return [
      { clusterId: 1, clusterName: 'Pollachi and Udumalapet' },
      { clusterId: 2, clusterName: 'Thuthukudi' }
    ];
  }, [serverClusters, clusters]);

  // Permitted clusters for user
  const selectableClusters = useMemo(() => {
    if (isAdmin) return activeClusters;
    if (isManager && authorizedClusterIds.length > 0) {
      return activeClusters.filter((c) => authorizedClusterIds.includes(Number(c.clusterId)));
    }
    return activeClusters;
  }, [isAdmin, isManager, activeClusters, authorizedClusterIds]);

  // Filtered Items
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      // Search
      if (search.trim()) {
        const q = search.toLowerCase();
        const matchName = (item.itemName || '').toLowerCase().includes(q);
        const matchId = String(item.itemId || item.itemid || '').includes(q);
        if (!matchName && !matchId) return false;
      }

      // Status
      if (statusFilter === 'active' && Number(item.active ?? 1) !== 1) return false;
      if (statusFilter === 'archived' && Number(item.active ?? 1) !== 0) return false;

      // Unit
      if (unitFilter !== 'all' && (item.unitType || 'Kgs') !== unitFilter) return false;

      return true;
    });
  }, [items, search, statusFilter, unitFilter]);

  // Unique unit types for filter dropdown
  const availableUnits = useMemo(() => {
    const set = new Set(items.map((i) => i.unitType || 'Kgs'));
    return Array.from(set);
  }, [items]);

  // Quick Open Daily Price Modal
  const openPriceUpdate = (item) => {
    setSelectedItemForPrice(item);
    const effCluster = selectedCluster !== 'all' ? selectedCluster : (selectableClusters[0]?.clusterId ? String(selectableClusters[0].clusterId) : '1');
    const existingClusterPrice = item.clusterPrices && item.clusterPrices[effCluster] ? item.clusterPrices[effCluster].price : item.currentPrice || item.basePrice || item.price || 0;

    setPriceForm({
      newPrice: String(existingClusterPrice),
      clusterId: String(effCluster),
      effectiveDate: new Date().toISOString().slice(0, 10)
    });
    setPriceModalError('');
    setPriceModalOpen(true);
  };

  // Quick Price Adjust (+/-)
  const adjustPriceDelta = (delta) => {
    const cur = parseFloat(priceForm.newPrice) || 0;
    const next = Math.max(0, parseFloat((cur + delta).toFixed(2)));
    setPriceForm((prev) => ({ ...prev, newPrice: String(next) }));
  };

  // Submit Daily Price Update
  const handleSavePrice = async (e) => {
    if (e) e.preventDefault();
    setPriceModalError('');

    const val = parseFloat(priceForm.newPrice);
    if (isNaN(val) || val < 0) {
      setPriceModalError('Please enter a valid non-negative price (e.g. ₹55.50).');
      return;
    }

    if (!selectedItemForPrice) return;

    const clusterIdNum = Number(priceForm.clusterId || 0);

    // Permission Scope Check
    if (isManager && clusterIdNum === 0) {
      setPriceModalError('Sales Managers can only update regional cluster prices, not global base prices.');
      return;
    }
    if (isManager && authorizedClusterIds.length > 0 && !authorizedClusterIds.includes(clusterIdNum)) {
      setPriceModalError(`Cluster #${clusterIdNum} is outside your regional supervision scope.`);
      return;
    }

    setSavingPrice(true);

    const clusterObj = activeClusters.find((c) => Number(c.clusterId) === clusterIdNum);
    const clusterLabel = clusterIdNum === 0 ? 'Global Base' : (clusterObj?.clusterName || `Cluster #${clusterIdNum}`);

    const baseUpdatedAt = selectedItemForPrice.lastUpdatedAt;
    const basePrice = selectedItemForPrice.currentPrice || selectedItemForPrice.basePrice || 0;

    if (!isOnline) {
      // Local-first offline queuing
      try {
        await queuePriceUpdate(user?.id, {
          itemId: selectedItemForPrice.itemId || selectedItemForPrice.itemid,
          clusterId: clusterIdNum,
          newPrice: val,
          effectiveDate: priceForm.effectiveDate,
          basePrice,
          baseUpdatedAt,
          itemName: selectedItemForPrice.itemName,
          clusterName: clusterLabel
        });

        // Update local items state optimistically
        setItems((prev) =>
          prev.map((it) => {
            if (it.itemId === selectedItemForPrice.itemId) {
              return {
                ...it,
                currentPrice: val,
                effectiveDate: priceForm.effectiveDate,
                pendingSyncPrice: val
              };
            }
            return it;
          })
        );

        if (showToast) showToast(`Offline: Saved ₹${val} for ${selectedItemForPrice.itemName}. Queued for sync.`);
        setPriceModalOpen(false);
      } catch (err) {
        setPriceModalError(`Failed to save offline change: ${err.message}`);
      } finally {
        setSavingPrice(false);
      }
      return;
    }

    // Online direct sync
    try {
      const res = await api.updateDailyPrice({
        itemId: selectedItemForPrice.itemId || selectedItemForPrice.itemid,
        clusterId: clusterIdNum,
        newPrice: val,
        effectiveDate: priceForm.effectiveDate,
        basePrice,
        baseUpdatedAt,
        forceOverwrite: false
      });

      if (res && (res.status === 200 || res.status === 1)) {
        if (showToast) showToast(`Daily price for ${selectedItemForPrice.itemName} updated to ₹${val}`);
        setPriceModalOpen(false);
        loadItems();
      } else if (res && res.status === 409) {
        // Concurrent edit detected
        setPriceModalOpen(false);
        setActiveConflict({
          mutationId: null,
          payload: {
            itemId: selectedItemForPrice.itemId,
            clusterId: clusterIdNum,
            newPrice: val,
            effectiveDate: priceForm.effectiveDate,
            itemName: selectedItemForPrice.itemName,
            clusterName: clusterLabel
          },
          conflictData: {
            serverPrice: res.serverPrice,
            serverUpdatedAt: res.serverUpdatedAt,
            serverUpdatedByName: res.serverUpdatedByName,
            clientPrice: val,
            message: res.message
          }
        });
        setConflictModalOpen(true);
      } else {
        setPriceModalError(res?.message || 'Failed to update price on server.');
      }
    } catch (err) {
      // Revert to queue if network dropped
      try {
        await queuePriceUpdate(user?.id, {
          itemId: selectedItemForPrice.itemId || selectedItemForPrice.itemid,
          clusterId: clusterIdNum,
          newPrice: val,
          effectiveDate: priceForm.effectiveDate,
          basePrice,
          baseUpdatedAt,
          itemName: selectedItemForPrice.itemName,
          clusterName: clusterLabel
        });
        if (showToast) showToast(`Network error: Queued ₹${val} for ${selectedItemForPrice.itemName} to sync automatically.`);
        setPriceModalOpen(false);
      } catch (qErr) {
        setPriceModalError(`Connection failed: ${err.message}`);
      }
    } finally {
      setSavingPrice(false);
    }
  };

  // View Price History
  const openHistoryModal = async (item) => {
    setHistoryItem(item);
    setHistoryList([]);
    setLoadingHistory(true);
    setHistoryModalOpen(true);

    try {
      const res = await api.getItemPriceHistory(item.itemId || item.itemid, user?.id);
      if (res && res.history) {
        setHistoryList(res.history);
      }
    } catch (err) {
      console.warn('Failed to load history:', err);
    } finally {
      setLoadingHistory(false);
    }
  };

  // Admin Add / Edit Product
  const openCreateProduct = () => {
    setEditingProduct(null);
    setProductForm({
      itemName: '',
      unitType: 'Kgs',
      price: '',
      kgsPerUnit: 50,
      itemImage: ''
    });
    setProductModalError('');
    setProductModalOpen(true);
  };

  const openEditProduct = (item) => {
    setEditingProduct(item);
    setProductForm({
      itemName: item.itemName,
      unitType: item.unitType || 'Kgs',
      price: String(item.basePrice ?? item.price ?? ''),
      kgsPerUnit: item.kgsPerUnit || item.kgsperunit || 50,
      itemImage: item.itemImage || item.itemimage || ''
    });
    setProductModalError('');
    setProductModalOpen(true);
  };

  const handleSaveProduct = async (e) => {
    if (e) e.preventDefault();
    setProductModalError('');

    if (!productForm.itemName.trim()) {
      setProductModalError('Product name is required.');
      return;
    }

    setSavingProduct(true);
    try {
      if (editingProduct) {
        const res = await api.updateItem(editingProduct.itemId || editingProduct.itemid, {
          itemName: productForm.itemName.trim(),
          unitType: productForm.unitType.trim(),
          kgsPerUnit: Number(productForm.kgsPerUnit) || 50,
          itemImage: productForm.itemImage.trim()
        });
        if (res && (res.status === 200 || res.status === 1)) {
          if (showToast) showToast(`Product '${productForm.itemName}' updated.`);
          setProductModalOpen(false);
          loadItems();
        } else {
          setProductModalError(res?.message || 'Failed to update product.');
        }
      } else {
        const p = parseFloat(productForm.price);
        if (isNaN(p) || p < 0) {
          setProductModalError('Initial base price must be a valid non-negative number.');
          setSavingProduct(false);
          return;
        }

        const res = await api.createItem({
          itemName: productForm.itemName.trim(),
          unitType: productForm.unitType.trim(),
          price: p,
          kgsPerUnit: Number(productForm.kgsPerUnit) || 50,
          itemImage: productForm.itemImage.trim()
        });

        if (res && (res.status === 201 || res.status === 200)) {
          if (showToast) showToast(`New product '${productForm.itemName}' created successfully.`);
          setProductModalOpen(false);
          loadItems();
        } else {
          setProductModalError(res?.message || 'Failed to create product.');
        }
      }
    } catch (err) {
      setProductModalError(`Error: ${err.message}`);
    } finally {
      setSavingProduct(false);
    }
  };

  // Admin Soft Archive / Restore Product
  const handleToggleArchive = async (item) => {
    const isCurrentlyActive = Number(item.active ?? 1) === 1;
    const confirmMsg = isCurrentlyActive
      ? `Archive '${item.itemName}'? It will be hidden from new order entry catalogs, but all past customer orders referencing it are permanently preserved.`
      : `Restore '${item.itemName}' to the active wholesale catalog?`;

    if (!window.confirm(confirmMsg)) return;

    try {
      const res = await api.archiveItem(item.itemId || item.itemid, isCurrentlyActive ? 0 : 1);
      if (res && (res.status === 200 || res.status === 1)) {
        if (showToast) showToast(res.message);
        loadItems();
      } else {
        if (showToast) showToast(res?.message || 'Archive operation failed.');
      }
    } catch (err) {
      if (showToast) showToast(`Error: ${err.message}`);
    }
  };

  // Conflict Resolution Handlers
  const handleResolveConflictKeepServer = async () => {
    if (!activeConflict) return;
    if (activeConflict.mutationId) {
      await resolvePriceConflictKeepServer(activeConflict.mutationId, activeConflict.conflictData?.serverPrice, user?.id);
    }
    setConflictModalOpen(false);
    setActiveConflict(null);
    if (showToast) showToast('Accepted current server price. Local offline change discarded.');
    loadItems();
  };

  const handleResolveConflictOverwrite = async () => {
    if (!activeConflict) return;
    try {
      if (activeConflict.mutationId) {
        await resolvePriceConflictOverwrite(activeConflict.mutationId, user?.id);
      } else {
        // Direct online retry with forceOverwrite = true
        await api.updateDailyPrice({
          itemId: activeConflict.payload.itemId,
          clusterId: activeConflict.payload.clusterId,
          newPrice: activeConflict.payload.newPrice,
          effectiveDate: activeConflict.payload.effectiveDate,
          forceOverwrite: true
        });
      }
      setConflictModalOpen(false);
      setActiveConflict(null);
      if (showToast) showToast(`Overwrote server price with your update (₹${activeConflict.payload.newPrice}).`);
      loadItems();
    } catch (err) {
      if (showToast) showToast(`Failed to overwrite price: ${err.message}`);
    }
  };

  // Find if an item has a pending mutation in outbox
  const getPendingMutationForItem = (itemId) => {
    return pendingPriceMutations.find((m) => Number(m.payload?.itemId) === Number(itemId));
  };

  return (
    <div className="page-content-inner" style={{ paddingBottom: '80px' }}>
      {/* Page Header */}
      <div className="page-heading" style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', marginBottom: '20px' }}>
        <div>
          <div className="eyebrow" style={{ fontSize: '11px', fontWeight: 700, color: '#0284c7', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Wholesale Catalog &amp; Pricing
          </div>
          <h1 style={{ fontSize: '24px', fontWeight: 800, color: '#0f172a', margin: '4px 0' }}>
            Items &amp; Daily Pricing
          </h1>
          <p style={{ margin: 0, fontSize: '13px', color: '#64748b' }}>
            {isAdmin
              ? 'Manage products, define daily commodity rates, and view auditable pricing history.'
              : 'Review catalog commodities and update authorized regional daily prices for store orders.'}
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {!isOnline && (
            <span style={{ fontSize: '12px', fontWeight: 700, color: '#9a3412', background: '#ffedd5', border: '1px solid #fed7aa', padding: '6px 12px', borderRadius: '8px' }}>
              📡 Offline Mode (Local Cache)
            </span>
          )}

          {isAdmin && (
            <button
              type="button"
              className="primary-button"
              onClick={openCreateProduct}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', height: '38px', padding: '0 16px', borderRadius: '8px', background: '#0284c7', color: '#fff', border: 'none', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}
            >
              <span>+</span> Add Product
            </button>
          )}
        </div>
      </div>

      {/* KPI Stats Strip */}
      <div className="stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px', marginBottom: '20px' }}>
        <div className="stat-card" style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Total Commodities</div>
          <div style={{ fontSize: '24px', fontWeight: 800, color: '#0f172a', marginTop: '4px' }}>{items.length}</div>
          <div style={{ fontSize: '11px', color: '#16a34a', marginTop: '2px' }}>
            {items.filter((i) => Number(i.active ?? 1) === 1).length} active for order entry
          </div>
        </div>

        <div className="stat-card" style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Supervised Clusters</div>
          <div style={{ fontSize: '24px', fontWeight: 800, color: '#0f172a', marginTop: '4px' }}>
            {selectableClusters.length}
          </div>
          <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
            {isAdmin ? 'All wholesale hubs' : 'Your regional supervision'}
          </div>
        </div>

        <div className="stat-card" style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Offline Outbox</div>
          <div style={{ fontSize: '24px', fontWeight: 800, color: pendingPriceMutations.length > 0 ? '#d97706' : '#16a34a', marginTop: '4px' }}>
            {pendingPriceMutations.length}
          </div>
          <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
            {pendingPriceMutations.length > 0 ? 'Changes waiting to sync' : 'All rates synced with server'}
          </div>
        </div>
      </div>

      {/* Filter and Search Panel */}
      <div className="card manager-filter-panel" style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '16px', marginBottom: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', alignItems: 'flex-end' }}>
          <div>
            <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#475569', marginBottom: '5px' }}>
              Search Catalog
            </label>
            <input
              type="text"
              className="filter-input"
              placeholder="Search by product name or item #ID..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: '100%', height: '38px', padding: '0 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px' }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#475569', marginBottom: '5px' }}>
              Wholesale Cluster Pricing
            </label>
            <select
              className="filter-select"
              value={selectedCluster}
              onChange={(e) => setSelectedCluster(e.target.value)}
              style={{ width: '100%', height: '38px', padding: '0 10px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', background: '#fff' }}
            >
              {isAdmin && <option value="all">Global Base Rates (All Clusters)</option>}
              {selectableClusters.map((c) => (
                <option key={c.clusterId} value={String(c.clusterId)}>
                  {c.clusterName || `Cluster ${c.clusterId}`}
                </option>
              ))}
            </select>
          </div>

          {isAdmin && (
            <div>
              <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#475569', marginBottom: '5px' }}>
                Catalog Status
              </label>
              <select
                className="filter-select"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                style={{ width: '100%', height: '38px', padding: '0 10px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', background: '#fff' }}
              >
                <option value="active">Active Only</option>
                <option value="archived">Archived Products</option>
                <option value="all">All Products</option>
              </select>
            </div>
          )}

          <div>
            <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#475569', marginBottom: '5px' }}>
              Unit Type
            </label>
            <select
              className="filter-select"
              value={unitFilter}
              onChange={(e) => setUnitFilter(e.target.value)}
              style={{ width: '100%', height: '38px', padding: '0 10px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', background: '#fff' }}
            >
              <option value="all">All Units</option>
              {availableUnits.map((u) => (
                <option key={u} value={u}>{u}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Items Product Cards Grid */}
      {loading ? (
        <div style={{ padding: '60px 20px', textAlign: 'center', color: '#64748b' }}>
          <div style={{ fontSize: '28px', marginBottom: '8px' }}>⏳</div>
          <p style={{ margin: 0, fontWeight: 600 }}>Loading commodities and daily rates...</p>
        </div>
      ) : filteredItems.length === 0 ? (
        <div style={{ padding: '60px 20px', textAlign: 'center', background: '#fff', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: '36px', marginBottom: '10px' }}>📦</div>
          <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#1e293b', margin: '0 0 6px' }}>
            No Products Found
          </h3>
          <p style={{ fontSize: '13px', color: '#64748b', maxWidth: '400px', margin: '0 auto 16px' }}>
            {search || unitFilter !== 'all' || statusFilter !== 'all'
              ? 'No products match your current search criteria. Try resetting filters.'
              : 'The wholesale commodity catalog is currently empty.'}
          </p>
          {isAdmin && (
            <button
              type="button"
              className="primary-button"
              onClick={openCreateProduct}
              style={{ height: '36px', padding: '0 16px', borderRadius: '8px', background: '#0284c7', color: '#fff', border: 'none', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}
            >
              + Create First Product
            </button>
          )}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '16px' }}>
          {filteredItems.map((item) => {
            const pendingMut = getPendingMutationForItem(item.itemId || item.itemid);
            const isArchived = Number(item.active ?? 1) === 0;

            const displayPrice = pendingMut?.payload?.newPrice !== undefined
              ? pendingMut.payload.newPrice
              : item.currentPrice || item.basePrice || item.price || 0;

            return (
              <div
                key={item.itemId || item.itemid}
                style={{
                  background: '#fff',
                  border: isArchived ? '1px dashed #cbd5e1' : '1px solid #e2e8f0',
                  borderRadius: '14px',
                  padding: '18px',
                  boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  opacity: isArchived ? 0.75 : 1
                }}
              >
                <div>
                  {/* Top Bar of Card */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', marginBottom: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <div
                        style={{
                          width: '42px',
                          height: '42px',
                          borderRadius: '10px',
                          background: '#f1f5f9',
                          display: 'grid',
                          placeItems: 'center',
                          fontSize: '20px',
                          border: '1px solid #e2e8f0'
                        }}
                      >
                        {item.itemName.toLowerCase().includes('onion') ? '🧅' :
                         item.itemName.toLowerCase().includes('potato') ? '🥔' :
                         item.itemName.toLowerCase().includes('tomato') ? '🍅' : '📦'}
                      </div>
                      <div>
                        <h3 style={{ fontSize: '16px', fontWeight: 800, color: '#0f172a', margin: '0 0 2px' }}>
                          {item.itemName}
                        </h3>
                        <div style={{ fontSize: '11px', color: '#64748b' }}>
                          Item #{item.itemId || item.itemid} · {item.kgsPerUnit || item.kgsperunit || 50} kg/{item.unitType || 'Kgs'}
                        </div>
                      </div>
                    </div>

                    <span
                      style={{
                        fontSize: '11px',
                        fontWeight: 700,
                        padding: '3px 8px',
                        borderRadius: '12px',
                        background: isArchived ? '#f1f5f9' : '#dcfce7',
                        color: isArchived ? '#64748b' : '#166534'
                      }}
                    >
                      {isArchived ? 'Archived' : 'Active'}
                    </span>
                  </div>

                  {/* Prominent Current Daily Price */}
                  <div
                    style={{
                      background: '#f8fafc',
                      borderRadius: '10px',
                      padding: '12px 14px',
                      marginBottom: '14px',
                      border: '1px solid #edf2f7'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                      <span style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
                        Daily Wholesale Rate
                      </span>
                      {selectedCluster !== 'all' && (
                        <span style={{ fontSize: '11px', color: '#0284c7', fontWeight: 600 }}>
                          Cluster #{selectedCluster}
                        </span>
                      )}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', marginTop: '4px' }}>
                      <span style={{ fontSize: '28px', fontWeight: 900, color: '#0f172a' }}>
                        ₹{Number(displayPrice).toFixed(2)}
                      </span>
                      <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>
                        / {item.unitType || 'Kgs'}
                      </span>
                    </div>

                    <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>
                      {item.effectiveDate ? `Effective ${item.effectiveDate}` : 'Current rate'}
                      {item.lastUpdatedByName && ` · by ${item.lastUpdatedByName}`}
                    </div>
                  </div>

                  {/* Pending Outbox Mutation Pill */}
                  {pendingMut && (
                    <div
                      style={{
                        marginBottom: '12px',
                        padding: '8px 12px',
                        borderRadius: '8px',
                        fontSize: '11.5px',
                        fontWeight: 600,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        background: pendingMut.isConflict ? '#fef2f2' : '#fffbeb',
                        border: pendingMut.isConflict ? '1px solid #fecaca' : '1px solid #fef3c7',
                        color: pendingMut.isConflict ? '#991b1b' : '#92400e'
                      }}
                    >
                      <div>
                        {pendingMut.isConflict ? '⚠️ Rate Conflict on Server' :
                         pendingMut.status === 'syncing' ? '🔄 Syncing rate to server...' :
                         '⏳ Waiting to sync offline rate'}
                      </div>
                      {pendingMut.isConflict && (
                        <button
                          type="button"
                          onClick={() => {
                            setActiveConflict(pendingMut);
                            setConflictModalOpen(true);
                          }}
                          style={{
                            border: 'none',
                            background: '#ef4444',
                            color: '#fff',
                            fontSize: '10px',
                            fontWeight: 700,
                            padding: '3px 8px',
                            borderRadius: '4px',
                            cursor: 'pointer'
                          }}
                        >
                          Resolve
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Card Action Buttons */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', paddingTop: '10px', borderTop: '1px solid #f1f5f9' }}>
                  <button
                    type="button"
                    onClick={() => openPriceUpdate(item)}
                    style={{
                      flex: 1,
                      minWidth: '120px',
                      height: '36px',
                      borderRadius: '8px',
                      background: '#0284c7',
                      color: '#fff',
                      border: 'none',
                      fontWeight: 700,
                      fontSize: '12.5px',
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '5px'
                    }}
                  >
                    <span>⚡</span> Update Price
                  </button>

                  <button
                    type="button"
                    onClick={() => openHistoryModal(item)}
                    style={{
                      height: '36px',
                      padding: '0 12px',
                      borderRadius: '8px',
                      background: '#f8fafc',
                      color: '#334155',
                      border: '1px solid #cbd5e1',
                      fontWeight: 600,
                      fontSize: '12px',
                      cursor: 'pointer'
                    }}
                    title="View Price Audit History"
                  >
                    📜 History
                  </button>

                  {isAdmin && (
                    <>
                      <button
                        type="button"
                        onClick={() => openEditProduct(item)}
                        style={{
                          height: '36px',
                          padding: '0 10px',
                          borderRadius: '8px',
                          background: '#f8fafc',
                          color: '#475569',
                          border: '1px solid #cbd5e1',
                          fontWeight: 600,
                          fontSize: '12px',
                          cursor: 'pointer'
                        }}
                        title="Edit Product Details"
                      >
                        ✏️
                      </button>

                      <button
                        type="button"
                        onClick={() => handleToggleArchive(item)}
                        style={{
                          height: '36px',
                          padding: '0 10px',
                          borderRadius: '8px',
                          background: isArchived ? '#f0fdf4' : '#fff1f2',
                          color: isArchived ? '#166534' : '#be123c',
                          border: isArchived ? '1px solid #bbf7d0' : '1px solid #fecdd3',
                          fontWeight: 600,
                          fontSize: '12px',
                          cursor: 'pointer'
                        }}
                        title={isArchived ? 'Restore Product' : 'Archive Product (Preserves Orders)'}
                      >
                        {isArchived ? '♻️ Restore' : '📦 Archive'}
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ========================================================================= */}
      {/* QUICK DAILY PRICE UPDATE MODAL (Designed for Rapid Daily Operations)       */}
      {/* ========================================================================= */}
      {priceModalOpen && selectedItemForPrice && (
        <div
          className="modal-backdrop"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.65)',
            backdropFilter: 'blur(3px)',
            zIndex: 100,
            display: 'grid',
            placeItems: 'center',
            padding: '16px'
          }}
        >
          <div
            className="modal-card"
            style={{
              background: '#fff',
              borderRadius: '16px',
              maxWidth: '440px',
              width: '100%',
              padding: '24px',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div>
                <h3 style={{ fontSize: '18px', fontWeight: 800, color: '#0f172a', margin: 0 }}>
                  Update Daily Price
                </h3>
                <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>
                  {selectedItemForPrice.itemName} (#{selectedItemForPrice.itemId || selectedItemForPrice.itemid})
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPriceModalOpen(false)}
                style={{ border: 'none', background: 'transparent', fontSize: '20px', color: '#94a3b8', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            {priceModalError && (
              <div style={{ marginBottom: '14px', padding: '10px 12px', borderRadius: '8px', background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', fontSize: '12px' }}>
                {priceModalError}
              </div>
            )}

            <form onSubmit={handleSavePrice}>
              {/* Target Scope / Cluster */}
              <div style={{ marginBottom: '14px' }}>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#475569', marginBottom: '5px' }}>
                  Pricing Region / Cluster *
                </label>
                <select
                  value={priceForm.clusterId}
                  onChange={(e) => setPriceForm((prev) => ({ ...prev, clusterId: e.target.value }))}
                  style={{ width: '100%', height: '38px', padding: '0 10px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', background: '#fff' }}
                >
                  {isAdmin && <option value="0">Global Base Catalog Rate</option>}
                  {selectableClusters.map((c) => (
                    <option key={c.clusterId} value={String(c.clusterId)}>
                      {c.clusterName || `Cluster ${c.clusterId}`}
                    </option>
                  ))}
                </select>
              </div>

              {/* Price Entry with Large Typography & Quick Steppers */}
              <div style={{ marginBottom: '14px' }}>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#475569', marginBottom: '5px' }}>
                  New Price per {selectedItemForPrice.unitType || 'Kgs'} (₹) *
                </label>
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                  <span style={{ position: 'absolute', left: '14px', fontSize: '18px', fontWeight: 800, color: '#64748b' }}>
                    ₹
                  </span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={priceForm.newPrice}
                    onChange={(e) => setPriceForm((prev) => ({ ...prev, newPrice: e.target.value }))}
                    style={{
                      width: '100%',
                      height: '52px',
                      paddingLeft: '32px',
                      paddingRight: '12px',
                      borderRadius: '10px',
                      border: '2px solid #0284c7',
                      fontSize: '24px',
                      fontWeight: 800,
                      color: '#0f172a'
                    }}
                  />
                </div>

                {/* Quick Increment / Decrement Stepper Buttons */}
                <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
                  {[-1, -0.5, 0.5, 1].map((delta) => (
                    <button
                      key={delta}
                      type="button"
                      onClick={() => adjustPriceDelta(delta)}
                      style={{
                        flex: 1,
                        height: '28px',
                        borderRadius: '6px',
                        border: '1px solid #cbd5e1',
                        background: '#f8fafc',
                        fontSize: '11.5px',
                        fontWeight: 700,
                        color: delta < 0 ? '#b91c1c' : '#15803d',
                        cursor: 'pointer'
                      }}
                    >
                      {delta > 0 ? `+₹${delta}` : `-₹${Math.abs(delta)}`}
                    </button>
                  ))}
                </div>
              </div>

              {/* Effective Date */}
              <div style={{ marginBottom: '18px' }}>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#475569', marginBottom: '5px' }}>
                  Effective Date *
                </label>
                <input
                  type="date"
                  required
                  value={priceForm.effectiveDate}
                  onChange={(e) => setPriceForm((prev) => ({ ...prev, effectiveDate: e.target.value }))}
                  style={{ width: '100%', height: '38px', padding: '0 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px' }}
                />
              </div>

              {/* Offline Warning Notice */}
              {!isOnline && (
                <div style={{ marginBottom: '14px', padding: '8px 12px', borderRadius: '8px', background: '#fffbeb', border: '1px solid #fef3c7', color: '#92400e', fontSize: '11.5px' }}>
                  📡 <strong>Offline mode:</strong> This price will be saved locally and synced automatically when internet recovers.
                </div>
              )}

              {/* Action Buttons */}
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={() => setPriceModalOpen(false)}
                  style={{ height: '38px', padding: '0 16px', borderRadius: '8px', border: '1px solid #cbd5e1', background: '#fff', fontSize: '13px', fontWeight: 600, color: '#475569', cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingPrice}
                  style={{ height: '38px', padding: '0 20px', borderRadius: '8px', border: 'none', background: '#0284c7', color: '#fff', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}
                >
                  {savingPrice ? 'Saving...' : 'Save Price Change'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* PRICE AUDIT HISTORY MODAL (Visual Timeline)                               */}
      {/* ========================================================================= */}
      {historyModalOpen && historyItem && (
        <div
          className="modal-backdrop"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.65)',
            backdropFilter: 'blur(3px)',
            zIndex: 100,
            display: 'grid',
            placeItems: 'center',
            padding: '16px'
          }}
        >
          <div
            className="modal-card"
            style={{
              background: '#fff',
              borderRadius: '16px',
              maxWidth: '520px',
              width: '100%',
              padding: '24px',
              maxHeight: '85vh',
              overflowY: 'auto'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div>
                <h3 style={{ fontSize: '18px', fontWeight: 800, color: '#0f172a', margin: 0 }}>
                  Price Change History
                </h3>
                <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>
                  {historyItem.itemName} (#{historyItem.itemId || historyItem.itemid})
                </div>
              </div>
              <button
                type="button"
                onClick={() => setHistoryModalOpen(false)}
                style={{ border: 'none', background: 'transparent', fontSize: '20px', color: '#94a3b8', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            {loadingHistory ? (
              <div style={{ padding: '40px', textAlign: 'center', color: '#64748b' }}>
                <p>Loading historical audit records...</p>
              </div>
            ) : historyList.length === 0 ? (
              <div style={{ padding: '30px', textAlign: 'center', color: '#64748b' }}>
                <p>No recorded price changes for this commodity yet.</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {historyList.map((rec) => {
                  const delta = Number((rec.newPrice - rec.oldPrice).toFixed(2));
                  const isIncrease = delta > 0;
                  return (
                    <div
                      key={rec.id}
                      style={{
                        padding: '12px',
                        borderRadius: '10px',
                        background: '#f8fafc',
                        border: '1px solid #e2e8f0',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                      }}
                    >
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '16px', fontWeight: 800, color: '#0f172a' }}>
                            ₹{Number(rec.newPrice).toFixed(2)}
                          </span>
                          <span style={{ fontSize: '11px', fontWeight: 700, color: isIncrease ? '#15803d' : '#b91c1c' }}>
                            ({isIncrease ? `+₹${delta}` : `-₹${Math.abs(delta)}`})
                          </span>
                          <span style={{ fontSize: '11px', background: '#e2e8f0', padding: '2px 6px', borderRadius: '4px', color: '#475569' }}>
                            {rec.clusterName || (rec.clusterId === 0 ? 'Global Base' : `Cluster ${rec.clusterId}`)}
                          </span>
                        </div>
                        <div style={{ fontSize: '11px', color: '#64748b', marginTop: '3px' }}>
                          Changed by <strong>{rec.changedByName}</strong> · Effective {rec.effectiveDate}
                        </div>
                      </div>

                      <div style={{ fontSize: '10px', color: '#94a3b8', textAlign: 'right' }}>
                        {rec.createdAt ? new Date(rec.createdAt).toLocaleDateString() : ''}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div style={{ marginTop: '20px', textAlign: 'right' }}>
              <button
                type="button"
                onClick={() => setHistoryModalOpen(false)}
                style={{ height: '36px', padding: '0 16px', borderRadius: '8px', border: '1px solid #cbd5e1', background: '#fff', fontSize: '12.5px', fontWeight: 600, color: '#475569', cursor: 'pointer' }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* CONCURRENT EDIT CONFLICT RESOLUTION MODAL                                 */}
      {/* ========================================================================= */}
      {conflictModalOpen && activeConflict && (
        <div
          className="modal-backdrop"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.75)',
            backdropFilter: 'blur(3px)',
            zIndex: 110,
            display: 'grid',
            placeItems: 'center',
            padding: '16px'
          }}
        >
          <div
            className="modal-card"
            style={{
              background: '#fff',
              borderRadius: '16px',
              maxWidth: '480px',
              width: '100%',
              padding: '24px',
              border: '2px solid #ef4444'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
              <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: '#fee2e2', display: 'grid', placeItems: 'center', fontSize: '18px', color: '#dc2626' }}>
                ⚠️
              </div>
              <div>
                <h3 style={{ fontSize: '17px', fontWeight: 800, color: '#991b1b', margin: 0 }}>
                  Concurrent Edit Conflict
                </h3>
                <div style={{ fontSize: '12px', color: '#64748b' }}>
                  {activeConflict.payload?.itemName || 'Commodity rate'} ({activeConflict.payload?.clusterName || 'Region'})
                </div>
              </div>
            </div>

            <p style={{ fontSize: '13px', color: '#334155', lineHeight: 1.5, marginBottom: '16px' }}>
              While you were working offline, another user updated this product rate on the live server. Please choose which price should take effect:
            </p>

            {/* Comparison Box */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '20px' }}>
              <div style={{ padding: '14px', borderRadius: '10px', background: '#f8fafc', border: '1px solid #cbd5e1' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
                  Server Rate (Live)
                </div>
                <div style={{ fontSize: '22px', fontWeight: 900, color: '#0f172a', margin: '4px 0' }}>
                  ₹{Number(activeConflict.conflictData?.serverPrice || 0).toFixed(2)}
                </div>
                <div style={{ fontSize: '10.5px', color: '#64748b' }}>
                  by {activeConflict.conflictData?.serverUpdatedByName || 'System'}
                </div>
              </div>

              <div style={{ padding: '14px', borderRadius: '10px', background: '#f0fdf4', border: '1px solid #bbf7d0' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#166534', textTransform: 'uppercase' }}>
                  Your Offline Rate
                </div>
                <div style={{ fontSize: '22px', fontWeight: 900, color: '#15803d', margin: '4px 0' }}>
                  ₹{Number(activeConflict.payload?.newPrice || 0).toFixed(2)}
                </div>
                <div style={{ fontSize: '10.5px', color: '#166534' }}>
                  Effective {activeConflict.payload?.effectiveDate}
                </div>
              </div>
            </div>

            {/* Resolution Buttons */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <button
                type="button"
                onClick={handleResolveConflictKeepServer}
                style={{
                  height: '40px',
                  borderRadius: '8px',
                  background: '#f8fafc',
                  border: '1px solid #cbd5e1',
                  color: '#334155',
                  fontWeight: 700,
                  fontSize: '13px',
                  cursor: 'pointer'
                }}
              >
                Keep Server Rate (Discard My Change)
              </button>

              <button
                type="button"
                onClick={handleResolveConflictOverwrite}
                style={{
                  height: '40px',
                  borderRadius: '8px',
                  background: '#dc2626',
                  border: 'none',
                  color: '#fff',
                  fontWeight: 700,
                  fontSize: '13px',
                  cursor: 'pointer'
                }}
              >
                Overwrite Server with My Rate (₹{Number(activeConflict.payload?.newPrice || 0).toFixed(2)})
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* ADMIN ADD / EDIT PRODUCT MODAL                                            */}
      {/* ========================================================================= */}
      {productModalOpen && isAdmin && (
        <div
          className="modal-backdrop"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.65)',
            backdropFilter: 'blur(3px)',
            zIndex: 100,
            display: 'grid',
            placeItems: 'center',
            padding: '16px'
          }}
        >
          <div
            className="modal-card"
            style={{
              background: '#fff',
              borderRadius: '16px',
              maxWidth: '460px',
              width: '100%',
              padding: '24px'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div>
                <h3 style={{ fontSize: '18px', fontWeight: 800, color: '#0f172a', margin: 0 }}>
                  {editingProduct ? 'Edit Product Details' : 'Add New Commodity'}
                </h3>
                <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>
                  {editingProduct ? `Product #${editingProduct.itemId || editingProduct.itemid}` : 'Create an item in the wholesale catalog'}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setProductModalOpen(false)}
                style={{ border: 'none', background: 'transparent', fontSize: '20px', color: '#94a3b8', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            {productModalError && (
              <div style={{ marginBottom: '14px', padding: '10px 12px', borderRadius: '8px', background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', fontSize: '12px' }}>
                {productModalError}
              </div>
            )}

            <form onSubmit={handleSaveProduct}>
              <div style={{ marginBottom: '14px' }}>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#475569', marginBottom: '5px' }}>
                  Product Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Onion Medium, Bell Pepper..."
                  value={productForm.itemName}
                  onChange={(e) => setProductForm((prev) => ({ ...prev, itemName: e.target.value }))}
                  style={{ width: '100%', height: '38px', padding: '0 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px' }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '14px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#475569', marginBottom: '5px' }}>
                    Unit Type *
                  </label>
                  <select
                    value={productForm.unitType}
                    onChange={(e) => setProductForm((prev) => ({ ...prev, unitType: e.target.value }))}
                    style={{ width: '100%', height: '38px', padding: '0 10px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', background: '#fff' }}
                  >
                    <option value="Kgs">Kgs</option>
                    <option value="Bags">Bags</option>
                    <option value="Boxes">Boxes</option>
                    <option value="Units">Units</option>
                    <option value="Liters">Liters</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#475569', marginBottom: '5px' }}>
                    Weight per Unit (kg)
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={productForm.kgsPerUnit}
                    onChange={(e) => setProductForm((prev) => ({ ...prev, kgsPerUnit: e.target.value }))}
                    style={{ width: '100%', height: '38px', padding: '0 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px' }}
                  />
                </div>
              </div>

              {!editingProduct && (
                <div style={{ marginBottom: '14px' }}>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#475569', marginBottom: '5px' }}>
                    Initial Wholesale Base Price (₹) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    placeholder="e.g. 50.00"
                    value={productForm.price}
                    onChange={(e) => setProductForm((prev) => ({ ...prev, price: e.target.value }))}
                    style={{ width: '100%', height: '38px', padding: '0 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px' }}
                  />
                </div>
              )}

              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#475569', marginBottom: '5px' }}>
                  Image Icon Filename (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. onion_fresh.png"
                  value={productForm.itemImage}
                  onChange={(e) => setProductForm((prev) => ({ ...prev, itemImage: e.target.value }))}
                  style={{ width: '100%', height: '38px', padding: '0 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px' }}
                />
              </div>

              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={() => setProductModalOpen(false)}
                  style={{ height: '38px', padding: '0 16px', borderRadius: '8px', border: '1px solid #cbd5e1', background: '#fff', fontSize: '13px', fontWeight: 600, color: '#475569', cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingProduct}
                  style={{ height: '38px', padding: '0 20px', borderRadius: '8px', border: 'none', background: '#0284c7', color: '#fff', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}
                >
                  {savingProduct ? 'Saving...' : editingProduct ? 'Save Changes' : 'Create Product'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
