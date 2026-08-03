function throwIfError(error) {
  if (!error) return;
  const next = new Error(error.message || 'The private sync server request failed.');
  next.code = error.code || 'supabase-sync-error';
  next.details = error.details || null;
  throw next;
}

function inactiveMobilePublishSession(error) {
  const message = [error?.message, error?.details, error?.code]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return /mobile working-set publish session.*(?:no longer active|inactive|expired)/.test(message)
    || /publish (?:session|token).*(?:no longer active|inactive|invalid|expired)/.test(message);
}

function mobilePublishFingerprint(records = []) {
  return records
    .map((record) => [record?.recordType, record?.recordId, record?.updatedAt].map(String).join(':'))
    .sort()
    .join('|');
}

function operationInput(operation) {
  const payload = operation.payload || {};
  return {
    operationId: operation.operationId,
    playerId: operation.playerId,
    workspaceId: operation.workspaceId,
    deviceId: operation.deviceId,
    deviceSequence: operation.deviceSequence,
    commandType: operation.commandType,
    entityType: operation.entityType,
    entityId: operation.entityId,
    baseVersion: operation.baseVersion,
    payload: operation.workspaceId && !payload.workspaceId
      ? { ...payload, workspaceId: operation.workspaceId }
      : payload,
    occurredAt: operation.occurredAt,
  };
}

function pullEntry(row) {
  return Object.freeze({
    serverSequence: Number(row.server_sequence),
    operationId: String(row.operation_id),
    playerId: row.player_id == null ? null : String(row.player_id),
    workspaceId: row.workspace_id == null ? null : String(row.workspace_id),
    originDeviceId: String(row.origin_device_id),
    deviceSequence: row.device_sequence == null ? null : Number(row.device_sequence),
    commandType: String(row.command_type),
    entityType: String(row.entity_type),
    entityId: String(row.entity_id),
    baseVersion: row.base_version == null ? null : Number(row.base_version),
    payload: row.payload || {},
    occurredAt: String(row.occurred_at),
    status: String(row.status),
    acceptedAt: String(row.accepted_at),
    result: row.result_json || {},
  });
}

const MOBILE_RESOURCE_BUCKET = 'tapestry-mobile-resources';

const ROUTINE_COMMANDS = new Set([
  'startRoutineRun',
  'completeRoutineStep',
  'completeRoutineRun',
]);

const CHRONICLE_COMMANDS = new Set([
  'createChronicleEntry',
  'updateChronicleEntry',
  'changeChronicleAccess',
  'archiveChronicleEntry',
  'setChronicleLock',
]);
const GOAL_COMMANDS = new Set(['recordGoalUpdate']);
const MATCH_COMMANDS = new Set(['createMatch', 'updateMatch', 'completeMatch']);

function pushRpcName(operation) {
  if (ROUTINE_COMMANDS.has(operation?.commandType)) return 'apply_routine_sync_batch';
  if (CHRONICLE_COMMANDS.has(operation?.commandType)) return 'apply_chronicle_sync_batch';
  if (GOAL_COMMANDS.has(operation?.commandType)) return 'apply_goal_sync_batch';
  if (MATCH_COMMANDS.has(operation?.commandType)) return 'apply_match_sync_batch';
  return 'apply_sync_batch';
}

export class SupabaseSyncTransport {
  constructor({ client, ownerId } = {}) {
    if (!client?.rpc || !client?.channel) throw new Error('Supabase sync transport requires a client.');
    this.client = client;
    this.ownerId = String(ownerId || '');
    this.channel = null;
    this.mobileReferencePublishTail = Promise.resolve();
    this.mobileReferencePublishes = new Map();
  }

  async registerDevice(device) {
    const { data, error } = await this.client.rpc('register_sync_device', {
      p_device_id: device.id,
      p_display_name: device.displayName,
      p_platform: device.platform,
    });
    throwIfError(error);
    return data;
  }

  async prepareShopAuthority({ player, catalog = [], inventory = [], globalMoney = 0 } = {}) {
    const { data, error } = await this.client.rpc('prepare_shop_authority', {
      p_player: player,
      p_catalog: catalog,
      p_inventory: inventory,
      p_global_money: Number(globalMoney) || 0,
    });
    throwIfError(error);
    return data;
  }

