import {
  createImportLedgerStatements,
  currencyToMinor,
  deterministicRows,
  fingerprintShadowSource,
  omitKeys,
  stableJson,
  textOrNull,
} from './shadowDomainUtils.js';

const IMPORTER_VERSION = 'batch20-commerce-v1';
const SHOP_KEYS = ['UUID','itemId','name','description','type','itemClass','category','currencyType','cost','quantity','duration','enjoyment','cooldownMs','stockLimit','soldCount','purchaseLimitPerPlayer','availableFrom','availableUntil','bannerResourceHash','bannerImageUrl','createdAt','updatedAt'];
const INVENTORY_KEYS = ['UUID','parent','itemUUID','itemId','name','description','type','itemClass','category','quantity','duration','enjoyment','cooldownMs','lastUsedAt','useCount','purchasedAt','purchaseCount','cooldownUntil','bannerResourceHash','bannerImageUrl'];
const TRANSACTION_KEYS = ['UUID','parent','type','purchaseBatchUUID','name','description','itemUUID','category','currencyType','quantity','unitCost','totalCost','cost','createdAt','inGameTimestamp'];

function boundedJson(value, max = 131072) {
  const text = stableJson(value ?? {});
  return new TextEncoder().encode(text).byteLength <= max ? text : '{}';
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export class CommerceShadowImporter {
  constructor({ client, now = () => new Date() } = {}) {
    if (!client) throw new Error('CommerceShadowImporter requires a SQLite client.');
    this.client = client;
    this.now = now;
  }

  async import({ shop = [], inventory = [], transactions = [], runId = null } = {}) {
    const source = { shop, inventory, transactions };
    const sourceFingerprint = await fingerprintShadowSource(source);
    const existing = await this.client.query({
      sql: `SELECT run_id AS runId,counts_json AS countsJson,diagnostics_json AS diagnosticsJson
            FROM shadow_import_runs WHERE domain='commerce' AND source_fingerprint=? AND importer_version=?`,
      bind: [sourceFingerprint, IMPORTER_VERSION], result: 'one',
    });
    if (existing) return { duplicate: true, runId: existing.runId, sourceFingerprint, counts: JSON.parse(existing.countsJson), diagnostics: JSON.parse(existing.diagnosticsJson) };

    const shopInput = deterministicRows(shop, { kind: 'shop-item' });
    const inventoryInput = deterministicRows(inventory, { kind: 'inventory-item' });
    const transactionInput = deterministicRows(transactions, { kind: 'purchase-ledger' });
    const diagnostics = [
      ...shopInput.rejected, ...shopInput.conflicts,
      ...inventoryInput.rejected, ...inventoryInput.conflicts,
      ...transactionInput.rejected, ...transactionInput.conflicts,
    ];
    const [playerValues, resourceValues] = await Promise.all([
      this.client.query({ sql: 'SELECT id FROM players', result: 'values' }),
      this.client.query({ sql: "SELECT content_hash FROM resources WHERE state='active'", result: 'values' }),
    ]);
    const playerIds = new Set(playerValues);
    const resourceHashes = new Set(resourceValues);
    const timestamp = this.now().toISOString();
    const statements = [];
    const shopById = new Map();

    for (const record of shopInput.selected) {
      const id = String(record.UUID);
      const currencyType = record.currencyType === 'dollars' ? 'dollars' : 'tokens';
      const cost = Math.max(0, finite(record.cost) ?? 0);
      let bannerHash = textOrNull(record.bannerResourceHash);
      if (bannerHash && !resourceHashes.has(bannerHash)) { diagnostics.push({ kind: 'shop-item', recordId: id, reason: 'unknown-banner-resource' }); bannerHash = null; }
      if (typeof record.bannerImageUrl === 'string' && record.bannerImageUrl.startsWith('data:')) diagnostics.push({ kind: 'shop-item', recordId: id, reason: 'inline-banner-requires-resource-import' });
      const normalized = {
        id,
        itemId: textOrNull(record.itemId),
        type: textOrNull(record.type) || 'quantity',
      };
      shopById.set(id, normalized);
      statements.push({
        sql: `INSERT INTO shop_items(
                id,item_id,name,description,item_type,item_class,category,currency_type,token_cost,money_cost_minor,
                quantity_per_purchase,duration_minutes,enjoyment,cooldown_ms,stock_limit,sold_count,purchase_limit_per_player,
                available_from,available_until,banner_resource_hash,created_at,updated_at,extra_json
              ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
              ON CONFLICT(id) DO UPDATE SET
                item_id=excluded.item_id,name=excluded.name,description=excluded.description,item_type=excluded.item_type,
                item_class=excluded.item_class,category=excluded.category,currency_type=excluded.currency_type,
                token_cost=excluded.token_cost,money_cost_minor=excluded.money_cost_minor,
                quantity_per_purchase=excluded.quantity_per_purchase,duration_minutes=excluded.duration_minutes,
                enjoyment=excluded.enjoyment,cooldown_ms=excluded.cooldown_ms,stock_limit=excluded.stock_limit,
                sold_count=excluded.sold_count,purchase_limit_per_player=excluded.purchase_limit_per_player,
                available_from=excluded.available_from,available_until=excluded.available_until,
                banner_resource_hash=excluded.banner_resource_hash,updated_at=excluded.updated_at,extra_json=excluded.extra_json`,
        bind: [id, normalized.itemId, String(record.name || 'Untitled item'), textOrNull(record.description), normalized.type,
          textOrNull(record.itemClass), textOrNull(record.category), currencyType,
          currencyType === 'tokens' ? Math.max(0, Math.trunc(cost)) : 0,
          currencyType === 'dollars' ? currencyToMinor(cost) : 0,
          Number.isFinite(Number(record.quantity)) ? Math.max(0, Math.trunc(Number(record.quantity))) : null,
          finite(record.duration), finite(record.enjoyment), Math.max(0, Math.trunc(Number(record.cooldownMs) || 0)),
          record.stockLimit == null || record.stockLimit === '' ? null : Math.max(0, Math.trunc(Number(record.stockLimit) || 0)),
          Math.max(0, Math.trunc(Number(record.soldCount) || 0)),
          record.purchaseLimitPerPlayer == null || record.purchaseLimitPerPlayer === '' ? null : Math.max(1, Math.trunc(Number(record.purchaseLimitPerPlayer) || 1)),
          textOrNull(record.availableFrom), textOrNull(record.availableUntil), bannerHash,
          textOrNull(record.createdAt), textOrNull(record.updatedAt), boundedJson(omitKeys(record, SHOP_KEYS))], result: 'changes',
      });
    }

    for (const record of inventoryInput.selected) {
      const id = String(record.UUID);
      const playerId = playerIds.has(record.parent) ? record.parent : null;
      if (!playerId) { diagnostics.push({ kind: 'inventory-item', recordId: id, reason: 'unknown-player', playerId: record.parent }); continue; }
      const shopItemId = record.itemUUID && shopById.has(record.itemUUID) ? record.itemUUID : null;
      let bannerHash = textOrNull(record.bannerResourceHash);
      if (bannerHash && !resourceHashes.has(bannerHash)) bannerHash = null;
      statements.push({
        sql: `INSERT INTO inventory_items(
                id,player_id,shop_item_id,item_id,name_snapshot,description_snapshot,item_type,item_class,category_snapshot,
                quantity,duration_minutes,enjoyment,cooldown_ms,last_used_at,use_count,purchased_at,purchase_count,
                cooldown_until,banner_resource_hash,extra_json
              ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
              ON CONFLICT(id) DO UPDATE SET
                player_id=excluded.player_id,shop_item_id=excluded.shop_item_id,item_id=excluded.item_id,
                name_snapshot=excluded.name_snapshot,description_snapshot=excluded.description_snapshot,
                item_type=excluded.item_type,item_class=excluded.item_class,category_snapshot=excluded.category_snapshot,
                quantity=excluded.quantity,duration_minutes=excluded.duration_minutes,enjoyment=excluded.enjoyment,
                cooldown_ms=excluded.cooldown_ms,last_used_at=excluded.last_used_at,use_count=excluded.use_count,
                purchased_at=excluded.purchased_at,purchase_count=excluded.purchase_count,cooldown_until=excluded.cooldown_until,
                banner_resource_hash=excluded.banner_resource_hash,extra_json=excluded.extra_json`,
        bind: [id, playerId, shopItemId, textOrNull(record.itemId), String(record.name || 'Unknown item'),
          textOrNull(record.description), textOrNull(record.type) || 'quantity', textOrNull(record.itemClass), textOrNull(record.category),
          Math.max(0, Math.trunc(Number(record.quantity) || 0)), finite(record.duration), finite(record.enjoyment),
          Math.max(0, Math.trunc(Number(record.cooldownMs) || 0)), textOrNull(record.lastUsedAt), Math.max(0, Math.trunc(Number(record.useCount) || 0)),
          textOrNull(record.purchasedAt), Math.max(0, Math.trunc(Number(record.purchaseCount) || 0)), textOrNull(record.cooldownUntil),
          bannerHash, boundedJson(omitKeys(record, INVENTORY_KEYS))], result: 'changes',
      });
    }

    const batches = new Map();
    for (const record of transactionInput.selected) {
      if (record.type && record.type !== 'shop_purchase') continue;
      const batchId = textOrNull(record.purchaseBatchUUID);
      if (!batchId) {
        diagnostics.push({ kind: 'purchase-ledger', recordId: record.UUID, reason: 'missing-purchase-batch' });
        continue;
      }
      const playerId = playerIds.has(record.parent) ? record.parent : null;
      const currencyType = record.currencyType === 'dollars' ? 'dollars' : 'tokens';
      const quantity = Math.max(1, Math.trunc(Number(record.quantity) || 1));
      const unitCost = Math.max(0, finite(record.unitCost) ?? (finite(record.totalCost ?? record.cost) ?? 0) / quantity);
      const totalCost = Math.max(0, finite(record.totalCost ?? record.cost) ?? unitCost * quantity);
      const batch = batches.get(batchId) || { playerId, occurredAt: textOrNull(record.createdAt) || timestamp, tokenCost: 0, moneyCostMinor: 0, itemCount: 0 };
      if (currencyType === 'dollars') batch.moneyCostMinor += currencyToMinor(totalCost);
      else batch.tokenCost += Math.trunc(totalCost);
      batch.itemCount += quantity;
      batches.set(batchId, batch);
      statements.push({
        sql: `INSERT INTO purchase_ledger(
                id,purchase_batch_id,player_id,shop_item_id,item_name_snapshot,description_snapshot,category_snapshot,
                currency_type,quantity,unit_cost_tokens,unit_cost_money_minor,total_cost_tokens,total_cost_money_minor,
                occurred_at,in_game_timestamp,metadata_json
              ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
              ON CONFLICT(id) DO UPDATE SET metadata_json=excluded.metadata_json`,
        bind: [String(record.UUID), batchId, playerId, record.itemUUID && shopById.has(record.itemUUID) ? record.itemUUID : null,
          String(record.name || 'Unknown item'), textOrNull(record.description), textOrNull(record.category), currencyType, quantity,
          currencyType === 'tokens' ? Math.trunc(unitCost) : 0, currencyType === 'dollars' ? currencyToMinor(unitCost) : 0,
          currencyType === 'tokens' ? Math.trunc(totalCost) : 0, currencyType === 'dollars' ? currencyToMinor(totalCost) : 0,
          textOrNull(record.createdAt) || timestamp,
          Number.isFinite(Number(record.inGameTimestamp)) ? Math.trunc(Number(record.inGameTimestamp)) : null,
          boundedJson(omitKeys(record, TRANSACTION_KEYS), 65536)], result: 'changes',
      });
    }
    // Purchase batches must precede ledger rows. Move ledger statements after batch inserts.
    const ledgerStatements = statements.splice(shopInput.selected.length + inventoryInput.selected.filter((record) => playerIds.has(record.parent)).length);
    for (const [batchId, batch] of [...batches.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      statements.push({
        sql: `INSERT INTO purchase_batches(
                id,player_id,status,token_cost,money_cost_minor,item_count,occurred_at,operation_id,metadata_json
              ) VALUES(?,?,'committed',?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`,
        bind: [batchId, batch.playerId, batch.tokenCost, batch.moneyCostMinor, batch.itemCount, batch.occurredAt,
          `data-import:${batchId}`, stableJson({ imported: true })], result: 'changes',
      });
    }
    statements.push(...ledgerStatements);

    const counts = {
      shopItems: shopInput.selected.length,
      inventoryItems: inventoryInput.selected.filter((record) => playerIds.has(record.parent)).length,
      purchaseBatches: batches.size,
      purchaseLedger: ledgerStatements.length,
      diagnostics: diagnostics.length,
    };
    const effectiveRunId = runId || `commerce:${sourceFingerprint.slice(0, 24)}`;
    statements.push(...createImportLedgerStatements({
      runId: effectiveRunId, domain: 'commerce', sourceFingerprint, importerVersion: IMPORTER_VERSION,
      startedAt: timestamp, finishedAt: timestamp, counts, diagnostics,
    }));
    await this.client.executeAtomic({ commandId: `shadow-import:${effectiveRunId}`, label: 'commerce-shadow-import', statements });
    return { duplicate: false, runId: effectiveRunId, sourceFingerprint, counts, diagnostics };
  }
}

export default CommerceShadowImporter;
