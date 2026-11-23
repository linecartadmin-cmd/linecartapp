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

// Modals built by individual screens before the redesign. Selectors match their markup:
// class names (.modal-overlay / .modal-backdrop), ARIA dialogs, Tailwind full-screen overlays, and
// inline-styled fixed overlays (for example the Manager Reports target form).
const LEGACY_MODAL_SELECTOR =
  '.modal-overlay, .modal-backdrop, [role="dialog"][aria-modal="true"], .fixed.inset-0, [style*="position: fixed"], [style*="position:fixed"]';

// A button counts as the modal's own close control when it is marked as one, or when its only
// content is a close glyph. Text buttons such as "Cancel" are never pressed: on some screens a
// "Cancel ..." button is the destructive action.
const CLOSE_SELECTOR = '.modal-close, [aria-label="Close"], [aria-label="close"]';
const CLOSE_GLYPHS = new Set(['✕', '✖', '×', '╳']);

function isFullScreenOverlay(el, view) {
  const r = el.getBoundingClientRect();
  if (!(r.width > 0 && r.height > 0)) return false;
  // Inline fixed elements must cover the screen to count (excludes small fixed badges and bars).
  const inlineFixed = !el.matches('.modal-overlay, .modal-backdrop, [role="dialog"], .fixed.inset-0');
  if (inlineFixed && view) {
    return r.width >= view.innerWidth * 0.9 && r.height >= view.innerHeight * 0.9;
  }
  return true;
}

function findCloseControl(modal) {
  const marked = modal.querySelector(CLOSE_SELECTOR);
  if (marked) return marked;
  return Array.from(modal.querySelectorAll('button')).find((b) => CLOSE_GLYPHS.has((b.textContent || '').trim())) || null;
}

// Returns 'none' when no legacy modal is open, 'closed' when its own close control was pressed,
// or 'blocked' when a modal is open without one (the caller then does nothing, so the user never
// navigates away from a half-finished form or a pending confirmation).
export function closeLegacyModal(doc = typeof document !== 'undefined' ? document : null) {
  if (!doc) return 'none';
  const view = doc.defaultView || (typeof window !== 'undefined' ? window : null);
  const modals = Array.from(doc.querySelectorAll(LEGACY_MODAL_SELECTOR)).filter((el) => {
    // New-primitive layers are handled by the overlay stack; toasts and the build badge are not modals.
    if (el.closest('.lc-scrim, .lc-toasts, [data-testid="build-badge"]')) return false;
    return isFullScreenOverlay(el, view);
  });
  if (!modals.length) return 'none';
  const top = modals[modals.length - 1];
  const close = findCloseControl(top);
  if (close && !close.disabled) {
    close.click();
    return 'closed';
  }
  return 'blocked';
}
