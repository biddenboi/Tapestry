import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveModalDismissalPolicy } from './modalDismissalPolicy.js';

test('protected editors require an explicit in-editor exit path', () => {
  assert.deepEqual(resolveModalDismissalPolicy({
    protectedEditor: true,
    closeOnBackdrop: true,
    closeOnEscape: true,
    showCloseButton: true,
  }), {
    closeOnBackdrop: false,
    closeOnEscape: false,
    showCloseButton: false,
    blockEscape: true,
  });
});

test('ordinary informational modals keep their existing dismissal defaults', () => {
  assert.deepEqual(resolveModalDismissalPolicy(), {
    closeOnBackdrop: true,
    closeOnEscape: true,
    showCloseButton: true,
    blockEscape: false,
  });

  assert.deepEqual(resolveModalDismissalPolicy({
    closeOnBackdrop: false,
    closeOnEscape: false,
    showCloseButton: false,
  }), {
    closeOnBackdrop: false,
    closeOnEscape: false,
    showCloseButton: false,
    blockEscape: false,
  });
});
