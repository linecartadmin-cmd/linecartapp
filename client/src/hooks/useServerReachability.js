import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';

const RECHECK_INTERVAL_MS = 30000;

/**
 * Tracks whether the LineCart server can actually be reached (not just navigator.onLine,
 * which stays true on captive portals and dead mobile data).
 *
 * Returns { isConnected, isChecking, recheck }. recheck() resolves to true/false.
 */
export default function useServerReachability() {
  const [browserOnline, setBrowserOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine);
  const [serverReachable, setServerReachable] = useState(true);
  const [isChecking, setIsChecking] = useState(false);
  const mounted = useRef(true);

  const recheck = useCallback(async () => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setBrowserOnline(false);
      return false;
    }
    setIsChecking(true);
    const ok = await api.ping();
    if (mounted.current) {
      setServerReachable(ok);
      setBrowserOnline(true);
      setIsChecking(false);
    }
    return ok;
  }, []);

  useEffect(() => {
    mounted.current = true;
    const onOnline = () => {
      setBrowserOnline(true);
      recheck();
    };
    const onOffline = () => setBrowserOnline(false);
    const onVisible = () => {
      if (document.visibilityState === 'visible') recheck();
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisible);
    recheck();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') recheck();
    }, RECHECK_INTERVAL_MS);
    return () => {
      mounted.current = false;
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(timer);
    };
  }, [recheck]);

  return { isConnected: browserOnline && serverReachable, isChecking, recheck };
}
