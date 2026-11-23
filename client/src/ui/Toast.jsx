import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import Icon from './Icon';
import { inferToastVariant, toastDuration, TOAST_VARIANTS } from './toastVariant';

export { inferToastVariant };

const ToastContext = createContext(null);

const ICONS = { info: Info, success: CheckCircle2, warning: AlertTriangle, error: AlertCircle };
const MAX_VISIBLE = 3;

function normalizeOptions(opts) {
  if (!opts) return {};
  if (typeof opts === 'string') return { variant: opts };
  return opts;
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const seq = useRef(0);

  const dismiss = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const show = useCallback((message, opts) => {
    if (message == null || message === '') return null;
    const o = normalizeOptions(opts);
    const variant = TOAST_VARIANTS.includes(o.variant) ? o.variant : inferToastVariant(message);
    const id = ++seq.current;
    // Errors always stay until dismissed, even if a duration is passed
    const duration = variant === 'error' ? null : o.duration !== undefined ? o.duration : toastDuration(variant, message);
    setToasts((list) => {
      // Do not stack the same visible message twice (double taps, repeated retries).
      if (list.some((t) => t.message === String(message) && t.variant === variant)) return list;
      return [...list, { id, message: String(message), variant, duration }];
    });
    return id;
  }, []);

  const value = useMemo(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

function ToastItem({ toast, onDismiss, active }) {
  // Auto-close timer that pauses while the pointer is over the toast or focus is inside it.
  const [paused, setPaused] = useState(false);
  const remaining = useRef(toast.duration);
  useEffect(() => {
    if (!active || !toast.duration || paused) return undefined;
    const started = Date.now();
    const t = setTimeout(() => onDismiss(toast.id), remaining.current);
    return () => {
      clearTimeout(t);
      remaining.current = Math.max(800, remaining.current - (Date.now() - started));
    };
  }, [active, paused, toast.duration, toast.id, onDismiss]);
  const pause = () => setPaused(true);
  const resume = (e) => {
    if (e && e.currentTarget.contains(e.relatedTarget)) return;
    setPaused(false);
  };
  const isError = toast.variant === 'error';
  return (
    <div className={`lc-toast lc-toast--${toast.variant}`} role={isError ? 'alert' : 'status'} data-testid="lc-toast" data-variant={toast.variant} data-paused={paused ? "true" : "false"} onMouseEnter={pause} onMouseLeave={resume} onFocus={pause} onBlur={resume}>
      <span className="lc-toast__icon"><Icon icon={ICONS[toast.variant]} size={20} /></span>
      <span className="lc-toast__msg">{toast.message}</span>
      <button type="button" className="lc-toast__close" onClick={() => onDismiss(toast.id)} aria-label="Dismiss notification">
        <Icon icon={X} size={18} />
      </button>
    </div>
  );
}

function ToastViewport({ toasts, onDismiss }) {
  // Show the oldest few; the rest wait their turn (queued). Timers start only once visible.
  const visible = toasts.slice(0, MAX_VISIBLE);
  const waiting = toasts.length - visible.length;
  return (
    <div className="lc-toasts" aria-live="polite" aria-relevant="additions">
      {visible.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={onDismiss} active />
      ))}
      {waiting > 0 ? <span className="lc-sr-only">{waiting} more notifications waiting</span> : null}
    </div>
  );
}
