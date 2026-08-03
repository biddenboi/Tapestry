/**
 * Resolve modal dismissal controls without changing the defaults used by
 * ordinary informational dialogs.
 */
export function resolveModalDismissalPolicy({
  protectedEditor = false,
  closeOnBackdrop = true,
  closeOnEscape = true,
  showCloseButton = true,
} = {}) {
  if (protectedEditor) {
    return Object.freeze({
      closeOnBackdrop: false,
      closeOnEscape: false,
      showCloseButton: false,
      blockEscape: true,
    });
  }

  return Object.freeze({
    closeOnBackdrop: !!closeOnBackdrop,
    closeOnEscape: !!closeOnEscape,
    showCloseButton: !!showCloseButton,
    blockEscape: false,
  });
}
