import { useEffect, useRef } from 'react';
import { registerOverlay, isTopOverlay } from './overlayStack';

const FOCUSABLE =
  'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

let lockCount = 0;

function lockScroll() {
  if (lockCount++ === 0) document.documentElement.classList.add('lc-scroll-locked');
}
function unlockScroll() {
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount === 0) document.documentElement.classList.remove('lc-scroll-locked');
}

// Shared behaviour for modal layers: focus moves in and is trapped, Escape closes the top layer,
// page scroll is locked, focus returns to the opener on close, and the layer joins the back stack.
export function useOverlay({ open, onClose, panelRef, initialFocusRef, dismissible = true }) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const dismissibleRef = useRef(dismissible);
  dismissibleRef.current = dismissible;

  useEffect(() => {
    if (!open) return undefined;
    const opener = document.activeElement;
    const entry = {
      onRequestClose: (reason) => {
        if (dismissibleRef.current && onCloseRef.current) onCloseRef.current(reason);
      }
    };
    const unregister = registerOverlay(entry);
    lockScroll();

    const focusFirst = () => {
      const panel = panelRef.current;
      if (!panel) return;
      const target = initialFocusRef?.current || panel.querySelector('[data-autofocus]') || panel.querySelector(FOCUSABLE) || panel;
      target.focus({ preventScroll: true });
    };
    const focusTimer = setTimeout(focusFirst, 0);

    const onKeyDown = (e) => {
      if (!isTopOverlay(entry)) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        entry.onRequestClose('escape');
        return;
      }
      if (e.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const items = Array.from(panel.querySelectorAll(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (!items.length) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);

    return () => {
      clearTimeout(focusTimer);
      document.removeEventListener('keydown', onKeyDown, true);
      unregister();
      unlockScroll();
      if (opener && typeof opener.focus === 'function' && document.contains(opener)) {
        opener.focus({ preventScroll: true });
      }
    };
  }, [open, panelRef, initialFocusRef]);
}
