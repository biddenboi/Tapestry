export const COMMERCE_TRANSACTIONS_SCHEMA_SQL = `
CREATE TABLE shop_items (
  id TEXT PRIMARY KEY,
  item_id TEXT,
  name TEXT NOT NULL,
  description TEXT,
  item_type TEXT NOT NULL,
  item_class TEXT,
  category TEXT,
  currency_type TEXT NOT NULL DEFAULT 'tokens' CHECK (currency_type IN ('tokens','dollars')),
  token_cost INTEGER NOT NULL DEFAULT 0 CHECK (token_cost >= 0),
  money_cost_minor INTEGER NOT NULL DEFAULT 0 CHECK (money_cost_minor >= 0),
  quantity_per_purchase INTEGER,
  duration_minutes REAL,
  enjoyment REAL,
  cooldown_ms INTEGER NOT NULL DEFAULT 0 CHECK (cooldown_ms >= 0),
  stock_limit INTEGER CHECK (stock_limit IS NULL OR stock_limit >= 0),
  sold_count INTEGER NOT NULL DEFAULT 0 CHECK (sold_count >= 0),
  purchase_limit_per_player INTEGER CHECK (purchase_limit_per_player IS NULL OR purchase_limit_per_player > 0),
  available_from TEXT,
  available_until TEXT,
  banner_resource_hash TEXT REFERENCES resources(content_hash) ON DELETE SET NULL,
  created_at TEXT,
  updated_at TEXT,
  extra_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(extra_json) AND length(extra_json) <= 131072),
  CHECK (stock_limit IS NULL OR sold_count <= stock_limit)
) STRICT;
CREATE INDEX shop_items_availability_idx ON shop_items(available_from, available_until, category, name, id);
CREATE UNIQUE INDEX shop_items_identity_idx ON shop_items(item_type, item_id) WHERE item_id IS NOT NULL;

CREATE TABLE inventory_items (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  shop_item_id TEXT REFERENCES shop_items(id) ON DELETE SET NULL,
  item_id TEXT,
  name_snapshot TEXT NOT NULL,
  description_snapshot TEXT,
  item_type TEXT NOT NULL,
  item_class TEXT,
  category_snapshot TEXT,
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  duration_minutes REAL,
  enjoyment REAL,
  cooldown_ms INTEGER NOT NULL DEFAULT 0 CHECK (cooldown_ms >= 0),
  last_used_at TEXT,
  use_count INTEGER NOT NULL DEFAULT 0 CHECK (use_count >= 0),
  purchased_at TEXT,
  purchase_count INTEGER NOT NULL DEFAULT 0 CHECK (purchase_count >= 0),
  cooldown_until TEXT,
  banner_resource_hash TEXT REFERENCES resources(content_hash) ON DELETE SET NULL,
  extra_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(extra_json) AND length(extra_json) <= 131072)
) STRICT;
CREATE INDEX inventory_player_type_idx ON inventory_items(player_id, item_type, item_id, id);
CREATE UNIQUE INDEX inventory_player_shop_item_idx ON inventory_items(player_id, shop_item_id) WHERE shop_item_id IS NOT NULL;

CREATE TABLE purchase_batches (
  id TEXT PRIMARY KEY,
  player_id TEXT REFERENCES players(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('committed','reversed')),
  token_cost INTEGER NOT NULL CHECK (token_cost >= 0),
  money_cost_minor INTEGER NOT NULL CHECK (money_cost_minor >= 0),
  item_count INTEGER NOT NULL CHECK (item_count > 0),
  occurred_at TEXT NOT NULL,
  operation_id TEXT NOT NULL UNIQUE,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json) AND length(metadata_json) <= 65536)
) STRICT;
CREATE INDEX purchase_batches_player_time_idx ON purchase_batches(player_id, occurred_at DESC, id);

CREATE TABLE purchase_ledger (
  id TEXT PRIMARY KEY,
  purchase_batch_id TEXT NOT NULL REFERENCES purchase_batches(id) ON DELETE RESTRICT,
  player_id TEXT REFERENCES players(id) ON DELETE SET NULL,
  shop_item_id TEXT REFERENCES shop_items(id) ON DELETE SET NULL,
  item_name_snapshot TEXT NOT NULL,
  description_snapshot TEXT,
  category_snapshot TEXT,
  currency_type TEXT NOT NULL CHECK (currency_type IN ('tokens','dollars')),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_cost_tokens INTEGER NOT NULL DEFAULT 0 CHECK (unit_cost_tokens >= 0),
  unit_cost_money_minor INTEGER NOT NULL DEFAULT 0 CHECK (unit_cost_money_minor >= 0),
  total_cost_tokens INTEGER NOT NULL DEFAULT 0 CHECK (total_cost_tokens >= 0),
  total_cost_money_minor INTEGER NOT NULL DEFAULT 0 CHECK (total_cost_money_minor >= 0),
  occurred_at TEXT NOT NULL,
  in_game_timestamp INTEGER,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json) AND length(metadata_json) <= 65536)
) STRICT;
CREATE INDEX purchase_ledger_player_time_idx ON purchase_ledger(player_id, in_game_timestamp, occurred_at, id);
CREATE INDEX purchase_ledger_batch_idx ON purchase_ledger(purchase_batch_id, id);

CREATE TABLE purchase_commands (
  operation_id TEXT PRIMARY KEY,
  purchase_batch_id TEXT NOT NULL UNIQUE,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  cart_json TEXT NOT NULL CHECK (json_valid(cart_json) AND json_type(cart_json)='array'),
  occurred_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json) AND length(metadata_json) <= 65536)
) STRICT;

CREATE TRIGGER purchase_commands_validate
BEFORE INSERT ON purchase_commands
BEGIN
  SELECT CASE WHEN json_array_length(NEW.cart_json)=0
    THEN RAISE(ABORT, 'purchase-empty-cart') END;
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM json_each(NEW.cart_json)
    WHERE json_type(value,'$.quantity')!='integer' OR CAST(json_extract(value,'$.quantity') AS INTEGER)<=0
       OR json_type(value,'$.itemId')!='text'
  ) THEN RAISE(ABORT, 'purchase-invalid-cart') END;
  SELECT CASE WHEN (
    SELECT COUNT(*) FROM json_each(NEW.cart_json)
  ) <> (
    SELECT COUNT(DISTINCT json_extract(value,'$.itemId')) FROM json_each(NEW.cart_json)
  ) THEN RAISE(ABORT, 'purchase-duplicate-item') END;
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM json_each(NEW.cart_json) c
    LEFT JOIN shop_items s ON s.id=json_extract(c.value,'$.itemId')
    WHERE s.id IS NULL
  ) THEN RAISE(ABORT, 'purchase-item-missing') END;
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM json_each(NEW.cart_json) c
    JOIN shop_items s ON s.id=json_extract(c.value,'$.itemId')
    WHERE (s.available_from IS NOT NULL AND s.available_from>NEW.occurred_at)
       OR (s.available_until IS NOT NULL AND s.available_until<NEW.occurred_at)
       OR (s.stock_limit IS NOT NULL AND s.sold_count+CAST(json_extract(c.value,'$.quantity') AS INTEGER)>s.stock_limit)
       OR (s.purchase_limit_per_player IS NOT NULL AND
           COALESCE((SELECT purchase_count FROM inventory_items i WHERE i.player_id=NEW.player_id AND i.shop_item_id=s.id),0)
             + CAST(json_extract(c.value,'$.quantity') AS INTEGER)>s.purchase_limit_per_player)
  ) THEN RAISE(ABORT, 'purchase-item-unavailable') END;
  SELECT CASE WHEN (
    SELECT tokens FROM players WHERE id=NEW.player_id
  ) < COALESCE((
    SELECT SUM(s.token_cost*CAST(json_extract(c.value,'$.quantity') AS INTEGER))
    FROM json_each(NEW.cart_json) c JOIN shop_items s ON s.id=json_extract(c.value,'$.itemId')
    WHERE s.currency_type='tokens'
  ),0) THEN RAISE(ABORT, 'purchase-insufficient-tokens') END;
  SELECT CASE WHEN (
    SELECT global_money_minor FROM economy WHERE singleton_id=1
  ) < COALESCE((
    SELECT SUM(s.money_cost_minor*CAST(json_extract(c.value,'$.quantity') AS INTEGER))
    FROM json_each(NEW.cart_json) c JOIN shop_items s ON s.id=json_extract(c.value,'$.itemId')
    WHERE s.currency_type='dollars'
  ),0) THEN RAISE(ABORT, 'purchase-insufficient-money') END;
END;

CREATE TRIGGER purchase_commands_apply
AFTER INSERT ON purchase_commands
BEGIN
  INSERT INTO purchase_batches(
    id,player_id,status,token_cost,money_cost_minor,item_count,occurred_at,operation_id,metadata_json
  )
  SELECT NEW.purchase_batch_id,NEW.player_id,'committed',
         COALESCE(SUM(CASE WHEN s.currency_type='tokens' THEN s.token_cost*CAST(json_extract(c.value,'$.quantity') AS INTEGER) ELSE 0 END),0),
         COALESCE(SUM(CASE WHEN s.currency_type='dollars' THEN s.money_cost_minor*CAST(json_extract(c.value,'$.quantity') AS INTEGER) ELSE 0 END),0),
         COALESCE(SUM(CAST(json_extract(c.value,'$.quantity') AS INTEGER)),0),
         NEW.occurred_at,NEW.operation_id,NEW.metadata_json
  FROM json_each(NEW.cart_json) c JOIN shop_items s ON s.id=json_extract(c.value,'$.itemId');

  UPDATE players SET tokens=tokens-(
    SELECT COALESCE(SUM(s.token_cost*CAST(json_extract(c.value,'$.quantity') AS INTEGER)),0)
    FROM json_each(NEW.cart_json) c JOIN shop_items s ON s.id=json_extract(c.value,'$.itemId')
    WHERE s.currency_type='tokens'
  ),updated_at=NEW.occurred_at WHERE id=NEW.player_id;

  UPDATE economy SET global_money_minor=global_money_minor-(
    SELECT COALESCE(SUM(s.money_cost_minor*CAST(json_extract(c.value,'$.quantity') AS INTEGER)),0)
    FROM json_each(NEW.cart_json) c JOIN shop_items s ON s.id=json_extract(c.value,'$.itemId')
    WHERE s.currency_type='dollars'
  ),updated_at=NEW.occurred_at WHERE singleton_id=1;

  UPDATE shop_items SET sold_count=sold_count+(
    SELECT CAST(json_extract(c.value,'$.quantity') AS INTEGER)
    FROM json_each(NEW.cart_json) c WHERE json_extract(c.value,'$.itemId')=shop_items.id
  ),updated_at=NEW.occurred_at
  WHERE id IN (SELECT json_extract(value,'$.itemId') FROM json_each(NEW.cart_json)) AND stock_limit IS NOT NULL;

  INSERT INTO inventory_items(
    id,player_id,shop_item_id,item_id,name_snapshot,description_snapshot,item_type,item_class,category_snapshot,
    quantity,duration_minutes,enjoyment,cooldown_ms,purchased_at,purchase_count,banner_resource_hash,extra_json
  )
  SELECT NEW.operation_id || ':' || s.id,NEW.player_id,s.id,s.item_id,s.name,s.description,s.item_type,s.item_class,s.category,
         CAST(json_extract(c.value,'$.quantity') AS INTEGER),s.duration_minutes,s.enjoyment,s.cooldown_ms,
         NEW.occurred_at,CAST(json_extract(c.value,'$.quantity') AS INTEGER),s.banner_resource_hash,'{}'
  FROM json_each(NEW.cart_json) c JOIN shop_items s ON s.id=json_extract(c.value,'$.itemId')
  ON CONFLICT(player_id,shop_item_id) WHERE shop_item_id IS NOT NULL DO UPDATE SET
    quantity=inventory_items.quantity+excluded.quantity,
    purchase_count=inventory_items.purchase_count+excluded.purchase_count,
    name_snapshot=excluded.name_snapshot,description_snapshot=excluded.description_snapshot,
    item_type=excluded.item_type,item_class=excluded.item_class,category_snapshot=excluded.category_snapshot,
    duration_minutes=excluded.duration_minutes,enjoyment=excluded.enjoyment,cooldown_ms=excluded.cooldown_ms,
    purchased_at=excluded.purchased_at,banner_resource_hash=excluded.banner_resource_hash;

  INSERT INTO purchase_ledger(
    id,purchase_batch_id,player_id,shop_item_id,item_name_snapshot,description_snapshot,category_snapshot,
    currency_type,quantity,unit_cost_tokens,unit_cost_money_minor,total_cost_tokens,total_cost_money_minor,
    occurred_at,metadata_json
  )
  SELECT NEW.operation_id || ':' || s.id,NEW.purchase_batch_id,NEW.player_id,s.id,s.name,s.description,s.category,
         s.currency_type,CAST(json_extract(c.value,'$.quantity') AS INTEGER),
         CASE WHEN s.currency_type='tokens' THEN s.token_cost ELSE 0 END,
         CASE WHEN s.currency_type='dollars' THEN s.money_cost_minor ELSE 0 END,
         CASE WHEN s.currency_type='tokens' THEN s.token_cost*CAST(json_extract(c.value,'$.quantity') AS INTEGER) ELSE 0 END,
         CASE WHEN s.currency_type='dollars' THEN s.money_cost_minor*CAST(json_extract(c.value,'$.quantity') AS INTEGER) ELSE 0 END,
         NEW.occurred_at,'{}'
  FROM json_each(NEW.cart_json) c JOIN shop_items s ON s.id=json_extract(c.value,'$.itemId');
END;

`.trim();

export const migration012 = Object.freeze({
  id: '012_commerce_transactions',
  description: 'Normalize catalog, inventory, purchase batches, and ledger with integer money and transactional constraints.',
  sourceApplicationVersion: 'batch20',
  sql: COMMERCE_TRANSACTIONS_SCHEMA_SQL,
  checksum: 'deae1266d5ff86b080abc0a5952561d644fd02a4e5858c55dfb9e80de470815d',
});
export default migration012;
