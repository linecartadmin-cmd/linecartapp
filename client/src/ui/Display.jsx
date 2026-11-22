import React from 'react';
import { Inbox } from 'lucide-react';
import Icon from './Icon';

export function EmptyState({ icon = Inbox, title, children, action }) {
  return (
    <div className="lc-empty">
      <span className="lc-empty__icon"><Icon icon={icon} size={24} /></span>
      {title ? <h3 className="lc-empty__title">{title}</h3> : null}
      {children ? <p className="lc-empty__text">{children}</p> : null}
      {action ? <div className="lc-empty__action">{action}</div> : null}
    </div>
  );
}

// Placeholder blocks while content loads. Wrap a group in <SkeletonGroup label> for screen readers.
export function Skeleton({ width = '100%', height = 16, radius, style }) {
  return <span className="lc-skel" aria-hidden="true" style={{ width, height, borderRadius: radius, ...style }} />;
}

export function SkeletonGroup({ label = 'Loading', children }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" style={{ display: 'grid', gap: 12 }}>
      <span className="lc-sr-only">{label}</span>
      {children}
    </div>
  );
}

// A labelled figure. Shows exactly the value it is given: no trend or comparison is invented.
export function Metric({ label, value, hint, loading = false }) {
  return (
    <div className="lc-metric">
      <span className="lc-metric__label">{label}</span>
      {loading ? <Skeleton width="60%" height={28} /> : <span className="lc-metric__value">{value ?? '—'}</span>}
      {hint ? <span className="lc-metric__hint">{hint}</span> : null}
    </div>
  );
}

export function ProgressBar({ value = 0, max = 100, label, showValue = true, valueText, tone }) {
  const safeMax = Number(max) > 0 ? Number(max) : 100;
  const v = Math.max(0, Math.min(Number(value) || 0, safeMax));
  const pct = Math.round((v / safeMax) * 100);
  return (
    <div className={`lc-progress ${tone ? `lc-progress--${tone}` : ''}`.trim()}>
      {label || showValue ? (
        <div className="lc-progress__top">
          {label ? <span>{label}</span> : <span />}
          {showValue ? <span className="lc-progress__value">{valueText || `${pct}%`}</span> : null}
        </div>
      ) : null}
      <div
        className="lc-progress__track"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={safeMax}
        aria-valuenow={v}
        aria-valuetext={valueText || `${pct}%`}
      >
        <div className="lc-progress__fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
