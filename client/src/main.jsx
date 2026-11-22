import React, { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import BuildBadge from './components/BuildBadge.jsx';
import { ToastProvider } from './ui';
import './index.css';

// Development-only component gallery (/#dev-gallery on the Vite dev server). import.meta.env.DEV is
// replaced with `false` in production builds, so this branch and the gallery chunk are removed.
const DevGallery = import.meta.env.DEV ? lazy(() => import('./dev/ComponentGallery.jsx')) : null;
const showDevGallery = Boolean(DevGallery) && window.location.hash === '#dev-gallery';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BuildBadge />
    <ToastProvider>
      <ErrorBoundary>
        {showDevGallery ? (
          <Suspense fallback={null}>
            <DevGallery />
          </Suspense>
        ) : (
          <App />
        )}
      </ErrorBoundary>
    </ToastProvider>
  </React.StrictMode>
);
