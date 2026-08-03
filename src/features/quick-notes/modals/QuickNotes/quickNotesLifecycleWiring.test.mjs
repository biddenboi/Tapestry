import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const [gameHub, launcher, composer, notes, controller, requirements] = await Promise.all([
  read('../../../../app/shell/GameHub/GameHub.jsx'),
  read('../../../chronicle/components/QuickCapture/QuickCaptureLauncher.jsx'),
  read('../../../chronicle/modals/ChronicleComposerModal/ChronicleComposerModal.jsx'),
  read('./QuickNotes.jsx'),
  read('./QuickNotesController.js'),
  read('../../../../app/data-source/panelDomainRequirements.js'),
]);

test('Quick Capture replaces the visible Quick Notes destination and opens the canonical Entry composer', () => {
  assert.doesNotMatch(gameHub, /loadQuickNotes|showQuickNotes|Quick Notes/);
  assert.match(gameHub, /<QuickCaptureLauncher \/>/);
  assert.match(launcher, /ChronicleComposerModal/);
  assert.match(launcher, /initialVisibility: 'private'/);
  assert.match(composer, /ChronicleDraftService/);
  assert.match(requirements, /notes: Object\.freeze\(\[D\.notes\]\)/);
});

test('one controller owns autosave, serialization, flush state, and undo-redo bookkeeping', () => {
  assert.match(notes, /createQuickNotesController/);
  assert.match(controller, /createKeyedSerialQueue/);
  assert.match(controller, /cancelAutosave/);
  assert.match(controller, /recordEdit/);
  assert.match(controller, /undo:/);
  assert.match(controller, /redo:/);
  assert.doesNotMatch(notes, /ensureFullyLoaded/);
});

test('Quick Notes render and pending-write recovery use the live Notes domain boundary', () => {
  assert.doesNotMatch(notes, /ensureCanonicalSource/);
  assert.match(notes, /if \(pendingWrite\) \{\s*await ensureDomainLoaded\('notes'\);/);
  assert.match(notes, /\[databaseConnection, ensureDomainLoaded, flushCanonicalWrite, notesController, runDurableMutation\]/);
});
