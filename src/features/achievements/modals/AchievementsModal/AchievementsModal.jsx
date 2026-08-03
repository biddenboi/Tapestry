import '@features/achievements/modals/AchievementsModal/AchievementsModal.css';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ACHIEVEMENT_DEFINITIONS_V2,
  ACHIEVEMENT_V2_CATEGORY,
} from '@domain/achievements-v2/AchievementCatalogV2.js';
import {
  ACHIEVEMENT_RECORD_DEFINITIONS,
  formatAchievementRecord,
} from '@domain/achievements-v2/AchievementRecords.js';
import { reconcileAchievementState } from '@domain/achievements/AchievementProcessing.js';
import { STORES } from '@domain/constants.js';
import ModalFrame from '@shared/ui/ModalFrame.jsx';
import LocalSectionNav from '@shared/navigation/LocalSectionNav/LocalSectionNav.jsx';
import { useLocalSectionRoute } from '@shared/navigation/LocalSectionNav/LocalSectionRouteState.js';

const PAGES = Object.freeze([
  { id: 'overview', label: 'Overview', icon: 'home' },
  { id: 'journeys', label: 'Journeys', icon: 'route' },
  { id: 'records', label: 'Records', icon: 'chart' },
  { id: 'collections', label: 'Collections', icon: 'grid' },
  { id: 'legacy', label: 'Legacy Cabinet', icon: 'archive' },
]);

function numericProgress(progress = {}) {
  const ignored = new Set(['appliedEventIds', 'domains', 'fellowIds', 'byTeammate']);
  const direct = Object.entries(progress).find(([key, value]) => !ignored.has(key) && Number.isFinite(Number(value)));
  if (direct) return Number(direct[1]);
  if (Array.isArray(progress.domains)) return progress.domains.length;
  if (Array.isArray(progress.fellowIds)) return progress.fellowIds.length;
  return 0;
}

function AchievementCard({ definition, receipt, progress, selected, canSelect, onToggle }) {
  const earned = Boolean(receipt);
  const value = numericProgress(progress);
  const nextStage = definition.stages.find((stage) => stage > value);
  const stageLabel = definition.stages.length > 1
    ? `${Math.min(value, definition.stages.at(-1))} / ${nextStage || definition.stages.at(-1)}`
    : null;
  return (
    <article
      className={`achievement-v2-card ${earned ? 'is-earned' : 'is-locked'} ${selected ? 'is-selected' : ''}`}
      data-achievement-recipe
    >
      <div className="achievement-v2-card__mark" aria-hidden="true">
        {earned ? '◆' : definition.secret ? '?' : '◇'}
      </div>
      <div className="achievement-v2-card__copy">
        <span className="achievement-v2-card__category">
          {ACHIEVEMENT_V2_CATEGORY[definition.category]}
        </span>
        <h4>{definition.secret && !earned ? 'Undiscovered' : definition.title}</h4>
        <p>{definition.secret && !earned
          ? 'A hidden distinction with a specific evidence rule.'
          : definition.description}</p>
        <div className="achievement-v2-card__meta">
          <span>{earned ? `Earned ${new Date(receipt.earnedAt).toLocaleDateString()}` : 'Not yet earned'}</span>
          {stageLabel && <span>{stageLabel}</span>}
        </div>
        {earned && (
          <details className="achievement-v2-evidence">
            <summary>Why this was earned</summary>
            <p>
              {receipt.evidenceSnapshot?.eventType?.replaceAll('-', ' ') || 'Verified event'}
              {receipt.evidenceSnapshot?.occurredAt
                ? ` · ${new Date(receipt.evidenceSnapshot.occurredAt).toLocaleString()}`
                : ''}
            </p>
          </details>
        )}
      </div>
      {earned && canSelect && (
        <button type="button" className="achievement-v2-card__select" onClick={() => onToggle(definition.id)}>
          {selected ? 'Remove' : 'Showcase'}
        </button>
      )}
    </article>
  );
}

function EmptyPanel({ children }) {
  return <div className="achievement-v2-empty">{children}</div>;
}

