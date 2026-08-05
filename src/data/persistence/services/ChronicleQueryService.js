import { STORES } from '../../../domain/constants.js';
import {
  compareChronicleFeedItems,
  decodeChronicleFeedCursor,
  isAfterChronicleCursor,
} from '../../../domain/chronicle/ChronicleFeedCursor.js';
import { conservativeChronicleMetadata } from '../../../domain/chronicle/ChronicleEntryKind.js';
import {
  canViewChronicleEntry,
  publicChronicleMetadata,
} from '../../../domain/chronicle/ChronicleVisibility.js';
import { normalizeChronicleAccess } from '../../../domain/chronicle/ChronicleAccessPolicy.js';
import { bundleChronicleMoments } from '../../../domain/chronicle/MomentBundling.js';

function joinEntry(journal, metadata, primaryStory = null, access = null, revision = null) {
  const normalized = conservativeChronicleMetadata(journal, metadata);
  const normalizedAccess = normalizeChronicleAccess(access || {}, normalized);
  return {
    ...journal,
    ...normalized,
    UUID: journal.UUID,
    journalUUID: journal.UUID,
    parent: journal.parent,
    title: journal.title || '',
    entry: journal.entry || '',
    createdAt: journal.createdAt,
    primaryStoryId: primaryStory?.storyUUID || normalized.primaryStoryId || null,
    storyOrdinal: primaryStory?.ordinal || null,
    access: normalizedAccess,
    visibility: normalizedAccess.visibility,
    editPolicy: normalizedAccess.editPolicy,
    collaborationState: normalizedAccess.collaborationState,
    currentRevision: revision || null,
    currentRevisionNumber: Number(revision?.revisionNumber || normalized.currentRevisionNumber) || 1,
    latestEditorUUID: revision?.editorUUID || normalized.latestEditorUUID || journal.parent,
    latestRevisedAt: revision?.authoritativeAt || revision?.createdAt || normalized.latestRevisedAt || normalized.updatedAt,
  };
}

function safeForViewer(entry, viewerUUID) {
  return publicChronicleMetadata(entry, viewerUUID);
}

export class ChronicleQueryService {
  constructor(facade) {
    if (!facade?.getAll) throw new Error('ChronicleQueryService requires a database facade.');
    this.facade = facade;
  }

  async _snapshot(viewerIGT = Infinity) {
    const [
      journals,
      metadata,
      stories,
      memberships,
      accessRows,
      revisions,
    ] = await Promise.all([
      Number.isFinite(Number(viewerIGT))
        ? this.facade.getAllThroughIGT(STORES.journal, viewerIGT)
        : this.facade.getAll(STORES.journal),
      this.facade.getAll(STORES.chronicleEntryMetadata),
      this.facade.getAll(STORES.chronicleStory),
      this.facade.getAll(STORES.chronicleStoryEntry),
      this.facade.getAll(STORES.chronicleEntryAccess),
      this.facade.getAll(STORES.chronicleEntryRevision),
    ]);
    const metadataById = new Map(metadata.map((item) => [String(item.journalUUID || item.UUID), item]));
    const primaryByEntry = new Map(
      memberships
        .filter((item) => item.role !== 'related')
        .map((item) => [String(item.journalUUID), item]),
    );
    const storyById = new Map(stories.map((story) => [String(story.UUID), story]));
    const accessByEntry = new Map(accessRows.map((access) => [String(access.journalUUID || access.UUID), access]));
    const revisionByEntry = new Map();
    for (const revision of revisions) {
      const key = String(revision.entryUUID);
      if (Number(revision.revisionNumber) > Number(revisionByEntry.get(key)?.revisionNumber || 0)) {
        revisionByEntry.set(key, revision);
      }
    }
    const entries = journals.map((journal) => {
      const primary = primaryByEntry.get(String(journal.UUID));
      return {
        ...joinEntry(
          journal,
          metadataById.get(String(journal.UUID)),
          primary,
          accessByEntry.get(String(journal.UUID)),
          revisionByEntry.get(String(journal.UUID)),
        ),
        primaryStory: primary ? storyById.get(String(primary.storyUUID)) || null : null,
      };
    });
    return { entries, stories, memberships, storyById, accessByEntry, revisionByEntry };
  }

  async recent({
    viewerUUID,
    viewerIGT = Infinity,
    cursor = null,
    limit = 24,
    bundleMoments = true,
  } = {}) {
    const snapshot = await this._snapshot(viewerIGT);
    const decodedCursor = decodeChronicleFeedCursor(cursor);
    const all = snapshot.entries
      .filter((entry) => (
        (entry.visibility === 'fellows' || entry.visibility === 'global')
        && canViewChronicleEntry(entry, {
          viewerUUID,
          authorUUID: entry.parent,
          viewerIGT,
        })
      ))
      .map((entry) => safeForViewer(entry, viewerUUID))
      .sort(compareChronicleFeedItems);
    const afterCursor = all
      .filter((entry) => isAfterChronicleCursor(entry, decodedCursor));
    const page = afterCursor
      .slice(0, Math.max(1, Math.min(100, Number(limit) || 24)));
    return {
      entries: bundleMoments ? bundleChronicleMoments(page) : page,
      rawEntries: page,
      hasMore: afterCursor.length > page.length,
      nextCursor: page.at(-1)
        ? {
            publishedAt: page.at(-1).publishedAt,
            journalUUID: page.at(-1).journalUUID,
          }
        : null,
    };
  }

