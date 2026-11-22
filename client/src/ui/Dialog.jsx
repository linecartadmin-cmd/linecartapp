import React, { useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useOverlay } from './useOverlay';
import { IconButton, Button } from './Button';

/**
 * Modal dialog: portal, focus trap, Escape / Android back / scrim click close it (unless
 * dismissible is false), page scroll locked, focus returns to the opener.
 */
export function Dialog({ open, onClose, title, children, footer, size = 'md', dismissible = true, initialFocusRef, closeLabel = 'Close', role = 'dialog' }) {
  const panelRef = useRef(null);
  const titleId = `dlg${useId().replace(/:/g, '')}`;
  useOverlay({ open, onClose, panelRef, initialFocusRef, dismissible });
  if (!open) return null;
  return createPortal(
    <div
      className="lc-scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && dismissible) onClose?.('scrim');
      }}
    >
      <div
        ref={panelRef}
        className={`lc-dialog ${size === 'wide' ? 'lc-dialog--wide' : ''}`.trim()}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="lc-dialog__head">
          <h2 className="lc-dialog__title" id={titleId}>{title}</h2>
          {dismissible ? <IconButton icon={X} label={closeLabel} size="sm" onClick={() => onClose?.('button')} /> : null}
        </div>
        <div className="lc-dialog__body">{children}</div>
        {footer ? <div className="lc-dialog__foot">{footer}</div> : null}
      </div>
    </div>,
    document.body
  );
}

/**
 * Confirmation for an action. `onConfirm` may return a promise; the confirm button shows a
 * spinner until it settles, and the dialog cannot be dismissed meanwhile.
 * tone="danger" uses the destructive button style. Cancel always gets initial focus so a stray
 * Enter never confirms a destructive action.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'primary',
  onConfirm,
  onCancel,
  children
}) {
  const cancelRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    try {
      setBusy(true);
      await onConfirm?.();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={() => !busy && onCancel?.()}
      title={title}
      dismissible={!busy}
      initialFocusRef={cancelRef}
      role="alertdialog"
      footer={
        <>
          <Button ref={cancelRef} variant="secondary" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={run} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {message ? <p style={{ margin: 0 }}>{message}</p> : null}
      {children}
    </Dialog>
  );
}

export function BottomSheet({ open, onClose, title, children, label }) {
  const panelRef = useRef(null);
  const titleId = `sh${useId().replace(/:/g, '')}`;
  useOverlay({ open, onClose, panelRef });
  if (!open) return null;
  return createPortal(
    <div
      className="lc-scrim lc-scrim--sheet"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.('scrim');
      }}
    >
      <div
        ref={panelRef}
        className="lc-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : label}
        tabIndex={-1}
      >
        <div className="lc-sheet__grip" aria-hidden="true" />
        <div className="lc-sheet__head">
          {title ? <h2 className="lc-sheet__title" id={titleId}>{title}</h2> : <span style={{ flex: 1 }} />}
          <IconButton icon={X} label="Close" size="sm" onClick={() => onClose?.('button')} />
        </div>
        <div className="lc-sheet__body">{children}</div>
      </div>
    </div>,
    document.body
  );
}
