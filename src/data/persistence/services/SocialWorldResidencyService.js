import { buildFriendResidency } from '../../../domain/social-world/FriendshipResidency.js';
import { resolveProfileVisibility } from '../../../domain/social-world/ProfileVisibility.js';
import { VISIBILITY_TIER } from '../../../domain/social-world/SocialWorldContracts.js';
import { deserializeProfilePictureValue } from '../profilePictureValue.js';
import {
  hydrateRankProjection,
  visibleRatingProjectionAtIGTSql,
} from './RankVisibilityProjection.js';

function parseJson(value) {
  if (value == null || value === '') return null;
  try { return JSON.parse(value); } catch { return null; }
}

function hydrateIdentityRow(row) {
  return {
    ...hydrateRankProjection(row),
    profilePicture: deserializeProfilePictureValue(row.profilePicture),
    frame: parseJson(row.frameJson),
    theme: parseJson(row.themeJson) || 'minimalist',
  };
}

export class SocialWorldResidencyService {
  constructor({ facade = null, socialRepository = null, castService = null, client = null } = {}) {
    if (!facade && !socialRepository) throw new Error('SocialWorldResidencyService requires a persistence source.');
    this.facade = facade;
    this.socialRepository = socialRepository;
    this.castService = castService;
    this.client = client;
    this.lastValidCastByViewer = new Map();
  }

  async _friendships(viewerId, viewerIGT) {
    return this.socialRepository
      ? this.socialRepository.listFriendshipsForPlayer(viewerId, { status: 'accepted', viewerIGT })
      : this.facade.getFriendshipsForPlayer(viewerId);
  }

  async _players(viewerIGT) {
    if (this.client?.query) {
      const rows = await this.client.query({
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
              FROM players ORDER BY id`,
        bind: [viewerIGT],
        result: 'all',
      });
      return rows.map(hydrateIdentityRow);
    }
    return this.facade?.getAll?.('players') || [];
  }

  async _dynamicCast(viewerId, viewerIGT) {
    if (!this.castService) return { cast: null, unavailable: null };
    try {
      const cast = await this.castService.getDynamicCast({ viewerId, viewerIGT });
      if (cast) this.lastValidCastByViewer.set(String(viewerId), cast);
      return { cast, unavailable: null };
    } catch (error) {
      if (error?.code !== 'social-cast-source-not-ready') throw error;
      return {
        cast: this.lastValidCastByViewer.get(String(viewerId)) || null,
        unavailable: Object.freeze({
          code: error.code,
          states: error.states || [],
        }),
      };
    }
  }

  async getResidency({ viewerId, viewerIGT } = {}) {
    if (!viewerId) return null;
    const [friendships, castResult, players] = await Promise.all([
      this._friendships(String(viewerId), viewerIGT),
      this._dynamicCast(String(viewerId), viewerIGT),
      this._players(viewerIGT),
    ]);
    const { cast } = castResult;
    const accepted = (friendships || []).filter((row) => row.status === 'accepted');
    const friendResidency = buildFriendResidency({ viewerId, friendships: accepted, players });
    const friendIds = new Set(friendResidency.friendIds);
    const playersById = new Map(players.map((player) => [String(player.UUID || player.id), player]));
    const dynamic = (cast?.assignments || [])
      .filter((assignment) => !friendIds.has(String(assignment.subjectId)))
      .map((assignment) => Object.freeze({
        ...assignment,
        visibilityTier: VISIBILITY_TIER.dynamic,
        profile: playersById.get(String(assignment.subjectId)) || assignment.profile
          ? Object.freeze({
              ...(playersById.get(String(assignment.subjectId)) || assignment.profile),
              visibilityTier: VISIBILITY_TIER.dynamic,
            })
          : null,
      }));
    return Object.freeze({
      viewerId: String(viewerId),
      ...friendResidency,
      friends: friendResidency.friends,
      dynamic: Object.freeze(dynamic),
      surroundingProfiles: Object.freeze([...friendResidency.friends, ...dynamic]),
      castReview: cast?.review || null,
      castSourceUnavailable: castResult.unavailable,
    });
  }

  async getProfileAccess({ viewerId, profileId, viewerIGT } = {}) {
    if (!viewerId || !profileId) return null;
    const residency = await this.getResidency({ viewerId, viewerIGT });
    return resolveProfileVisibility({
      viewerId,
      profileId,
      friendIds: residency.friendIds,
      dynamicProfileIds: residency.dynamic.map((entry) => entry.subjectId),
      friendCount: residency.friendCount,
    });
  }
}

export default SocialWorldResidencyService;
