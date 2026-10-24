import React, { useState, useEffect } from 'react';
import { api } from './api';
import OverviewScreen from './components/OverviewScreen';
import OrderEntryScreen from './components/OrderEntryScreen';
import ReportsScreen from './components/ReportsScreen';
import CustomersScreen from './components/CustomersScreen';
import SummaryReportScreen from './components/SummaryReportScreen';
import LoginScreen from './components/LoginScreen';

const DEFAULT_ORDERS = [
  { id: 'LC-24018', customer: 'Bharkathi briyani hotel', date: '2026-10-24', itemsCount: 4, total: 4280, status: 'In progress' },
  { id: 'LC-24017', customer: 'hotel saro', date: '2026-10-23', itemsCount: 3, total: 3150, status: 'Delivered' },
  { id: 'LC-24016', customer: 'Hasini Vegitables', date: '2026-10-23', itemsCount: 5, total: 6720, status: 'Delivered' },
  { id: 'LC-24015', customer: 'City bakes & cafe', date: '2026-10-22', itemsCount: 2, total: 1980, status: 'Pending' },
  { id: 'LC-24014', customer: 'amirtha hotel', date: '2026-10-22', itemsCount: 4, total: 4870, status: 'Delivered' },
  { id: 'LC-24013', customer: 'yuvamukil mess', date: '2026-10-21', itemsCount: 3, total: 3620, status: 'Delivered' },
  { id: 'LC-24012', customer: 'KS vegitable shop', date: '2026-10-21', itemsCount: 2, total: 1840, status: 'Cancelled' }
];

