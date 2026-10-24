import React, { useState, useId, useRef, useEffect } from 'react';

/**
 * Exact replica of Android 12+ Toast as captured in apk_login_toast.png
 * Includes aria-live="polite" for screen reader accessibility.
 */
export function AndroidToast({ message }) {
  if (!message) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-16 left-1/2 -translate-x-1/2 z-50 pointer-events-none flex items-center gap-2.5 bg-[#eef2f6] text-[#1c1b1f] px-4 py-2.5 rounded-full shadow-xl border border-black/10 max-w-[90vw]"
    >
      <img
        src="/lincart_flashicon.png"
        alt=""
        className="w-5 h-5 object-contain rounded-full flex-shrink-0"
      />
      <span className="text-sm font-normal tracking-tight whitespace-nowrap overflow-hidden text-ellipsis">
        {message}
      </span>
    </div>
  );
}

/**
 * Exact replica of Android MaterialComponents.TextInputLayout.OutlinedBox
 * with CustomOutlineBox style (3dp #f7ef02 stroke, #f7ef02 floating/inline hint, dark #1c1b1f text).
 */
export function OutlinedInput({
  id: propId,
  name,
  label,
  value,
  onChange,
  type = 'text',
  inputMode,
  readOnly = false,
  disabled = false,
  maxLength,
  multiline = false,
  rows = 3,
  bgColor = '#19afe6',
  className = '',
  inputClassName = '',
  onClick,
  autoComplete,
  autoCorrect,
  autoCapitalize,
  spellCheck
}) {
  const generatedId = useId();
  const inputId = propId || generatedId;
  const [focused, setFocused] = useState(false);

  const hasValue = value !== undefined && value !== null && String(value).length > 0;
  const isFloating = focused || hasValue;

  return (
    <div
      onClick={onClick}
      className={`relative border-[3px] border-[#f7ef02] rounded-[4px] transition-colors ${
        onClick ? 'cursor-pointer' : ''
      } ${className}`}
      style={{ backgroundColor: 'transparent' }}
    >
      <label
        htmlFor={inputId}
        style={{
          backgroundColor: isFloating ? bgColor : 'transparent'
        }}
        className={`absolute left-2.5 px-1 transition-all duration-150 pointer-events-none select-none font-normal text-[#f7ef02] ${
          isFloating
            ? '-top-2.5 text-[12px] leading-none z-10'
            : multiline
            ? 'top-3.5 text-[16px] leading-tight'
            : 'top-1/2 -translate-y-1/2 text-[16px] leading-none'
        }`}
      >
        {label}
      </label>

      {multiline ? (
        <textarea
          id={inputId}
          name={name || inputId}
          value={value}
          onChange={onChange}
          readOnly={readOnly}
          disabled={disabled}
          maxLength={maxLength}
          rows={rows}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          className={`w-full bg-transparent text-[#1c1b1f] text-[16px] px-3.5 py-3 outline-none resize-y ${inputClassName}`}
        />
      ) : (
        <input
          id={inputId}
          name={name || inputId}
          type={type}
          inputMode={inputMode}
          value={value}
          onChange={onChange}
          readOnly={readOnly}
          disabled={disabled}
          maxLength={maxLength}
          autoComplete={autoComplete}
          autoCorrect={autoCorrect}
          autoCapitalize={autoCapitalize}
          spellCheck={spellCheck}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          className={`w-full bg-transparent text-[#1c1b1f] text-[16px] px-3.5 h-[52px] outline-none ${
            onClick ? 'cursor-pointer' : ''
          } ${inputClassName}`}
        />
      )}
    </div>
  );
}

/**
 * Exact replica of Widget.MaterialComponents.TextInputLayout.OutlinedBox.ExposedDropdownMenu
 * Matches the APK's AutoCompleteTextView dropdowns for Cluster, ShopCategory, ModeOfPayment, Shop Name, Remarks.
 */
export function OutlinedDropdown({
  id: propId,
  name,
  label,
  value,
  options = [],
  onChange,
  bgColor = '#19afe6',
  className = '',
  compact = false
}) {
  const generatedId = useId();
  const selectId = propId || generatedId;
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  const hasValue = value !== undefined && value !== null && String(value).length > 0;

  useEffect(() => {
    const handleOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div
        onClick={() => setOpen((o) => !o)}
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-labelledby={`${selectId}-label`}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen((o) => !o);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
        className={`relative border-[3px] border-[#f7ef02] rounded-[4px] cursor-pointer flex items-center justify-between px-3.5 ${
          compact ? 'h-[48px]' : 'h-[54px]'
        }`}
      >
        <label
          id={`${selectId}-label`}
          style={{
            backgroundColor: hasValue || open ? bgColor : 'transparent'
          }}
          className={`absolute left-2.5 px-1 transition-all duration-150 pointer-events-none select-none font-normal text-[#f7ef02] ${
            hasValue || open
              ? '-top-2.5 text-[12px] leading-none z-10'
              : 'top-1/2 -translate-y-1/2 text-[16px] leading-none'
          }`}
        >
          {label}
        </label>

        <span className="text-[#1c1b1f] text-[15px] font-normal truncate pr-5 select-none">
          {value || ''}
        </span>

        {/* Material ExposedDropdownMenu trailing triangle icon */}
        <svg
          className={`w-5 h-5 text-[#49454f] flex-shrink-0 transition-transform ${
            open ? 'rotate-180' : ''
          }`}
          viewBox="0 0 24 24"
          fill="currentColor"
        >
          <path d="M7 10l5 5 5-5z" />
        </svg>
      </div>

      {open && options.length > 0 && (
        <ul
          role="listbox"
          className="absolute left-0 right-0 mt-0.5 bg-[#f5f5f8] text-[#1c1b1f] rounded shadow-xl border border-black/15 max-h-60 overflow-y-auto z-50 py-1"
        >
          {options.map((opt, idx) => {
            const optLabel = typeof opt === 'object' ? opt.label : String(opt);
            const optValue = typeof opt === 'object' ? opt.value : opt;
            const isSelected = String(optLabel) === String(value) || String(optValue) === String(value);
            return (
              <li
                key={`${optValue}-${idx}`}
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  onChange(opt);
                  setOpen(false);
                }}
                className={`px-4 py-2.5 text-[15px] cursor-pointer hover:bg-black/10 transition-colors ${
                  isSelected ? 'bg-black/5 font-medium' : 'font-normal'
                }`}
              >
                {optLabel}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
