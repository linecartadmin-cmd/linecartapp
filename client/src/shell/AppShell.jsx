import React, { useEffect, useState } from 'react';
import './shell.css';
import SideNav from './SideNav';
import BottomNav from './BottomNav';
import MoreSheet from './MoreSheet';
import TopBar from './TopBar';

/**
 * Layout only. All routing, permission and session logic stays in App.jsx and is passed in:
 * nav (from visibleNav), page, onSelect(item), onBack, onSignOut, approvals, syncSlot.
 */
export default function AppShell({
  roleLabel,
  nav,
  page,
  title,
  showBack,
  onBack,
  onSelect,
  onSignOut,
  user,
  approvals,
  onOpenApprovals,
  syncSlot,
  dateLabel,
  devPreview,
  forcePhone = false,
  children
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const badges = { approvals: approvals && approvals.status === 'ok' && approvals.count > 0 ? approvals.count : null };
  const moreIds = new Set(nav.moreGroups.flatMap((g) => g.items.map((i) => i.pageId)));

  // Keep toasts clear of the phone bottom bar.
  useEffect(() => {
    const root = document.documentElement;
    const mq = window.matchMedia('(max-width: 599px)');
    const apply = () => root.style.setProperty('--lc-toast-offset', forcePhone || mq.matches ? 'calc(var(--lc-bottomnav-h) + 12px)' : '24px');
    apply();
    mq.addEventListener?.('change', apply);
    return () => {
      mq.removeEventListener?.('change', apply);
      root.style.removeProperty('--lc-toast-offset');
    };
  }, [forcePhone]);

  return (
    <div className={`lc-shell ${forcePhone ? 'lc-shell--phone' : ''}`.trim()}>
      <SideNav groups={nav.groups} page={page} onSelect={onSelect} homePage={nav.home} badges={badges} ariaLabel={`${roleLabel} navigation`} />
      <div className="lc-main">
        <TopBar
          title={title}
          showBack={showBack}
          onBack={onBack}
          syncSlot={syncSlot}
          dateLabel={dateLabel}
          approvals={approvals}
          onOpenApprovals={onOpenApprovals}
          user={user}
          roleLabel={roleLabel}
          onSignOut={onSignOut}
          devPreview={devPreview}
        />
        {children}
      </div>
      <BottomNav
        items={nav.phone}
        page={page}
        onSelect={onSelect}
        onMore={() => setMoreOpen(true)}
        moreActive={moreIds.has(page)}
        moreIsAccountOnly={nav.moreGroups.length === 0}
        badges={badges}
        ariaLabel={`${roleLabel} navigation`}
      />
      <MoreSheet
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        groups={nav.moreGroups}
        page={page}
        onSelect={onSelect}
        user={user}
        roleLabel={roleLabel}
        onSignOut={onSignOut}
        badges={badges}
      />
    </div>
  );
}