export default function AchievementsModal({
  player,
  isSelf,
  databaseConnection,
  onClose,
  onSaved,
}) {
  const [evidence, setEvidence] = useState([]);
  const [legacy, setLegacy] = useState([]);
  const [records, setRecords] = useState([]);
  const [progressRows, setProgressRows] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [currentPlayer, setCurrentPlayer] = useState(player);
  const [loading, setLoading] = useState(true);
  const [reconciling, setReconciling] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState(() => (player.selectedAchievementsV2 || []).filter(Boolean).slice(0, 3));
  const { activePageId, selectPage } = useLocalSectionRoute({
    sectionId: 'achievements',
    pages: PAGES,
    profileUUID: player.UUID,
    databaseConnection,
    defaultPageId: 'overview',
  });

  const load = useCallback(async () => {
    setLoading(true);
    await databaseConnection.ensureDomainLoaded?.('achievements');
    await databaseConnection.achievementV2.synchronizeDefinitions();
    const [nextEvidence, nextLegacy, nextRecords, nextProgress, nextInventory, refreshed] = await Promise.all([
      databaseConnection.achievementV2.getEvidence(player.UUID),
      databaseConnection.achievementV2.getLegacyAwards(player.UUID),
      databaseConnection.achievementV2.getRecords(player.UUID),
      databaseConnection.achievementV2.getAllProgress(player.UUID),
      databaseConnection.getPlayerStore(STORES.inventory, player.UUID).catch(() => []),
      databaseConnection.get(STORES.player, player.UUID).catch(() => null),
    ]);
    setEvidence(nextEvidence);
    setLegacy(nextLegacy);
    setRecords(nextRecords);
    setProgressRows(nextProgress);
    setInventory(nextInventory);
    if (refreshed) {
      setCurrentPlayer(refreshed);
      setSelected((refreshed.selectedAchievementsV2 || []).filter(Boolean).slice(0, 3));
    }
    setLoading(false);
  }, [databaseConnection, player.UUID]);

  useEffect(() => {
    load().catch((error) => {
      console.warn('[AchievementsModal] v2 load failed:', error);
      setLoading(false);
    });
  }, [load]);

  const evidenceById = useMemo(
    () => new Map(evidence.map((receipt) => [receipt.achievementId, receipt])),
    [evidence],
  );
  const progressById = useMemo(
    () => new Map(progressRows.map((row) => [row.achievementId, row.progress])),
    [progressRows],
  );
  const recent = evidence.slice(0, 3)
    .map((receipt) => ACHIEVEMENT_DEFINITIONS_V2.find((entry) => entry.id === receipt.achievementId))
    .filter(Boolean);
  const selectedDefinitions = selected
    .map((id) => ACHIEVEMENT_DEFINITIONS_V2.find((entry) => entry.id === id))
    .filter(Boolean);

  const toggleSelection = useCallback((achievementId) => {
    setSelected((previous) => {
      if (previous.includes(achievementId)) return previous.filter((id) => id !== achievementId);
      if (previous.length >= 3) return [...previous.slice(1), achievementId];
      return [...previous, achievementId];
    });
  }, []);

  const saveSelection = useCallback(async () => {
    if (!isSelf || saving) return;
    setSaving(true);
    try {
      const refreshed = await databaseConnection.get(STORES.player, player.UUID);
      const updated = { ...(refreshed || currentPlayer), selectedAchievementsV2: selected };
      await databaseConnection.add(STORES.player, updated);
      setCurrentPlayer(updated);
      onSaved?.(updated);
    } finally {
      setSaving(false);
    }
  }, [currentPlayer, databaseConnection, isSelf, onSaved, player.UUID, saving, selected]);

  const reconcile = useCallback(async () => {
    if (!isSelf || reconciling) return;
    setReconciling(true);
    try {
      const refreshed = await databaseConnection.get(STORES.player, player.UUID);
      await reconcileAchievementState(databaseConnection, refreshed || currentPlayer, {
        reason: 'explicit-reconciliation',
      });
      await load();
    } finally {
      setReconciling(false);
    }
  }, [currentPlayer, databaseConnection, isSelf, load, player.UUID, reconciling]);

  const collectionGroups = useMemo(() => {
    const rows = inventory.filter((item) => String(item.type || '').startsWith('cosmetic_'));
    const grouped = new Map();
    for (const item of rows) {
      const label = String(item.type || 'collection').replace('cosmetic_', '').replaceAll('_', ' ');
      grouped.set(label, [...(grouped.get(label) || []), item]);
    }
    return [...grouped.entries()];
  }, [inventory]);

  return (
    <ModalFrame
      onClose={onClose}
      title="Achievements"
      subtitle={currentPlayer.username}
      eyebrow="Evidence, records, and collections"
      size="xl"
      accent="var(--color-achievement)"
      className="ach-modal achievement-v2"
    >
      <LocalSectionNav
        items={PAGES}
        value={activePageId}
        onChange={selectPage}
        label="Achievement sections"
      />
      {loading ? (
        <div className="ach-modal-loading">Loading…</div>
      ) : (
        <div className="achievement-v2-page">
          {activePageId === 'overview' && (
            <>
              <section className="achievement-v2-hero">
                <div><strong>{evidence.length}</strong><span>earned</span></div>
                <div><strong>{records.length}</strong><span>records</span></div>
                <div><strong>{legacy.length}</strong><span>legacy</span></div>
              </section>
              <section>
                <div className="achievement-v2-section-title">
                  <h3>Showcase</h3>
                  {isSelf && (
                    <button type="button" className="primary" onClick={saveSelection} disabled={saving}>
                      {saving ? 'Saving…' : 'Save showcase'}
                    </button>
                  )}
                </div>
                {selectedDefinitions.length ? (
                  <div className="achievement-v2-list">
                    {selectedDefinitions.map((definition) => (
                      <AchievementCard
                        key={definition.id}
                        definition={definition}
                        receipt={evidenceById.get(definition.id)}
                        progress={progressById.get(definition.id)}
                        selected
                        canSelect={isSelf}
                        onToggle={toggleSelection}
                      />
                    ))}
                  </div>
                ) : <EmptyPanel>No achievements are in the showcase yet.</EmptyPanel>}
              </section>
              <section>
                <h3>Recent evidence</h3>
                {recent.length ? (
                  <div className="achievement-v2-list">
                    {recent.map((definition) => (
                      <AchievementCard
                        key={definition.id}
                        definition={definition}
                        receipt={evidenceById.get(definition.id)}
                        progress={progressById.get(definition.id)}
                        selected={selected.includes(definition.id)}
                        canSelect={isSelf}
                        onToggle={toggleSelection}
                      />
                    ))}
                  </div>
                ) : <EmptyPanel>Complete a meaningful action to create the first evidence receipt.</EmptyPanel>}
              </section>
            </>
          )}

          {activePageId === 'journeys' && Object.keys(ACHIEVEMENT_V2_CATEGORY).map((category) => {
            const definitions = ACHIEVEMENT_DEFINITIONS_V2.filter((entry) => entry.category === category);
            return (
              <section key={category} className="achievement-v2-journey">
                <h3>{ACHIEVEMENT_V2_CATEGORY[category]}</h3>
                <div className="achievement-v2-grid">
                  {definitions.map((definition) => (
                    <AchievementCard
                      key={definition.id}
                      definition={definition}
                      receipt={evidenceById.get(definition.id)}
                      progress={progressById.get(definition.id)}
                      selected={selected.includes(definition.id)}
                      canSelect={isSelf}
                      onToggle={toggleSelection}
                    />
                  ))}
                </div>
              </section>
            );
          })}

          {activePageId === 'records' && (
            <section>
              <h3>Live records</h3>
              <div className="achievement-v2-records">
                {ACHIEVEMENT_RECORD_DEFINITIONS.map((definition) => {
                  const record = records.find((row) => row.recordId === definition.id);
                  return (
                    <article key={definition.id}>
                      <span>{definition.label}</span>
                      <strong>{record ? formatAchievementRecord(record) : '—'}</strong>
                      <small>{record?.achievedAt ? new Date(record.achievedAt).toLocaleDateString() : 'No evidence yet'}</small>
                    </article>
                  );
                })}
              </div>
            </section>
          )}

          {activePageId === 'collections' && (
            <section>
              <h3>Collections</h3>
              {collectionGroups.length ? collectionGroups.map(([label, items]) => (
                <div key={label} className="achievement-v2-collection">
                  <div><strong>{label}</strong><span>{items.length}</span></div>
                  <p>{items.map((item) => item.name || item.itemId).join(' · ')}</p>
                </div>
              )) : <EmptyPanel>No cosmetic collections are owned yet.</EmptyPanel>}
            </section>
          )}

          {activePageId === 'legacy' && (
            <section>
              <div className="achievement-v2-section-title">
                <div>
                  <h3>Legacy Cabinet</h3>
                  <p>Preserved awards from the previous catalog. They remain part of the profile and are never re-inferred.</p>
                </div>
                {isSelf && (
                  <button type="button" onClick={reconcile} disabled={reconciling}>
                    {reconciling ? 'Checking…' : 'Replay verified evidence'}
                  </button>
                )}
              </div>
              {legacy.length ? (
                <div className="achievement-v2-legacy">
                  {legacy.map((award) => (
                    <article key={award.legacyKey}>
                      <span aria-hidden="true">▣</span>
                      <div>
                        <strong>{award.title || award.legacyKey}</strong>
                        <small>{new Date(award.earnedAt).toLocaleDateString()}</small>
                      </div>
                      {award.preservedSelected && <em>Preserved showcase</em>}
                    </article>
                  ))}
                </div>
              ) : <EmptyPanel>No legacy awards were present in this save.</EmptyPanel>}
            </section>
          )}
        </div>
      )}
    </ModalFrame>
  );
}
