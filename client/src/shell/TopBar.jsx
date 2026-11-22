import React from 'react';
import { ArrowLeft, ClipboardCheck, Smartphone, Monitor } from 'lucide-react';
import { IconButton, Icon } from '../ui';
import ProfileMenu from './ProfileMenu';

// Real pending price-approval count for Admin and Sales Manager. The badge appears only when the
// count was loaded successfully and is above zero; loading or failure shows no number.
export function ApprovalIndicator({ approvals, onOpen }) {
  const { status, count } = approvals;
  const ok = status === 'ok';
  const label =
    status === 'error'
      ? 'Price approvals (pending count unavailable)'
      : ok
        ? `Price approvals: ${count} pending`
        : 'Price approvals';
  return (
    <IconButton
      icon={ClipboardCheck}
      label={label}
      badge={ok && count > 0 ? (count > 99 ? '99+' : count) : null}
      onClick={onOpen}
      data-testid="approval-indicator"
      data-status={status}
    />
  );
}

export default function TopBar({
  title,
  showBack,
  onBack,
  syncSlot,
  dateLabel,
  approvals,
  onOpenApprovals,
  user,
  roleLabel,
  onSignOut,
  devPreview
}) {
  return (
    <header className="lc-topbar">
      {showBack ? <IconButton icon={ArrowLeft} label="Go back" onClick={onBack} /> : <span className="lc-topbar__title-pad" />}
      <div className="lc-topbar__title" id="crumbCurrent" aria-live="polite">{title}</div>
      <div className="lc-topbar__actions">
        {syncSlot ? <div className="lc-topbar__sync">{syncSlot}</div> : null}
        {dateLabel ? <span className="lc-topbar__date">{dateLabel}</span> : null}
        {devPreview ? (
          <button type="button" className="lc-devtoggle" onClick={devPreview.onToggle} title="Development builds only">
            <Icon icon={devPreview.active ? Monitor : Smartphone} size={16} />
            {devPreview.active ? 'Exit preview' : 'Phone preview (dev)'}
          </button>
        ) : null}
        {approvals ? <ApprovalIndicator approvals={approvals} onOpen={onOpenApprovals} /> : null}
        <ProfileMenu user={user} roleLabel={roleLabel} onSignOut={onSignOut} />
      </div>
    </header>
  );
}
