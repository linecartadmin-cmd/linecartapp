import React, { forwardRef } from 'react';
import Icon from './Icon';

/**
 * variant: primary | secondary | ghost | danger | danger-ghost | success
 * size: sm (36px) | md (44px) | lg (56px field actions)
 */
export const Button = forwardRef(function Button(
  { variant = 'primary', size = 'md', block = false, loading = false, icon, iconAfter, type = 'button', disabled, className = '', children, ...rest },
  ref
) {
  const cls = ['lc-btn', `lc-btn--${variant}`, size !== 'md' && `lc-btn--${size}`, block && 'lc-btn--block', className].filter(Boolean).join(' ');
  return (
    <button ref={ref} type={type} className={cls} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <span className="lc-btn__spinner" aria-hidden="true" /> : icon ? <Icon icon={icon} size={size === 'sm' ? 18 : 20} /> : null}
      <span>{children}</span>
      {iconAfter && !loading ? <Icon icon={iconAfter} size={size === 'sm' ? 18 : 20} /> : null}
    </button>
  );
});

// Icon-only button: `label` is required and becomes the accessible name and tooltip.
export const IconButton = forwardRef(function IconButton(
  { icon, label, size = 'md', outlined = false, badge, type = 'button', className = '', ...rest },
  ref
) {
  if (!label && typeof console !== 'undefined') console.warn('IconButton needs a label');
  const cls = ['lc-icon-btn', size === 'sm' && 'lc-icon-btn--sm', outlined && 'lc-icon-btn--outlined', className].filter(Boolean).join(' ');
  return (
    <button ref={ref} type={type} className={cls} aria-label={label} title={label} {...rest}>
      <Icon icon={icon} size={size === 'sm' ? 18 : 20} />
      {badge != null && badge !== false ? <span className="lc-count lc-count--dot-pos" aria-hidden="true">{badge}</span> : null}
    </button>
  );
});
