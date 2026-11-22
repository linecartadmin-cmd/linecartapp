import React from 'react';
import { AlertTriangle, Check, CircleDashed, Clock, PackageCheck, Truck, X, MapPin } from 'lucide-react';
import Icon from './Icon';

// One lookup for every status string the server returns. The text shown is the status itself
// (or the label given), so the pill never changes what a status means; it only styles it.
// Keys are compared case-insensitively.
export const STATUS_MAP = {
  // Orders and delivery
  pending: { tone: 'neutral', icon: CircleDashed },
  'in progress': { tone: 'info', icon: Clock },
  'price approval pending': { tone: 'warning', icon: AlertTriangle },
  'picked up': { tone: 'transit', icon: Truck },
  delivered: { tone: 'success', icon: PackageCheck },
  'could not deliver': { tone: 'danger', icon: X },
  cancelled: { tone: 'danger', icon: X },
  rejected: { tone: 'danger', icon: X },
  // Payment
  collected: { tone: 'success', icon: Check },
  'partially collected': { tone: 'warning', icon: AlertTriangle },
  'not collected': { tone: 'neutral', icon: CircleDashed },
  // Price requests
  approved: { tone: 'success', icon: Check },
  // Visits
  verified: { tone: 'success', icon: MapPin },
  flagged: { tone: 'warning', icon: AlertTriangle },
  pending_review: { tone: 'warning', icon: AlertTriangle },
  too_far: { tone: 'danger', icon: MapPin },
  poor_accuracy: { tone: 'warning', icon: MapPin }
};

export function statusTone(status) {
  return STATUS_MAP[String(status || '').trim().toLowerCase()]?.tone || 'neutral';
}

export default function StatusPill({ status, label, tone, icon, className = '' }) {
  const entry = STATUS_MAP[String(status || '').trim().toLowerCase()];
  const t = tone || entry?.tone || 'neutral';
  const ic = icon === null ? null : icon || entry?.icon;
  return (
    <span className={`lc-pill lc-pill--${t} ${className}`.trim()}>
      {ic ? <Icon icon={ic} size={14} /> : null}
      <span>{label || status || '—'}</span>
    </span>
  );
}