  async purchaseShopItems({ operationId, deviceId, playerId, cart, occurredAt } = {}) {
    const { data, error } = await this.client.rpc('purchase_shop_items', {
      p_operation_id: operationId,
      p_device_id: deviceId,
      p_player_id: playerId,
      p_cart: cart,
      p_occurred_at: occurredAt,
    });
    throwIfError(error);
    return data;
  }

  async activateShopItem({ operationId, deviceId, playerId, inventoryId } = {}) {
    const { data, error } = await this.client.rpc('activate_shop_item', {
      p_operation_id: operationId,
      p_device_id: deviceId,
      p_player_id: playerId,
      p_inventory_id: inventoryId,
    });
    throwIfError(error);
    return data;
  }

  async cancelShopEffect({ operationId, deviceId, playerId, intervalId } = {}) {
    const { data, error } = await this.client.rpc('cancel_shop_effect', {
      p_operation_id: operationId,
      p_device_id: deviceId,
      p_player_id: playerId,
      p_interval_id: intervalId,
    });
    throwIfError(error);
    return data;
  }

  async getShopAuthority(playerId) {
    const { data, error } = await this.client.rpc('get_shop_authority', {
      p_player_id: playerId,
    });
    throwIfError(error);
    return data;
  }

  async registerWebPushSubscription(subscription = {}) {
    const { data, error } = await this.client.rpc('register_web_push_subscription', {
      p_endpoint: subscription.endpoint,
      p_p256dh: subscription.keys?.p256dh,
      p_auth: subscription.keys?.auth,
      p_user_agent: typeof navigator === 'undefined' ? null : navigator.userAgent,
    });
    throwIfError(error);
    return data;
  }

  async unregisterWebPushSubscription(endpoint) {
    const { data, error } = await this.client.rpc('unregister_web_push_subscription', {
      p_endpoint: endpoint,
    });
    throwIfError(error);
    return data;
  }

  async getServerIntegrity() {
    const { data, error } = await this.client.rpc('get_tapestry_server_integrity');
    throwIfError(error);
    return data;
  }

  async exportServerSnapshot() {
    const { data, error } = await this.client.rpc('export_tapestry_server_snapshot');
    throwIfError(error);
    return data;
  }

  async mergeMobileReferenceRecords(records = []) {
    let merged = 0;
    for (let index = 0; index < records.length; index += 500) {
      // eslint-disable-next-line no-await-in-loop
      const { data, error } = await this.client.rpc('merge_mobile_reference_records', {
        p_records: records.slice(index, index + 500),
      });
      throwIfError(error);
      merged += Number(data?.merged || 0);
    }
    return { merged };
  }

