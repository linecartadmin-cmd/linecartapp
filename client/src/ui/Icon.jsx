import React from 'react';

// Wraps a lucide-react icon component with consistent size and stroke.
// Decorative by default (aria-hidden); pass `label` for a meaningful standalone icon.
export default function Icon({ icon: IconComponent, size = 20, strokeWidth = 2, label, className = '', ...rest }) {
  if (!IconComponent) return null;
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true, focusable: false };
  return (
    <IconComponent
      width={size}
      height={size}
      strokeWidth={strokeWidth}
      className={`lc-icon ${className}`.trim()}
      {...a11y}
      {...rest}
    />
  );
}
