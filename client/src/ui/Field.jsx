import React, { cloneElement, isValidElement, useId } from 'react';
import { AlertCircle, Search } from 'lucide-react';
import Icon from './Icon';

/**
 * Field wraps one control with a visible label, optional help and an error message.
 * The control receives id, aria-describedby and aria-invalid automatically.
 */
export function Field({ label, help, error, required = false, id, className = '', children }) {
  const autoId = useId();
  const controlId = id || `f${autoId.replace(/:/g, '')}`;
  const helpId = help ? `${controlId}-help` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy = [errorId, helpId].filter(Boolean).join(' ') || undefined;
  const control = isValidElement(children)
    ? cloneElement(children, {
        id: children.props.id || controlId,
        'aria-describedby': [children.props['aria-describedby'], describedBy].filter(Boolean).join(' ') || undefined,
        'aria-invalid': error ? true : children.props['aria-invalid'],
        required: children.props.required ?? (required || undefined)
      })
    : children;
  return (
    <div className={`lc-field ${className}`.trim()}>
      {label ? (
        <label className="lc-field__label" htmlFor={controlId}>
          {label}
          {required ? <span className="lc-field__req" aria-hidden="true">*</span> : null}
        </label>
      ) : null}
      {control}
      {error ? (
        <span className="lc-field__error" id={errorId} role="alert">
          <Icon icon={AlertCircle} size={16} />
          <span>{error}</span>
        </span>
      ) : null}
      {help ? <span className="lc-field__help" id={helpId}>{help}</span> : null}
    </div>
  );
}

export function TextInput({ className = '', ...rest }) {
  return <input className={`lc-input ${className}`.trim()} {...rest} />;
}

export function SearchInput({ className = '', label = 'Search', ...rest }) {
  return (
    <div className="lc-input-wrap">
      <Icon icon={Search} size={18} />
      <input type="search" aria-label={rest['aria-label'] || label} className={`lc-input ${className}`.trim()} {...rest} />
    </div>
  );
}

export function Select({ className = '', options, children, ...rest }) {
  return (
    <select className={`lc-select ${className}`.trim()} {...rest}>
      {options
        ? options.map((o) => (
            <option key={String(o.value)} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))
        : children}
    </select>
  );
}

export function TextArea({ className = '', ...rest }) {
  return <textarea className={`lc-textarea ${className}`.trim()} {...rest} />;
}