export default function App() {
  const [user, setUser] = useState(() => {
    try {
      const saved = localStorage.getItem('LineCartPref_user');
      return saved ? JSON.parse(saved) : { id: 6, name: 'GURUPRASATH A', role: 'Field Sales Agent', phone: '9876543210' };
    } catch {
      return { id: 6, name: 'GURUPRASATH A', role: 'Field Sales Agent', phone: '9876543210' };
    }
  });

  const [page, setPage] = useState(() => {
    const hash = window.location.hash.replace('#', '');
    return ['overview', 'orders', 'reports', 'customers', 'summary'].includes(hash)
      ? hash
      : 'overview';
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
      return saved ? JSON.parse(saved) : DEFAULT_ORDERS;
    } catch {
      return DEFAULT_ORDERS;
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
      if (['overview', 'orders', 'reports', 'customers', 'summary'].includes(hash)) {
        setPage(hash);
      }
    };
    window.addEventListener('hashchange', handleHash);
    return () => window.removeEventListener('hashchange', handleHash);
  }, []);

  const navigate = (nextPage) => {
    setPage(nextPage);
    window.location.hash = `#${nextPage}`;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Sync body class for android-preview
  useEffect(() => {
    document.body.classList.toggle('android-preview', androidPreview);
  }, [androidPreview]);

  // Load cluster and shops data from backend
  useEffect(() => {
    if (!user) return;
    api.getClusterInfo(user.id).then((res) => {
      if ((res.status === 200 || res.status === 1) && res.result?.clusterList) {
        setClusters(res.result.clusterList);
      }
    });

    api.getItemsOrder(user.id).then((res) => {
      if ((res.status === 200 || res.status === 1) && res.result?.clusterList) {
        const allShops = [];
        res.result.clusterList.forEach((c) => {
          if (c.shopsList) {
            c.shopsList.forEach((s) => allShops.push({ ...s, clusterid: c.clusterId }));
          }
        });
        setShops(allShops);

        // Catalog items from first shop
        if (res.result.clusterList[0]?.shopsList?.[0]?.itemsList) {
          setCatalogItems(res.result.clusterList[0].shopsList[0].itemsList);
        }
      }
    });
  }, [user]);

  const handleOrderPlaced = (newOrder) => {
    setOrders((prev) => {
      const updated = [newOrder, ...prev];
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
    localStorage.removeItem('LineCartPref_userid');
    localStorage.removeItem('LineCartPref_user');
    setUser(null);
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
    overview: 'Overview',
    orders: 'Order entry',
    reports: 'Reports',
    customers: 'Customers',
    summary: 'Summary Report'
  };

  if (!user) {
    return (
      <>
        <LoginScreen onLoginSuccess={(u) => setUser(u)} showToast={showToast} />
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
          href="#overview"
          onClick={(e) => {
            e.preventDefault();
            navigate('overview');
          }}
          aria-label="Linecart home"
        >
          <img src="/lincart_flashicon.png" alt="" />
          <span>linecart<span className="brand-dot">.</span></span>
        </a>

        <div className="workspace-label">WORKSPACE</div>

        {/* Main Nav */}
        <nav className="main-nav" aria-label="Main navigation">
          <button
            className={`nav-item ${page === 'overview' ? 'active' : ''}`}
            onClick={() => navigate('overview')}
          >
            <span className="nav-icon">▦</span>Overview
          </button>

          <button
            className={`nav-item ${page === 'orders' ? 'active' : ''}`}
            onClick={() => {
              setPrefCustomer('');
              navigate('orders');
            }}
          >
            <span className="nav-icon">▤</span>Order entry
          </button>

          <button
            className={`nav-item ${page === 'reports' ? 'active' : ''}`}
            onClick={() => navigate('reports')}
          >
            <span className="nav-icon">▥</span>Reports
          </button>

          <button
            className={`nav-item ${page === 'customers' ? 'active' : ''}`}
            onClick={() => navigate('customers')}
          >
            <span className="nav-icon">♙</span>Customers
          </button>

          <button
            className={`nav-item ${page === 'summary' ? 'active' : ''}`}
            onClick={() => navigate('summary')}
          >
            <span className="nav-icon">📋</span>Summary Report
          </button>
        </nav>

        {/* Sidebar Bottom: Help Card & Profile Card */}
        <div className="sidebar-bottom">
          <div className="help-card">
            <div className="help-mark">?</div>
            <strong>Need a hand?</strong>
            <span>All your routes and store orders in one place.</span>
          </div>

          <button
            className="profile-button"
            title="Click to switch user or sign out"
            onClick={handleLogout}
          >
            <span className="avatar">{initials(user.name)}</span>
            <span className="profile-copy">
              <b>{user.name}</b>
              <small>{user.role || 'Field Sales Agent'} · Sign out</small>
            </span>
            <span className="more">···</span>
          </button>
        </div>
      </aside>

      {/* --- MAIN CONTENT AREA --- */}
      <main className="main-area">
        {/* Android Simulated Status Bar (Visible in Android preview) */}
        <div className="android-status-bar">
          <span>9:41</span>
          <span>● ● ▰</span>
        </div>

        {/* Top Sticky Header */}
        <header className="topbar">
          <div className="breadcrumbs">
            <span>Linecart</span>
            <span className="crumb-slash">/</span>
            <strong id="crumbCurrent">{pageLabels[page] || 'Overview'}</strong>
          </div>

          <div className="top-actions">
            <span className="today-label" id="todayLabel">{todayStr}</span>

            {/* Android Preview Toggle Button */}
            <button
              className="android-toggle"
              onClick={() => setAndroidPreview(!androidPreview)}
              title="Toggle Android mobile preview device frame"
            >
              ▯ &nbsp;{androidPreview ? 'Desktop view' : 'Android preview'}
            </button>

            {/* Notifications */}
            <button
              className="icon-button"
              onClick={() => showToast('All wholesale delivery routes are active')}
              aria-label="Notifications"
            >
              ♧<i></i>
            </button>

            {/* Avatar Pill */}
            <span className="top-avatar" title={user.name}>
              {initials(user.name)}
            </span>
          </div>
        </header>

        {/* Main Content Router */}
        <div className="page-content" id="pageContent">
          {page === 'overview' && (
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

          {page === 'orders' && (
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
          )}

          {page === 'reports' && (
            <ReportsScreen
              user={user}
              clusters={clusters}
              shops={shops}
              orders={orders}
              onNavigate={navigate}
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

          {page === 'summary' && (
            <SummaryReportScreen
              user={user}
              showToast={showToast}
            />
          )}
        </div>

        {/* Mobile & Android Preview Bottom Navigation */}
        <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
          <button
            className={page === 'overview' ? 'active' : ''}
            onClick={() => navigate('overview')}
          >
            <span>⌂</span>Home
          </button>
          <button
            className={page === 'orders' ? 'active' : ''}
            onClick={() => {
              setPrefCustomer('');
              navigate('orders');
            }}
          >
            <span>▤</span>Orders
          </button>
          <button
            className={page === 'customers' ? 'active' : ''}
            onClick={() => navigate('customers')}
          >
            <span>♙</span>Shops
          </button>
          <button
            className={page === 'reports' ? 'active' : ''}
            onClick={() => navigate('reports')}
          >
            <span>▥</span>Reports
          </button>
          <button
            className={page === 'summary' ? 'active' : ''}
            onClick={() => navigate('summary')}
          >
            <span>📋</span>Summary
          </button>
        </nav>

        {/* Android System Gesture Bar (Visible in Android preview) */}
        <div className="android-system-nav">
          <span></span>
        </div>
      </main>

      {/* Floating Exit Android Preview Button */}
      {androidPreview && (
        <button
          className="exit-android"
          onClick={() => setAndroidPreview(false)}
        >
          ← &nbsp; Exit Android preview
        </button>
      )}

      {/* Toast Notification Container */}
      <div className={`toast ${toastMsg ? 'visible' : ''}`} role="status">
        {toastMsg}
      </div>
    </div>
  );
}