  async global({
    viewerUUID,
    viewerIGT = Infinity,
    cursor = null,
    limit = 24,
  } = {}) {
    if (!viewerUUID) return { entries: [], rawEntries: [], hasMore: false, nextCursor: null };
    const snapshot = await this._snapshot(viewerIGT);
    const ordered = snapshot.entries
      .filter((entry) => entry.visibility === 'global')
      .filter((entry) => canViewChronicleEntry(entry, {
        viewerUUID,
        authorUUID: entry.parent,
        viewerIGT,
      }))
      .map((entry) => safeForViewer(entry, viewerUUID))
      .sort((a, b) => (
        String(b.latestRevisedAt || b.publishedAt || '').localeCompare(String(a.latestRevisedAt || a.publishedAt || ''))
        || String(b.UUID).localeCompare(String(a.UUID))
      ));
    const afterCursor = cursor?.activityAt && cursor?.journalUUID
      ? ordered.filter((entry) => (
          String(entry.latestRevisedAt || entry.publishedAt || '') < String(cursor.activityAt)
          || (
            String(entry.latestRevisedAt || entry.publishedAt || '') === String(cursor.activityAt)
            && String(entry.UUID) < String(cursor.journalUUID)
          )
        ))
      : ordered;
    const page = afterCursor.slice(0, Math.max(1, Math.min(100, Number(limit) || 24)));
    return {
      entries: page,
      rawEntries: page,
      hasMore: afterCursor.length > page.length,
      nextCursor: page.at(-1) ? {
        activityAt: page.at(-1).latestRevisedAt || page.at(-1).publishedAt,
        journalUUID: page.at(-1).UUID,
      } : null,
    };
  }

  async chronicleForProfile({
    profileUUID,
    viewerUUID,
    viewerIGT = Infinity,
  } = {}) {
    const snapshot = await this._snapshot(viewerIGT);
    const owner = String(viewerUUID || '') === String(profileUUID || '');
    const entries = snapshot.entries
      .filter((entry) => String(entry.parent) === String(profileUUID))
      .filter((entry) => owner
        ? entry.lifecycleState !== 'draft'
        : canViewChronicleEntry(entry, {
            viewerUUID,
            authorUUID: profileUUID,
            viewerIGT,
          }))
      .map((entry) => safeForViewer(entry, viewerUUID))
      .sort((a, b) => String(b.occurrenceAt || '').localeCompare(String(a.occurrenceAt || '')));
    const stories = snapshot.stories
      .filter((story) => String(story.parent) === String(profileUUID))
      .filter((story) => String(viewerUUID) === String(profileUUID) || story.visibility === 'fellows')
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    return { entries, stories, memberships: snapshot.memberships };
  }

  async story(storyUUID, { viewerUUID, viewerIGT = Infinity } = {}) {
    const snapshot = await this._snapshot(viewerIGT);
    const story = snapshot.storyById.get(String(storyUUID)) || null;
    if (!story || (String(story.parent) !== String(viewerUUID) && story.visibility !== 'fellows')) {
      return { story: null, entries: [] };
    }
    const entriesById = new Map(snapshot.entries.map((entry) => [String(entry.UUID), entry]));
    const entries = snapshot.memberships
      .filter((item) => String(item.storyUUID) === String(storyUUID))
      .sort((a, b) => Number(a.ordinal) - Number(b.ordinal))
      .map((item) => entriesById.get(String(item.journalUUID)))
      .filter((entry) => entry && canViewChronicleEntry(entry, {
        viewerUUID,
        authorUUID: entry.parent,
        viewerIGT,
      }))
      .map((entry, index, visible) => ({
        ...safeForViewer(entry, viewerUUID),
        visibleOrdinal: index + 1,
        visibleCount: visible.length,
      }));
    return { story, entries };
  }

  async wander({
    viewerUUID,
    viewerIGT = Infinity,
    excluded = new Set(),
    limit = 5,
    random = Math.random,
  } = {}) {
    const snapshot = await this._snapshot(viewerIGT);
    const eligible = snapshot.entries.filter((entry) => (
      (entry.visibility === 'fellows' || entry.visibility === 'global')
      && entry.resurfacePolicy !== 'never'
      && !excluded.has(String(entry.UUID))
      && canViewChronicleEntry(entry, {
        viewerUUID,
        authorUUID: entry.parent,
        viewerIGT,
      })
    )).map((entry) => safeForViewer(entry, viewerUUID))
      .sort(compareChronicleFeedItems);
    const pool = [...eligible];
    const selected = [];
    while (pool.length && selected.length < Math.max(1, Math.min(5, limit))) {
      const index = Math.min(pool.length - 1, Math.floor(random() * pool.length));
      selected.push(pool.splice(index, 1)[0]);
    }
    return selected;
  }

  async search(query, options = {}) {
    const terms = String(query || '').toLowerCase().trim().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    const { entries } = await this.chronicleForProfile(options);
    return entries.filter((entry) => {
      const haystack = `${entry.title || ''}\n${entry.entry || ''}\n${entry.subtitle || ''}`.toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
  }
}

export default ChronicleQueryService;