  async replaceMobileReferenceRecords(records = []) {
    const snapshot = [...records];
    const fingerprint = mobilePublishFingerprint(snapshot);
    const inFlight = this.mobileReferencePublishes.get(fingerprint);
    if (inFlight) return inFlight;

    const publish = this.mobileReferencePublishTail
      .catch(() => undefined)
      .then(async () => {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            const { data: publishToken, error: beginError } = await this.client.rpc('begin_mobile_reference_publish');
            throwIfError(beginError);
            let merged = 0;
            for (let index = 0; index < snapshot.length; index += 500) {
              // eslint-disable-next-line no-await-in-loop
              const { data, error } = await this.client.rpc('merge_mobile_reference_publish', {
                p_publish_token: publishToken,
                p_records: snapshot.slice(index, index + 500),
              });
              throwIfError(error);
              merged += Number(data?.merged || 0);
            }
            const { data: finalized, error: finalizeError } = await this.client.rpc('finalize_mobile_reference_publish', {
              p_publish_token: publishToken,
            });
            throwIfError(finalizeError);
            return { merged, pruned: Number(finalized?.pruned || 0) };
          } catch (error) {
            if (attempt === 0 && inactiveMobilePublishSession(error)) continue;
            throw error;
          }
        }
        throw new Error('The mobile working-set publish did not complete.');
      });

    this.mobileReferencePublishTail = publish;
    this.mobileReferencePublishes.set(fingerprint, publish);
    publish.then(
      () => this.mobileReferencePublishes.delete(fingerprint),
      () => this.mobileReferencePublishes.delete(fingerprint),
    );
    return publish;
  }

  async uploadDatabaseCheckpoint({ bytes, deviceId, createdAt = new Date().toISOString() } = {}) {
    const storage = this.client.storage?.from?.(MOBILE_RESOURCE_BUCKET);
    if (!storage || !bytes?.byteLength || !deviceId) {
      return { uploaded: false, reason: 'checkpoint-storage-unavailable' };
    }
    const safeDeviceId = encodeURIComponent(String(deviceId));
    const root = `${this.ownerId}/database-checkpoints/devices/${safeDeviceId}`;
    const databasePath = `${root}/tapestry.sqlite`;
    const deviceManifestPath = `${root}/manifest.json`;
    const latestManifestPath = `${this.ownerId}/database-checkpoints/latest.json`;
    const { error: databaseError } = await storage.upload(databasePath, bytes, {
      upsert: true,
      contentType: 'application/vnd.sqlite3',
      cacheControl: '0',
    });
    throwIfError(databaseError);
    const manifestRecord = {
      version: 2,
      ownerId: this.ownerId,
      deviceId: String(deviceId),
      databasePath,
      byteLength: bytes.byteLength,
      createdAt,
    };
    const manifest = new TextEncoder().encode(JSON.stringify(manifestRecord));
    const { error: deviceManifestError } = await storage.upload(deviceManifestPath, manifest, {
      upsert: true,
      contentType: 'application/json',
      cacheControl: '0',
    });
    throwIfError(deviceManifestError);
    // The latest manifest is a small pointer written only after the database
    // object succeeds. A clean device can therefore restore directly from the
    // cloud without asking the user for a ZIP or local folder.
    const { error: latestManifestError } = await storage.upload(latestManifestPath, manifest, {
      upsert: true,
      contentType: 'application/json',
      cacheControl: '0',
    });
    throwIfError(latestManifestError);
    return {
      uploaded: true,
      databasePath,
      manifestPath: deviceManifestPath,
      latestManifestPath,
      byteLength: bytes.byteLength,
      createdAt,
    };
  }

  async downloadDatabaseCheckpoint() {
    const storage = this.client.storage?.from?.(MOBILE_RESOURCE_BUCKET);
    if (!storage?.download) return { found: false, reason: 'checkpoint-storage-unavailable' };
    const latestManifestPath = `${this.ownerId}/database-checkpoints/latest.json`;
    const { data: manifestBlob, error: manifestError } = await storage.download(latestManifestPath);
    if (manifestError) {
      const missing = String(manifestError?.statusCode || manifestError?.status || manifestError?.code || '') === '404'
        || /not found|does not exist/i.test(String(manifestError?.message || ''));
      if (missing) return { found: false, reason: 'checkpoint-not-found' };
      throwIfError(manifestError);
    }
    let manifest;
    try {
      manifest = JSON.parse(await manifestBlob.text());
    } catch (error) {
      const next = new Error('The cloud database checkpoint manifest is invalid.');
      next.code = 'checkpoint-manifest-invalid';
      next.cause = error;
      throw next;
    }
    if (String(manifest?.ownerId || '') !== this.ownerId || !manifest?.databasePath) {
      const next = new Error('The cloud database checkpoint does not belong to this account.');
      next.code = 'checkpoint-owner-mismatch';
      throw next;
    }
    const { data: databaseBlob, error: databaseError } = await storage.download(String(manifest.databasePath));
    throwIfError(databaseError);
    const bytes = new Uint8Array(await databaseBlob.arrayBuffer());
    const expectedBytes = Math.max(0, Number(manifest.byteLength) || 0);
    if (!bytes.byteLength || (expectedBytes && bytes.byteLength !== expectedBytes)) {
      const next = new Error('The cloud database checkpoint is incomplete.');
      next.code = 'checkpoint-size-mismatch';
      throw next;
    }
    return {
      found: true,
      bytes,
      manifest,
      latestManifestPath,
    };
  }

  async getMobileReferenceRecords(recordTypes = null) {
    const filtered = Array.isArray(recordTypes) && recordTypes.length > 0;
    const { data, error } = await this.client.rpc(
      filtered ? 'get_mobile_reference_records_by_type' : 'get_mobile_reference_records',
      filtered ? { p_record_types: [...new Set(recordTypes.map(String))] } : undefined,
    );
    throwIfError(error);
    return Array.isArray(data) ? data : [];
  }

  async publishMobileResources(resources = []) {
    const candidates = resources.filter((record) => (
      record?.UUID && record?.hash && record?.blob instanceof Blob
    ));
    if (!candidates.length) return { uploaded: 0, registered: 0 };
    const resourceIds = candidates.map((record) => record.UUID);
    const { data: existingRows, error: lookupError } = await this.client
      .from('mobile_resource_metadata')
      .select('resource_id,content_hash')
      .in('resource_id', resourceIds);
    throwIfError(lookupError);
    const existing = new Map((existingRows || []).map((row) => [String(row.resource_id), row.content_hash]));
    const metadata = [];
    let uploaded = 0;
    for (const record of candidates) {
      const storagePath = `${this.ownerId}/${record.hash}`;
      if (existing.get(String(record.UUID)) !== record.hash) {
        // Hash paths make this safe across duplicate resource references.
        // eslint-disable-next-line no-await-in-loop
        const { error: uploadError } = await this.client.storage
          .from(MOBILE_RESOURCE_BUCKET)
          .upload(storagePath, record.blob, {
            contentType: record.mimeType || record.blob.type || 'application/octet-stream',
            cacheControl: '31536000',
            upsert: false,
          });
        if (uploadError && !/already exists|duplicate/i.test(uploadError.message || '')) throwIfError(uploadError);
        uploaded += uploadError ? 0 : 1;
      }
      metadata.push({
        owner_id: this.ownerId,
        resource_id: record.UUID,
        content_hash: record.hash,
        mime_type: record.mimeType || record.blob.type || 'application/octet-stream',
        byte_size: Number(record.sizeBytes || record.blob.size),
        width: record.width || null,
        height: record.height || null,
        kind: record.kind || 'image',
        storage_path: storagePath,
        updated_at: new Date().toISOString(),
      });
    }
    const { error: metadataError } = await this.client
      .from('mobile_resource_metadata')
      .upsert(metadata, { onConflict: 'owner_id,resource_id' });
    throwIfError(metadataError);
    return { uploaded, registered: metadata.length };
  }

  async downloadMobileResource(resourceUUID) {
    const { data: metadata, error: metadataError } = await this.client
      .from('mobile_resource_metadata')
      .select('resource_id,content_hash,mime_type,byte_size,width,height,kind,storage_path,created_at')
      .eq('resource_id', resourceUUID)
      .maybeSingle();
    throwIfError(metadataError);
    if (!metadata) return null;
    const { data: blob, error: downloadError } = await this.client.storage
      .from(MOBILE_RESOURCE_BUCKET)
      .download(metadata.storage_path);
    throwIfError(downloadError);
    return {
      UUID: metadata.resource_id,
      hash: metadata.content_hash,
      mimeType: metadata.mime_type,
      sizeBytes: Number(metadata.byte_size || blob?.size || 0),
      width: metadata.width,
      height: metadata.height,
      kind: metadata.kind || 'image',
      blob,
      createdAt: metadata.created_at || new Date().toISOString(),
      parent: null,
      usedBy: [],
      remoteCached: true,
    };
  }

  async push({ operations = [] } = {}) {
    if (!operations.length) return [];
    const results = [];
    let index = 0;
    while (index < operations.length) {
      const rpcName = pushRpcName(operations[index]);
      const segment = [];
      while (index < operations.length && pushRpcName(operations[index]) === rpcName) {
        segment.push(operations[index]);
        index += 1;
      }
      // Consecutive segments preserve the device sequence even when commands
      // are handled by separate narrow server RPCs.
      // eslint-disable-next-line no-await-in-loop
      const { data, error } = await this.client.rpc(rpcName, {
        p_operations: segment.map(operationInput),
      });
      throwIfError(error);
      results.push(...(Array.isArray(data) ? data : []));
    }
    return results;
  }

  async pull({ after = 0, limit = 100 } = {}) {
    const { data, error } = await this.client.rpc('pull_sync_log', {
      p_after: Math.max(0, Number(after) || 0),
      p_limit: Math.max(1, Math.min(500, Number(limit) || 100)),
    });
    throwIfError(error);
    return (data || []).map(pullEntry);
  }

  subscribe(onNudge) {
    this.unsubscribe();
    if (!this.ownerId || typeof onNudge !== 'function') return () => undefined;
    this.channel = this.client
      .channel(`tapestry-sync-${this.ownerId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'sync_log',
        filter: `owner_id=eq.${this.ownerId}`,
      }, () => onNudge())
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'mobile_reference_records',
        filter: `owner_id=eq.${this.ownerId}`,
      }, () => onNudge())
      .subscribe();
    return () => this.unsubscribe();
  }

  unsubscribe() {
    const channel = this.channel;
    this.channel = null;
    if (channel) void this.client.removeChannel(channel);
  }
}

export default SupabaseSyncTransport;
