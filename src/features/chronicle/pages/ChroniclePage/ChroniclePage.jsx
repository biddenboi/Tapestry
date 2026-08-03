import { useCallback, useEffect, useMemo, useState } from 'react';
import NiceModal from '@ebay/nice-modal-react';
import { useAppContext } from '@app/hooks/useAppContext.js';
import { DOMAIN_INVALIDATION } from '@app/context/domainRevisions.js';
import { getCurrentIGT } from '@domain/time/Time.js';
import ChronicleQueryService from '@data/persistence/services/ChronicleQueryService.js';
import ChronicleResurfaceService from '@data/persistence/services/ChronicleResurfaceService.js';
import ChronicleDraftService from '@data/persistence/services/ChronicleDraftService.js';
import RetrospectiveDialogueRepository from '@data/persistence/repositories/RetrospectiveDialogueRepository.js';
import ChronicleComposerModal from '@features/chronicle/modals/ChronicleComposerModal/ChronicleComposerModal.jsx';
import { ChronicleEntryCard } from '@features/chronicle/components/ChronicleCards/ChronicleCards.jsx';
import LocalSectionNav from '@shared/navigation/LocalSectionNav/LocalSectionNav.jsx';
import { useLocalSectionRoute } from '@shared/navigation/LocalSectionNav/LocalSectionRouteState.js';
import {
  ACHIEVEMENT_EVENT_TYPE,
  createAchievementEvent,
  queueAchievementEvent,
} from '@domain/achievements/AchievementProcessing.js';
import '@features/chronicle/Chronicle.css';

const SECTIONS = Object.freeze([
  { id: 'active', label: 'Active' },
  { id: 'drafts', label: 'Drafts' },
  { id: 'revisit', label: 'Revisit' },
  { id: 'archive', label: 'Archive' },
]);

