import { useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { closeTopOverlay, closeLegacyModal } from '../ui/overlayStack';

/**
 * Android hardware back button (native app only; browsers keep their own back button).
 * Order of precedence:
 *   1. Close the top dialog, sheet or menu opened through the new UI primitives.
 *   2. A modal built by an existing screen: press its own close button; if it has none, do nothing
 *      (so an unfinished form is never left behind by accident).
 *   3. Otherwise follow the app's existing in-app history (App.jsx handleBack).
 *   4. At the role's home screen with no history: send the app to the background. This never signs
 *      out and never clears data or the offline queue; reopening the app returns to the same screen.
 */
export function useAndroidBackButton({ enabled, onBack, isAtRoot }) {
  const latest = useRef({ onBack, isAtRoot });
  latest.current = { onBack, isAtRoot };

  useEffect(() => {
    if (!enabled || !Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return undefined;
    let handle = null;
    let cancelled = false;

    import('@capacitor/app')
      .then(({ App }) =>
        App.addListener('backButton', () => {
          if (closeTopOverlay()) return;
          const legacy = closeLegacyModal();
          if (legacy !== 'none') return;
          if (latest.current.isAtRoot) {
            App.minimizeApp().catch(() => {});
            return;
          }
          latest.current.onBack();
        })
      )
      .then((h) => {
        if (cancelled) h?.remove();
        else handle = h;
      })
      .catch((err) => console.warn('[AndroidBack] listener unavailable:', err?.message || err));

    return () => {
      cancelled = true;
      handle?.remove();
    };
  }, [enabled]);
}
