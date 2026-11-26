import React, { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import { Capacitor } from '@capacitor/core';
import { api } from './api';
import OverviewScreen from './components/OverviewScreen';
import LoginScreen from './components/LoginScreen';
import ErrorBoundary from './components/ErrorBoundary';
import SyncStatusBar from './components/SyncStatusBar';
import { initSyncEngine } from './offline/syncEngine';
import {
  signOutAppSession,
  removeSavedAccount,
  getMemorySessionToken,
  restoreNativeSessionToken,
  clearNativeSessionToken,
  ACTIVE_USER_KEY
} from './offline/biometricAuth';
import { saveOrdersCache, loadOrdersCache, clearOrdersCache } from './offline/ordersCache';
import {
  seedPilotDataIfEmpty,
  saveClusters,
  saveShops,
  saveCatalog,
  getClusters,
  getShops,
  getCatalog,
  clearUserCachedData,
  hasUnsyncedMutations
} from './offline/offlineDb';
import { useToast, ConfirmDialog, Skeleton, SkeletonGroup } from './ui';
import AppShell from './shell/AppShell';
import { visibleNav, pageTitle, roleKeyFor, ROLE_LABELS } from './shell/navConfig';
import { useAndroidBackButton } from './shell/useAndroidBackButton';
import ChangePasswordModal from './components/ChangePasswordModal';

// The phone-preview frame is a developer aid; import.meta.env.DEV is false in production builds.
const DEV_PREVIEW_ENABLED = import.meta.env.DEV;

// Lazy-loaded secondary screens for reduced initial bundle and fast APK startup
const OrderEntryScreen = lazy(() => import('./components/OrderEntryScreen'));
const ReportsScreen = lazy(() => import('./components/ReportsScreen'));
const CustomersScreen = lazy(() => import('./components/CustomersScreen'));
const SummaryReportScreen = lazy(() => import('./components/SummaryReportScreen'));
const ManagerReportsScreen = lazy(() => import('./components/ManagerReportsScreen'));
const ManagerOrdersScreen = lazy(() => import('./components/ManagerOrdersScreen'));
const ShopMapScreen = lazy(() => import('./components/ShopMapScreen'));
const VisitsScreen = lazy(() => import('./components/VisitsScreen'));
const FieldVisitsScreen = lazy(() => import('./components/FieldVisitsScreen'));
const TeamAssignmentsScreen = lazy(() => import('./components/TeamAssignmentsScreen'));
const AdminDashboardScreen = lazy(() => import('./components/AdminDashboardScreen'));
const AdminUsersScreen = lazy(() => import('./components/AdminUsersScreen'));
const AdminRolesPermissionsScreen = lazy(() => import('./components/AdminRolesPermissionsScreen'));
const AdminAuditScreen = lazy(() => import('./components/AdminAuditScreen'));
const AdminSettingsScreen = lazy(() => import('./components/AdminSettingsScreen'));
const AdminTargetsScreen = lazy(() => import('./components/AdminTargetsScreen'));
const DeliveryRouteScreen = lazy(() => import('./components/DeliveryRouteScreen'));
const ItemsScreen = lazy(() => import('./components/ItemsScreen'));

function ScreenLoadingSkeleton() {
  return (
    <div className="screen-loading-skeleton" style={{ maxWidth: '900px', margin: '0 auto', padding: '8px 0' }}>
      <SkeletonGroup label="Loading page content">
        <Skeleton width="35%" height={24} />
        <Skeleton height={96} radius="var(--lc-radius-lg)" />
        <Skeleton height={180} radius="var(--lc-radius-lg)" />
      </SkeletonGroup>
    </div>
  );
}



export default function App() {
  const [user, setUser] = useState(() => {
    try {
      const saved = localStorage.getItem('LineCartPref_user');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const roleLower = (user?.role || '').toLowerCase();
  const isAdmin = roleLower === 'admin';
  const isManager = roleLower === 'sales manager';
  const isDelivery = roleLower === 'delivery agent';
  const isAgent = !isAdmin && !isManager && !isDelivery;

  const [permissions, setPermissions] = useState(null);
  const [showManualChangePassword, setShowManualChangePassword] = useState(false);
  const [authReady, setAuthReady] = useState(() => (
    !Capacitor.isNativePlatform() ||
    Boolean(getMemorySessionToken()) ||
    !localStorage.getItem('LineCartPref_user')
  ));

  useEffect(() => {
    const handler = () => setShowManualChangePassword(true);
    window.addEventListener('linecart:open-change-password', handler);
    return () => window.removeEventListener('linecart:open-change-password', handler);
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const res = await api.getAuthMe();
      if (res && res.status === 200 && res.user) {
        setUser(res.user);
        localStorage.setItem('LineCartPref_user', JSON.stringify(res.user));
        localStorage.setItem('LineCartPref_userid', String(res.user.id));
        return { ok: true, user: res.user };
      }
      if (res && (res.status === 401 || res.status === 403)) {
        return { ok: false, rejected: true };
      }
    } catch {}
    return { ok: false, rejected: false };
  }, []);

  // Authoritative identity sync: restore Android Keystore session token and verify with backend on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (Capacitor.isNativePlatform() && !getMemorySessionToken()) {
        await restoreNativeSessionToken();
      }
      if (cancelled) return;
      setAuthReady(true);

      const token = getMemorySessionToken() || localStorage.getItem('LineCartPref_token');
      const savedUser = localStorage.getItem('LineCartPref_user');

      if (!token && !savedUser) {
        if (user) setUser(null);
        return;
      }

      if (!token) {
        localStorage.removeItem('LineCartPref_user');
        localStorage.removeItem('LineCartPref_userid');
        setUser(null);
        return;
      }

      const synced = await refreshUser();
      if (!cancelled && synced.rejected) {
        await clearNativeSessionToken();
        localStorage.removeItem('LineCartPref_token');
        localStorage.removeItem('LineCartPref_user');
        localStorage.removeItem('LineCartPref_userid');
        setUser(null);
      }
    })();
    return () => { cancelled = true; };
  }, [refreshUser]);

  // Load active role permissions from backend
  useEffect(() => {
    if (!authReady || !user) return;
    api.getRolePermissions()
      .then((res) => {
        if (res && res.rolePermissions) {
          setPermissions(res.rolePermissions);
        }
      })
      .catch(() => {});
  }, [authReady, user]);

  // Initialize background and foreground sync engine
  useEffect(() => {
    const cleanup = initSyncEngine(() => user?.id);
    return () => {
      if (cleanup) cleanup();
    };
  }, [user?.id]);

  const isPageAllowed = (pageId) => {
    if (pageId === 'price-requests') {
      return isAdmin || isManager;
    }
    if (pageId.startsWith('admin-')) {
      return isAdmin;
    }
    if (isAdmin) return true;
    if (!permissions) return true;
    const uRole = user?.role || 'Field Sales Agent';
    const rPerms = permissions[uRole];
    if (!rPerms || !Array.isArray(rPerms.pages)) return true;
    return rPerms.pages.includes(pageId);
  };

  const [page, setPage] = useState(() => {
    const hash = window.location.hash.replace('#', '');
    try {
      const saved = localStorage.getItem('LineCartPref_user');
      const u = saved ? JSON.parse(saved) : null;
      const r = (u?.role || '').toLowerCase();
      if (r === 'admin') {
        const validAdmin = [
          'admin-dashboard', 'admin-users', 'admin-roles', 'admin-assignments',
          'admin-targets', 'orders', 'price-requests', 'reports', 'map', 'admin-audit', 'admin-settings', 'customers', 'delivery', 'items', 'field-visits'
        ];
        return validAdmin.includes(hash) ? hash : 'admin-dashboard';
      }
      if (r === 'sales manager') {
        const validManager = ['reports', 'orders', 'price-requests', 'map', 'team', 'customers', 'items', 'field-visits'];
        return validManager.includes(hash) ? hash : 'reports';
      }
      if (r === 'delivery agent') return 'delivery';
    } catch {}
    const valid = [
      'overview', 'orders', 'price-requests', 'reports', 'customers', 'summary', 'map', 'team', 'delivery', 'items', 'visits', 'field-visits',
      'admin-dashboard', 'admin-users', 'admin-roles', 'admin-assignments',
      'admin-targets', 'admin-orders', 'admin-reports', 'admin-audit', 'admin-settings'
    ];
    if (valid.includes(hash)) return hash;
    return 'overview';
  });

  // Development-only phone preview frame (never available in production builds)
  const [androidPreviewState, setAndroidPreview] = useState(false);
  const androidPreview = DEV_PREVIEW_ENABLED && androidPreviewState;
  const [prefCustomer, setPrefCustomer] = useState('');
  const toastApi = useToast();

  // Data from backend
  const [clusters, setClusters] = useState([]);
  const [shops, setShops] = useState([]);
  const [catalogItems, setCatalogItems] = useState([]);
  const [orders, setOrders] = useState(() => {
    let cachedUserId = null;
    try {
      cachedUserId = JSON.parse(localStorage.getItem('LineCartPref_user') || 'null')?.id ?? null;
    } catch {}
    const demoIds = new Set(['S101-24018', 'S103-24017', 'S039-24018', 'S042-24017', 'S043-24016', 'S046-24015', 'S047-24014', 'S048-24013', 'S049-24012']);
    // Only this user's cached list; TEMP- entries were offline orders from older app versions
    return loadOrdersCache(cachedUserId).filter(
      (o) => !demoIds.has(o.id) && !demoIds.has(o.orderId) && !String(o.id || o.orderId || '').startsWith('TEMP-')
    );
  });

  // Same calling convention as before: showToast(message). An optional second argument
  // ('success' | 'error' | 'warning' | 'info' or { variant, duration }) is accepted; without it the
  // type is inferred from the wording, and errors stay on screen until dismissed.
  const showToast = (msg, opts) => toastApi.show(msg, opts);

  // Sync page with hash
  useEffect(() => {
    const handleHash = () => {
      const hash = window.location.hash.replace('#', '');
      const validAdminPages = [
        'admin-dashboard', 'admin-users', 'admin-roles', 'admin-assignments',
        'admin-targets', 'orders', 'price-requests', 'reports', 'map', 'admin-audit', 'admin-settings', 'customers', 'delivery', 'items', 'field-visits'
      ];
      const validManagerPages = ['reports', 'orders', 'price-requests', 'map', 'team', 'customers', 'items', 'field-visits'];
      const validAgentPages = ['overview', 'orders', 'reports', 'customers', 'summary', 'visits'];
      const validDeliveryPages = ['delivery'];

      const validList = isAdmin ? validAdminPages : isManager ? validManagerPages : isDelivery ? validDeliveryPages : validAgentPages;
      if (validList.includes(hash)) {
        if (!isAdmin && hash.startsWith('admin-')) {
          showToast(`Access Denied: Administrator role required`);
          const fallback = isManager ? 'reports' : isDelivery ? 'delivery' : 'overview';
          setPage(fallback);
          window.location.hash = `#${fallback}`;
          return;
        }
        if (!isAdmin && !isPageAllowed(hash)) {
          showToast(`Access Denied: '${hash}' disabled by Administrator`);
          return;
        }
        setPage((prevPage) => {
          if (prevPage && prevPage !== hash) {
            setNavHistory((h) => [...h, prevPage]);
          }
          return hash;
        });
      }
    };
    window.addEventListener('hashchange', handleHash);
    return () => window.removeEventListener('hashchange', handleHash);
  }, [isAdmin, isManager, isDelivery, permissions]);

  // Route security & role-home normalization guard
  useEffect(() => {
    if (!user) return;
    if (page.startsWith('admin-') && !isAdmin) {
      const fallback = isManager ? 'reports' : isDelivery ? 'delivery' : 'overview';
      setPage(fallback);
      window.location.hash = `#${fallback}`;
      showToast('Access Denied: Administrator role required.');
      return;
    }
    if (isAdmin && page === 'overview') {
      setPage('admin-dashboard');
      window.location.hash = '#admin-dashboard';
      return;
    }
    if (isManager && page === 'overview') {
      setPage('reports');
      window.location.hash = '#reports';
      return;
    }
    if (isDelivery && page !== 'delivery') {
      setPage('delivery');
      window.location.hash = '#delivery';
    }
  }, [page, isAdmin, isManager, isDelivery, user]);

  const [navHistory, setNavHistory] = useState([]);

  const getRoleHome = () => {
    if (isAdmin) return 'admin-dashboard';
    if (isManager) return 'reports';
    if (isDelivery) return 'delivery';
    return 'overview';
  };

  const navigate = (nextPage) => {
    if (nextPage !== page) {
      setNavHistory((prev) => [...prev, page]);
    }
    setPage(nextPage);
    window.location.hash = `#${nextPage}`;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleBack = () => {
    const roleHome = getRoleHome();
    if (!navHistory.length) {
      if (page !== roleHome) {
        navigate(roleHome);
      }
      return;
    }

    const historyCopy = [...navHistory];
    let prev = historyCopy.pop();
    while (historyCopy.length && (prev === page || (prev.startsWith('admin-') && !isAdmin))) {
      prev = historyCopy.pop();
    }

    if (prev && prev !== page && (!prev.startsWith('admin-') || isAdmin)) {
      setNavHistory(historyCopy);
      setPage(prev);
      window.location.hash = `#${prev}`;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else if (page !== roleHome) {
      setNavHistory([]);
      navigate(roleHome);
    }
  };

  // Sync body class for android-preview
  useEffect(() => {
    document.body.classList.toggle('android-preview', androidPreview);
  }, [androidPreview]);

  // Load cluster and shops data from backend (skipped for Delivery Agents who use /api/delivery/orders)
  useEffect(() => {
    if (!authReady || !user || isDelivery || user?.mustChangePassword) return;

    // 1. Immediately initialize with cached or pilot seed data from local storage
    seedPilotDataIfEmpty(user.id)
      .then(({ clusters: seedClusters, catalog: seedCatalog, shops: seedShops }) => {
        setClusters((prev) => (prev && prev.length ? prev : seedClusters));
        setShops((prev) => (prev && prev.length ? prev : seedShops));
        setCatalogItems((prev) => (prev && prev.length ? prev : seedCatalog));
      })
      .catch(() => {});

    // 2. Fetch authoritative backend data when online
    api.getClusterInfo(user.id).then((res) => {
      if ((res.status === 200 || res.status === 1) && res.result?.clusterList) {
        setClusters(res.result.clusterList);
        saveClusters(user.id, res.result.clusterList).catch(() => {});
      }
    }).catch(() => {});

    api.getItemsOrder(user.id).then((res) => {
      if ((res.status === 200 || res.status === 1) && res.result?.clusterList) {
        const allShops = [];
        res.result.clusterList.forEach((c) => {
          if (c.shopsList) {
            c.shopsList.forEach((s) => allShops.push({ ...s, clusterid: c.clusterId }));
          }
        });
        setShops(allShops);
        saveShops(user.id, allShops).catch(() => {});

        // Catalog items from first shop
        if (res.result.clusterList[0]?.shopsList?.[0]?.itemsList) {
          const items = res.result.clusterList[0].shopsList[0].itemsList;
          setCatalogItems(items);
          saveCatalog(user.id, items).catch(() => {});
        }
      }
    }).catch(() => {});
  }, [user]);

  // Load authoritative orders from backend
  useEffect(() => {
    if (!authReady || !user || isDelivery || user?.mustChangePassword) return;
    api.getOrders().then((res) => {
      if (res && res.status === 200 && Array.isArray(res.orders)) {
        // The server list is authoritative (orders are online-only; there are no local temporary orders)
        const merged = [];
        for (const srvOrder of res.orders) {
          if (!merged.some((m) => m.id === srvOrder.id || (srvOrder.orderId && m.orderId === srvOrder.orderId))) {
            merged.push(srvOrder);
          }
        }
        saveOrdersCache(merged, user.id);
        setOrders(merged);
      }
    }).catch(() => {});
  }, [authReady, user?.id, isDelivery, user?.mustChangePassword]);

  // Listen for sync engine updates to orders
  useEffect(() => {
    const handleOrdersSync = () => {
      setOrders(loadOrdersCache());

    };
    window.addEventListener('linecart:orders_updated', handleOrdersSync);
    return () => window.removeEventListener('linecart:orders_updated', handleOrdersSync);
  }, []);

  // Live pending price requests count for Admin and Sales Manager queues (existing endpoint, server-scoped).
  // status: 'idle' (not applicable) | 'loading' | 'ok' | 'error'. A count is shown only when 'ok'.
  const [approvals, setApprovals] = useState({ status: 'idle', count: 0 });
  const approvalsRequestRef = React.useRef(0);
  const approvalsUserId = user?.id;

  const refreshPendingPriceRequestsCount = useCallback(() => {
    if (!approvalsUserId || (!isAdmin && !isManager)) {
      setApprovals({ status: 'idle', count: 0 });
      return;
    }
    const requestId = ++approvalsRequestRef.current;
    // Keep the last successfully loaded count visible while refreshing; never show a guessed number
    setApprovals((prev) => (prev.status === 'ok' ? prev : { status: 'loading', count: 0 }));
    api.getPriceRequests('pending', approvalsUserId).then((res) => {
      if (requestId !== approvalsRequestRef.current) return;
      // api.getPriceRequests falls back to the device cache when offline (cached: true). That copy may be
      // stale, so the indicator treats it as "count unavailable" and shows no number.
      if (res && res.status === 200 && Array.isArray(res.priceRequests) && !res.cached) {
        setApprovals({ status: 'ok', count: res.priceRequests.filter((p) => p.status === 'pending').length });
      } else {
        setApprovals({ status: 'error', count: 0 });
      }
    }).catch(() => {
      if (requestId === approvalsRequestRef.current) setApprovals({ status: 'error', count: 0 });
    });
  }, [approvalsUserId, isAdmin, isManager]);

  useEffect(() => {
    refreshPendingPriceRequestsCount();
    const handleUpdate = () => refreshPendingPriceRequestsCount();
    window.addEventListener('linecart:orders_updated', handleUpdate);
    window.addEventListener('linecart:price_requests_updated', handleUpdate);
    return () => {
      window.removeEventListener('linecart:orders_updated', handleUpdate);
      window.removeEventListener('linecart:price_requests_updated', handleUpdate);
    };
  }, [refreshPendingPriceRequestsCount]);

  const handleOrderPlaced = (newOrder) => {
    setOrders((prev) => {
      // Deduplicate: if an order with same ID, clientMutationId, or orderId exists, update in-place
      const existingIdx = prev.findIndex(
        (o) => (newOrder.id && o.id === newOrder.id) ||
               (newOrder.orderId && (o.orderId === newOrder.orderId || o.id === newOrder.orderId)) ||
               (newOrder.clientMutationId && o.clientMutationId === newOrder.clientMutationId)
      );
      let updated;
      if (existingIdx >= 0) {
        updated = [...prev];
        updated[existingIdx] = { ...updated[existingIdx], ...newOrder };
      } else {
        updated = [newOrder, ...prev];
      }
      saveOrdersCache(updated, user?.id);
      return updated;
    });
  };

  const handleShopAdded = (newShop) => {
    setShops((prev) => [newShop, ...prev]);
  };

  const handleOrderForCustomer = (customerName) => {
    setPrefCustomer(customerName);
    navigate('orders');
  };

  // Sign-out confirmation shown only when unsent updates exist (replaces window.confirm).
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);

  const handleLogout = async () => {
    const leavingUserId = user?.id;
    // Unsent delivery/price updates stay on the device and are sent at this user's next sign-in
    try {
      if (leavingUserId && (await hasUnsyncedMutations(leavingUserId))) {
        setLogoutConfirmOpen(true);
        return;
      }
    } catch {}
    await performLogout();
  };

  // Runs only after handleLogout decided it may proceed (directly, or from the confirmation dialog).
  const performLogout = async () => {
    const leavingUserId = user?.id;
    setLogoutConfirmOpen(false);
    api.logout();
    // Shared-device privacy: remove this user's biometric credential, cached data and order list
    try {
      if (leavingUserId) await removeSavedAccount(leavingUserId);
      else await signOutAppSession();
    } catch {}
    try {
      if (leavingUserId) await clearUserCachedData(leavingUserId);
    } catch {}
    clearOrdersCache();
    try {
      localStorage.removeItem(ACTIVE_USER_KEY);
    } catch {}
    await clearNativeSessionToken();
    await signOutAppSession();
    localStorage.removeItem('LineCartPref_token');
    localStorage.removeItem('LineCartPref_userid');
    localStorage.removeItem('LineCartPref_user');
    setOrders([]);
    setShops([]);
    setCatalogItems([]);
    setClusters([]);
    setUser(null);
    setNavHistory([]);
    setPage('overview');
    window.location.hash = '#overview';
  };

  const todayStr = new Date().toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });

  // Navigation for this role, filtered by the same permission check as before
  const roleKey = roleKeyFor({ isAdmin, isManager, isDelivery });
  const roleLabel = user?.role || ROLE_LABELS[roleKey];
  const nav = visibleNav(roleKey, isPageAllowed);
  // The approvals indicator follows the same rule as the Price approvals nav entry
  const showApprovals = Boolean(user) && (isAdmin || (isManager && isPageAllowed('orders')));

  const handleNavSelect = (item) => {
    if (item.resetsPreselectedShop) setPrefCustomer('');
    navigate(item.pageId);
  };

  // Android hardware back: open dialog or sheet first, then in-app history. On the role's home screen
  // it moves the app to the background, as Android does for a top-level screen (the in-app history can
  // hold entries the role-home guard redirects, such as 'overview' for managers after sign-in).
  // Never signs out, never clears data. On the sign-in screen (no user) it closes an open overlay first
  // and otherwise moves the app to the background, instead of replaying old page history.
  useAndroidBackButton({ enabled: true, onBack: handleBack, isAtRoot: !user || page === getRoleHome() });

  if (!authReady && user) {
    return (
      <div style={{ padding: '24px' }}>
        <ScreenLoadingSkeleton />
      </div>
    );
  }

  if (!user) {
    return (
      <LoginScreen
        onLoginSuccess={(u) => {
          // Errors from earlier failed attempts no longer apply once sign-in succeeds
          toastApi.clearErrors();
          setUser(u);
          const r = (u?.role || '').toLowerCase();
          if (r === 'admin') navigate('admin-dashboard');
          else if (r === 'sales manager') navigate('reports');
          else if (r === 'delivery agent') navigate('delivery');
          else navigate('overview');
        }}
        showToast={showToast}
      />
    );
  }

  const shell = (
    <AppShell
      roleLabel={roleLabel}
      nav={nav}
      page={page}
      title={pageTitle(roleKey, page)}
      showBack={page !== getRoleHome()}
      onBack={handleBack}
      onSelect={handleNavSelect}
      onSignOut={handleLogout}
      user={user}
      approvals={showApprovals ? approvals : null}
      onOpenApprovals={() => navigate('price-requests')}
      syncSlot={<SyncStatusBar userId={user?.id} userName={user?.name} showToast={showToast} />}
      dateLabel={todayStr}
      forcePhone={androidPreview}
      devPreview={DEV_PREVIEW_ENABLED ? { active: androidPreview, onToggle: () => setAndroidPreview((v) => !v) } : null}
    >
      <div className="page-content" id="pageContent">
        <ErrorBoundary key={page}>
          <Suspense fallback={<ScreenLoadingSkeleton />}>
          {/* Administrator Exclusive Screens */}
          {(page === 'admin-dashboard' || (page === 'overview' && isAdmin)) && (
          <AdminDashboardScreen
            user={user}
            onNavigate={navigate}
            showToast={showToast}
          />
        )}

        {page === 'admin-users' && (
          <AdminUsersScreen
            user={user}
            clusters={clusters}
            onNavigate={navigate}
            showToast={showToast}
          />
        )}

        {page === 'admin-roles' && (
          <AdminRolesPermissionsScreen
            user={user}
            onNavigate={navigate}
            showToast={showToast}
          />
        )}

        {page === 'admin-assignments' && (
          <TeamAssignmentsScreen
            user={user}
            clusters={clusters}
            showToast={showToast}
          />
        )}

        {page === 'admin-targets' && (
          <AdminTargetsScreen
            user={user}
            clusters={clusters}
            onNavigate={navigate}
            showToast={showToast}
          />
        )}

        {page === 'admin-audit' && (
          <AdminAuditScreen
            user={user}
            showToast={showToast}
          />
        )}

        {page === 'admin-settings' && (
          <AdminSettingsScreen
            user={user}
            showToast={showToast}
          />
        )}

        {(page === 'delivery' || isDelivery) && (
          <DeliveryRouteScreen
            user={user}
            onLogout={handleLogout}
            onBack={handleBack}
            isMobilePreview={androidPreview}
            onTogglePreview={DEV_PREVIEW_ENABLED ? (v) => setAndroidPreview(typeof v === 'boolean' ? v : !androidPreviewState) : undefined}
            showToast={showToast}
          />
        )}

        {/* Operational Screens */}
        {page === 'overview' && !isAdmin && !isManager && (
          <OverviewScreen
            user={user}
            orders={orders}
            shops={shops}
            clusters={clusters}
            onNavigate={navigate}
            onOrderForCustomer={handleOrderForCustomer}
            showToast={showToast}
          />
        )}

        {(page === 'orders' || page === 'admin-orders' || page === 'price-requests') && (
          (isAdmin || isManager) ? (
            <ManagerOrdersScreen
              user={user}
              clusters={clusters}
              shops={shops}
              showToast={showToast}
              defaultTab={page === 'price-requests' ? 'price-requests' : 'orders'}
              onNavigate={navigate}
              isAdmin={isAdmin}
            />
          ) : (
            <OrderEntryScreen
              user={user}
              clusters={clusters}
              shops={shops}
              catalogItems={catalogItems}
              preselectedShop={prefCustomer}
              onOrderPlaced={handleOrderPlaced}
              onNavigate={navigate}
              showToast={showToast}
            />
          )
        )}

        {(page === 'reports' || page === 'admin-reports' || (page === 'overview' && isManager)) && (
          (isAdmin || isManager) ? (
            <ManagerReportsScreen
              user={user}
              clusters={clusters}
              onNavigate={navigate}
              showToast={showToast}
            />
          ) : (
            <ReportsScreen
              user={user}
              clusters={clusters}
              shops={shops}
              orders={orders}
              onNavigate={navigate}
              showToast={showToast}
            />
          )
        )}

        {page === 'map' && (
          <ShopMapScreen
            user={user}
            clusters={clusters}
            showToast={showToast}
          />
        )}

        {page === 'team' && (
          <TeamAssignmentsScreen
            user={user}
            clusters={clusters}
            showToast={showToast}
          />
        )}

        {page === 'customers' && (
          <CustomersScreen
            user={user}
            clusters={clusters}
            shops={shops}
            onShopAdded={handleShopAdded}
            onOrderForCustomer={handleOrderForCustomer}
            showToast={showToast}
          />
        )}

        {page === 'items' && (isAdmin || isManager) && (
          <ItemsScreen
            user={user}
            clusters={clusters}
            showToast={showToast}
            onNavigate={navigate}
          />
        )}

        {page === 'visits' && !isAdmin && !isManager && !isDelivery && (
          <VisitsScreen
            user={user}
            showToast={showToast}
          />
        )}

        {page === 'field-visits' && (isAdmin || isManager) && (
          <FieldVisitsScreen user={user} showToast={showToast} />
        )}

        {page === 'summary' && (
          <SummaryReportScreen
            user={user}
            showToast={showToast}
          />
        )}
          </Suspense>
        </ErrorBoundary>
      </div>
    </AppShell>
  );

  return (
    <>
      {(user?.mustChangePassword || showManualChangePassword) && (
        <ChangePasswordModal
          user={user}
          onClose={!user?.mustChangePassword ? () => setShowManualChangePassword(false) : undefined}
          onSuccess={() => {
            setShowManualChangePassword(false);
            const updated = { ...user, mustChangePassword: false };
            setUser(updated);
            try {
              localStorage.setItem('LineCartPref_user', JSON.stringify(updated));
            } catch {}
            window.dispatchEvent(new CustomEvent('linecart:password_changed'));
          }}
          showToast={showToast}
        />
      )}
      {androidPreview ? (
        <div className="lc-devframe-host">
          <span className="lc-devframe-note">Development preview only: simulated phone width, not the native app</span>
          <div className="lc-devframe">{shell}</div>
        </div>
      ) : (
        shell
      )}
      <ConfirmDialog
        open={logoutConfirmOpen}
        title="Sign out with unsent updates?"
        message="Some delivery or price updates have not been sent yet. They will stay on this device and be sent the next time you sign in."
        confirmLabel="Sign out"
        cancelLabel="Stay signed in"
        tone="danger"
        onCancel={() => setLogoutConfirmOpen(false)}
        onConfirm={performLogout}
      />
    </>
  );
}
