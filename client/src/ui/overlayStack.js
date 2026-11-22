// A tiny registry of open overlays (Dialog, BottomSheet, menus) so Escape and the Android hardware back
// button close the top-most one first. Legacy screen modals are not registered; see closeLegacyModal().

const stack = [];

export function registerOverlay(entry) {
  stack.push(entry);
  return () => {
    const i = stack.indexOf(entry);
    if (i >= 0) stack.splice(i, 1);
  };
}

export function isTopOverlay(entry) {
  return stack[stack.length - 1] === entry;
}

export function hasOpenOverlay() {
  return stack.length > 0;
}

// Asks the top-most registered overlay to close. Returns true when one was open.
export function closeTopOverlay() {
  const top = stack[stack.length - 1];
  if (!top) return false;
  if (typeof top.onRequestClose === 'function') top.onRequestClose('back');
  return true;
}

// Modals built by individual screens before the redesign. Selectors match their markup.
const LEGACY_MODAL_SELECTOR = '.modal-overlay, .modal-backdrop, [role="dialog"][aria-modal="true"], .fixed.inset-0';

// Returns 'none' when no legacy modal is open, 'closed' when its own close button was pressed,
// or 'blocked' when a modal is open but has no close button (the caller then does nothing, so the
// user never navigates away from a half-finished form).
export function closeLegacyModal(doc = typeof document !== 'undefined' ? document : null) {
  if (!doc) return 'none';
  const modals = Array.from(doc.querySelectorAll(LEGACY_MODAL_SELECTOR)).filter((el) => {
    if (el.closest('.lc-scrim')) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
  if (!modals.length) return 'none';
  const top = modals[modals.length - 1];
  const close = top.querySelector('.modal-close, [aria-label="Close"], [aria-label="close"]');
  if (close && !close.disabled) {
    close.click();
    return 'closed';
  }
  return 'blocked';
}
