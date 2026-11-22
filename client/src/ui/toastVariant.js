// Existing screens call showToast('message') with no type. To keep that calling convention and
// still keep failures on screen, the variant is inferred from the wording when none is given.
// Order matters: queued/offline wording first (those are not failures), then failures, then input
// problems, then success. Anything else is informational.
const QUEUED_RE = /\b(queued|waiting to sync|saved locally|sync automatically|updated locally|working offline|offline mode|\(offline\))/i;
const ERROR_RE = /\b(fail(ed|ure)?|error|could ?n[o']t|cannot|can't|unable|denied|forbidden|invalid|not placed|not saved|not sent|refused|timed? ?out|no internet|no connection|expired)\b/i;
const WARNING_RE = /\b(warning|notice|pending|not yet|unsynced|retry|offline|unavailable|cached|requires an active|please (select|enter|choose|verify)|required|must)\b/i;
const SUCCESS_RE = /\b(success(fully)?|saved|updated|created|placed|approved|deleted|removed|assigned|welcome|synced|verified|delivered|recorded|copied|registered|downloaded|exported)\b/i;

export const TOAST_VARIANTS = ['info', 'success', 'warning', 'error'];

export function inferToastVariant(message) {
  const text = String(message || '');
  if (QUEUED_RE.test(text)) return 'warning';
  if (ERROR_RE.test(text)) return 'error';
  if (WARNING_RE.test(text)) return 'warning';
  if (SUCCESS_RE.test(text)) return 'success';
  return 'info';
}
