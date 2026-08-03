import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (relativePath) => readFile(new URL(relativePath, import.meta.url), 'utf8');
const [
  modalFrame,
  overlayFocus,
  taskEditor,
  postComposer,
  postDetail,
  informationalModal,
  uiCss,
] = await Promise.all([
  read('./ModalFrame.jsx'),
  read('./useOverlayFocus.js'),
  read('../../features/tasks/modals/TaskCreationMenu/TaskCreationMenu.jsx'),
  read('../../features/chronicle/modals/ChronicleComposerModal/ChronicleComposerModal.jsx'),
  read('../../features/chronicle/modals/ChronicleEntryModal/ChronicleEntryModal.jsx'),
  read('../../features/inventory/modals/InventoryItemPopup/InventoryItemPopup.jsx'),
  read('./UI.css'),
]);

function bodyBetween(source, startText, endText) {
  const start = source.indexOf(startText);
  const end = source.indexOf(endText, start + startText.length);
  assert.ok(start >= 0 && end > start, `Could not isolate ${startText}`);
  return source.slice(start, end);
}

test('task creation and editing ignore backdrop clicks and Escape', () => {
  assert.match(taskEditor, /useOverlayFocus\(modal\.visible, undefined, false, false, true\)/);
  assert.match(taskEditor, /<div className="blanker" aria-hidden="true" \/>/);
  assert.doesNotMatch(taskEditor, /className="blanker"[^>]*onClick/);
  assert.match(taskEditor, /activeTask\.UUID \? 'TASK EDITING' : 'TASK CREATION'/);
});

test('Chronicle composition and supported entry editing opt into protected dismissal', () => {
  assert.match(postComposer, /className="chronicle-composer"\s+protectedEditor/);
  assert.match(postDetail, /NiceModal\.show\(ChronicleComposerModal, \{ entry/);
  assert.match(modalFrame, /dismissal\.closeOnBackdrop \? onClose : undefined/);
  assert.match(modalFrame, /onClose && dismissal\.showCloseButton/);
  assert.match(overlayFocus, /if \(blockEscape\)[\s\S]*event\.preventDefault\(\)[\s\S]*stopImmediatePropagation/);
});

test('explicit discard, close, save, and publish actions remain wired', () => {
  assert.match(taskEditor, /<button onClick=\{handleDiscard\}>DISCARD<\/button>/);
  assert.match(taskEditor, /onClick=\{handleSaveTodo\}[\s\S]*SAVE TODO/);
  assert.match(postComposer, /<button type="button" onClick=\{close\}[^>]*>Close<\/button>/);
  assert.match(postComposer, /type="submit" form="chronicle-composer-form"/);
  assert.match(postComposer, /Save revision/);
  assert.match(postDetail, /onClick=\{editEntry\}>Edit/);
});

test('validation and persistence failures do not clear entered drafts', () => {
  const taskSave = bodyBetween(taskEditor, 'const handleSaveTodo = async () => {', 'const handleDelete = async () => {');
  assert.match(taskSave, /if \(!canSave\(\)\) return/);
  assert.ok(taskSave.indexOf('await databaseConnection.add(STORES.todo') < taskSave.indexOf('setActiveTask({})'));

  const composerCatch = bodyBetween(postComposer, '} catch (publishError) {', '\n  };\n\n  if (!modal.visible)');
  assert.match(composerCatch, /setError\(/);
  assert.match(composerCatch, /setSaving\(false\)/);
  assert.doesNotMatch(composerCatch, /setTitle|setBody|setImages|modal\.hide|modal\.remove/);

  assert.match(postComposer, /journalUUID: editingJournalUUID \|\| uuid\(\)/);
  assert.match(postComposer, /existingMetadata: editingMetadata/);
});

test('an unrelated informational modal keeps default ModalFrame dismissal', () => {
  assert.match(informationalModal, /<ModalFrame[\s\S]*onClose=\{close\}/);
  assert.doesNotMatch(informationalModal, /protectedEditor/);
});

test('modal headers keep their full height when the body needs to scroll', () => {
  assert.match(
    uiCss,
    /\.ui-modal__header,\s*\n\.ui-drawer__header \{[\s\S]*?flex: 0 0 auto;/,
  );
});
