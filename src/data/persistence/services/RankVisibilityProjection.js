const SQL_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_.]*$/;
const MATCH_LEADERBOARD_SNAPSHOT_ID = 'matchLeaderboardSnapshot:v1';

/**
 * Returns a SQLite expression whose single bind is the viewer's IGT cursor.
 * It yields the latest visible rated-result JSON from the same materialized
 * timeline used by the full Profile and Lobby views.
 */
export function visibleRatingProjectionAtIGTSql(playerIdExpression) {
  const expression = String(playerIdExpression || '');
  if (!SQL_IDENTIFIER.test(expression)) {
    throw new TypeError('Rank visibility projection requires a trusted SQL identifier.');
  }
  return `(
    SELECT rated_result.value
    FROM document_derived_caches rating_cache
    JOIN json_each(json_extract(
      rating_cache.record_json,
      '$.value.eloTimelineByPlayer'
    )) player_timeline
    JOIN json_each(json_extract(player_timeline.value, '$.ratedResults')) rated_result
    WHERE rating_cache.uuid='${MATCH_LEADERBOARD_SNAPSHOT_ID}'
      AND player_timeline.key=CAST(${expression} AS TEXT)
      AND CAST(json_extract(rated_result.value, '$.completedIGT') AS INTEGER)<=?
    ORDER BY CAST(json_extract(rated_result.value, '$.completedIGT') AS INTEGER) DESC,
             json_extract(rated_result.value, '$.concludedAt') DESC,
             json_extract(rated_result.value, '$.matchUUID') DESC
    LIMIT 1
  )`;
}

export function hydrateRankProjection(row) {
  if (!row) return null;
  let result = null;
  try {
    result = row.ratingResultJson ? JSON.parse(row.ratingResultJson) : null;
  } catch {
    result = null;
  }
  const projectedElo = Number(result?.newElo);
  const hasVisibleRating = result != null && Number.isFinite(projectedElo);
  const { ratingResultJson: _ratingResultJson, ...identity } = row;
  return {
    ...identity,
    elo: hasVisibleRating ? Math.max(0, projectedElo) : Math.max(0, Number(row.elo) || 0),
    hasVisibleRating,
  };
}
