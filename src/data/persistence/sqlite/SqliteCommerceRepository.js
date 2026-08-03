import { currencyFromMinor, parseJson, stableJson } from './shadowDomainUtils.js';

export class SqliteCommerceRepository {
  constructor({ client, now = () => new Date() } = {}) {
    if (!client) throw new Error('SqliteCommerceRepository requires a SQLite client.');
    this.client = client;
    this.now = now;
  }

  async getCatalog() {
    const rows = await this.client.query({
      sql: `SELECT id,item_id AS itemId,name,description,item_type AS type,item_class AS itemClass,category,
                   currency_type AS currencyType,token_cost AS tokenCost,money_cost_minor AS moneyCostMinor,
                   quantity_per_purchase AS quantity,duration_minutes AS duration,enjoyment,cooldown_ms AS cooldownMs,
                   stock_limit AS stockLimit,sold_count AS soldCount,purchase_limit_per_player AS purchaseLimitPerPlayer,
                   available_from AS availableFrom,available_until AS availableUntil,
                   banner_resource_hash AS bannerResourceHash,created_at AS createdAt,updated_at AS updatedAt,
                   extra_json AS extraJson
            FROM shop_items ORDER BY category,name,id`, result: 'all',
    });
    return rows.map((row) => ({
      ...parseJson(row.extraJson, {}), ...row, UUID: row.id,
      cost: row.currencyType === 'dollars' ? currencyFromMinor(Number(row.moneyCostMinor)) : Number(row.tokenCost),
      soldCount: Number(row.soldCount), cooldownMs: Number(row.cooldownMs),
    }));
  }

  async getInventory(playerId) {
    const rows = await this.client.query({
      sql: `SELECT id,player_id AS parent,shop_item_id AS itemUUID,item_id AS itemId,name_snapshot AS name,
                   description_snapshot AS description,item_type AS type,item_class AS itemClass,
                   category_snapshot AS category,quantity,duration_minutes AS duration,enjoyment,
                   cooldown_ms AS cooldownMs,last_used_at AS lastUsedAt,use_count AS useCount,
                   purchased_at AS purchasedAt,purchase_count AS purchaseCount,cooldown_until AS cooldownUntil,
                   banner_resource_hash AS bannerResourceHash,extra_json AS extraJson
            FROM inventory_items WHERE player_id=? ORDER BY name_snapshot,id`, bind: [playerId], result: 'all',
    });
    return rows.map((row) => ({ ...parseJson(row.extraJson, {}), ...row, UUID: row.id,
      quantity: Number(row.quantity), cooldownMs: Number(row.cooldownMs), useCount: Number(row.useCount), purchaseCount: Number(row.purchaseCount),
    }));
  }

  async getLedgerForPlayer(playerId, { viewerIGT = Infinity } = {}) {
    const bind = [playerId];
    const igt = Number.isFinite(Number(viewerIGT)) ? 'AND (in_game_timestamp IS NULL OR in_game_timestamp<=?)' : '';
    if (igt) bind.push(Math.trunc(Number(viewerIGT)));
    const rows = await this.client.query({
      sql: `SELECT id,purchase_batch_id AS purchaseBatchUUID,player_id AS parent,shop_item_id AS itemUUID,
                   item_name_snapshot AS name,description_snapshot AS description,category_snapshot AS category,
                   currency_type AS currencyType,quantity,unit_cost_tokens AS unitCostTokens,
                   unit_cost_money_minor AS unitCostMoneyMinor,total_cost_tokens AS totalCostTokens,
                   total_cost_money_minor AS totalCostMoneyMinor,occurred_at AS createdAt,
                   in_game_timestamp AS inGameTimestamp,metadata_json AS metadataJson
            FROM purchase_ledger WHERE player_id=? ${igt} ORDER BY occurred_at,id`, bind, result: 'all',
    });
    return rows.map((row) => ({
      ...parseJson(row.metadataJson, {}), ...row, UUID: row.id, type: 'shop_purchase', quantity: Number(row.quantity),
      unitCost: row.currencyType === 'dollars' ? currencyFromMinor(Number(row.unitCostMoneyMinor)) : Number(row.unitCostTokens),
      totalCost: row.currencyType === 'dollars' ? currencyFromMinor(Number(row.totalCostMoneyMinor)) : Number(row.totalCostTokens),
      cost: row.currencyType === 'dollars' ? currencyFromMinor(Number(row.totalCostMoneyMinor)) : Number(row.totalCostTokens),
    }));
  }

