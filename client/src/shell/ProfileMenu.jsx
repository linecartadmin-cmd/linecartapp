import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, LogOut } from 'lucide-react';
import { Icon, registerOverlay } from '../ui';

export function initials(name) {
  return (name || 'User')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((x) => x[0])
    .join('')
    .toUpperCase();
}

// Avatar button with a small menu: who is signed in, and Sign out. Nothing else is added here
// in this phase (no password change: not approved).
export default function ProfileMenu({ user, roleLabel, onSignOut }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const btnRef = useRef(null);
  const firstItemRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const unregister = registerOverlay({ onRequestClose: () => setOpen(false) });
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setOpen(false);
        btnRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('touchstart', onDoc, { passive: true });
    document.addEventListener('keydown', onKey);
    const focusTimer = setTimeout(() => firstItemRef.current?.focus(), 0);
    return () => {
      clearTimeout(focusTimer);
      unregister();
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('touchstart', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="lc-profile" ref={wrapRef}>
      <button
        ref={btnRef}
        type="button"
        className="lc-profile__btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account: ${user?.name || ''}`}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="lc-avatar" aria-hidden="true">{initials(user?.name)}</span>
        <span className="lc-profile__name" aria-hidden="true">
          <b>{user?.name}</b>
          <small>{roleLabel}</small>
        </span>
        <Icon icon={ChevronDown} size={16} className="lc-profile__chev" />
      </button>
      {open ? (
        <div className="lc-menu" role="menu" aria-label="Account">
          <div className="lc-menu__head" role="presentation">
            <b>{user?.name}</b>
            <small>{roleLabel}</small>
          </div>
          <button
            ref={firstItemRef}
            type="button"
            role="menuitem"
            className="lc-menu__item lc-menu__item--danger"
            onClick={() => {
              setOpen(false);
              onSignOut();
            }}
          >
            <Icon icon={LogOut} size={20} />
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}
