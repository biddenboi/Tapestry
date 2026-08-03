import { buildSocialWorldScene } from '../../../domain/social-world/SocialWorldScene.js';
import { deserializeProfilePictureValue } from '../profilePictureValue.js';
import {
  hydrateRankProjection,
  visibleRatingProjectionAtIGTSql,
} from './RankVisibilityProjection.js';

function asId(value) {
  return value == null ? '' : String(value);
}

function parseJson(value) {
  if (value == null || value === '') return null;
  try { return JSON.parse(value); } catch { return null; }
}

function hydrateIdentityRow(row) {
  return row ? {
    ...hydrateRankProjection(row),
    profilePicture: deserializeProfilePictureValue(row.profilePicture),
    title: row.title || null,
    frame: parseJson(row.frameJson),
    theme: parseJson(row.themeJson) || 'minimalist',
  } : null;
}

export class SocialWorldSceneQueryService {
  constructor({
    residencyService,
    presenceQueryService = null,
    client = null,
    facade = null,
  } = {}) {
    if (!residencyService) throw new Error('SocialWorldSceneQueryService requires the residency service.');
    this.residencyService = residencyService;
    this.presenceQueryService = presenceQueryService;
    this.client = client;
    this.facade = facade;
  }

  async getSceneSnapshot({
    viewerId,
    viewerIGT,
    nowMs = Date.now(),
  } = {}) {
    const id = asId(viewerId);
    if (!id) return null;
    const cursor = Math.max(0, Math.trunc(Number(viewerIGT) || 0));
    const [residency, viewerProfile, sourceVersions] = await Promise.all([
      this.residencyService.getResidency({ viewerId: id, viewerIGT: cursor }),
      this._viewerProfile(id, cursor),
      this._sourceVersions(),
    ]);
    const sceneProfileIds = [
      id,
      ...(residency?.friends || []).map((entry) => entry?.id || entry?.UUID),
      ...(residency?.dynamic || []).map((entry) => entry?.subjectId),
    ].map(asId).filter(Boolean);
    const uniqueProfileIds = [...new Set(sceneProfileIds)];
    const batchedPresences = this.presenceQueryService?.getProfilesPresence
      ? await this.presenceQueryService.getProfilesPresence({
          profileIds: uniqueProfileIds,
          activeProfileId: id,
          viewerIGT: cursor,
          nowMs,
        })
      : null;
    const presences = batchedPresences instanceof Map
      ? Object.fromEntries(batchedPresences)
      : Object.fromEntries(await Promise.all(uniqueProfileIds.map(async (profileId) => [
          profileId,
          this.presenceQueryService
            ? await this.presenceQueryService.getProfilePresence({
                profileId,
                viewerIGT: cursor,
                isActiveProfile: profileId === id,
                nowMs,
              })
            : null,
        ])));
    return buildSocialWorldScene({
      viewerId: id,
      viewerIGT: cursor,
      viewerProfile,
      residency,
      presences,
      sourceVersions,
    });
  }

  async _viewerProfile(viewerId, viewerIGT) {
    if (this.client?.query) {
      const row = await this.client.query({
        sql: `SELECT id AS UUID,username,description,profile_picture AS profilePicture,elo,
                     ${visibleRatingProjectionAtIGTSql('players.id')} AS ratingResultJson,
                     (SELECT pt.title_id FROM player_titles pt
                      WHERE pt.player_id=players.id AND pt.active=1 ORDER BY pt.title_id LIMIT 1) AS title,
                     (SELECT pc.value_json FROM player_cosmetics pc
                      WHERE pc.player_id=players.id AND pc.slot IN ('profileFrame','cardFrame','frame')
                      ORDER BY CASE pc.slot WHEN 'profileFrame' THEN 0 WHEN 'cardFrame' THEN 1 ELSE 2 END LIMIT 1) AS frameJson,
                     (SELECT pc.value_json FROM player_cosmetics pc
                      WHERE pc.player_id=players.id AND pc.slot='theme' LIMIT 1) AS themeJson,
                     archived_at AS archivedAt,banned_at AS bannedAt
              FROM players WHERE id=? LIMIT 1`,
        bind: [viewerIGT, viewerId],
        result: 'one',
      });
      if (row) return hydrateIdentityRow(row);
    }
    const players = await this.facade?.getAll?.('players') || [];
    return players.find((player) => asId(player?.UUID || player?.id) === viewerId) || { UUID: viewerId };
  }

  async _sourceVersions() {
    if (!this.client?.query) return {};
    const rows = await this.client.query({
      sql: `SELECT source_key AS sourceKey,version
            FROM source_versions
            WHERE source_key IN ('presence','socialWorld','social','profiles')
            ORDER BY source_key`,
      result: 'all',
    });
    return Object.fromEntries(rows.map((row) => [row.sourceKey, Math.max(0, Number(row.version) || 0)]));
  }
}

export default SocialWorldSceneQueryService;