  async getPurchase(batchId) {
    const batch = await this.client.query({
      sql: `SELECT id,player_id AS playerId,status,token_cost AS tokenCost,money_cost_minor AS moneyCostMinor,
                   item_count AS itemCount,occurred_at AS occurredAt,operation_id AS operationId,metadata_json AS metadataJson
            FROM purchase_batches WHERE id=?`, bind: [batchId], result: 'one',
    });
    if (!batch) return null;
    const [player, economy, inventory, ledger] = await Promise.all([
      this.client.query({ sql: 'SELECT id AS UUID,tokens,elo,username FROM players WHERE id=?', bind: [batch.playerId], result: 'one' }),
      this.client.query({ sql: 'SELECT global_money_minor AS moneyMinor FROM economy WHERE singleton_id=1', result: 'one' }),
      this.getInventory(batch.playerId),
      this.getLedgerForPlayer(batch.playerId),
    ]);
    return {
      purchaseBatchUUID: batch.id,
      operationId: batch.operationId,
      occurredAt: batch.occurredAt,
      tokenCost: Number(batch.tokenCost),
      dollarCost: currencyFromMinor(Number(batch.moneyCostMinor)),
      itemCount: Number(batch.itemCount),
      player: player ? { ...player, tokens: Number(player.tokens) } : null,
      globalMoneyAfter: economy ? currencyFromMinor(Number(economy.moneyMinor)) : 0,
      playerInventory: inventory,
      ledgerRecords: ledger.filter((row) => row.purchaseBatchUUID === batch.id),
      metadata: parseJson(batch.metadataJson, {}),
    };
  }

  async commitPurchase({ playerId, purchaseBatchId, operationId, cart, occurredAt = this.now(), metadata = {} } = {}) {
    if (!playerId || !purchaseBatchId || !operationId) throw new Error('Purchase requires playerId, purchaseBatchId, and operationId.');
    const existing = await this.client.query({
      sql: 'SELECT purchase_batch_id AS batchId FROM purchase_commands WHERE operation_id=?', bind: [operationId], result: 'one',
    });
    if (existing) return { ...(await this.getPurchase(existing.batchId)), duplicate: true };
    const normalizedCart = [...(cart || [])].map((entry) => ({
      itemId: String(entry.itemId ?? entry.item?.UUID ?? ''),
      quantity: Math.trunc(Number(entry.quantity ?? entry.qty)),
    })).sort((a, b) => a.itemId.localeCompare(b.itemId));
    const timestamp = (occurredAt instanceof Date ? occurredAt : new Date(occurredAt)).toISOString();
    try {
      await this.client.executeAtomic({
        commandId: `purchase:${operationId}`,
        label: 'shop-purchase',
        statements: [{
          sql: `INSERT INTO purchase_commands(operation_id,purchase_batch_id,player_id,cart_json,occurred_at,metadata_json)
                VALUES(?,?,?,?,?,?)`,
          bind: [operationId, purchaseBatchId, playerId, stableJson(normalizedCart), timestamp, stableJson(metadata)], result: 'changes',
        }],
      });
    } catch (error) {
      const message = String(error?.message || '');
      const mapping = [
        ['purchase-empty-cart','empty-cart'], ['purchase-invalid-cart','invalid-quantity'],
        ['purchase-duplicate-item','duplicate-item'], ['purchase-item-missing','catalog-item-missing'],
        ['purchase-item-unavailable','item-unavailable'], ['purchase-insufficient-tokens','insufficient-tokens'],
        ['purchase-insufficient-money','insufficient-money'],
      ];
      const match = mapping.find(([needle]) => message.includes(needle));
      if (match) error.code = match[1];
      throw error;
    }
    return { ...(await this.getPurchase(purchaseBatchId)), duplicate: false };
  }
}

export default SqliteCommerceRepository;
