import React, { useRef } from 'react';

// Single-choice control with radio-group semantics: arrow keys move and select, Tab leaves the group.
export default function SegmentedControl({ options, value, onChange, label, className = '' }) {
  const refs = useRef([]);
  const idx = Math.max(0, options.findIndex((o) => o.value === value));
  const move = (to) => {
    const n = (to + options.length) % options.length;
    onChange(options[n].value);
    refs.current[n]?.focus();
  };
  return (
    <div className={`lc-seg ${className}`.trim()} role="radiogroup" aria-label={label}>
      {options.map((o, i) => (
        <button
          key={String(o.value)}
          ref={(el) => (refs.current[i] = el)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={i === idx ? 0 : -1}
          className="lc-seg__opt"
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); move(i + 1); }
            if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); move(i - 1); }
            if (e.key === 'Home') { e.preventDefault(); move(0); }
            if (e.key === 'End') { e.preventDefault(); move(options.length - 1); }
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