export default function ChroniclePage({ onOpenEntry, profilesById = {}, embedded = false }) {
  const {
    databaseConnection,
    currentPlayer,
    domainRevisions,
    invalidateDomains,
  } = useAppContext();
  const services = useMemo(() => ({
    query: new ChronicleQueryService(databaseConnection),
    resurface: new ChronicleResurfaceService(databaseConnection),
    drafts: new ChronicleDraftService(databaseConnection),
    retrospective: new RetrospectiveDialogueRepository(databaseConnection),
  }), [databaseConnection]);
  const { activePageId: section, selectPage: setSection } = useLocalSectionRoute({
    sectionId: 'feed-yours',
    pages: SECTIONS,
    profileUUID: currentPlayer?.UUID,
    databaseConnection,
    defaultPageId: 'active',
  });
  const [entries, setEntries] = useState([]);
  const [revisit, setRevisit] = useState([]);
  const [drafts, setDrafts] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!currentPlayer?.UUID) return;
    setLoading(true);
    try {
      const viewerIGT = getCurrentIGT(currentPlayer);
      const [owned, resurfaced, savedDrafts] = await Promise.all([
        services.query.chronicleForProfile({
          profileUUID: currentPlayer.UUID,
          viewerUUID: currentPlayer.UUID,
          viewerIGT,
        }),
        services.resurface.revisit({
          playerUUID: currentPlayer.UUID,
          viewerIGT,
          limit: 4,
        }),
        services.drafts.list(currentPlayer.UUID),
      ]);
      setEntries(owned.entries);
      setRevisit(resurfaced);
      setDrafts(savedDrafts);
    } finally {
      setLoading(false);
    }
  }, [currentPlayer, services.drafts, services.query, services.resurface]);

  useEffect(() => { load(); }, [
    load,
    domainRevisions.chronicle,
    domainRevisions.journals,
  ]);

  const recordRetrospective = async (entry, action, target = null) => {
    const dialogue = await services.retrospective.record({
      sourceJournalId: entry.UUID,
      targetJournalId: target?.UUID || null,
      playerId: currentPlayer.UUID,
      action,
      body: target?.entry || '',
      occurrenceAt: entry.occurrenceAt || entry.createdAt,
      metadata: { source: 'feed-yours-revisit' },
    });
    await queueAchievementEvent(databaseConnection, createAchievementEvent({
      type: ACHIEVEMENT_EVENT_TYPE.retrospectiveAction,
      parent: currentPlayer.UUID,
      sourceUUID: dialogue.id,
      payload: {
        action,
        targetUUID: entry.UUID,
        presentActionUUID: target?.UUID || null,
        usedInPresentAction: action === 'carry_forward' && Boolean(target?.UUID),
      },
    }));
    invalidateDomains(DOMAIN_INVALIDATION.chronicleWrite);
  };

  const beginRetrospectiveWriting = (entry, action) => {
    NiceModal.show(ChronicleComposerModal, {
      initialKind: 'entry',
      initialVisibility: 'private',
      addendumTo: entry.UUID,
      onCreated: async (created) => {
        await recordRetrospective(entry, action, created);
        await load();
      },
    });
  };

  const activeEntries = entries.filter((entry) => entry.lifecycleState !== 'archived');
  const archivedEntries = entries.filter((entry) => entry.lifecycleState === 'archived');
  const displayed = section === 'active'
    ? activeEntries
    : section === 'revisit'
      ? revisit
      : section === 'archive'
        ? archivedEntries
        : [];
  const author = profilesById[currentPlayer?.UUID] || currentPlayer;

  return (
    <section className={`chronicle-page chronicle-yours ${embedded ? 'chronicle-yours--embedded' : ''}`}>
      <header className="chronicle-page__header">
        <div>
          <span className="chronicle-kicker">Owned Entries</span>
          <h1>Yours</h1>
          <p>Manage every Entry you own, regardless of who can access it.</p>
        </div>
        <button
          type="button"
          className="primary"
          onClick={() => NiceModal.show(ChronicleComposerModal, {
            initialKind: 'moment',
            initialVisibility: 'private',
            quickCapture: true,
            onCreated: load,
          })}
        >
          Quick Capture
        </button>
      </header>

      <LocalSectionNav items={SECTIONS} value={section} onChange={setSection} label="Yours sections" />

      {loading && <p className="chronicle-quiet-copy" role="status">Opening Yours…</p>}

      {!loading && section === 'drafts' && (
        <div className="chronicle-stream">
          <section className="chronicle-drafts">
            <header>
              <div><span className="chronicle-kicker">Saved locally</span><h2>Drafts</h2></div>
              <span>{drafts.length}</span>
            </header>
            {drafts.map((draft) => (
              <button
                type="button"
                key={draft.UUID}
                onClick={() => NiceModal.show(ChronicleComposerModal, { draft, onCreated: load })}
              >
                <strong>{draft.title || draft.body?.slice(0, 70) || `Untitled ${draft.entryKind}`}</strong>
                <small>{new Date(draft.updatedAt || draft.createdAt).toLocaleString()}</small>
              </button>
            ))}
            {!drafts.length && <p className="chronicle-quiet-copy">No saved drafts.</p>}
          </section>
        </div>
      )}

      {!loading && section !== 'drafts' && (
        <div className="chronicle-stream">
          {displayed.map((entry) => (
            <div key={entry.UUID} className="chronicle-retrospective-row">
              <ChronicleEntryCard entry={entry} author={author} onOpen={onOpenEntry} />
              {section === 'revisit' && (
                <div className="chronicle-retrospective-actions">
                  <button type="button" onClick={() => beginRetrospectiveWriting(entry, 'write_back')}>Write Back</button>
                  <button type="button" onClick={() => beginRetrospectiveWriting(entry, 'later_reflection')}>Add Later Reflection</button>
                  <button type="button" onClick={() => beginRetrospectiveWriting(entry, 'carry_forward')}>Carry Forward</button>
                  <button type="button" onClick={() => beginRetrospectiveWriting(entry, 'what_happened_afterward')}>What Happened Afterward</button>
                </div>
              )}
            </div>
          ))}
          {!displayed.length && (
            <p className="chronicle-quiet-copy">
              {section === 'archive' ? 'Nothing is archived.' : section === 'revisit' ? 'Nothing is ready to revisit.' : 'Nothing here yet.'}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
