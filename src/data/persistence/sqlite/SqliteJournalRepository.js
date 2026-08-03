import { parseCompactJournal } from '../journals/CompactJournalMarkdown.js';
import { parseJson, stableJson, textOrNull } from './shadowDomainUtils.js';

const JOURNAL_BASE_SELECT = `
SELECT j.id,j.player_id AS playerId,j.file_path AS filePath,j.content_hash AS contentHash,
       j.title_projection AS title,j.created_at AS createdAt,j.updated_at AS editedAt,
       j.in_game_timestamp AS inGameTimestamp,j.document_revision AS revision,
       j.document_state AS documentState,j.deleted_at AS deletedAt,
       COALESCE(f.pinned,0) AS pinned,f.sort_at AS sortAt,
       COALESCE(f.visibility,'visible') AS visibility,
       COALESCE(f.feed_state_json,'{"version":1}') AS feedStateJson,
       s.compact_markdown AS stagedMarkdown
FROM journals j
LEFT JOIN journal_feed_metadata f ON f.journal_id=j.id
LEFT JOIN journal_import_staging s ON s.journal_id=j.id`;

function normalizeTag(value) {
  const tag = String(value ?? '').trim().replace(/^#+/, '').normalize('NFC');
  if (!tag || new TextEncoder().encode(tag).byteLength > 128) return null;
  return { tag, normalized: tag.toLocaleLowerCase('en-US') };
}

function rowBase(row) {
  return {
    UUID: row.id,
    parent: row.playerId,
    title: row.title || '',
    createdAt: row.createdAt,
    editedAt: row.editedAt || undefined,
    inGameTimestamp: row.inGameTimestamp == null ? undefined : Number(row.inGameTimestamp),
    revision: Number(row.revision),
    contentHash: row.contentHash,
    filePath: row.filePath,
    documentState: row.documentState,
    deletedAt: row.deletedAt || undefined,
    pinned: Boolean(row.pinned),
    sortAt: row.sortAt || undefined,
    visibility: row.visibility,
    feedState: parseJson(row.feedStateJson, { version: 1 }),
  };
}

export class SqliteJournalRepository {
  constructor({ client, fileAdapter = null, now = () => new Date(), random = Math.random } = {}) {
    if (!client) throw new Error('SqliteJournalRepository requires a SQLite client.');
    this.client = client;
    this.fileAdapter = fileAdapter;
    this.now = now;
    this.random = random;
  }

  async _documentForRow(row) {
    let markdown = null;
    if (row.documentState === 'indexed' && this.fileAdapter) markdown = await this.fileAdapter.readText(row.filePath);
    if (markdown == null) markdown = row.stagedMarkdown;
    if (markdown == null) return { title: row.title || '', body: '', markdown: null };
    const parsed = parseCompactJournal(markdown, { expectedId: row.id, path: row.filePath });
    return { title: parsed.title, body: parsed.body, markdown: parsed.markdown };
  }

  async _relations(ids) {
    if (!ids.length) return { tags: new Map(), votes: new Map() };
    const placeholders = ids.map(() => '?').join(',');
    const [tagRows, voteRows] = await Promise.all([
      this.client.query({
        sql: `SELECT journal_id AS journalId,tag FROM journal_tags
              WHERE journal_id IN (${placeholders}) ORDER BY journal_id,normalized_tag`,
        bind: ids, result: 'all',
      }),
      this.client.query({
        sql: `SELECT journal_id AS journalId,voter_id AS voterId,value FROM journal_votes
              WHERE journal_id IN (${placeholders}) ORDER BY journal_id,voter_id`,
        bind: ids, result: 'all',
      }),
    ]);
    const tags = new Map(ids.map((id) => [id, []]));
    const votes = new Map(ids.map((id) => [id, {}]));
    for (const row of tagRows) tags.get(row.journalId)?.push(row.tag);
    for (const row of voteRows) votes.get(row.journalId)[row.voterId] = Number(row.value);
    return { tags, votes };
  }

  async _hydrate(rows) {
    const ids = rows.map((row) => row.id);
    const relations = await this._relations(ids);
    return Promise.all(rows.map(async (row) => {
      const document = await this._documentForRow(row);
      return {
        ...rowBase(row),
        title: document.title,
        entry: document.body,
        tags: relations.tags.get(row.id) || [],
        votes: relations.votes.get(row.id) || {},
      };
    }));
  }

  async getJournal(id, { includeDeleted = false } = {}) {
    const row = await this.client.query({
      sql: `${JOURNAL_BASE_SELECT} WHERE j.id=? ${includeDeleted ? '' : 'AND j.deleted_at IS NULL'}`,
      bind: [id], result: 'one',
    });
    return row ? (await this._hydrate([row]))[0] : null;
  }

  async listFeed({ playerId = null, viewerIGT = Infinity, visibility = 'visible', limit = 100, offset = 0 } = {}) {
    const clauses = ['j.deleted_at IS NULL', "j.document_state IN ('staged','indexed')", 'COALESCE(f.visibility,\'visible\')=?'];
    const bind = [visibility];
    if (playerId) { clauses.push('j.player_id=?'); bind.push(playerId); }
    if (Number.isFinite(Number(viewerIGT))) {
      clauses.push('(j.in_game_timestamp IS NULL OR j.in_game_timestamp<=?)');
      bind.push(Math.max(0, Math.trunc(Number(viewerIGT))));
    }
    bind.push(Math.max(1, Math.min(500, Math.trunc(Number(limit) || 100))), Math.max(0, Math.trunc(Number(offset) || 0)));
    const rows = await this.client.query({
      sql: `${JOURNAL_BASE_SELECT}
            WHERE ${clauses.join(' AND ')}
            ORDER BY COALESCE(f.pinned,0) DESC,
                     COALESCE(f.sort_at,j.updated_at,j.created_at) DESC,j.id
            LIMIT ? OFFSET ?`,
      bind, result: 'all',
    });
    return this._hydrate(rows);
  }

  async getRandomVisibleEntry(viewerIGT = Infinity, { playerId = null, visibility = 'visible', random = this.random } = {}) {
    const entries = await this.listFeed({ playerId, viewerIGT, visibility, limit: 500, offset: 0 });
    if (!entries.length) return null;
    const value = Number(random());
    const index = Math.min(entries.length - 1, Math.max(0, Math.floor((Number.isFinite(value) ? value : 0) * entries.length)));
    return entries[index];
  }

  async getCommentsForJournalThroughIGT(journalId, viewerIGT = Infinity, { includeDeleted = false } = {}) {
    const clauses = ['c.journal_id=?'];
    const bind = [journalId];
    if (!includeDeleted) clauses.push('c.deleted_at IS NULL');
    if (Number.isFinite(Number(viewerIGT))) {
      clauses.push('(c.in_game_timestamp IS NULL OR c.in_game_timestamp<=?)');
      bind.push(Math.max(0, Math.trunc(Number(viewerIGT))));
    }
    const rows = await this.client.query({
      sql: `SELECT c.id,c.journal_id AS journalId,c.author_id AS authorId,c.text,
                   c.created_at AS createdAt,c.updated_at AS updatedAt,
                   c.in_game_timestamp AS inGameTimestamp,c.deleted_at AS deletedAt,c.extra_json AS extraJson
            FROM journal_comments c WHERE ${clauses.join(' AND ')}
            ORDER BY COALESCE(c.in_game_timestamp,0),c.created_at,c.id`,
      bind, result: 'all',
    });
    if (!rows.length) return [];
    const ids = rows.map((row) => row.id);
    const placeholders = ids.map(() => '?').join(',');
    const votes = await this.client.query({
      sql: `SELECT comment_id AS commentId,voter_id AS voterId,value FROM journal_comment_votes
            WHERE comment_id IN (${placeholders}) ORDER BY comment_id,voter_id`,
      bind: ids, result: 'all',
    });
    const votesByComment = new Map(ids.map((id) => [id, {}]));
    for (const vote of votes) votesByComment.get(vote.commentId)[vote.voterId] = Number(vote.value);
    return rows.map((row) => ({
      UUID: row.id,
      journalUUID: row.journalId,
      authorUUID: row.authorId,
      text: row.text,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt || undefined,
      inGameTimestamp: row.inGameTimestamp == null ? undefined : Number(row.inGameTimestamp),
      deletedAt: row.deletedAt || undefined,
      votes: votesByComment.get(row.id),
      ...parseJson(row.extraJson, {}),
    }));
  }

  async setFeedMetadata(journalId, { pinned = false, sortAt = null, visibility = 'visible', feedState = { version: 1 }, operationId } = {}) {
    if (!operationId) throw new Error('Journal feed metadata writes require an operation ID.');
    if (!['visible','hidden','draft'].includes(visibility)) throw new Error('Invalid journal visibility.');
    const feedStateJson = stableJson({ version: Number(feedState?.version) || 1, ...(feedState || {}) });
    if (new TextEncoder().encode(feedStateJson).byteLength > 65536) throw new Error('Journal feed state exceeds 65536 bytes.');
    const timestamp = this.now().toISOString();
    return this.client.executeAtomic({
      commandId: `journal-feed:${operationId}`,
      label: 'journal-feed-metadata-write',
      statements: [{
        sql: `INSERT INTO journal_feed_metadata(journal_id,pinned,sort_at,visibility,feed_state_json,updated_at)
              VALUES(?,?,?,?,?,?)
              ON CONFLICT(journal_id) DO UPDATE SET
                pinned=excluded.pinned,sort_at=excluded.sort_at,visibility=excluded.visibility,
                feed_state_json=excluded.feed_state_json,updated_at=excluded.updated_at`,
        bind: [journalId, pinned ? 1 : 0, textOrNull(sortAt), visibility, feedStateJson, timestamp], result: 'changes',
      }],
    });
  }

  async setTags(journalId, tags = [], { operationId } = {}) {
    if (!operationId) throw new Error('Journal tag writes require an operation ID.');
    const normalized = new Map();
    for (const raw of tags) {
      const tag = normalizeTag(raw);
      if (!tag) throw new Error('Journal tags must contain 1–128 UTF-8 bytes.');
      if (!normalized.has(tag.normalized)) normalized.set(tag.normalized, tag.tag);
    }
    const statements = [{ sql: 'DELETE FROM journal_tags WHERE journal_id=?', bind: [journalId], result: 'changes' }];
    for (const [key, tag] of [...normalized.entries()].sort(([a], [b]) => a.localeCompare(b))) statements.push({
      sql: 'INSERT INTO journal_tags(journal_id,tag,normalized_tag) VALUES(?,?,?)',
      bind: [journalId, tag, key], result: 'changes',
    });
    return this.client.executeAtomic({ commandId: `journal-tags:${operationId}`, label: 'journal-tags-write', statements });
  }

  async setJournalVote(journalId, voterId, value, { operationId } = {}) {
    if (!operationId) throw new Error('Journal votes require an operation ID.');
    if (![0, -1, 1].includes(Number(value))) throw new Error('Journal votes must be -1, 0, or 1.');
    const statement = Number(value) === 0 ? {
      sql: 'DELETE FROM journal_votes WHERE journal_id=? AND voter_id=?', bind: [journalId, voterId], result: 'changes',
    } : {
      sql: `INSERT INTO journal_votes(journal_id,voter_id,value,updated_at) VALUES(?,?,?,?)
            ON CONFLICT(journal_id,voter_id) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`,
      bind: [journalId, voterId, Number(value), this.now().toISOString()], result: 'changes',
    };
    return this.client.executeAtomic({ commandId: `journal-vote:${operationId}`, label: 'journal-vote-write', statements: [statement] });
  }

  async upsertComment(comment, { operationId } = {}) {
    if (!operationId || !comment?.UUID || !comment?.journalUUID) throw new Error('Comment writes require IDs and an operation ID.');
    const text = String(comment.text ?? '').normalize('NFC');
    if (new TextEncoder().encode(text).byteLength > 65536) throw new Error('Journal comment exceeds 65536 bytes.');
    return this.client.executeAtomic({
      commandId: `journal-comment:${operationId}`,
      label: 'journal-comment-write',
      statements: [{
        sql: `INSERT INTO journal_comments(id,journal_id,author_id,text,created_at,updated_at,in_game_timestamp,deleted_at,extra_json)
              VALUES(?,?,?,?,?,?,?,?,?)
              ON CONFLICT(id) DO UPDATE SET text=excluded.text,updated_at=excluded.updated_at,
                in_game_timestamp=excluded.in_game_timestamp,deleted_at=excluded.deleted_at,extra_json=excluded.extra_json`,
        bind: [comment.UUID, comment.journalUUID, textOrNull(comment.authorUUID), text,
          textOrNull(comment.createdAt) || this.now().toISOString(), textOrNull(comment.updatedAt),
          Number.isFinite(Number(comment.inGameTimestamp)) ? Math.trunc(Number(comment.inGameTimestamp)) : null,
          textOrNull(comment.deletedAt), stableJson(comment.extra || {})], result: 'changes',
      }],
    });
  }

  async deleteComment(commentId, { operationId } = {}) {
    if (!operationId) throw new Error('Comment deletes require an operation ID.');
    return this.client.executeAtomic({
      commandId: `journal-comment-delete:${operationId}`,
      label: 'journal-comment-delete',
      statements: [{
        sql: 'UPDATE journal_comments SET deleted_at=? WHERE id=? AND deleted_at IS NULL',
        bind: [this.now().toISOString(), commentId], result: 'changes',
      }],
    });
  }

  async setCommentVote(commentId, voterId, value, { operationId } = {}) {
    if (!operationId) throw new Error('Comment votes require an operation ID.');
    if (![0, -1, 1].includes(Number(value))) throw new Error('Comment votes must be -1, 0, or 1.');
    const statement = Number(value) === 0 ? {
      sql: 'DELETE FROM journal_comment_votes WHERE comment_id=? AND voter_id=?', bind: [commentId, voterId], result: 'changes',
    } : {
      sql: `INSERT INTO journal_comment_votes(comment_id,voter_id,value,updated_at) VALUES(?,?,?,?)
            ON CONFLICT(comment_id,voter_id) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`,
      bind: [commentId, voterId, Number(value), this.now().toISOString()], result: 'changes',
    };
    return this.client.executeAtomic({ commandId: `journal-comment-vote:${operationId}`, label: 'journal-comment-vote-write', statements: [statement] });
  }
}

export default SqliteJournalRepository;
