// Toast type for showToast(message) calls that do not pass one.
//
// Preferred API for new and migrated screens: pass the type explicitly,
//   showToast('Order placed', 'success')
//   showToast(res?.message || 'Could not save the price', 'error')
//   showToast('Saved on this phone; it will be sent when online', 'warning')
//   showToast(text, { variant: 'info', duration: 6000 })
// Inference below exists only so the many existing calls keep working. It errs towards 'error'
// (which stays until dismissed) whenever a message reads like something did not happen.
//
// Order of checks:
//   1. queued / offline / cached wording -> warning (the work is kept and will be sent; not a failure)
//   2. hard failure wording -> error
//   3. input problems ("Please enter…", "… is required", "must be…") -> error, unless the same
//      message also reports a success ("GPS coordinates updated. Please enter the street address.")
//   4. other cautionary wording -> warning
//   5. success wording -> success
//   6. anything else -> info
const QUEUED_RE = /\b(queued|waiting to sync|saved locally|sync automatically|updated locally|working offline|offline mode|showing cached|loaded cached|viewing cached|will be sent|syncing)\b|\(offline\)/i;
const ERROR_RE = new RegExp(
  [
    'fail(ed|ure|s)?', 'errors?', "could ?n[o']t", 'cannot', "can't", 'unable', 'denied', 'forbidden', 'invalid', 'incorrect',
    'not found', 'not permitted', 'not allowed', 'not available', 'not supported', 'no longer supported', 'not placed',
    'not saved', 'not sent', 'refused', 'strictly rejected', 'rejected (it|by)', 'timed? ?out', 'no internet', 'no connection',
    'expired', 'deactivated', 'disabled', 'already (registered|used|configured|reviewed|in use|exists)', 'was already', 'already belongs',
    'belongs to an existing', 'exceeds', 'too large', 'requires an active', 'access restricted', 'outside your',
    'unauthori[sz]ed', 'authentication required', 'try again', 'please update the'
  ].map((w) => `\\b${w}\\b`).join('|'),
  'i'
);
const INPUT_RE = /\b(required|must|please (select|enter|choose|give|provide)|enter a valid|missing)\b|^\s*enter\b/i;
const WARNING_RE = /\b(warning|notice|pending|not yet|unsynced|retry|offline|unavailable|cached|please verify|immutable|protected|does not need)\b/i;
const SUCCESS_RE = /\b(success(fully)?|saved|updated|created|placed|approved|deleted|removed|assigned|welcome|synced|verified|delivered|recorded|copied|registered|downloaded|exported|captured)\b/i;

export const TOAST_VARIANTS = ['info', 'success', 'warning', 'error'];

export function inferToastVariant(message) {
  const text = String(message || '');
  if (QUEUED_RE.test(text)) return 'warning';
  if (ERROR_RE.test(text)) return 'error';
  const input = INPUT_RE.exec(text);
  if (input) {
    // A success reported before the instruction ('GPS coordinates updated. Please enter…') is a prompt, not a failure
    const ok = SUCCESS_RE.exec(text);
    return ok && ok.index < input.index ? 'warning' : 'error';
  }
  if (WARNING_RE.test(text)) return 'warning';
  if (SUCCESS_RE.test(text)) return 'success';
  return 'info';
}

// How long a toast stays before closing itself, in milliseconds; null means "until dismissed".
// Errors never close themselves. Others get more time for longer messages (about 60 ms per
// character), within a floor and a ceiling. Timers pause while the toast is hovered or focused.
const DURATION_RULES = {
  info: { min: 4000, max: 10000 },
  success: { min: 4000, max: 10000 },
  warning: { min: 7000, max: 12000 }
};

export function toastDuration(variant, message) {
  if (variant === 'error') return null;
  const rule = DURATION_RULES[variant] || DURATION_RULES.info;
  const byLength = 1500 + 60 * String(message || '').length;
  return Math.max(rule.min, Math.min(rule.max, byLength));
}
