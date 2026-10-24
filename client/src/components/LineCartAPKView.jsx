import React, { useState, useEffect } from 'react';
import APKHomeReport from './APKHomeReport';
import APKRegistration from './APKRegistration';
import APKOrderRequest from './APKOrderRequest';
import APKOrderReports from './APKOrderReports';

const VALID_TABS = ['home', 'registration', 'order_request', 'reports'];

export default function LineCartAPKView({ user }) {
  // Default fragment in MainMenu.java onCreate is HomeReport ('home')
  const [activeTab, setActiveTab] = useState(() => {
    const hash = window.location.hash.replace('#', '');
    return VALID_TABS.includes(hash) ? hash : 'home';
  });

  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.replace('#', '');
      if (VALID_TABS.includes(hash)) {
        setActiveTab(hash);
      }
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const switchTab = (tabId) => {
    setActiveTab(tabId);
    window.history.pushState(null, '', `#${tabId}`);
  };

  return (
    <div className="w-full flex flex-col h-full bg-[#19afe6] overflow-hidden">
      {/* FrameLayout (@+id/fragment_container) matching res/layout/mainpage.xml */}
      <main className="flex-1 overflow-y-auto">
        {activeTab === 'home' && <APKHomeReport user={user} />}
        {activeTab === 'registration' && <APKRegistration user={user} />}
        {activeTab === 'order_request' && <APKOrderRequest user={user} />}
        {activeTab === 'reports' && <APKOrderReports user={user} />}
      </main>

      {/* BottomNavigationView (@+id/bottom_navigation) matching res/menu/bottom_nav_menu.xml */}
      <nav
        id="bottom_navigation"
        aria-label="Bottom Navigation"
        className="bg-[#f7f2fa] text-[#49454f] border-t border-black/10 h-[72px] px-2 flex items-center justify-around select-none z-30 flex-shrink-0"
      >
        {/* 1. Home (@+id/nav_home -> drawable/ic_home.xml) */}
        <button
          id="nav_home"
          type="button"
          onClick={() => switchTab('home')}
          aria-current={activeTab === 'home' ? 'page' : undefined}
          className="flex-1 flex flex-col items-center justify-center py-1 group focus:outline-none"
        >
          <div
            className={`px-5 py-1 rounded-full transition-colors ${
              activeTab === 'home' ? 'bg-[#e8def8] text-[#1d192b]' : 'text-[#49454f] group-hover:bg-black/5'
            }`}
          >
            <svg className="w-6 h-6" viewBox="0 0 960 960" fill="currentColor">
              <path d="M240,760L360,760L360,520L600,520L600,760L720,760L720,400L480,220L240,400L240,760ZM160,840L160,360L480,120L800,360L800,840L520,840L520,600L440,600L440,840L160,840Z" />
            </svg>
          </div>
          <span
            className={`text-[12px] mt-0.5 leading-tight ${
              activeTab === 'home' ? 'font-bold text-[#1d192b]' : 'font-medium text-[#49454f]'
            }`}
          >
            Home
          </span>
        </button>

        {/* 2. Registration (@+id/nav_reg -> drawable/ic_registration.xml) */}
        <button
          id="nav_reg"
          type="button"
          onClick={() => switchTab('registration')}
          aria-current={activeTab === 'registration' ? 'page' : undefined}
          className="flex-1 flex flex-col items-center justify-center py-1 group focus:outline-none"
        >
          <div
            className={`px-5 py-1 rounded-full transition-colors ${
              activeTab === 'registration'
                ? 'bg-[#e8def8] text-[#1d192b]'
                : 'text-[#49454f] group-hover:bg-black/5'
            }`}
          >
            <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
              <path d="M15,14c-2.67,0 -8,1.34 -8,4v2h16v-2c0,-2.66 -5.33,-4 -8,-4zM6,12v-3H3V9h3V6h2v3h3v2H8v3H6zM15,12c2.21,0 4,-1.79 4,-4s-1.79,-4 -4,-4 -4,1.79 -4,4 1.79,4 4,4z" />
            </svg>
          </div>
          <span
            className={`text-[12px] mt-0.5 leading-tight ${
              activeTab === 'registration' ? 'font-bold text-[#1d192b]' : 'font-medium text-[#49454f]'
            }`}
          >
            Registration
          </span>
        </button>

        {/* 3. OrderRequest (@+id/nav_profile -> drawable/ic_shop.xml) */}
        <button
          id="nav_profile"
          type="button"
          onClick={() => switchTab('order_request')}
          aria-current={activeTab === 'order_request' ? 'page' : undefined}
          className="flex-1 flex flex-col items-center justify-center py-1 group focus:outline-none"
        >
          <div
            className={`px-5 py-1 rounded-full transition-colors ${
              activeTab === 'order_request'
                ? 'bg-[#e8def8] text-[#1d192b]'
                : 'text-[#49454f] group-hover:bg-black/5'
            }`}
          >
            <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
              <path d="M7,18c-1.1,0 -1.99,0.9 -1.99,2s0.89,2 1.99,2 2,-0.9 2,-2 -0.9,-2 -2,-2zM10,19.5c0,0.28 -0.22,0.5 -0.5,0.5s-0.5,-0.22 -0.5,-0.5 0.22,-0.5 0.5,-0.5 0.5,0.22 0.5,0.5zM17,18c-1.1,0 -1.99,0.9 -1.99,2s0.89,2 1.99,2 2,-0.9 2,-2 -0.9,-2 -2,-2zM20,19.5c0,0.28 -0.22,0.5 -0.5,0.5s-0.5,-0.22 -0.5,-0.5 0.22,-0.5 0.5,-0.5 0.5,0.22 0.5,0.5zM7.17,14.75l0.03,-0.07 0.96,-1.68h7.45c0.75,0 1.41,-0.41 1.75,-1.03l3.58,-6.49c0.08,-0.14 0.12,-0.31 0.12,-0.48 0,-0.55 -0.45,-1 -1,-1H5.21l-0.94,-2H1v2h2l3.6,7.59 -1.35,2.44C4.52,15.37 5.48,17 7,17h12v-2H7.42c-0.14,0 -0.25,-0.11 -0.25,-0.25z" />
            </svg>
          </div>
          <span
            className={`text-[12px] mt-0.5 leading-tight ${
              activeTab === 'order_request' ? 'font-bold text-[#1d192b]' : 'font-medium text-[#49454f]'
            }`}
          >
            OrderRequest
          </span>
        </button>

        {/* 4. Reports (@+id/nav_reports -> drawable/ic_reports.xml) */}
        <button
          id="nav_reports"
          type="button"
          onClick={() => switchTab('reports')}
          aria-current={activeTab === 'reports' ? 'page' : undefined}
          className="flex-1 flex flex-col items-center justify-center py-1 group focus:outline-none"
        >
          <div
            className={`px-5 py-1 rounded-full transition-colors ${
              activeTab === 'reports' ? 'bg-[#e8def8] text-[#1d192b]' : 'text-[#49454f] group-hover:bg-black/5'
            }`}
          >
            <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19,3H5C3.9,3 3,3.9 3,5v14c0,1.1 0.9,2 2,2h14c1.1,0 2,-0.9 2,-2V5C21,3.9 20.1,3 19,3zM9,17H7v-7h2V17zM13,17h-2v-4h2V17zM17,17h-2V7h2V17z" />
            </svg>
          </div>
          <span
            className={`text-[12px] mt-0.5 leading-tight ${
              activeTab === 'reports' ? 'font-bold text-[#1d192b]' : 'font-medium text-[#49454f]'
            }`}
          >
            Reports
          </span>
        </button>
      </nav>
    </div>
  );
}
