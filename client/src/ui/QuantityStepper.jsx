import React from 'react';
import { Minus, Plus } from 'lucide-react';
import Icon from './Icon';

// Numeric quantity with large +/- targets. Emits numbers; empty input emits ''.
export default function QuantityStepper({ value, onChange, min = 0, max, step = 1, unit, label = 'Quantity', disabled = false, id }) {
  const num = value === '' || value == null ? null : Number(value);
  const clamp = (n) => {
    let v = n;
    if (min != null) v = Math.max(min, v);
    if (max != null) v = Math.min(max, v);
    return Math.round(v * 1000) / 1000;
  };
  const dec = () => onChange(clamp((num ?? 0) - step));
  const inc = () => onChange(clamp((num ?? 0) + step));
  return (
    <div className="lc-stepper" role="group" aria-label={label}>
      <button type="button" onClick={dec} disabled={disabled || (num ?? 0) <= min} aria-label={`Decrease ${label.toLowerCase()}`}>
        <Icon icon={Minus} size={18} />
      </button>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        aria-label={unit ? `${label} (${unit})` : label}
        value={num ?? ''}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === '') return onChange('');
          const n = Number(raw);
          if (!Number.isNaN(n)) onChange(clamp(n));
        }}
      />
      <button type="button" onClick={inc} disabled={disabled || (max != null && (num ?? 0) >= max)} aria-label={`Increase ${label.toLowerCase()}`}>
        <Icon icon={Plus} size={18} />
      </button>
      {unit ? <span className="lc-stepper__unit" aria-hidden="true">{unit}</span> : null}
    </div>
  );
}
