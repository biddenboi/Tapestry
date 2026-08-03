export const SOCIAL_NOTIFICATIONS_SCHEMA_SQL = `
CREATE TABLE source_versions (
  source_key TEXT PRIMARY KEY,
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  updated_at TEXT NOT NULL
) STRICT;

INSERT INTO source_versions(source_key,version,updated_at) VALUES
  ('social',0,'1970-01-01T00:00:00.000Z'),
  ('achievements',0,'1970-01-01T00:00:00.000Z'),
  ('profileSummaries',0,'1970-01-01T00:00:00.000Z'),
  ('profiles',0,'1970-01-01T00:00:00.000Z'),
  ('tasks',0,'1970-01-01T00:00:00.000Z'),
  ('journals',0,'1970-01-01T00:00:00.000Z'),
  ('matches',0,'1970-01-01T00:00:00.000Z'),
  ('inventory',0,'1970-01-01T00:00:00.000Z'),
  ('competitiveArenas',0,'1970-01-01T00:00:00.000Z'),
  ('leaderboards',0,'1970-01-01T00:00:00.000Z'),
  ('analytics',0,'1970-01-01T00:00:00.000Z'),
  ('recommender',0,'1970-01-01T00:00:00.000Z');

CREATE TABLE friendships (
  id TEXT PRIMARY KEY,
  requester_player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  recipient_player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted')),
  created_at TEXT NOT NULL,
  accepted_at TEXT,
  in_game_timestamp INTEGER,
  metadata_version INTEGER NOT NULL DEFAULT 1 CHECK (metadata_version >= 1),
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (
    json_valid(metadata_json)
    AND json_type(metadata_json)='object'
    AND length(metadata_json) <= 65536
  ),
  CHECK (requester_player_id <> recipient_player_id),
  CHECK (
    (status='pending' AND accepted_at IS NULL)
    OR (status='accepted' AND accepted_at IS NOT NULL)
  )
) STRICT;

CREATE UNIQUE INDEX friendships_pair_unique_idx ON friendships(
  CASE WHEN requester_player_id < recipient_player_id THEN requester_player_id ELSE recipient_player_id END,
  CASE WHEN requester_player_id < recipient_player_id THEN recipient_player_id ELSE requester_player_id END
);
CREATE INDEX friendships_requester_status_idx ON friendships(requester_player_id,status,created_at,id);
CREATE INDEX friendships_recipient_status_idx ON friendships(recipient_player_id,status,created_at,id);

CREATE TABLE friendship_members (
  friendship_id TEXT NOT NULL REFERENCES friendships(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  member_role TEXT NOT NULL CHECK (member_role IN ('requester','recipient')),
  joined_at TEXT NOT NULL,
  PRIMARY KEY(friendship_id,player_id),
  UNIQUE(friendship_id,member_role)
) STRICT;
CREATE INDEX friendship_members_player_idx ON friendship_members(player_id,friendship_id);

CREATE TRIGGER friendship_members_validate
BEFORE INSERT ON friendship_members
BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM friendships f
    WHERE f.id=NEW.friendship_id
      AND (
        (NEW.member_role='requester' AND NEW.player_id=f.requester_player_id)
        OR (NEW.member_role='recipient' AND NEW.player_id=f.recipient_player_id)
      )
  ) THEN RAISE(ABORT,'friendship-invalid-member') END;
END;

CREATE TRIGGER friendships_seed_members
AFTER INSERT ON friendships
BEGIN
  INSERT INTO friendship_members(friendship_id,player_id,member_role,joined_at)
  VALUES(NEW.id,NEW.requester_player_id,'requester',NEW.created_at);
  INSERT INTO friendship_members(friendship_id,player_id,member_role,joined_at)
  VALUES(NEW.id,NEW.recipient_player_id,'recipient',NEW.created_at);
END;

CREATE TRIGGER friendships_refresh_members
AFTER UPDATE OF requester_player_id,recipient_player_id ON friendships
WHEN OLD.requester_player_id IS NOT NEW.requester_player_id
  OR OLD.recipient_player_id IS NOT NEW.recipient_player_id
BEGIN
  DELETE FROM friendship_members WHERE friendship_id=NEW.id;
END;

CREATE TRIGGER friendship_members_restore
AFTER DELETE ON friendship_members
WHEN EXISTS(SELECT 1 FROM friendships WHERE id=OLD.friendship_id)
BEGIN
  INSERT OR IGNORE INTO friendship_members(friendship_id,player_id,member_role,joined_at)
  SELECT id,requester_player_id,'requester',created_at FROM friendships WHERE id=OLD.friendship_id;
  INSERT OR IGNORE INTO friendship_members(friendship_id,player_id,member_role,joined_at)
  SELECT id,recipient_player_id,'recipient',created_at FROM friendships WHERE id=OLD.friendship_id;
END;

CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  recipient_player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 512),
  message TEXT NOT NULL CHECK (length(message) <= 8192),
  kind TEXT NOT NULL CHECK (length(kind) BETWEEN 1 AND 128),
  created_at TEXT NOT NULL,
  read_at TEXT,
  in_game_timestamp INTEGER,
  metadata_version INTEGER NOT NULL DEFAULT 1 CHECK (metadata_version >= 1),
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (
    json_valid(metadata_json)
    AND json_type(metadata_json)='object'
    AND length(metadata_json) <= 65536
  ),
  CHECK (
    kind <> 'friend_request'
    OR (
      json_type(metadata_json,'$.friendshipUUID')='text'
      AND json_type(metadata_json,'$.requesterUUID')='text'
    )
  )
) STRICT;
CREATE INDEX notifications_recipient_delivery_idx
ON notifications(recipient_player_id,in_game_timestamp,created_at,id);
CREATE INDEX notifications_recipient_unread_idx
ON notifications(recipient_player_id,created_at DESC,id) WHERE read_at IS NULL;

CREATE TABLE friendship_request_commands (
  operation_id TEXT PRIMARY KEY,
  friendship_id TEXT NOT NULL UNIQUE,
  requester_player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  recipient_player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  notification_id TEXT NOT NULL UNIQUE,
  notification_title TEXT NOT NULL CHECK (length(notification_title) BETWEEN 1 AND 512),
  notification_message TEXT NOT NULL CHECK (length(notification_message) <= 8192),
  created_at TEXT NOT NULL,
  in_game_timestamp INTEGER,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json) AND json_type(metadata_json)='object' AND length(metadata_json)<=65536),
  CHECK (requester_player_id <> recipient_player_id)
) STRICT;

CREATE TRIGGER friendship_request_commands_validate
BEFORE INSERT ON friendship_request_commands
BEGIN
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM friendships f
    WHERE (f.requester_player_id=NEW.requester_player_id AND f.recipient_player_id=NEW.recipient_player_id)
       OR (f.requester_player_id=NEW.recipient_player_id AND f.recipient_player_id=NEW.requester_player_id)
  ) THEN RAISE(ABORT,'friendship-already-exists') END;
END;

CREATE TRIGGER friendship_request_commands_apply
AFTER INSERT ON friendship_request_commands
BEGIN
  INSERT INTO friendships(
    id,requester_player_id,recipient_player_id,status,created_at,accepted_at,in_game_timestamp,metadata_version,metadata_json
  ) VALUES(
    NEW.friendship_id,NEW.requester_player_id,NEW.recipient_player_id,'pending',NEW.created_at,NULL,
    NEW.in_game_timestamp,1,NEW.metadata_json
  );
  INSERT INTO notifications(
    id,recipient_player_id,title,message,kind,created_at,read_at,in_game_timestamp,metadata_version,metadata_json
  ) VALUES(
    NEW.notification_id,NEW.recipient_player_id,NEW.notification_title,NEW.notification_message,'friend_request',
    NEW.created_at,NULL,NEW.in_game_timestamp,1,
    json_object('friendshipUUID',NEW.friendship_id,'requesterUUID',NEW.requester_player_id)
  );
  UPDATE source_versions SET version=version+1,updated_at=NEW.created_at
  WHERE source_key IN ('social','achievements','profileSummaries');
END;

CREATE TABLE friendship_accept_commands (
  operation_id TEXT PRIMARY KEY,
  friendship_id TEXT NOT NULL UNIQUE REFERENCES friendships(id) ON DELETE CASCADE,
  accepter_player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  notification_id TEXT NOT NULL UNIQUE,
  notification_title TEXT NOT NULL CHECK (length(notification_title) BETWEEN 1 AND 512),
  notification_message TEXT NOT NULL CHECK (length(notification_message) <= 8192),
  accepted_at TEXT NOT NULL,
  in_game_timestamp INTEGER,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json) AND json_type(metadata_json)='object' AND length(metadata_json)<=65536)
) STRICT;

CREATE TRIGGER friendship_accept_commands_validate
BEFORE INSERT ON friendship_accept_commands
BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM friendships
    WHERE id=NEW.friendship_id AND status='pending' AND recipient_player_id=NEW.accepter_player_id
  ) THEN RAISE(ABORT,'friendship-not-acceptable') END;
END;

CREATE TRIGGER friendship_accept_commands_apply
AFTER INSERT ON friendship_accept_commands
BEGIN
  UPDATE friendships SET status='accepted',accepted_at=NEW.accepted_at
  WHERE id=NEW.friendship_id AND status='pending' AND recipient_player_id=NEW.accepter_player_id;
  UPDATE notifications SET read_at=COALESCE(read_at,NEW.accepted_at)
  WHERE recipient_player_id=NEW.accepter_player_id
    AND kind='friend_request'
    AND json_extract(metadata_json,'$.friendshipUUID')=NEW.friendship_id;
  INSERT INTO notifications(
    id,recipient_player_id,title,message,kind,created_at,read_at,in_game_timestamp,metadata_version,metadata_json
  )
  SELECT NEW.notification_id,f.requester_player_id,NEW.notification_title,NEW.notification_message,
         'friend_accepted',NEW.accepted_at,NULL,NEW.in_game_timestamp,1,
         json_object('friendshipUUID',NEW.friendship_id,'accepterUUID',NEW.accepter_player_id)
  FROM friendships f WHERE f.id=NEW.friendship_id;
  UPDATE source_versions SET version=version+1,updated_at=NEW.accepted_at
  WHERE source_key IN ('social','achievements','profileSummaries');
END;

CREATE TABLE friendship_close_commands (
  operation_id TEXT PRIMARY KEY,
  friendship_id TEXT NOT NULL UNIQUE,
  actor_player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  closed_at TEXT NOT NULL
) STRICT;

CREATE TRIGGER friendship_close_commands_validate
BEFORE INSERT ON friendship_close_commands
BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM friendship_members WHERE friendship_id=NEW.friendship_id AND player_id=NEW.actor_player_id
  ) THEN RAISE(ABORT,'friendship-not-closable') END;
END;

CREATE TRIGGER friendship_close_commands_apply
AFTER INSERT ON friendship_close_commands
BEGIN
  UPDATE notifications SET read_at=COALESCE(read_at,NEW.closed_at)
  WHERE json_extract(metadata_json,'$.friendshipUUID')=NEW.friendship_id;
  DELETE FROM friendships WHERE id=NEW.friendship_id;
  UPDATE source_versions SET version=version+1,updated_at=NEW.closed_at
  WHERE source_key IN ('social','achievements','profileSummaries');
END;
`.trim();

export const migration013 = Object.freeze({
  id: '013_social_notifications',
  description: 'Normalize two-party friendships, generated membership rows, indexed notifications, and source-version invalidation.',
  sourceApplicationVersion: 'batch21',
  sql: SOCIAL_NOTIFICATIONS_SCHEMA_SQL,
  checksum: '248f55a3122e071917f1394b4dd0d4014040463a8c31d59545d653841e398f58',
  compatibleChecksums: Object.freeze([
    '6eca11a00152ee962f6628de203f95e5f4662eee6a4249b5e1270cd956523215',
  ]),
});

export default migration013;
