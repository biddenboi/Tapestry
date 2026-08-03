export const FRIEND_RESIDENCY_VISIBILITY_SQL = `
CREATE INDEX friendships_accepted_residency_idx
ON friendships(status,accepted_at,id)
WHERE status='accepted';

CREATE VIEW friend_residency AS
SELECT fm.player_id AS viewer_player_id,
       CASE WHEN f.requester_player_id=fm.player_id
            THEN f.recipient_player_id ELSE f.requester_player_id END AS friend_player_id,
       f.id AS friendship_id,
       f.accepted_at AS resident_since
FROM friendship_members fm
JOIN friendships f ON f.id=fm.friendship_id
WHERE f.status='accepted';

CREATE TRIGGER friendship_capacity_insert
BEFORE INSERT ON friendships
WHEN NEW.status='accepted'
BEGIN
  SELECT CASE WHEN (
    SELECT COUNT(*) FROM friendships f
    WHERE f.status='accepted'
      AND (f.requester_player_id=NEW.requester_player_id OR f.recipient_player_id=NEW.requester_player_id)
  ) >= 3 THEN RAISE(ABORT,'friend-cap-reached') END;
  SELECT CASE WHEN (
    SELECT COUNT(*) FROM friendships f
    WHERE f.status='accepted'
      AND (f.requester_player_id=NEW.recipient_player_id OR f.recipient_player_id=NEW.recipient_player_id)
  ) >= 3 THEN RAISE(ABORT,'friend-cap-reached') END;
END;

CREATE TRIGGER friendship_capacity_accept
BEFORE UPDATE OF status ON friendships
WHEN OLD.status<>'accepted' AND NEW.status='accepted'
BEGIN
  SELECT CASE WHEN (
    SELECT COUNT(*) FROM friendships f
    WHERE f.status='accepted'
      AND (f.requester_player_id=NEW.requester_player_id OR f.recipient_player_id=NEW.requester_player_id)
  ) >= 3 THEN RAISE(ABORT,'friend-cap-reached') END;
  SELECT CASE WHEN (
    SELECT COUNT(*) FROM friendships f
    WHERE f.status='accepted'
      AND (f.requester_player_id=NEW.recipient_player_id OR f.recipient_player_id=NEW.recipient_player_id)
  ) >= 3 THEN RAISE(ABORT,'friend-cap-reached') END;
END;
`.trim();

export const migration021 = Object.freeze({
  id: '021_friend_residency_visibility',
  description: 'Enforce three explicit friend places and expose durable friend residency for tiered profile access.',
  sourceApplicationVersion: 'social-world-batch5',
  sql: FRIEND_RESIDENCY_VISIBILITY_SQL,
  checksum: '5987930a63a2fe805eeae5ca21ebef04415a42be1b3a0a1441146928d8c512cc',
});

export default migration021;
