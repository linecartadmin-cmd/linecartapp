import React from 'react';
import { APP_BUILD_ENV } from '../api';

// Always-visible marker for the local development build only (it talks to a local server, never production).
// Rendered at the app root (outside the error boundary) so it shows on every screen. Release, debug and web
// builds render nothing; the debug build is identified by its launcher name "LineCart DEBUG".
const BADGES = {
  local: { text: 'LOCAL TEST SERVER', bg: '#1d4ed8' }
};

export default function BuildBadge() {
  const badge = BADGES[APP_BUILD_ENV];
  if (!badge) return null;
  return (
    <div
      data-testid="build-badge"
      aria-label={badge.text}
      style={{
        position: 'fixed',
        top: 'calc(env(safe-area-inset-top, 0px) + 2px)',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 2147483647,
        pointerEvents: 'none',
        background: badge.bg,
        color: '#fff',
        fontSize: '10px',
        fontWeight: 800,
        letterSpacing: '0.06em',
        lineHeight: '16px',
        padding: '0 8px',
        borderRadius: '9999px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.35)',
        whiteSpace: 'nowrap',
        opacity: 0.92
      }}
    >
      {badge.text}
    </div>
  );
}
