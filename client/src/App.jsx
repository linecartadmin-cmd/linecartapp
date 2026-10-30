import React, { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import { api } from './api';
import OverviewScreen from './components/OverviewScreen';
import LoginScreen from './components/LoginScreen';
import ErrorBoundary from './components/ErrorBoundary';
import SyncStatusBar from './components/SyncStatusBar';
import { initSyncEngine } from './offline/syncEngine';
import { signOutAppSession } from './offline/biometricAuth';
import {
  seedPilotDataIfEmpty,
  saveClusters,
  saveShops,
  saveCatalog,
  getClusters,
  getShops,
  getCatalog
} from './offline/offlineDb';

// Lazy-loaded secondary screens for reduced initial bundle and fast APK startup
const logoIcon = '/lincart_flashicon.png';
const OrderEntryScreen = lazy(() => import('./components/OrderEntryScreen'));
const ReportsScreen = lazy(() => import('./components/ReportsScreen'));
const CustomersScreen = lazy(() => import('./components/CustomersScreen'));
const SummaryReportScreen = lazy(() => import('./components/SummaryReportScreen'));
const ManagerReportsScreen = lazy(() => import('./components/ManagerReportsScreen'));
const ManagerOrdersScreen = lazy(() => import('./components/ManagerOrdersScreen'));
const ShopMapScreen = lazy(() => import('./components/ShopMapScreen'));
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
    <div className="screen-loading-skeleton" role="status" aria-label="Loading page content" style={{
      padding: '28px 20px',
      display: 'flex',
      flexDirection: 'column',
      gap: '16px',
      maxWidth: '900px',
      margin: '0 auto'
    }}>
      <div style={{
        height: '24px',
        width: '35%',
        borderRadius: '6px',
        background: '#e2e8f0',
        opacity: 0.7
      }} />
      <div style={{
        height: '96px',
        borderRadius: '12px',
        background: '#f8fafc',
        border: '1px solid #e2e8f0'
      }} />
      <div style={{
        height: '180px',
        borderRadius: '12px',
        background: '#f8fafc',
        border: '1px solid #e2e8f0'
      }} />
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

  // Authoritative identity sync: verify session token with backend on mount
  useEffect(() => {
    const token = localStorage.getItem('LineCartPref_token');
    const savedUser = localStorage.getItem('LineCartPref_user');

    if (!token && !savedUser) {
      if (user) setUser(null);
      return;
    }

    api.getAuthMe().then((res) => {
      if (res && res.status === 200 && res.user) {
        setUser(res.user);
        localStorage.setItem('LineCartPref_user', JSON.stringify(res.user));
        localStorage.setItem('LineCartPref_userid', String(res.user.id));
      } else if (res && (res.status === 401 || res.status === 403)) {
        localStorage.removeItem('LineCartPref_token');
        localStorage.removeItem('LineCartPref_user');
        localStorage.removeItem('LineCartPref_userid');
        setUser(null);
      }
    }).catch(() => {});
  }, []);

  // Load active role permissions from backend
  useEffect(() => {
    api.getRolePermissions()
      .then((res) => {
        if (res && res.rolePermissions) {
          setPermissions(res.rolePermissions);
        }
      })
      .catch(() => {});
  }, [user]);

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
          'admin-targets', 'orders', 'price-requests', 'reports', 'map', 'admin-audit', 'admin-settings', 'customers', 'delivery', 'items'
        ];
        return validAdmin.includes(hash) ? hash : 'admin-dashboard';
      }
      if (r === 'sales manager') {
        const validManager = ['reports', 'orders', 'price-requests', 'map', 'team', 'customers', 'items'];
        return validManager.includes(hash) ? hash : 'reports';
      }
      if (r === 'delivery agent') return 'delivery';
    } catch {}
    const valid = [
      'overview', 'orders', 'price-requests', 'reports', 'customers', 'summary', 'map', 'team', 'delivery', 'items',
      'admin-dashboard', 'admin-users', 'admin-roles', 'admin-assignments',
      'admin-targets', 'admin-orders', 'admin-reports', 'admin-audit', 'admin-settings'
    ];
    if (valid.includes(hash)) return hash;
    return 'overview';
  });

  const [androidPreview, setAndroidPreview] = useState(false);
  const [prefCustomer, setPrefCustomer] = useState('');
  const [toastMsg, setToastMsg] = useState('');
  const [toastTimer, setToastTimer] = useState(null);

  // Data from backend
  const [clusters, setClusters] = useState([]);
  const [shops, setShops] = useState([]);
  const [catalogItems, setCatalogItems] = useState([]);
  const [orders, setOrders] = useState(() => {
    try {
      const saved = localStorage.getItem('linecart_orders');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          const demoIds = new Set(['S101-24018', 'S103-24017', 'S039-24018', 'S042-24017', 'S043-24016', 'S046-24015', 'S047-24014', 'S048-24013', 'S049-24012']);
          return parsed.filter((o) => !demoIds.has(o.id) && !demoIds.has(o.orderId));
        }
      }
      return [];
    } catch {
      return [];
    }
  });

  const showToast = (msg) => {
    setToastMsg(msg);
    if (toastTimer) clearTimeout(toastTimer);
    const timer = setTimeout(() => setToastMsg(''), 2500);
    setToastTimer(timer);
  };

  // Sync page with hash
  useEffect(() => {
    const handleHash = () => {
      const hash = window.location.hash.replace('#', '');
      const validAdminPages = [
        'admin-dashboard', 'admin-users', 'admin-roles', 'admin-assignments',
        'admin-targets', 'orders', 'price-requests', 'reports', 'map', 'admin-audit', 'admin-settings', 'customers', 'delivery', 'items'
      ];
      const validManagerPages = ['reports', 'orders', 'price-requests', 'map', 'team', 'customers', 'items'];
      const validAgentPages = ['overview', 'orders', 'reports', 'customers', 'summary'];
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
    if (!user || isDelivery) return;

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
    if (!user || isDelivery) return;
    api.getOrders().then((res) => {
      if (res && res.status === 200 && Array.isArray(res.orders)) {
        setOrders((prev) => {
          // Keep any local un-synced offline temporary orders at the top
          const pendingLocal = prev.filter((o) => String(o.id || '').startsWith('TEMP-') || o.syncStatus === 'pending');
          const merged = [...pendingLocal];
          for (const srvOrder of res.orders) {
            if (!merged.some((m) => m.id === srvOrder.id || (srvOrder.orderId && m.orderId === srvOrder.orderId))) {
              merged.push(srvOrder);
            }
          }
          localStorage.setItem('linecart_orders', JSON.stringify(merged));
          return merged;
        });
      }
    }).catch(() => {});
  }, [user?.id, isDelivery]);

  // Listen for sync engine updates to orders
  useEffect(() => {
    const handleOrdersSync = () => {
      try {
        const raw = localStorage.getItem('linecart_orders');
        if (raw) {
          const list = JSON.parse(raw);
          if (Array.isArray(list)) setOrders(list);
        }
      } catch {}
    };
    window.addEventListener('linecart:orders_updated', handleOrdersSync);
    return () => window.removeEventListener('linecart:orders_updated', handleOrdersSync);
  }, []);

  // Live pending price requests count for Admin and Sales Manager queues
  const [pendingPriceRequestsCount, setPendingPriceRequestsCount] = useState(0);

  const refreshPendingPriceRequestsCount = useCallback(() => {
    if (!user || (!isAdmin && !isManager)) return;
    api.getPriceRequests('pending', user.id).then((res) => {
      if (res && res.status === 200 && Array.isArray(res.priceRequests)) {
        setPendingPriceRequestsCount(res.priceRequests.filter((p) => p.status === 'pending').length);
      }
    }).catch(() => {});
  }, [user, isAdmin, isManager]);

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
      localStorage.setItem('linecart_orders', JSON.stringify(updated));
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

  const handleLogout = () => {
    api.logout();
    signOutAppSession();
    localStorage.removeItem('LineCartPref_token');
    localStorage.removeItem('LineCartPref_userid');
    localStorage.removeItem('LineCartPref_user');
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

  const initials = (name) =>
    (name || 'Admin')
      .split(/\s+/)
      .slice(0, 2)
      .map((x) => x[0])
      .join('')
      .toUpperCase();

  const pageLabels = {
    overview: isAdmin ? 'Executive Command Center' : isManager ? 'Performance Reports' : 'Overview',
    orders: isAdmin ? 'All Company Orders' : isManager ? 'Team Orders' : 'Order entry',
    reports: isAdmin ? 'Executive Reports' : isManager ? 'Performance Reports' : 'Reports',
    customers: 'Customer Shops',
    summary: 'Summary Report',
    map: 'Cluster Shop Map',
    team: 'Sales Team Supervision',
    delivery: 'Delivery Route Fulfillment',
    'admin-dashboard': 'Executive Command Center',
    'admin-users': 'User Accounts & Roles',
    'admin-roles': 'Roles & Permissions',
    'admin-assignments': 'Team Assignments',
    'admin-targets': 'Targets & Quotas',
    'admin-audit': 'Security Audit Trail',
    'admin-settings': 'System Settings',
    items: 'Items & Daily Pricing'
  };

  if (!user) {
    return (
      <>
        <LoginScreen
          onLoginSuccess={(u) => {
            setUser(u);
            const r = (u?.role || '').toLowerCase();
            if (r === 'admin') navigate('admin-dashboard');
            else if (r === 'sales manager') navigate('reports');
            else if (r === 'delivery agent') navigate('delivery');
            else navigate('overview');
          }}
          showToast={showToast}
        />
        <div className={`toast ${toastMsg ? 'visible' : ''}`} role="status">
          {toastMsg}
        </div>
      </>
    );
  }

  return (
    <div className={`app-shell`}>
      {/* --- DESKTOP SIDEBAR --- */}
      <aside className="sidebar">
        {/* Brand */}
        <a
          className="brand"
          href={isAdmin ? '#admin-dashboard' : isManager ? '#reports' : isDelivery ? '#delivery' : '#overview'}
          onClick={(e) => {
            e.preventDefault();
            navigate(isAdmin ? 'admin-dashboard' : isManager ? 'reports' : isDelivery ? 'delivery' : 'overview');
          }}
          aria-label="Linecart home"
        >
          <img src="/lincart_flashicon.png" alt="" />
          <span>linecart<span className="brand-dot">.</span></span>
        </a>

        <div className="workspace-label">
          {isAdmin ? '🛡 EXECUTIVE GOVERNANCE' : isManager ? 'SALES MANAGER PORTAL' : isDelivery ? '🚚 DELIVERY ROUTE FLEET' : 'WORKSPACE'}
        </div>

        {/* Main Nav */}
        {isAdmin ? (
          <nav className="main-nav" aria-label="Administrator navigation">
            <button
              className={`nav-item ${page === 'admin-dashboard' ? 'active' : ''}`}
              onClick={() => navigate('admin-dashboard')}
            >
              <span className="nav-icon">▦</span>Dashboard
            </button>

            <button
              className={`nav-item ${page === 'admin-users' ? 'active' : ''}`}
              onClick={() => navigate('admin-users')}
            >
              <span className="nav-icon">👥</span>User Management
            </button>

            <button
              className={`nav-item ${page === 'admin-roles' ? 'active' : ''}`}
              onClick={() => navigate('admin-roles')}
            >
              <span className="nav-icon">🛡</span>Roles &amp; Permissions
            </button>

            <button
              className={`nav-item ${page === 'admin-assignments' ? 'active' : ''}`}
              onClick={() => navigate('admin-assignments')}
            >
              <span className="nav-icon">🔗</span>Team Assignments
            </button>

            <button
              className={`nav-item ${page === 'admin-targets' ? 'active' : ''}`}
              onClick={() => navigate('admin-targets')}
            >
              <span className="nav-icon">🎯</span>Targets &amp; Quotas
            </button>

            <button
              className={`nav-item ${page === 'orders' ? 'active' : ''}`}
              onClick={() => navigate('orders')}
            >
              <span className="nav-icon">📦</span>Company Orders
            </button>

            <button
              className={`nav-item ${page === 'price-requests' ? 'active' : ''}`}
              onClick={() => navigate('price-requests')}
            >
              <span className="nav-icon">⏳</span>Price Approvals
              {pendingPriceRequestsCount > 0 && (
                <span style={{
                  marginLeft: 'auto',
                  background: '#d97706',
                  color: '#fff',
                  fontSize: '11px',
                  fontWeight: 800,
                  padding: '1px 7px',
                  borderRadius: '999px'
                }}>
                  {pendingPriceRequestsCount}
                </span>
              )}
            </button>

            <button
              className={`nav-item ${page === 'items' ? 'active' : ''}`}
              onClick={() => navigate('items')}
            >
              <span className="nav-icon">🏷️</span>Items &amp; Daily Pricing
            </button>

            <button
              className={`nav-item ${page === 'reports' ? 'active' : ''}`}
              onClick={() => navigate('reports')}
            >
              <span className="nav-icon">📈</span>Executive Reports
            </button>

            <button
              className={`nav-item ${page === 'map' ? 'active' : ''}`}
              onClick={() => navigate('map')}
            >
              <span className="nav-icon">🗺</span>Cluster Shop Map
            </button>

            <button
              className={`nav-item ${page === 'delivery' ? 'active' : ''}`}
              onClick={() => navigate('delivery')}
            >
              <span className="nav-icon">🚚</span>Delivery Fleet
            </button>

            <button
              className={`nav-item ${page === 'admin-audit' ? 'active' : ''}`}
              onClick={() => navigate('admin-audit')}
            >
              <span className="nav-icon">📜</span>Security Audit
            </button>

            <button
              className={`nav-item ${page === 'admin-settings' ? 'active' : ''}`}
              onClick={() => navigate('admin-settings')}
            >
              <span className="nav-icon">⚙️</span>System Settings
            </button>
          </nav>
        ) : isManager ? (
          <nav className="main-nav" aria-label="Manager navigation">
            {isPageAllowed('reports') && (
              <button
                className={`nav-item ${page === 'reports' ? 'active' : ''}`}
                onClick={() => navigate('reports')}
              >
                <span className="nav-icon">▥</span>Reports &amp; Performance
              </button>
            )}

            {isPageAllowed('orders') && (
              <button
                className={`nav-item ${page === 'orders' ? 'active' : ''}`}
                onClick={() => navigate('orders')}
              >
                <span className="nav-icon">▤</span>Team Orders
              </button>
            )}

            {isPageAllowed('orders') && (
              <button
                className={`nav-item ${page === 'price-requests' ? 'active' : ''}`}
                onClick={() => navigate('price-requests')}
              >
                <span className="nav-icon">⏳</span>Price Approvals
                {pendingPriceRequestsCount > 0 && (
                  <span style={{
                    marginLeft: 'auto',
                    background: '#d97706',
                    color: '#fff',
                    fontSize: '11px',
                    fontWeight: 800,
                    padding: '1px 7px',
                    borderRadius: '999px'
                  }}>
                    {pendingPriceRequestsCount}
                  </span>
                )}
              </button>
            )}

            {isPageAllowed('items') && (
              <button
                className={`nav-item ${page === 'items' ? 'active' : ''}`}
                onClick={() => navigate('items')}
              >
                <span className="nav-icon">🏷️</span>Items &amp; Daily Pricing
              </button>
            )}

            {isPageAllowed('map') && (
              <button
                className={`nav-item ${page === 'map' ? 'active' : ''}`}
                onClick={() => navigate('map')}
              >
                <span className="nav-icon">🗺</span>Cluster Shop Map
              </button>
            )}

            {isPageAllowed('team') && (
              <button
                className={`nav-item ${page === 'team' ? 'active' : ''}`}
                onClick={() => navigate('team')}
              >
                <span className="nav-icon">👥</span>My Sales Team
              </button>
            )}

            {isPageAllowed('customers') && (
              <button
                className={`nav-item ${page === 'customers' ? 'active' : ''}`}
                onClick={() => navigate('customers')}
              >
                <span className="nav-icon">♙</span>Customer Shops
              </button>
            )}
          </nav>
        ) : isDelivery ? (
          <nav className="main-nav" aria-label="Delivery agent navigation">
            <button
              className={`nav-item ${page === 'delivery' ? 'active' : ''}`}
              onClick={() => navigate('delivery')}
            >
              <span className="nav-icon">🚚</span>Delivery Route
            </button>
          </nav>
        ) : (
          <nav className="main-nav" aria-label="Sales agent navigation">
            {isPageAllowed('overview') && (
              <button
                className={`nav-item ${page === 'overview' ? 'active' : ''}`}
                onClick={() => navigate('overview')}
              >
                <span className="nav-icon">▦</span>Overview
              </button>
            )}

            {isPageAllowed('orders') && (
              <button
                className={`nav-item ${page === 'orders' ? 'active' : ''}`}
                onClick={() => {
                  setPrefCustomer('');
                  navigate('orders');
                }}
              >
                <span className="nav-icon">▤</span>Order entry
              </button>
            )}

            {isPageAllowed('reports') && (
              <button
                className={`nav-item ${page === 'reports' ? 'active' : ''}`}
                onClick={() => navigate('reports')}
              >
                <span className="nav-icon">▥</span>Reports
              </button>
            )}

            {isPageAllowed('customers') && (
              <button
                className={`nav-item ${page === 'customers' ? 'active' : ''}`}
                onClick={() => navigate('customers')}
              >
                <span className="nav-icon">♙</span>Customers
              </button>
            )}

            {isPageAllowed('summary') && (
              <button
                className={`nav-item ${page === 'summary' ? 'active' : ''}`}
                onClick={() => navigate('summary')}
              >
                <span className="nav-icon">📋</span>Summary Report
              </button>
            )}
          </nav>
        )}

        {/* Sidebar Bottom: Help Card & Profile Card */}
        <div className="sidebar-bottom">
          <div className="help-card">
            <div className="help-mark">?</div>
            <strong>{isAdmin ? 'System Governance' : isManager ? 'Manager Assistance' : isDelivery ? 'Delivery Assistance' : 'Need a hand?'}</strong>
            <span>{isAdmin ? 'Full administrative authority and audit monitoring.' : isManager ? 'Team targets, order tracking & cluster mapping.' : isDelivery ? 'Road-distance ordered stops and quick status updates.' : 'All your routes and store orders in one place.'}</span>
          </div>

          <button
            className="profile-button"
            title="Click to switch user or sign out"
            onClick={handleLogout}
          >
            <span className="avatar">{initials(user.name)}</span>
            <span className="profile-copy">
              <b>{user.name}</b>
              <small>{user.role || (isAdmin ? 'Admin' : isManager ? 'Sales Manager' : isDelivery ? 'Delivery Agent' : 'Field Sales Agent')} · Sign out</small>
            </span>
            <span className="more">···</span>
          </button>
        </div>
      </aside>

      {/* --- MAIN CONTENT AREA --- */}
      <main className="main-area">
        {/* Android Simulated Status Bar (Visible only in desktop Android preview) */}
        {androidPreview && (
          <div className="android-status-bar">
            <span>9:41</span>
            <span>● ● ▰</span>
          </div>
        )}

        {/* Top Sticky Header */}
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="back-nav-button"
              onClick={handleBack}
              title="Go back"
              aria-label="Go back"
            >
              <svg className="back-arrow-svg" viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="19" y1="12" x2="5" y2="12"></line>
                <polyline points="12 19 5 12 12 5"></polyline>
              </svg>
              <span className="sr-only">Go back</span>
            </button>
            <div className="breadcrumbs">
              <span className="crumb-brand">Linecart</span>
              <span className="crumb-slash">/</span>
              <strong id="crumbCurrent">{pageLabels[page] || 'Overview'}</strong>
            </div>
          </div>

          <div className="top-actions">
            <SyncStatusBar userId={user?.id} userName={user?.name} showToast={showToast} />
            <span className="today-label" id="todayLabel">{todayStr}</span>

            {/* Laptop / Mobile Preview Toggle Button */}
            <button
              className="android-toggle device-preview-toggle"
              onClick={() => setAndroidPreview(!androidPreview)}
              title="Toggle view between Laptop and Mobile preview"
              aria-label="Toggle device preview"
            >
              {androidPreview ? '💻 Laptop view' : '📱 Mobile preview'}
            </button>

            {/* Notifications */}
            <button
              className="icon-button"
              onClick={() => showToast('All wholesale delivery routes are active')}
              aria-label="Notifications"
            >
              🔔<i></i>
            </button>

            {/* Sign out Button in Topbar */}
            <button
              className="topbar-signout-btn"
              onClick={handleLogout}
              title="Sign out of LineCart"
              aria-label="Sign out"
            >
              <span className="signout-icon" aria-hidden="true">🚪</span>
              <span className="signout-text">Sign out</span>
            </button>

            {/* Avatar Pill */}
            <span className="top-avatar" title={user.name}>
              {initials(user.name)}
            </span>
          </div>
        </header>

        {/* Subtle Monochrome Background Watermark (strictly behind content, never full-color, preserves contrast) */}
        <div className="app-watermark-bg" aria-hidden="true">
          <div className="app-watermark-mark">
            <img
              src={logoIcon}
              alt=""
              className="app-watermark-logo"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
            />
            <span className="app-watermark-text">LineCart</span>
          </div>
        </div>

        {/* Main Content Router */}
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
              onTogglePreview={() => setAndroidPreview(!androidPreview)}
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

          {page === 'summary' && (
            <SummaryReportScreen
              user={user}
              showToast={showToast}
            />
          )}
            </Suspense>
          </ErrorBoundary>
        </div>

        {/* Mobile & Android Preview Bottom Navigation */}
        {isDelivery ? (
          <nav className="mobile-bottom-nav" aria-label="Mobile delivery navigation">
            <button
              className={page === 'delivery' ? 'active' : ''}
              onClick={() => navigate('delivery')}
            >
              <span>🚚</span>Route
            </button>
            <button
              className="mobile-nav-signout"
              onClick={handleLogout}
              title="Sign out of LineCart"
              aria-label="Sign out"
            >
              <span>🚪</span>Sign out
            </button>
          </nav>
        ) : isAdmin ? (
          <nav className="mobile-bottom-nav" aria-label="Mobile admin navigation">
            <button
              className={page === 'admin-dashboard' || page === 'overview' ? 'active' : ''}
              onClick={() => navigate('admin-dashboard')}
            >
              <span>▦</span>Overview
            </button>
            <button
              className={page === 'admin-users' ? 'active' : ''}
              onClick={() => navigate('admin-users')}
            >
              <span>👥</span>Users
            </button>
            <button
              className={page === 'orders' ? 'active' : ''}
              onClick={() => navigate('orders')}
            >
              <span>📦</span>Orders
            </button>
            <button
              className={page === 'items' ? 'active' : ''}
              onClick={() => navigate('items')}
            >
              <span>🏷️</span>Items
            </button>
            <button
              className={page === 'admin-roles' ? 'active' : ''}
              onClick={() => navigate('admin-roles')}
            >
              <span>🛡</span>Roles
            </button>
            <button
              className={page === 'admin-settings' ? 'active' : ''}
              onClick={() => navigate('admin-settings')}
            >
              <span>⚙️</span>Settings
            </button>
            <button
              className="mobile-nav-signout"
              onClick={handleLogout}
              title="Sign out of LineCart"
              aria-label="Sign out"
            >
              <span>🚪</span>Sign out
            </button>
          </nav>
        ) : isManager ? (
          <nav className="mobile-bottom-nav" aria-label="Mobile manager navigation">
            {isPageAllowed('reports') && (
              <button
                className={page === 'reports' ? 'active' : ''}
                onClick={() => navigate('reports')}
              >
                <span>▥</span>Reports
              </button>
            )}
            {isPageAllowed('orders') && (
              <button
                className={page === 'orders' ? 'active' : ''}
                onClick={() => navigate('orders')}
              >
                <span>▤</span>Orders
              </button>
            )}
            {isPageAllowed('items') && (
              <button
                className={page === 'items' ? 'active' : ''}
                onClick={() => navigate('items')}
              >
                <span>🏷️</span>Pricing
              </button>
            )}
            {isPageAllowed('map') && (
              <button
                className={page === 'map' ? 'active' : ''}
                onClick={() => navigate('map')}
              >
                <span>🗺</span>Map
              </button>
            )}
            {isPageAllowed('team') && (
              <button
                className={page === 'team' ? 'active' : ''}
                onClick={() => navigate('team')}
              >
                <span>👥</span>Team
              </button>
            )}
            {isPageAllowed('customers') && (
              <button
                className={page === 'customers' ? 'active' : ''}
                onClick={() => navigate('customers')}
              >
                <span>♙</span>Shops
              </button>
            )}
            <button
              className="mobile-nav-signout"
              onClick={handleLogout}
              title="Sign out of LineCart"
              aria-label="Sign out"
            >
              <span>🚪</span>Sign out
            </button>
          </nav>
        ) : (
          <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
            {isPageAllowed('overview') && (
              <button
                className={page === 'overview' ? 'active' : ''}
                onClick={() => navigate('overview')}
              >
                <span>⌂</span>Home
              </button>
            )}
            {isPageAllowed('orders') && (
              <button
                className={page === 'orders' ? 'active' : ''}
                onClick={() => {
                  setPrefCustomer('');
                  navigate('orders');
                }}
              >
                <span>▤</span>Orders
              </button>
            )}
            {isPageAllowed('customers') && (
              <button
                className={page === 'customers' ? 'active' : ''}
                onClick={() => navigate('customers')}
              >
                <span>♙</span>Shops
              </button>
            )}
            {isPageAllowed('reports') && (
              <button
                className={page === 'reports' ? 'active' : ''}
                onClick={() => navigate('reports')}
              >
                <span>▥</span>Reports
              </button>
            )}
            {isPageAllowed('summary') && (
              <button
                className={page === 'summary' ? 'active' : ''}
                onClick={() => navigate('summary')}
              >
                <span>📋</span>Summary
              </button>
            )}
            <button
              className="mobile-nav-signout"
              onClick={handleLogout}
              title="Sign out of LineCart"
              aria-label="Sign out"
            >
              <span>🚪</span>Sign out
            </button>
          </nav>
        )}

        {/* Android System Gesture Bar (Visible only in desktop Android preview) */}
        {androidPreview && (
          <div className="android-system-nav">
            <span></span>
          </div>
        )}
      </main>

      {/* Floating Exit Android Preview Button */}
      {androidPreview && (
        <button
          className="exit-android"
          onClick={() => setAndroidPreview(false)}
        >
          ← &nbsp; Exit Mobile preview (Laptop view)
        </button>
      )}

      {/* Toast Notification Container */}
      <div className={`toast ${toastMsg ? 'visible' : ''}`} role="status">
        {toastMsg}
      </div>
    </div>
  );
}
