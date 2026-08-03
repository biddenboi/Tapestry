import { useEffect, useMemo, useState } from 'react';
import { useAppContext } from '@app/hooks/useAppContext.js';
import ChronicleRevisionRepository from '@data/persistence/repositories/ChronicleRevisionRepository.js';
import ChronicleCollaborationService from '@data/persistence/services/ChronicleCollaborationService.js';

function revisionDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
}

export default function EntryRevisionHistory({ entryUUID, owner = false, onRestored = null }) {
  const { databaseConnection, currentPlayer, invalidateDomains } = useAppContext();
  const revisions = useMemo(
    () => new ChronicleRevisionRepository(databaseConnection),
    [databaseConnection],
  );
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState('');
  const collaboration = useMemo(
    () => new ChronicleCollaborationService(databaseConnection),
    [databaseConnection],
  );

  useEffect(() => {
    if (!open || !entryUUID) return;
    let cancelled = false;
    const load = async () => {
      setLoadError('');
      let nextRows = await revisions.listForEntry(entryUUID, { limit: 20 });
      // Compact saves created before schema 40 can contain a complete Entry but
      // no revision document. Repair that late-arriving shape before declaring
      // the history empty, including immediately after importing an old archive.
      if (!nextRows.length && databaseConnection.chronicleSchema40?.reconcile) {
        await databaseConnection.chronicleSchema40.reconcile();
        nextRows = await revisions.listForEntry(entryUUID, { limit: 20 });
      }
      if (!cancelled) setRows(nextRows);
    };
    load().catch((error) => {
      console.warn('[EntryRevisionHistory] load failed:', error);
      if (!cancelled) setLoadError(String(error?.message || error));
    });
    return () => { cancelled = true; };
  }, [databaseConnection, entryUUID, open, revisions]);

  return (
    <section className="chronicle-revision-history">
      <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        {open ? 'Hide history' : 'Revision history'}
      </button>
      {open && (
        <ol>
          {rows.map((revision) => (
            <li key={revision.UUID}>
              <strong>Revision {revision.revisionNumber}</strong>
              <span>{revision.origin === 'migration' ? 'Imported' : `Edited by ${revision.editorUUID}`}</span>
              <time>{revisionDate(revision.authoritativeAt || revision.createdAt)}</time>
              {revision.editSummary && <p>{revision.editSummary}</p>}
              {owner && revision !== rows[0] && (
                <button type="button" disabled={busy} onClick={async () => {
                  setBusy(true);
                  try {
                    const restored = await collaboration.restore({
                      entryUUID,
                      revisionUUID: revision.UUID,
                      actorUUID: currentPlayer.UUID,
                      clientOperationId: `entry-restore:${entryUUID}:${revision.UUID}:${crypto.randomUUID()}`,
                    });
                    invalidateDomains?.(['chronicle', 'journals']);
                    onRestored?.({ ...restored.journal, ...restored.metadata, access: restored.access });
                    setRows(await revisions.listForEntry(entryUUID, { limit: 20 }));
                  } finally {
                    setBusy(false);
                  }
                }}>
                  Restore as new revision
                </button>
              )}
            </li>
          ))}
          {!rows.length && (
            <li data-history-error={loadError || undefined}>
              {loadError ? 'Revision history could not be loaded.' : 'No revision history is available.'}
            </li>
          )}
        </ol>
      )}
    </section>
  );
}
