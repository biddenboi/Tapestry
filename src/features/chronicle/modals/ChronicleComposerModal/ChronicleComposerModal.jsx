import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { v4 as uuid } from 'uuid';
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import { useAppContext } from '@app/hooks/useAppContext.js';
import { DOMAIN_INVALIDATION } from '@app/context/domainRevisions.js';
import { getCurrentIGT } from '@domain/time/Time.js';
import { STORES } from '@domain/constants.js';
import MarkdownEditor from '@shared/markdown-editor/MarkdownEditor.jsx';
import PostImagePicker from '@shared/post-images/PostImagePicker.jsx';
import ActionRow from '@shared/ui/ActionRow.jsx';
import FormField from '@shared/ui/FormField.jsx';
import ModalFrame from '@shared/ui/ModalFrame.jsx';
import ChronicleDraftService from '@data/persistence/services/ChronicleDraftService.js';
import ChronicleContextService from '@data/persistence/services/ChronicleContextService.js';
import ChronicleStoryRepository from '@data/persistence/repositories/ChronicleStoryRepository.js';
import ChronicleRepository from '@data/persistence/repositories/ChronicleRepository.js';
import EntryShareSelector from '@features/chronicle/components/EntryShareSelector/EntryShareSelector.jsx';
import '@features/chronicle/Chronicle.css';

const KIND_COPY = Object.freeze({
  moment: ['Moment', 'A quick trace: a sentence or image is enough.'],
  entry: ['Entry', 'A fuller reflection, update, or record.'],
  essay: ['Essay', 'Long-form writing with a required title.'],
});

function localDateTimeValue(value = new Date()) {
  const date = new Date(value);
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return shifted.toISOString().slice(0, 16);
}

export default NiceModal.create(({
  initialKind = 'moment',
  initialVisibility = 'private',
  initialStoryId = '',
  quickCapture = false,
  draft: suppliedDraft = null,
  entry: editingEntry = null,
  addendumTo = null,
  onCreated,
  mobileRestricted = false,
} = {}) => {
  const {
    databaseConnection,
    currentPlayer,
    invalidateDomains,
    notify,
  } = useAppContext();
  const modal = useModal();
  const services = useMemo(() => ({
    drafts: new ChronicleDraftService(databaseConnection),
    context: new ChronicleContextService(databaseConnection),
    stories: new ChronicleStoryRepository(databaseConnection),
  }), [databaseConnection]);
  const initial = suppliedDraft || (editingEntry ? {
    UUID: `edit:${editingEntry.UUID}`,
    entryKind: editingEntry.entryKind,
    title: editingEntry.title,
    subtitle: editingEntry.subtitle,
    body: editingEntry.entry,
    images: editingEntry.images,
    visibility: editingEntry.visibility,
    occurrenceAt: editingEntry.occurrenceAt,
    primaryStoryId: editingEntry.primaryStoryId,
    createdAt: editingEntry.createdAt,
    editingJournalUUID: editingEntry.UUID,
    editingMetadata: editingEntry,
    ownerUUID: editingEntry.parent,
  } : null);
  const editingJournalUUID = editingEntry?.UUID || initial?.editingJournalUUID || null;
  const editingMetadata = editingEntry || initial?.editingMetadata || null;
  const addendumTarget = addendumTo || initial?.addendumTo || null;
  const draftIdRef = useRef(initial?.UUID || uuid());
  const lastSavedSignature = useRef('');
  const closeRequested = useRef(false);

  const [kind, setKind] = useState(mobileRestricted ? 'moment' : initial?.entryKind || initialKind);
  const [title, setTitle] = useState(initial?.title || '');
  const [subtitle, setSubtitle] = useState(initial?.subtitle || '');
  const [body, setBody] = useState(initial?.body || '');
  const [images, setImages] = useState(initial?.images || []);
  const [visibility, setVisibility] = useState(initial?.visibility || initialVisibility);
  const [editSummary, setEditSummary] = useState(initial?.editSummary || '');
  const [occurrenceAt, setOccurrenceAt] = useState(localDateTimeValue(initial?.occurrenceAt));
  const [primaryStoryId, setPrimaryStoryId] = useState(initial?.primaryStoryId || initialStoryId || '');
  const [stories, setStories] = useState([]);
  const [imageProcessing, setImageProcessing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState(suppliedDraft ? 'Saved locally' : editingEntry ? 'Editing published entry' : '');
  const [error, setError] = useState('');
  const canChangeAccess = !editingJournalUUID
    || String(editingEntry?.parent || initial?.ownerUUID || '') === String(currentPlayer?.UUID || '');

  const meaningful = Boolean(title.trim() || subtitle.trim() || body.trim() || images.length);
  const canPublish = Boolean(currentPlayer?.UUID && meaningful && (kind !== 'essay' || title.trim()))
    && (!mobileRestricted || kind === 'moment')
    && !saving && !imageProcessing;

  const buildDraft = useCallback(() => ({
    UUID: draftIdRef.current,
    parent: currentPlayer?.UUID,
    ownerUUID: editingEntry?.parent || initial?.ownerUUID || currentPlayer?.UUID,
    entryKind: kind,
    title,
    subtitle,
    body,
    images,
    visibility,
    editSummary,
    occurrenceAt: new Date(occurrenceAt).toISOString(),
    primaryStoryId: primaryStoryId || null,
    editingJournalUUID,
    editingMetadata,
    addendumTo: addendumTarget,
    createdAt: initial?.createdAt || new Date().toISOString(),
    composerState: { version: 1, activeField: 'body' },
  }), [
    body,
    currentPlayer?.UUID,
    images,
    kind,
    occurrenceAt,
    primaryStoryId,
    subtitle,
    initial?.createdAt,
    addendumTarget,
    editingJournalUUID,
    editingMetadata,
    title,
    visibility,
    editSummary,
    editingEntry?.parent,
    initial?.ownerUUID,
  ]);

  const persistDraft = useCallback(async () => {
    if (!meaningful || !currentPlayer?.UUID) return null;
    const draft = buildDraft();
    const signature = JSON.stringify(draft);
    if (signature === lastSavedSignature.current) return draft;
    setSaveState('Saving locally…');
    const saved = await services.drafts.save(draft);
    lastSavedSignature.current = signature;
    setSaveState('Saved locally');
    return saved;
  }, [buildDraft, currentPlayer?.UUID, meaningful, services.drafts]);

  useEffect(() => {
    services.stories.list(currentPlayer?.UUID)
      .then(setStories)
      .catch((loadError) => console.warn('[ChronicleComposer] stories unavailable:', loadError));
  }, [currentPlayer?.UUID, services.stories]);

  useEffect(() => {
    if (!meaningful || saving) return undefined;
    setSaveState('Unsaved changes');
    const timer = window.setTimeout(() => {
      persistDraft().catch((saveError) => {
        console.warn('[ChronicleComposer] autosave failed:', saveError);
        setSaveState('Local save paused');
      });
    }, 700);
    return () => window.clearTimeout(timer);
  }, [meaningful, persistDraft, saving]);

  const close = useCallback(async () => {
    if (saving || imageProcessing || closeRequested.current) return;
    closeRequested.current = true;
    try {
      await persistDraft();
    } finally {
      modal.hide();
      modal.remove();
    }
  }, [imageProcessing, modal, persistDraft, saving]);

  const publish = async (event) => {
    event.preventDefault();
    if (!canPublish) return;
    setSaving(true);
    setError('');
    try {
      if (visibility === 'global') {
        const acknowledgementId = `chronicle-global-ack:${currentPlayer.UUID}`;
        const acknowledged = await databaseConnection.get(STORES.appSetting, acknowledgementId);
        if (!acknowledged) {
          const accepted = window.confirm(
            'Global entries can be edited by every profile in this Tapestry. Every edit is attributed to the active profile and remains reversible. The owner can lock the entry or change its access later.',
          );
          if (!accepted) {
            setSaving(false);
            return;
          }
          await databaseConnection.add(STORES.appSetting, {
            UUID: acknowledgementId,
            parent: currentPlayer.UUID,
            kind: 'chronicle-global-acknowledgement',
            value: { acknowledgedAt: new Date().toISOString() },
            updatedAt: new Date().toISOString(),
          });
        }
      }
      const contextSnapshot = await services.context.capture({ player: currentPlayer });
      const draft = { ...buildDraft(), contextSnapshot };
      const result = await services.drafts.publish(draft, {
        journalUUID: editingJournalUUID || uuid(),
        occurrenceAt: new Date(occurrenceAt).toISOString(),
        occurrenceIGT: getCurrentIGT(currentPlayer),
        visibility,
        existingMetadata: editingMetadata,
        commandOrigin: mobileRestricted ? 'mobile' : 'desktop',
      });
      if (primaryStoryId) {
        const memberships = await services.stories.memberships(primaryStoryId);
        if (!memberships.some((item) => item.journalUUID === result.journal.UUID)) {
          await services.stories.addEntry(primaryStoryId, result.journal.UUID);
        }
      }
      if (addendumTarget) {
        await new ChronicleRepository(databaseConnection).addLink({
          sourceJournalUUID: result.journal.UUID,
          targetType: 'journal',
          targetId: addendumTarget,
          relationType: 'addendum_to',
          shared: visibility === 'fellows',
        });
      }
      invalidateDomains(DOMAIN_INVALIDATION.chronicleWrite);
      onCreated?.({ ...result.journal, ...result.metadata });
      notify?.({
        title: visibility === 'global' ? 'Shared across profiles' : visibility === 'fellows' ? 'Added to the Feed' : 'Saved to Yours',
        message: `${KIND_COPY[kind][0]} saved as a canonical Entry.`,
        kind: 'success',
        persist: false,
      });
      modal.hide();
      modal.remove();
    } catch (publishError) {
      console.warn('[ChronicleComposer] publish failed:', publishError);
      setError(publishError?.message || 'Could not save this Chronicle entry.');
      setSaving(false);
    }
  };

  if (!modal.visible) return null;

  return (
    <ModalFrame
      onClose={close}
      title={quickCapture && !editingJournalUUID ? 'Quick Capture' : `${editingJournalUUID ? 'Edit' : 'New'} ${KIND_COPY[kind][0]}`}
      subtitle={editingJournalUUID ? 'Update the canonical entry without changing its original publish position.' : KIND_COPY[kind][1]}
      eyebrow="Feed"
      size="xl"
      accent="var(--color-feed)"
      className="chronicle-composer"
      protectedEditor
      footer={(
        <ActionRow className="chronicle-composer__footer">
          <span className="chronicle-save-state" role="status">{saveState}</span>
          <button type="button" onClick={close} disabled={saving || imageProcessing}>Close</button>
          <button type="submit" form="chronicle-composer-form" className="primary" disabled={!canPublish}>
            {saving ? 'Saving…' : editingJournalUUID ? 'Save revision' : visibility === 'global' ? 'Share with all profiles' : visibility === 'fellows' ? 'Share with Fellows' : 'Save privately'}
          </button>
        </ActionRow>
      )}
    >
      <form id="chronicle-composer-form" onSubmit={publish} className="chronicle-composer__form">
        {!mobileRestricted && <fieldset className="chronicle-kind-switcher">
          <legend>What are you writing?</legend>
          {Object.entries(KIND_COPY).map(([value, [label]]) => (
            <button
              key={value}
              type="button"
              aria-pressed={kind === value}
              className={kind === value ? 'is-active' : ''}
              onClick={() => setKind(value)}
            >
              {label}
            </button>
          ))}
        </fieldset>}

        {(kind !== 'moment' || title) && (
          <FormField label="Title" hint={kind === 'essay' ? 'Required for Essays' : 'Optional'}>
            <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={240} />
          </FormField>
        )}
        {kind === 'essay' && (
          <FormField label="Subtitle" hint="Optional">
            <input value={subtitle} onChange={(event) => setSubtitle(event.target.value)} maxLength={300} />
          </FormField>
        )}

        {!mobileRestricted && <PostImagePicker
          images={images}
          onChange={setImages}
          disabled={saving}
          onProcessingChange={setImageProcessing}
        />}
        <FormField label={kind === 'moment' ? 'What happened?' : 'Writing'}>
          <MarkdownEditor
            value={body}
            onChange={setBody}
            placeholder={kind === 'moment' ? 'Leave a trace…' : 'Write for the record…'}
            className="chronicle-composer__editor"
          />
        </FormField>

        <div className="chronicle-composer__metadata">
          <FormField label="When it happened">
            <input
              type="datetime-local"
              value={occurrenceAt}
              onChange={(event) => setOccurrenceAt(event.target.value)}
            />
          </FormField>
          <FormField label="Story">
            <select value={primaryStoryId} onChange={(event) => setPrimaryStoryId(event.target.value)}>
              <option value="">No Story</option>
              {stories.map((story) => <option key={story.UUID} value={story.UUID}>{story.title}</option>)}
            </select>
          </FormField>
        </div>

        <EntryShareSelector value={visibility} onChange={setVisibility} disabled={saving || !canChangeAccess} />

        {editingJournalUUID && (
          <FormField
            label="Edit summary"
            hint={`You are saving revision ${Number(editingMetadata?.currentRevisionNumber || 1) + 1}. Optional.`}
          >
            <input
              value={editSummary}
              onChange={(event) => setEditSummary(event.target.value)}
              maxLength={240}
              placeholder="What changed?"
            />
          </FormField>
        )}

        <p className="chronicle-private-note">
          Context is captured privately by default. Fellows only see details you explicitly share.
        </p>
        {error && <div className="chronicle-error" role="alert">{error}</div>}
      </form>
    </ModalFrame>
  );
});
